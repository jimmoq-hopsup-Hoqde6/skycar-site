#!/bin/bash
# Real-concurrency lock-order regression gate for the integrated chain (adopted from QA's stress_week1.sh).
#
# Why this and not injected sleeps: a sleep placed AFTER a function's locks only exposes a lock that is taken
# late, never a lock taken in the wrong ORDER. Here one session holds the journey row FOR UPDATE; about twelve
# sessions are then started and all queue behind it (care_journey_command cancel/start, customer review, technician
# start, photo-marker heal x2 and record x2, in-area and out-of-area care_submit_request, availability replace,
# vehicle archive x2). When the holder commits they all race for their locks at once, each in the order its own
# function takes them. An inversion between two of them produces SQLSTATE 40P01 within a few iterations.
#
# Usage: STRESS_DATABASE_URL=postgresql://user@127.0.0.1:PORT/skycar_integration_test [N=4] bash <this file>
# Disposable local database only. Exit 0 only if every iteration ran, with no deadlock and no timeout.
# Output ends with: STRESS-SUMMARY iterations=<n> sessions_per_iter~12 deadlocks(40P01)=<d> stmt_timeouts=<t>
URL=${STRESS_DATABASE_URL:?STRESS_DATABASE_URL is required (disposable local database only)}
case "$URL" in postgresql://*@127.0.0.1:*/skycar_integration_test|postgresql://*@localhost:*/skycar_integration_test) ;; *) echo "refusing: only a local skycar_integration_test database" >&2; exit 2;; esac
Q() { psql "$URL" -X -qAt -v ON_ERROR_STOP=1 "$@"; }
U() { cat /proc/sys/kernel/random/uuid; }
EV='[{"slot":1,"mime_type":"image/jpeg","size_bytes":256,"sha256":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"}]'
waitq() { for i in $(seq 600); do [ "$(Q -c "$1")" != 0 ] && return 0; sleep 0.05; done; echo TIMEOUT; return 1; }
fixture() { # $1 = journey state
 C=$(U);AD=$(U);T=$(U);X=$(U);ID=$(U);V=$(U);QID=$(U);RK=$(U);BK=$(U)
 Q -c "insert into auth.users(id) values('$C'),('$AD'),('$T');
  insert into public.user_roles(user_id,role) values('$AD','admin') on conflict do nothing;
  delete from public.user_roles where user_id='$T'; insert into public.user_roles(user_id,role) values('$T','technician');
  insert into public.care_experts(id,business_name,description,services,postcodes,insurance_valid_until) values('$X','QA tech','Synthetic isolated expert',array['repair'],array['5000'],current_date+30);
  insert into public.care_technician_accounts(expert_id,user_id) values('$X','$T');
  insert into public.vehicles(id,owner_id,make,model,year) values('$V','$C','Toyota','QA deadlock',2020);
  insert into public.care_requests(id,customer_id,vehicle_id,service,description,preferred_window,next_update_at,escalation_minutes,fulfilment_state)
   values('$ID','$C','$V','repair','Synthetic QA deadlock test','flexible',clock_timestamp()+interval '1 hour',30,'$2');
  insert into public.care_journeys(id,account_request_id,customer_details,state,expert_id,starts_at,ends_at)
   values('$ID','$ID','{\"postcode\":\"5000\"}','in_progress','$X',clock_timestamp()-interval '1 hour',clock_timestamp()+interval '1 hour');
  insert into public.care_reviewed_quotes(id,journey_id,expert_id,expert_name,expert_description,scope_summary,total_price_cents,status,expires_at,starts_at,ends_at)
   values('$QID','$ID','$X','QA tech','Synthetic isolated expert','Synthetic repair',10000,'selected',clock_timestamp()-interval '2 hours',clock_timestamp()-interval '1 hour',clock_timestamp()+interval '1 hour');
  update public.care_journeys set selected_quote_id='$QID' where id='$ID';" || return 1
 [ "$1" != in_progress ] && Q -c "update public.care_journeys set state='$1' where id='$ID'"
 return 0
}
REV() { echo "begin;set local statement_timeout='20s';set local role service_role;select public.care_customer_completion_review_command('$C'::uuid,null,'$RK'::uuid,'confirm_completion','$ID'::uuid,'{}'::jsonb);commit;"; }
JC() { # action payload
 echo "begin;set local statement_timeout='20s';set local role service_role;select public.care_journey_command('$1','$ID'::uuid,'$AD'::uuid,null,'$BK'::uuid,'$2'::jsonb);commit;"; }
TS() { echo "begin;set local statement_timeout='20s';set local role service_role;select public.care_technician_work_command('$T'::uuid,'$BK'::uuid,'start','$ID'::uuid,'{}'::jsonb);commit;"; }

HEAL() { echo "begin;set local statement_timeout='20s';set local role service_role;select public.care_heal_request_photo_marker('$ID'::uuid,'account');commit;"; }
REC() { echo "begin;set local statement_timeout='20s';set local role service_role;select public.care_record_request_photos('$ID'::uuid,1,repeat('a',64),'account');commit;"; }
SUB() { echo "begin;set local statement_timeout='20s';set local role authenticated;set local request.jwt.claim.sub='$C';select public.care_submit_request(gen_random_uuid(),jsonb_build_object('vehicle_id','$V','service','repair','description','Another scratch','preferred_window','flexible'));commit;"; }

OOA() { echo "begin;set local statement_timeout='20s';set local role authenticated;set local request.jwt.claim.sub='$C';select public.care_submit_request(gen_random_uuid(),jsonb_build_object('vehicle_id','$V','service','repair','description','OOA scratch','preferred_window','flexible','postcode','5290'));commit;"; }
SUBP() { echo "begin;set local statement_timeout='20s';set local role authenticated;set local request.jwt.claim.sub='$C';select public.care_submit_request(gen_random_uuid(),jsonb_build_object('vehicle_id','$V','service','repair','description','In-area scratch','preferred_window','flexible','postcode','5000'));commit;"; }
AVAIL() { echo "begin;set local statement_timeout='20s';set local role service_role;select public.care_technician_replace_availability('$T'::uuid,gen_random_uuid(),0,'{\"timezone\":\"Australia/Adelaide\",\"weekly_windows\":[{\"weekday\":1,\"starts_at\":\"09:00\",\"ends_at\":\"17:00\"}],\"exceptions\":[]}'::jsonb);commit;"; }
ARCH() { echo "begin;set local statement_timeout='20s';set local role authenticated;set local request.jwt.claim.sub='$C';select public.garage_mutate_vehicle('archive','$V'::uuid,'{\"expected_revision\":1}'::jsonb,gen_random_uuid(),gen_random_uuid());commit;"; }
OUTDIR=$(mktemp -d); trap 'rm -rf "$OUTDIR"' EXIT
TOT=0; DL=0; TO=0; FX=0
iter() { # $1=mix label
 fixture scheduled scheduled || { echo fixture failed; FX=$((FX+1)); return; }
 Q -c "insert into storage.objects(bucket_id,name) select 'private-media','care-requests/$ID/'||n from unnest(array['manifest.json','photo-1']) n" >/dev/null
 Q -c "begin;select 1 from public.care_journeys where id='$ID' for update;select pg_sleep(1.0);/* holder_$ID */commit;" >/dev/null 2>&1 & Hd=$!
 waitq "select count(*) from pg_stat_activity where wait_event='PgSleep' and query like '%holder_$ID%'"
 local pids=() files=(); n=0
 launch() { n=$((n+1)); Q -c "$2" >$OUTDIR/w1_${ID}_$n.out 2>&1 & pids+=($!); files+=($OUTDIR/w1_${ID}_$n.out); }
 case $1 in
  cancel+review) launch j "$(JC cancel '{}')"; launch j "$(REV)"; launch j "$(TS)";;
  start+review)  launch j "$(JC start '{}')"; launch j "$(REV)"; launch j "$(TS)";;
  cancel+archive) launch j "$(JC cancel '{}')"; launch j "$(ARCH)"; launch j "$(REV)";;
 esac
 launch h "$(HEAL)"; launch r "$(REC)"; launch s "$(SUBP)"; launch o "$(OOA)"; launch a "$(AVAIL)"; launch h "$(HEAL)"; launch r "$(REC)"; launch s "$(SUBP)"; launch x "$(ARCH)"
 sleep 0.3; wait $Hd; for p in "${pids[@]}"; do wait $p; done
 TOT=$((TOT+1))
 if cat "${files[@]}" | grep -qi 'deadlock detected'; then DL=$((DL+1)); echo "DEADLOCK in $ID ($1)"; cat "${files[@]}" | grep -i -B1 -A4 deadlock | head -8; fi
 if cat "${files[@]}" | grep -qi 'canceling statement'; then TO=$((TO+1)); echo "TIMEOUT in $ID ($1)"; fi
 ERRS=$(cat "${files[@]}" | grep -i ERROR | sed 's/ERROR: *//' | sort | uniq -c | tr '\n' ';'); echo "iter $1 errors: $ERRS" >> $OUTDIR/errs
 rm -f "${files[@]}"
}

# Ordered queue (deterministic arrival order): the holder keeps the journey row for 5 s; the sessions below are
# started ONE AT A TIME and the next one starts only when the previous is seen waiting on a lock (or has
# finished). So the lock queues form in a known order, forward and reversed, and a lock-order inversion between
# any two of them (for example journey-before-request in care_journey_command against the technician commands,
# which lock request then journey without a vehicle) is hit every time instead of by luck.
iter_ordered() { # $1 = fwd | rev
 fixture scheduled scheduled || { echo fixture failed; FX=$((FX+1)); return; }
 Q -c "insert into storage.objects(bucket_id,name) select 'private-media','care-requests/$ID/'||n from unnest(array['manifest.json','photo-1']) n" >/dev/null
 Q -c "begin;select 1 from public.care_journeys where id='$ID' for update;select pg_sleep(5.0);/* holder_$ID */commit;" >/dev/null 2>&1 & Hd=$!
 waitq "select count(*) from pg_stat_activity where wait_event='PgSleep' and query like '%holder_$ID%'"
 local cmds=("$(JC cancel '{}')" "$(TS)" "$(REV)" "$(HEAL)" "$(REC)" "$(SUBP)" "$(AVAIL)" "$(ARCH)") order=() pids=() files=() k n=0 i
 if [ "$1" = fwd ]; then for k in "${!cmds[@]}"; do order+=("$k"); done; else for ((k=${#cmds[@]}-1;k>=0;k--)); do order+=("$k"); done; fi
 for k in "${order[@]}"; do
  n=$((n+1)); PGAPPNAME="sess_${ID}_$n" Q -c "${cmds[$k]}" >$OUTDIR/o_${ID}_$n.out 2>&1 & pids+=($!); files+=($OUTDIR/o_${ID}_$n.out)
  for i in $(seq 80); do
   kill -0 ${pids[-1]} 2>/dev/null || break
   [ "$(Q -c "select count(*) from pg_stat_activity where application_name='sess_${ID}_$n' and wait_event_type='Lock'")" != 0 ] && break
   sleep 0.05
  done
 done
 wait $Hd; for p in "${pids[@]}"; do wait $p; done
 TOT=$((TOT+1))
 if cat "${files[@]}" | grep -qi 'deadlock detected'; then DL=$((DL+1)); echo "DEADLOCK in $ID (ordered $1)"; cat "${files[@]}" | grep -i -B1 -A4 deadlock | head -8; fi
 if cat "${files[@]}" | grep -qi 'canceling statement'; then TO=$((TO+1)); echo "TIMEOUT in $ID (ordered $1)"; fi
 ERRS=$(cat "${files[@]}" | grep -i ERROR | sed 's/ERROR: *//' | sort | uniq -c | tr '\n' ';'); echo "iter ordered-$1 errors: $ERRS" >> $OUTDIR/errs
 rm -f "${files[@]}"
}
N=${N:-4}
for i in $(seq $N); do for mix in cancel+review start+review cancel+archive; do iter $mix; done; iter_ordered fwd; iter_ordered rev; done
echo "errors seen (distinct):"; sed 's/^iter [^ ]* errors: //' $OUTDIR/errs 2>/dev/null | tr ';' '\n' | sed 's/^ *[0-9]* //' | sort | uniq -c | sort -rn; rm -f $OUTDIR/errs
echo "STRESS-SUMMARY iterations=$TOT sessions_per_iter~12 deadlocks(40P01)=$DL stmt_timeouts=$TO"
[ "$FX" -eq 0 ] && [ "$TOT" -ge 1 ] && [ "$DL" -eq 0 ] && [ "$TO" -eq 0 ]
