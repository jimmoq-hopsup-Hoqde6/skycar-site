import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {readdirSync,readFileSync} from 'node:fs';

// Disposable PostgreSQL only. Proves the SQL/RLS/lock contract for #53; it does not
// prove hosted Supabase JWT/Auth, the HTTP route, or any browser behaviour.
export async function verifyTechnicianAvailability({sql,auth,quote,result,waitForQuery}) {
  let checks=0;
  const equal=(actual,expected,label)=>{assert.deepEqual(actual,expected,label);checks++;};
  const run=statement=>Promise.resolve().then(()=>sql(statement));
  const json=async statement=>JSON.parse((await run(statement)).split('\n')[0]);
  const fail=async(statement,...codes)=>{
    await assert.rejects(()=>run(statement),error=>{
      const output=`${error.message}\n${error.stderr||''}`;
      return codes.every(code=>output.includes(code));
    },codes.join('+'));
    checks++;
  };
  const service=statement=>`begin;set local role service_role;${statement};commit;`;
  const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));

  const admin=randomUUID(),customer=randomUUID(),techA=randomUUID(),techB=randomUUID(),unlinked=randomUUID(),inactive=randomUUID(),roleless=randomUUID();
  const expertA=randomUUID(),expertB=randomUUID(),expertInactive=randomUUID(),expertRoleless=randomUUID();
  await run(`insert into auth.users(id) values(${quote(admin)}),(${quote(customer)}),(${quote(techA)}),(${quote(techB)}),(${quote(unlinked)}),(${quote(inactive)}),(${quote(roleless)});
    insert into public.user_roles(user_id,role) values(${quote(admin)},'admin'),(${quote(techA)},'technician'),(${quote(techB)},'technician'),(${quote(unlinked)},'technician'),(${quote(inactive)},'technician');
    insert into public.care_experts(id,business_name,description,services,postcodes,insurance_valid_until) values
      (${quote(expertA)},'Availability expert A','Disposable availability fixture',array['repair'],array['5000'],'2099-12-31'),
      (${quote(expertB)},'Availability expert B','Disposable availability fixture',array['repair'],array['5000'],'2099-12-31'),
      (${quote(expertInactive)},'Availability inactive','Disposable availability fixture',array['repair'],array['5000'],'2099-12-31'),
      (${quote(expertRoleless)},'Availability roleless','Disposable availability fixture',array['repair'],array['5000'],'2099-12-31');
    insert into public.care_technician_accounts(expert_id,user_id,active) values
      (${quote(expertA)},${quote(techA)},true),(${quote(expertB)},${quote(techB)},true),
      (${quote(expertInactive)},${quote(inactive)},false),(${quote(expertRoleless)},${quote(roleless)},true);`);

  const today=await run("select (clock_timestamp() at time zone 'Australia/Adelaide')::date");
  const plus=days=>run(`select (${quote(today)}::date+${days})::text`);
  const offsetAt=async date=>{
    const minutes=Number(await run(`select ((extract(epoch from (${quote(date)}::timestamp+interval '12 hours') at time zone 'UTC')-extract(epoch from (${quote(date)}::timestamp+interval '12 hours') at time zone 'Australia/Adelaide'))/60)::int`));
    return minutes===630?'+10:30':'+09:30';
  };
  const body=(revision,weekly=[],exceptions=[],extra={})=>({expected_revision:revision,timezone:'Australia/Adelaide',weekly_windows:weekly,exceptions,...extra});
  const replace=(actor,payload,key=randomUUID())=>service(`select public.care_technician_availability_replace(${actor?`${quote(actor)}::uuid`:'null'},${key?`${quote(key)}::uuid`:'null'},${quote(JSON.stringify(payload))}::jsonb)`);
  const read=actor=>service(`select public.care_technician_availability_read(${actor?`${quote(actor)}::uuid`:'null'})`);
  const check=async(expert,starts,ends)=>run(service(`select public.care_technician_availability_check(${quote(expert)}::uuid,${quote(starts)}::timestamptz,${quote(ends)}::timestamptz)`)).then(x=>x.split('\n')[0]);
  const revisionOf=async actor=>(await json(read(actor))).revision;
  const count=table=>run(`select count(*) from public.${table}`);
  const weekdayWindows=[{weekday:1,starts_at:'09:00',ends_at:'12:00'},{weekday:1,starts_at:'13:00',ends_at:'17:00'},{weekday:2,starts_at:'09:00',ends_at:'17:00'},{weekday:7,starts_at:'22:00',ends_at:'24:00'}];

  // ---- Authority: role, link and key checks precede everything. -----------------------------
  await fail(replace(customer,body(0)),'FORBIDDEN');
  await fail(replace(null,body(0)),'FORBIDDEN');
  await fail(replace(admin,body(0)),'FORBIDDEN');
  await fail(replace(unlinked,body(0)),'NOT_FOUND');
  await fail(replace(inactive,body(0)),'NOT_FOUND');
  await fail(replace(roleless,body(0)),'FORBIDDEN');
  await fail(read(customer),'FORBIDDEN');await fail(read(unlinked),'NOT_FOUND');
  await fail(replace(techA,body(0),null),'VALIDATION_FAILED');
  await fail(service(`select public.care_technician_availability_replace(${quote(techA)}::uuid,gen_random_uuid(),'[]'::jsonb)`),'VALIDATION_FAILED');
  equal(await count('care_technician_availability_commands'),'0','rejected calls leave no ledger row');
  const empty=await json(read(techA));
  equal([empty.revision,empty.weekly_windows,empty.exceptions,empty.timezone],[0,[],[],'Australia/Adelaide'],'unconfigured schedule is a successful empty record');
  equal(await check(expertA,'2031-01-06 10:00+10:30','2031-01-06 11:00+10:30'),'AVAILABILITY_REQUIRED','empty never means always available');

  // ---- Browser roles: no direct RPC or write access. -----------------------------------------
  const rpcArgs=`${quote(techA)}::uuid,gen_random_uuid(),'{}'::jsonb`;
  await fail(auth(techA,`select public.care_technician_availability_replace(${rpcArgs})`),'permission denied');
  await fail(auth(techA,`select public.care_technician_availability_read(${quote(techA)}::uuid)`),'permission denied');
  await fail(auth(techA,`select public.care_technician_availability_check(${quote(expertA)}::uuid,now(),now()+interval '1 hour')`),'permission denied');
  await fail(`begin;set local role anon;select public.care_technician_availability_replace(${rpcArgs});commit`,'permission denied');
  for(const table of ['care_technician_availability','care_technician_availability_exceptions','care_technician_availability_windows','care_technician_availability_commands']){
    await fail(`begin;set local role anon;select * from public.${table};commit`,'permission denied');
    await fail(auth(techA,`insert into public.${table}(${table.endsWith('commands')?'actor_id':'expert_id'}) select ${table.endsWith('commands')?'actor_id':'expert_id'} from public.${table} limit 0`),'permission denied');
    await fail(auth(techA,`delete from public.${table}`),'permission denied');
  }
  await fail(auth(techA,'select * from public.care_technician_availability_commands'),'permission denied');
  await fail(auth(techA,`update public.care_technician_availability set revision=99 where expert_id=${quote(expertA)}::uuid`),'permission denied');
  await fail(auth(techA,`insert into public.care_technician_availability(expert_id) values(${quote(expertA)}::uuid)`),'permission denied');
  await fail(auth(techA,`update public.care_technician_availability_windows set end_minute=1440`),'permission denied');

  // ---- Replace, replay, conflict, revision. ---------------------------------------------------
  const journeysBefore=await count('care_journeys'),eventsBefore=await count('care_journey_events'),commandsBefore=await count('care_journey_commands');
  const keyA=randomUUID();
  const exDate=await plus(30),dayOff=await plus(31);
  const exOffset=await offsetAt(exDate);
  const payloadA=body(0,weekdayWindows,[
    {date:exDate,windows:[{starts_at:'10:00',starts_at_offset:exOffset,ends_at:'14:00',ends_at_offset:exOffset}]},
    {date:dayOff,windows:[]}]);
  equal(await json(replace(techA,payloadA,keyA)),{revision:1,replayed:false});
  equal(await json(replace(techA,payloadA,keyA)),{revision:1,replayed:true},'exact retry replays');
  equal(await count('care_technician_availability_commands'),'1','one ledger row after replay');
  equal(await run(`select count(*) from public.audit_events where action='care.technician_availability_replace' and resource_id=${quote(expertA)}`),'1','one audit row after replay');
  await fail(replace(techA,{...payloadA,weekly_windows:[]},keyA),'IDEMPOTENCY_CONFLICT');
  equal(await revisionOf(techA),1,'conflicting key reuse does not mutate');
  const stored=await json(read(techA));
  equal(stored.weekly_windows,weekdayWindows,'read returns canonical weekly windows incl. 24:00 end');
  equal(stored.exceptions,[{date:exDate,windows:payloadA.exceptions[0].windows},{date:dayOff,windows:[]}],'read returns exceptions with offsets');
  await fail(replace(techA,body(0,[]),randomUUID()),'REVISION_CONFLICT');
  await fail(replace(techA,body(5,[]),randomUUID()),'REVISION_CONFLICT');
  equal(await revisionOf(techA),1,'stale revision leaves schedule untouched');
  equal((await json(read(techA))).weekly_windows.length,4);
  equal(await json(replace(techA,body(1,[{weekday:3,starts_at:'08:00',ends_at:'09:00'}]))),{revision:2,replayed:false},'edit replaces whole schedule');
  equal((await json(read(techA))).exceptions,[],'edit removed the dated exceptions');
  equal(await run(`select count(*) from public.care_technician_availability_windows where expert_id=${quote(expertA)}`),'1');
  equal(await count('care_journeys'),journeysBefore,'no booking ledger row created');
  equal(await count('care_journey_events'),eventsBefore);equal(await count('care_journey_commands'),commandsBefore);
  equal(await json(replace(techB,body(0,[{weekday:4,starts_at:'10:00',ends_at:'11:00'}],[]),keyA)),{revision:1,replayed:false},'same key value under another actor is independent');
  equal((await json(read(techB))).weekly_windows,[{weekday:4,starts_at:'10:00',ends_at:'11:00'}]);
  equal((await json(read(techA))).weekly_windows,[{weekday:3,starts_at:'08:00',ends_at:'09:00'}],'schedules are isolated per expert');

  // ---- RLS allow/deny on direct reads. ---------------------------------------------------------
  const own=table=>run(auth(techA,`select count(*) from public.${table}`)).then(x=>x.split('\n')[0]);
  equal(await own('care_technician_availability'),'1','technician reads exactly its own header');
  equal(await own('care_technician_availability_windows'),'1','technician reads exactly its own windows');
  equal((await run(auth(techA,`select count(*) from public.care_technician_availability where expert_id=${quote(expertB)}`))).split('\n')[0],'0','cannot read another technician');
  equal((await run(auth(techB,`select count(*) from public.care_technician_availability_windows where expert_id=${quote(expertA)}`))).split('\n')[0],'0');
  for(const actor of [customer,admin,unlinked,inactive,roleless]){
    equal((await run(auth(actor,'select count(*) from public.care_technician_availability_windows'))).split('\n')[0],'0','non-owner roles see no rows');
  }
  equal((await run(`begin;set local role authenticated;set local request.jwt.claim.sub='';select count(*) from public.care_technician_availability;commit`)).split('\n')[0],'0','no subject sees nothing');
  await run(`update public.care_technician_accounts set active=false where expert_id=${quote(expertA)}`);
  equal(await own('care_technician_availability'),'0','revoked link removes own-row read');
  await fail(replace(techA,body(2)),'NOT_FOUND');
  await run(`update public.care_technician_accounts set active=true where expert_id=${quote(expertA)}`);
  await run(`delete from public.user_roles where user_id=${quote(techA)} and role='technician'`);
  equal(await own('care_technician_availability'),'0','technician role removal removes own-row read');
  await fail(replace(techA,body(2)),'FORBIDDEN');
  await run(`insert into public.user_roles(user_id,role) values(${quote(techA)},'technician')`);

  // ---- Input validation: nothing is stored on failure. ----------------------------------------
  const baseRevision=await revisionOf(techA),baseCommands=await count('care_technician_availability_commands');
  const w=(weekday,starts_at,ends_at)=>({weekday,starts_at,ends_at});
  const invalid=[
    ['unknown top-level key',{...body(2),extra:1},'BODY'],
    ['missing key',{expected_revision:2,timezone:'Australia/Adelaide',weekly_windows:[]},'BODY'],
    ['negative revision',body(-1),'BODY'],['string revision',{...body(2),expected_revision:'2'},'BODY'],
    ['fractional revision',{...body(2),expected_revision:2.5},'BODY'],
    ['weekly not array',{...body(2),weekly_windows:{}},'BODY'],
    ['wrong timezone',{...body(2),timezone:'Australia/Sydney'},'TIMEZONE'],
    ['weekday 0',body(2,[w(0,'09:00','10:00')]),'WINDOW_SHAPE'],['weekday 8',body(2,[w(8,'09:00','10:00')]),'WINDOW_SHAPE'],
    ['string weekday',body(2,[w('1','09:00','10:00')]),'WINDOW_SHAPE'],
    ['unknown window key',body(2,[{...w(1,'09:00','10:00'),x:1}]),'WINDOW_SHAPE'],
    ['seconds',body(2,[w(1,'09:00:00','10:00')]),'WINDOW_RANGE'],['unpadded hour',body(2,[w(1,'9:00','10:00')]),'WINDOW_RANGE'],
    ['hour 25',body(2,[w(1,'09:00','25:00')]),'WINDOW_RANGE'],['24:00 start',body(2,[w(1,'24:00','24:00')]),'WINDOW_RANGE'],
    ['24:30',body(2,[w(1,'09:00','24:30')]),'WINDOW_RANGE'],
    ['end before start',body(2,[w(1,'10:00','09:00')]),'WINDOW_RANGE'],['zero length',body(2,[w(1,'09:00','09:00')]),'WINDOW_RANGE'],
    ['14 minute window',body(2,[w(1,'09:00','09:14')]),'WINDOW_RANGE'],
    ['overlap',body(2,[w(1,'09:00','12:00'),w(1,'11:59','14:00')]),'WINDOW_OVERLAP'],
    ['containment overlap',body(2,[w(1,'09:00','17:00'),w(1,'10:00','11:00')]),'WINDOW_OVERLAP'],
    ['duplicate window',body(2,[w(1,'09:00','12:00'),w(1,'09:00','12:00')]),'WINDOW_OVERLAP'],
    ['adjacent must be merged',body(2,[w(1,'09:00','12:00'),w(1,'12:00','14:00')]),'WINDOW_ADJACENT'],
    ['unsorted within day',body(2,[w(1,'13:00','14:00'),w(1,'09:00','10:00')]),'WINDOW_ORDER'],
    ['unsorted weekdays',body(2,[w(2,'09:00','10:00'),w(1,'09:00','10:00')]),'WINDOW_ORDER'],
    ['29 windows',body(2,Array.from({length:29},(_,i)=>w(1+Math.floor(i/5),`${String(8+(i%5)*2).padStart(2,'0')}:00`,`${String(9+(i%5)*2).padStart(2,'0')}:00`))),'TOO_MANY'],
  ];
  const exDay=await plus(40),exDay2=await plus(41);
  const off40=await offsetAt(exDay);
  const ew=(s,so,e,eo)=>({starts_at:s,starts_at_offset:so,ends_at:e,ends_at_offset:eo});
  invalid.push(
    ['exception unknown key',body(2,[],[{date:exDay,windows:[],x:1}]),'EXCEPTION_SHAPE'],
    ['exception bad date format',body(2,[],[{date:'2031-1-1',windows:[]}]),'EXCEPTION_SHAPE'],
    ['impossible date',body(2,[],[{date:'2031-02-30',windows:[]}]),'INVALID_VALUE'],
    ['past date',body(2,[],[{date:await plus(-1),windows:[]}]),'DATE_OUT_OF_RANGE'],
    ['beyond 18 months',body(2,[],[{date:await run(`select ((clock_timestamp() at time zone 'Australia/Adelaide')::date+interval '18 months'+interval '1 day')::date::text`),windows:[]}]),'DATE_OUT_OF_RANGE'],
    ['duplicate date',body(2,[],[{date:exDay,windows:[]},{date:exDay,windows:[]}]),'DUPLICATE_DATE'],
    ['unsorted dates',body(2,[],[{date:exDay2,windows:[]},{date:exDay,windows:[]}]),'EXCEPTION_ORDER'],
    ['367 exceptions',body(2,[],Array.from({length:367},()=>({date:exDay,windows:[]}))),'TOO_MANY'],
    ['9 exception windows',body(2,[],[{date:exDay,windows:Array.from({length:9},(_,i)=>ew(`${String(6+i*2).padStart(2,'0')}:00`,off40,`${String(7+i*2).padStart(2,'0')}:00`,off40))}]),'TOO_MANY'],
    ['missing offset',body(2,[],[{date:exDay,windows:[{starts_at:'09:00',ends_at:'10:00'}]}]),'WINDOW_SHAPE'],
    ['unsupported offset',body(2,[],[{date:exDay,windows:[ew('09:00','+11:00','10:00','+11:00')]}]),'WINDOW_RANGE'],
    ['offset in wall field',body(2,[],[{date:exDay,windows:[ew('09:00+10:30',off40,'10:00',off40)]}]),'WINDOW_RANGE'],
    ['wrong offset',body(2,[],[{date:exDay,windows:[ew('09:00',off40==='+10:30'?'+09:30':'+10:30','10:00',off40)]}]),'OFFSET_MISMATCH'],
    ['exception overlap',body(2,[],[{date:exDay,windows:[ew('09:00',off40,'12:00',off40),ew('11:00',off40,'13:00',off40)]}]),'WINDOW_OVERLAP'],
    ['exception adjacent',body(2,[],[{date:exDay,windows:[ew('09:00',off40,'12:00',off40),ew('12:00',off40,'13:00',off40)]}]),'WINDOW_ADJACENT'],
    ['exception unsorted',body(2,[],[{date:exDay,windows:[ew('13:00',off40,'14:00',off40),ew('09:00',off40,'10:00',off40)]}]),'WINDOW_ORDER'],
    ['exception short',body(2,[],[{date:exDay,windows:[ew('09:00',off40,'09:10',off40)]}]),'WINDOW_RANGE'],
  );
  for(const [label,payload,detail] of invalid){
    await fail(replace(techA,payload),'VALIDATION_FAILED',detail);
  }
  equal([await revisionOf(techA),await count('care_technician_availability_commands')],[baseRevision,baseCommands],'every invalid body is atomic: no revision or ledger change');
  assert.ok(invalid.length>=40);checks++;
  equal(await json(replace(techA,body(baseRevision,[w(1,'09:00','12:00'),w(1,'12:01','14:00')]))),{revision:baseRevision+1,replayed:false},'one-minute gap is canonical');
  equal(await json(replace(techA,body(baseRevision+1,[]))),{revision:baseRevision+2,replayed:false},'empty replacement clears schedule');
  equal(await check(expertA,`${exDay} 10:00+10:30`,`${exDay} 11:00+10:30`),'AVAILABILITY_REQUIRED','cleared schedule means nothing published');

  // ---- Database-level overlap guard (independent of the RPC). ---------------------------------
  const insertWindow=(wd,s,e)=>run(`insert into public.care_technician_availability_windows(expert_id,weekday,start_minute,end_minute) values(${quote(expertB)},${wd},${s},${e})`);
  await run(`delete from public.care_technician_availability_windows where expert_id=${quote(expertB)}`);
  await insertWindow(5,540,720);
  await fail(`insert into public.care_technician_availability_windows(expert_id,weekday,start_minute,end_minute) values(${quote(expertB)},5,700,800)`,'care_availability_weekly_no_overlap');
  await insertWindow(5,720,800);await insertWindow(6,540,720);
  await fail(`insert into public.care_technician_availability_windows(expert_id,weekday,start_minute,end_minute) values(${quote(expertB)},5,10,14)`,'violates check constraint');
  await run(`insert into public.care_technician_availability_exceptions values(${quote(expertB)},${quote(exDay)})`);
  const ins=(s,e)=>`insert into public.care_technician_availability_windows(expert_id,exception_date,start_minute,end_minute,start_offset_minutes,end_offset_minutes) values(${quote(expertB)},${quote(exDay)},${s},${e},630,630)`;
  await run(ins(540,720));
  await fail(ins(600,900),'care_availability_exception_no_overlap');
  await fail(`insert into public.care_technician_availability_windows(expert_id,weekday,exception_date,start_minute,end_minute,start_offset_minutes,end_offset_minutes) values(${quote(expertB)},1,${quote(exDay)},900,960,630,630)`,'violates check constraint');
  await fail(`insert into public.care_technician_availability_windows(expert_id,exception_date,start_minute,end_minute) values(${quote(expertB)},${quote(exDay)},900,960)`,'violates check constraint');
  await fail(`insert into public.care_technician_availability_windows(expert_id,exception_date,start_minute,end_minute,start_offset_minutes,end_offset_minutes) values(${quote(expertB)},${quote(exDay2)},900,960,630,630)`,'violates foreign key');
  await run(`delete from public.care_technician_availability_windows where expert_id=${quote(expertB)};delete from public.care_technician_availability_exceptions where expert_id=${quote(expertB)};update public.care_technician_availability set revision=0 where expert_id=${quote(expertB)}`);

  // ---- Capacity helper: windows, half-open edges, day off, exceptions, DST. -----------------------
  const monday=await run(`select d::date::text from generate_series(${quote(today)}::date+7,${quote(today)}::date+13,'1 day') d where extract(isodow from d)=1`);
  const mOff=await offsetAt(monday);
  const at=(date,time,offset)=>`${date} ${time}:00${offset}`;
  const exDateB=await plus(60);const exOffB=await offsetAt(exDateB);const dayOffB=await plus(61);const dayOffWeekday=Number(await run(`select extract(isodow from ${quote(dayOffB)}::date)::int`));
  equal((await json(replace(techA,body(await revisionOf(techA),
    [w(1,'09:00','12:00'),w(1,'13:00','17:00'),w(dayOffWeekday,'09:00','17:00')],
    [{date:exDateB,windows:[ew('18:00',exOffB,'20:00',exOffB)]},{date:dayOffB,windows:[]}])))).replayed,false);
  equal(await check(expertA,at(monday,'09:00',mOff),at(monday,'12:00',mOff)),'AVAILABLE','full window, start inclusive, end exclusive-compatible');
  equal(await check(expertA,at(monday,'10:00',mOff),at(monday,'11:00',mOff)),'AVAILABLE');
  equal(await check(expertA,at(monday,'08:59',mOff),at(monday,'10:00',mOff)),'SLOT_UNAVAILABLE','starts before window');
  equal(await check(expertA,at(monday,'11:00',mOff),at(monday,'12:01',mOff)),'SLOT_UNAVAILABLE','ends after window');
  equal(await check(expertA,at(monday,'11:00',mOff),at(monday,'14:00',mOff)),'SLOT_UNAVAILABLE','cannot span the lunch gap');
  equal(await check(expertA,at(monday,'13:00',mOff),at(monday,'17:00',mOff)),'AVAILABLE');
  equal(await check(expertA,at(dayOffB,'10:00',await offsetAt(dayOffB)),at(dayOffB,'11:00',await offsetAt(dayOffB))),'SLOT_UNAVAILABLE','dated day off overrides weekly hours');
  equal(await check(expertA,at(exDateB,'18:30',exOffB),at(exDateB,'19:30',exOffB)),'AVAILABLE','exception replaces/adds dated hours');
  equal(await check(expertA,at(exDateB,'10:00',exOffB),at(exDateB,'11:00',exOffB)),'SLOT_UNAVAILABLE','exception replaces recurring windows for its date');
  equal(await check(expertB,at(monday,'10:00',mOff),at(monday,'11:00',mOff)),'AVAILABILITY_REQUIRED','other expert has nothing published');
  await fail(service(`select public.care_technician_availability_check(${quote(expertA)}::uuid,now(),now())`),'VALIDATION_FAILED');
  await fail(service(`select public.care_technician_availability_check(${quote(expertA)}::uuid,'infinity',now())`),'VALIDATION_FAILED');

  // Adelaide DST using the next real transitions found in the pinned tz database.
  const transitions=(await run(`with d as (select x::date as dt,((extract(epoch from (x::date::timestamp+interval '12 hours') at time zone 'UTC')-extract(epoch from (x::date::timestamp+interval '12 hours') at time zone 'Australia/Adelaide'))/60)::int as utc_off from generate_series(${quote(today)}::date,${quote(today)}::date+420,'1 day') x),
      t as (select dt,utc_off,lag(utc_off) over(order by dt) as prev_off from d) select dt::text||' '||case when utc_off>prev_off then 'spring' else 'fall' end from t where utc_off<>prev_off order by dt`)).split('\n');
  const spring=transitions.find(x=>x.endsWith('spring')).split(' ')[0],fall=transitions.find(x=>x.endsWith('fall')).split(' ')[0];
  const sprAfter=await offsetAt(spring),falBefore='+10:30',falAfter='+09:30';
  assert.equal(sprAfter,'+10:30');assert.equal(await offsetAt(fall),'+09:30');
  const ordinarySunday=await run(`select (${quote(spring)}::date-7)::text`),ordOff=await offsetAt(ordinarySunday);
  equal((await json(replace(techA,body(await revisionOf(techA),[w(7,'02:00','04:00'),w(7,'09:00','17:00')])))).replayed,false);
  equal(await check(expertA,at(spring,'10:00',sprAfter),at(spring,'12:00',sprAfter)),'AVAILABLE','ordinary daytime window on a spring-forward day expands normally');
  equal(await check(expertA,at(fall,'10:00',falAfter),at(fall,'12:00',falAfter)),'AVAILABLE','ordinary daytime window on a fall-back day expands normally');
  equal(await check(expertA,at(ordinarySunday,'02:30',ordOff),at(ordinarySunday,'03:30',ordOff)),'AVAILABLE','02:00 boundary is valid on a non-transition Sunday');
  equal(await check(expertA,at(spring,'03:00',sprAfter),at(spring,'03:30',sprAfter)),'SLOT_UNAVAILABLE','nonexistent spring-forward boundary is never silently shifted');
  equal(await check(expertA,at(fall,'03:00',falAfter),at(fall,'03:30',falAfter)),'SLOT_UNAVAILABLE','ambiguous fall-back boundary is unavailable without explicit offsets');
  equal(await check(expertA,at(fall,'03:00',falBefore),at(fall,'03:30',falBefore)),'SLOT_UNAVAILABLE','ambiguous boundary stays unavailable for the first occurrence too');
  const setRev=async(weekly,exceptions)=>json(replace(techA,body(await revisionOf(techA),weekly,exceptions)));
  await fail(replace(techA,body(await revisionOf(techA),[],[{date:spring,windows:[ew('02:30','+09:30','04:00','+10:30')]}])),'OFFSET_MISMATCH');
  await fail(replace(techA,body(await revisionOf(techA),[],[{date:spring,windows:[ew('02:30','+10:30','04:00','+10:30')]}])),'OFFSET_MISMATCH');
  await fail(replace(techA,body(await revisionOf(techA),[],[{date:fall,windows:[ew('09:00','+10:30','10:00','+09:30')]}])),'OFFSET_MISMATCH');
  equal((await setRev([],[{date:spring,windows:[ew('01:00','+09:30','04:00','+10:30')]}])).replayed,false,'window spanning spring-forward with correct offsets is accepted');
  equal(await check(expertA,at(spring,'01:30','+09:30'),at(spring,'03:30','+10:30')),'AVAILABLE','slot inside a window that spans the spring-forward gap');
  equal((await setRev([],[{date:fall,windows:[ew('02:30','+09:30','04:00','+09:30')]}])).replayed,false,'explicit offset disambiguates fall-back');
  equal(await check(expertA,at(fall,'03:00',falAfter),at(fall,'03:30',falAfter)),'AVAILABLE','second occurrence of the ambiguous hour is available');
  equal(await check(expertA,at(fall,'02:45',falBefore),at(fall,'03:30',falAfter)),'SLOT_UNAVAILABLE','first occurrence precedes the explicit window start');
  equal((await setRev([],[{date:fall,windows:[ew('23:00','+09:30','24:00','+09:30')]}])).replayed,false,'24:00 end resolves against next midnight');
  equal(await check(expertA,at(fall,'23:15',falAfter),at(fall,'23:59',falAfter)),'AVAILABLE');

  // ---- Real journeys for lock-order/concurrency evidence. ------------------------------------------
  const journeyCommand=(id,action,payload,guestKey=null,actor=admin,key=randomUUID())=>`select public.care_journey_command(${quote(action)},${quote(id)}::uuid,${actor?`${quote(actor)}::uuid`:'null'},${guestKey?`${quote(guestKey)}::uuid`:'null'},${quote(key)}::uuid,${quote(JSON.stringify(payload))}::jsonb)`;
  const makeJourney=async daysAhead=>{
    const id=randomUUID(),guestKey=randomUUID();
    await run(`insert into public.care_guest_requests(id,idempotency_key,fingerprint,payload) values(${quote(id)},${quote(guestKey)},${quote(randomUUID().replaceAll('-','').repeat(2))},
      ${quote(JSON.stringify({name:'Availability Owner',phone:'0400000000',suburb:'Adelaide',postcode:'5000',vehicle:'Toyota Corolla 2020',service:'repair',description:'Bumper scratch'}))}::jsonb)`);
    await run(service(`select public.care_technician_admin_command(${quote(admin)}::uuid,gen_random_uuid(),'invite_technician',${quote(id)}::uuid,${quote(JSON.stringify({expert_id:expertA}))}::jsonb)`));
    const times=await json(`select jsonb_build_object('expiry',date_trunc('seconds',clock_timestamp()+interval '1 hour'),'start',date_trunc('seconds',clock_timestamp()+interval '${daysAhead} days'),'end',date_trunc('seconds',clock_timestamp()+interval '${daysAhead} days 2 hours'))`);
    await run(service(journeyCommand(id,'publish_quote',{expert_id:expertA,scope_summary:'Repair the visible bumper scratch',total_price_cents:49500,expires_at:times.expiry,starts_at:times.start,ends_at:times.end})));
    const quoteId=await run(`select id from public.care_reviewed_quotes where journey_id=${quote(id)} and status='issued'`);
    await run(service(journeyCommand(id,'select_quote',{quote_id:quoteId,address:'1 Synthetic Street'},guestKey,null)));
    equal(await run(`select state from public.care_journeys where id=${quote(id)}`),'booking_requested');
    return id;
  };
  const confirmSql=id=>journeyCommand(id,'confirm',{availability_confirmed:true});
  const cancelSql=id=>journeyCommand(id,'cancel',{});
  const state=id=>run(`select state from public.care_journeys where id=${quote(id)}`);
  const forbiddenTables=['vehicles','care_requests','care_journeys','care_reviewed_quotes','care_journey_commands','care_journey_events'];
  let day=20;
  for(const [label,operation,finalState] of [['confirm',confirmSql,'scheduled'],['cancel',cancelSql,'cancelled']]){
    // A: care_journey operation holds its locks; availability replace must neither wait nor deadlock.
    {
      const id=await makeJourney(day++),tag=`avail_a_${label}_${id}`,rev=await revisionOf(techA);
      const journeyRun=result(`begin;set local role service_role;${operation(id)};select pg_sleep(3);/* ${tag} */commit;`);
      await waitForQuery(tag);
      const started=Date.now();
      const replaced=await result(replace(techA,body(rev,[w(3,'08:00','09:00')])));
      const elapsed=Date.now()-started;
      assert.equal(replaced.error,undefined,replaced.output);checks++;
      assert.ok(elapsed<2000,`replace waited ${elapsed}ms behind journey ${label}`);checks++;
      assert.equal(await run(`select count(*) from pg_stat_activity where pid<>pg_backend_pid() and query like ${quote('%'+tag+'%')} and state='active'`),'1','journey transaction still open when replace finished');checks++;
      const journeyResult=await journeyRun;
      assert.equal(journeyResult.error,undefined,journeyResult.output);checks++;
      assert.ok(!`${journeyResult.output||''}${replaced.output||''}`.includes('deadlock'));checks++;
      equal(await state(id),finalState);
      equal(await revisionOf(techA),rev+1);
    }
    // B: availability replace holds ITS locks; journey operation must neither wait nor deadlock.
    {
      const id=await makeJourney(day++),tag=`avail_b_${label}_${id}`,rev=await revisionOf(techA),key=randomUUID();
      const replaceRun=result(`begin;set local role service_role;select public.care_technician_availability_replace(${quote(techA)}::uuid,${quote(key)}::uuid,${quote(JSON.stringify(body(rev,[w(4,'08:00','09:00')])))}::jsonb);select pg_sleep(3);/* ${tag} */commit;`);
      await waitForQuery(tag);
      const pid=await run(`select pid from pg_stat_activity where pid<>pg_backend_pid() and query like ${quote('%'+tag+'%')} limit 1`);
      const relations=(await run(`select coalesce(string_agg(distinct c.relname,','),'') from pg_locks l join pg_class c on c.oid=l.relation where l.pid=${pid} and l.locktype='relation' and c.relnamespace='public'::regnamespace and c.relkind='r'`)).split(',');
      for(const table of forbiddenTables) assert.ok(!relations.includes(table),`replace touched ${table}`);
      for(const table of ['care_technician_availability','care_technician_availability_windows','care_technician_availability_commands','care_experts','care_technician_accounts']) assert.ok(relations.includes(table),`replace did not lock ${table}`);
      checks+=forbiddenTables.length+5;
      const advisory=await run(`select count(*) from pg_locks where pid=${pid} and locktype='advisory'`);
      equal(advisory,'1','exactly the actor/key advisory lock');
      equal(await run(`select count(*) from pg_locks where pid=${pid} and locktype='advisory' and ((classid::bigint<<32)|objid::bigint)=hashtextextended('care:technician-availability:'||${quote(techA)}||':'||${quote(key)},0)`),'1','advisory lock is in the new availability namespace');
      equal(await run(`select count(*) from pg_locks where pid=${pid} and locktype='advisory' and ((classid::bigint<<32)|objid::bigint)=hashtextextended('care:expert-capacity:'||${quote(expertA)},0)`),'0','never takes the expert-capacity lock');
      const started=Date.now();
      const journeyResult=await result(service(operation(id)));
      const elapsed=Date.now()-started;
      assert.equal(journeyResult.error,undefined,journeyResult.output);checks++;
      assert.ok(elapsed<2000,`journey ${label} waited ${elapsed}ms behind availability replace`);checks++;
      assert.equal(await run(`select count(*) from pg_stat_activity where pid<>pg_backend_pid() and query like ${quote('%'+tag+'%')} and state='active'`),'1','replace transaction still open when journey operation finished');checks++;
      const replaceResult=await replaceRun;
      assert.equal(replaceResult.error,undefined,replaceResult.output);checks++;
      assert.ok(!`${journeyResult.output||''}${replaceResult.output||''}`.includes('deadlock'));checks++;
      equal(await state(id),finalState);
      equal(await revisionOf(techA),rev+1);
    }
  }

  // C: contended replaces on one expert serialize on the header row.
  {
    const rev=await revisionOf(techA);
    const racers=await Promise.all(Array.from({length:8},(_,i)=>result(replace(techA,body(rev,[w(5,`${String(8+i).padStart(2,'0')}:00`,`${String(8+i).padStart(2,'0')}:30`)])))));
    const winners=racers.filter(x=>!x.error),losers=racers.filter(x=>x.error);
    equal([winners.length,losers.length],[1,7],'exactly one concurrent writer wins a revision');
    assert.ok(losers.every(x=>x.output.includes('REVISION_CONFLICT')&&!x.output.includes('deadlock')));checks++;
    equal(await revisionOf(techA),rev+1);
    const sameKey=randomUUID(),payload=body(rev+1,[w(6,'08:00','09:00')]);
    const retries=await Promise.all(Array.from({length:6},()=>result(replace(techA,payload,sameKey))));
    assert.ok(retries.every(x=>!x.error),retries.map(x=>x.output).join('\n'));checks++;
    equal(retries.map(x=>JSON.parse(x.value.split('\n')[0]).replayed).sort(),[false,true,true,true,true,true],'one executor, five replays');
    equal(await run(`select count(*) from public.care_technician_availability_commands where actor_id=${quote(techA)} and idempotency_key=${quote(sameKey)}`),'1');
    equal(await revisionOf(techA),rev+2,'concurrent same-key retries advance the revision once');
  }

  // ---- Atomic rollback with a failing audit write. ---------------------------------------------------
  {
    const rev=await revisionOf(techA),before=await json(read(techA)),key=randomUUID(),commands=await count('care_technician_availability_commands');
    await run(`create function public.availability_test_audit_failure() returns trigger language plpgsql as $$ begin raise exception 'SYNTHETIC_AUDIT_FAILURE'; end $$;
      create trigger availability_test_audit_failure before insert on public.audit_events for each row execute function public.availability_test_audit_failure()`);
    await fail(replace(techA,body(rev,[w(1,'09:00','10:00')]),key),'SYNTHETIC_AUDIT_FAILURE');
    await run('drop trigger availability_test_audit_failure on public.audit_events;drop function public.availability_test_audit_failure()');
    const after=await json(read(techA));
    equal([after.revision,after.weekly_windows,after.exceptions],[before.revision,before.weekly_windows,before.exceptions],'audit failure rolls back the replacement');
    equal(await count('care_technician_availability_commands'),commands);
    equal(await json(replace(techA,body(rev,[w(1,'09:00','10:00')]),key)),{revision:rev+1,replayed:false},'same key can be retried after rollback');
  }

  // ---- Sequence privileges: browser roles get nothing on the identity sequence. ----------------------
  {
    const seq='public.care_technician_availability_windows_id_seq';
    for(const role of ['anon','authenticated'])
      for(const privilege of ['USAGE','SELECT','UPDATE'])
        equal(await run(`select has_sequence_privilege('${role}','${seq}','${privilege}')`),'f',`${role} has no ${privilege} on the windows sequence`);
    equal(await run(`select count(*) from pg_class c,aclexplode(c.relacl) a where c.oid='${seq}'::regclass and a.grantee=0`),'0','PUBLIC has no privilege on the windows sequence');
    equal(await run(`select has_sequence_privilege('service_role','${seq}','USAGE')`),'t','service_role keeps USAGE on the windows sequence');
  }

  // ---- Forward-only: applying the new migration only adds objects. -----------------------------------
  {
    const migrations=readdirSync('supabase/migrations').filter(name=>name.endsWith('.sql')).sort();
    const added='20261101060000_technician_availability_contract.sql';
    assert.equal(migrations.at(-1),added,'new migration orders last');checks++;
    const base=new URL(process.env.GARAGE_CARE_TEST_DATABASE_URL);
    assert.ok(['localhost','127.0.0.1'].includes(base.hostname));
    const admin=new URL(base);admin.pathname='/postgres';
    const scratch=new URL(base);scratch.pathname='/skycar_forward_only_scratch';
    const psql=(url,args)=>execFileSync('psql',[url.toString(),'-X','-qAt','-v','ON_ERROR_STOP=1',...args],{encoding:'utf8'});
    psql(admin,['-c','drop database if exists skycar_forward_only_scratch with (force)','-c','create database skycar_forward_only_scratch']);
    try {
      // Roles are cluster-wide and already exist; the shims otherwise match tests/integration/bootstrap.sql.
      const bootstrap=readFileSync('tests/integration/bootstrap.sql','utf8').split('\n').filter(line=>!/^create role /.test(line)).join('\n');
      psql(scratch,['-c',bootstrap]);
      for(const migration of migrations.filter(name=>name!==added)) psql(scratch,['-f',`supabase/migrations/${migration}`]);
      const snapshot=()=>psql(scratch,['-c',`
        select 'fn '||p.oid::regprocedure::text||' '||md5(pg_get_functiondef(p.oid)) from pg_proc p where p.pronamespace in ('public'::regnamespace,'auth'::regnamespace) and not exists(select 1 from pg_depend d where d.objid=p.oid and d.deptype='e')
        union all select 'col '||table_name||'.'||column_name||' '||data_type||' '||is_nullable||' '||coalesce(column_default,'') from information_schema.columns where table_schema='public'
        union all select 'con '||conrelid::regclass::text||' '||conname||' '||pg_get_constraintdef(oid) from pg_constraint where connamespace='public'::regnamespace
        union all select 'pol '||tablename||' '||policyname||' '||cmd||' '||coalesce(qual,'')||' '||coalesce(with_check,'')||' '||roles::text from pg_policies where schemaname='public'
        union all select 'trg '||tgrelid::regclass::text||' '||tgname||' '||pg_get_triggerdef(oid) from pg_trigger where not tgisinternal and tgrelid in (select oid from pg_class where relnamespace='public'::regnamespace)
        union all select 'rls '||relname||' '||relrowsecurity from pg_class where relnamespace='public'::regnamespace and relkind='r'
        union all select 'tgrant '||table_name||' '||grantee||' '||privilege_type from information_schema.role_table_grants where table_schema='public'
        union all select 'fgrant '||routine_name||' '||grantee||' '||privilege_type from information_schema.routine_privileges where routine_schema='public' and grantee in ('anon','authenticated','service_role')`]).split('\n').filter(Boolean);
      const before=snapshot();
      psql(scratch,['-f',`supabase/migrations/${added}`]);
      const after=snapshot(),beforeSet=new Set(before),afterSet=new Set(after);
      equal(before.filter(row=>!afterSet.has(row)),[],'no existing function, column, constraint, policy, trigger, RLS flag or grant changed or removed');
      const additions=after.filter(row=>!beforeSet.has(row));
      assert.ok(additions.length>40);
      equal(additions.filter(row=>!/availability|owns_expert/.test(row)),[],'every addition belongs to the availability contract');
      // Re-running is not silently idempotent: forward-only migrations are applied once.
      assert.throws(()=>psql(scratch,['-f',`supabase/migrations/${added}`]),/already exists/);checks++;
    } finally {
      psql(admin,['-c','drop database if exists skycar_forward_only_scratch with (force)']);
    }
  }
  console.log(`PASS: ${checks} technician availability auth/RLS/idempotency/overlap/validation/DST/concurrency/forward-only assertions (disposable database, not hosted Auth).`);
}
