#!/bin/sh
# Runs scripts/ops/sequence-default-acl-gate.sql and CLASSIFIES the result, failing loudly when the
# gate itself could not run. Replaces the old "grep the gate output" quick check, which printed nothing
# both for "only expected supabase_admin findings" and for "the gate never ran".
#
#   DATABASE_URL=postgresql://... sh scripts/ops/sequence-default-acl-gate.sh
#
# Exit status (stable; scripts may rely on it):
#   0   GO. Nothing to do.
#   10  NO-GO, every finding is a supabase_admin default ACL on sequences (schema public or global).
#       Expected on hosted projects until Supabase support runs the ops script. Does not block staging.
#   11  NO-GO with at least one blocking finding (anything that is not exactly the line shape above).
#   12  The gate did not run or ended in a way this script does not recognise (no DATABASE_URL, no
#       psql, connection or permission failure, other SQL error, missing or surplus finding rows).
#       This is NEVER the "expected" case. psql's own message is printed on stderr.
#
# Safety of the classification: a finding is "expected" only if its whole line equals the supabase_admin
# default ACL shape below (the gate quotes role names with quote_ident, so a role such as
# "supabase_admin evil" prints as creator="supabase_admin evil" and cannot match), and only if the number
# of finding rows equals the finding count the gate reported (a name containing a newline cannot add or
# hide a row without breaking that equality). Anything doubtful is treated as blocking or as 12.
set -u
gate=$(dirname "$0")/sequence-default-acl-gate.sql

die() { echo "SKYCAR-SEQ-ACL-GATE: $*" >&2; exit 12; }
[ -n "${DATABASE_URL:-}" ] || die "DATABASE_URL is not set (gate did not run)"
command -v psql >/dev/null 2>&1 || die "psql is not installed (gate did not run)"
[ -r "$gate" ] || die "cannot read $gate (gate did not run)"

tmp=$(mktemp -d) || die "cannot create a temporary directory (gate did not run)"
trap 'rm -rf "$tmp"' EXIT HUP INT TERM
psql "$DATABASE_URL" -X -qAt -v ON_ERROR_STOP=1 -v VERBOSITY=verbose -f "$gate" >"$tmp/out" 2>"$tmp/err"
rc=$?
rows=$(grep -cE '^(default_acl|sequence)\|' "$tmp/out")

if [ "$rc" -eq 0 ]; then
  if grep -qx 'GO' "$tmp/out" && [ "$rows" -eq 0 ]; then echo "GO"; exit 0; fi
  cat "$tmp/err" >&2
  die "psql exited 0 but the output is not exactly a GO (gate result unclear)"
fi

if [ "$rc" -ne 3 ] || ! grep -q 'P0001: SKYCAR-SEQ-ACL: NO-GO' "$tmp/err"; then
  cat "$tmp/err" >&2
  die "gate did not complete (psql exit $rc, not a NO-GO from the gate)"
fi

reported=$(sed -n 's/.*SKYCAR-SEQ-ACL: NO-GO (\([0-9][0-9]*\) finding(s)).*/\1/p' "$tmp/err" | head -n 1)
if [ -z "$reported" ] || [ "$reported" -lt 1 ] || [ "$rows" -ne "$reported" ]; then
  cat "$tmp/err" >&2
  die "NO-GO reported ${reported:-?} finding(s) but $rows finding row(s) were printed (output not trustworthy)"
fi

expected='^default_acl\|creator=supabase_admin scope=(public|GLOBAL\(all schemas\)) grantee=(anon|authenticated|PUBLIC) privilege=(USAGE|SELECT|UPDATE)$'
grep -E '^(default_acl|sequence)\|' "$tmp/out"
blocking=$(grep -E '^(default_acl|sequence)\|' "$tmp/out" | grep -cvE "$expected")
if [ "$blocking" -eq 0 ]; then
  echo "NO-GO (expected): $rows finding(s), all supabase_admin default ACLs; needs Supabase support to run scripts/ops/supabase-admin-sequence-default-acl.sql" >&2
  exit 10
fi
echo "NO-GO (blocking): $blocking of $rows finding(s) are not supabase_admin default ACLs; fix with a reviewed REVOKE before proceeding" >&2
exit 11
