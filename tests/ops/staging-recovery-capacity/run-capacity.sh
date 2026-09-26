#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

export PATH="/opt/node/bin:/usr/lib/postgresql/17/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
readonly SOURCE_ROOT=/source
readonly WORK_ROOT=/work/source
readonly METRICS_ROOT=/metrics
readonly PGDATA=/var/lib/postgresql/data/pgdata
readonly START_SECONDS=$SECONDS

export HOME=/work/home
export TMPDIR=/work/tmp
export npm_config_cache=/work/npm-cache

monitor_pid=''
postgres_started=false

cleanup() {
  if [[ -n "$monitor_pid" ]]; then
    kill "$monitor_pid" 2>/dev/null || true
    wait "$monitor_pid" 2>/dev/null || true
  fi
  if [[ "$postgres_started" == true ]]; then
    gosu postgres pg_ctl -D "$PGDATA" -m fast -w stop >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

read_cgroup() {
  local name=$1
  test -r "/sys/fs/cgroup/$name"
  tr -d '\n' < "/sys/fs/cgroup/$name"
}

memory_max_bytes=$(read_cgroup memory.max)
memory_swap_max_bytes=$(read_cgroup memory.swap.max)
read -r cpu_quota_us cpu_period_us < /sys/fs/cgroup/cpu.max
test "$memory_max_bytes" = 4294967296
test "$memory_swap_max_bytes" = 0
test "$cpu_quota_us" = 200000
test "$cpu_period_us" = 100000
test "$(node --version)" = "$EXPECTED_NODE_VERSION"

postgres_version_output=$(postgres --version)
[[ "$postgres_version_output" =~ ^postgres\ \(PostgreSQL\)\ 17\.6([^0-9]|$) ]]

install -d -m 0700 \
  "$HOME" \
  "$TMPDIR" \
  "$npm_config_cache" \
  "$WORK_ROOT/ops" \
  "$WORK_ROOT/tests/ops/staging-recovery-capacity"
cp -a "$SOURCE_ROOT/ops/staging-backup" "$WORK_ROOT/ops/"
cp -a "$SOURCE_ROOT/tests/ops/staging-backup-postgres.test.mjs" "$WORK_ROOT/tests/ops/"
cp -a "$SOURCE_ROOT/tests/ops/staging-recovery-capacity/near-limit-crypto.mjs" \
  "$WORK_ROOT/tests/ops/staging-recovery-capacity/"

disk_monitor() {
  while true; do
    work_bytes=$(du -sb /work 2>/dev/null | awk '{ print $1 }')
    pg_bytes=$(du -sb "$PGDATA" 2>/dev/null | awk '{ print $1 }')
    printf '%s\t%s\n' "$(date +%s%3N)" "$((work_bytes + pg_bytes))" >> "$METRICS_ROOT/disk-samples.tsv"
    sleep 0.2
  done
}

install -d -o postgres -g postgres -m 0700 "$PGDATA"
disk_monitor &
monitor_pid=$!
password_file=/var/lib/postgresql/data/.init-password
install -o postgres -g postgres -m 0600 /dev/null "$password_file"
printf '%s\n' 'synthetic-ci-only' > "$password_file"
chown postgres:postgres "$password_file"
gosu postgres initdb \
  -D "$PGDATA" \
  --encoding=UTF8 \
  --no-locale \
  --auth-local=trust \
  --auth-host=scram-sha-256 \
  --pwfile="$password_file" >/dev/null
rm -f -- "$password_file"
{
  echo "listen_addresses = '127.0.0.1'"
  echo "unix_socket_directories = '/tmp'"
  echo 'port = 5432'
} >> "$PGDATA/postgresql.conf"
gosu postgres pg_ctl -D "$PGDATA" -w start >/dev/null
postgres_started=true

npm ci --prefix "$WORK_ROOT/ops/staging-backup" --no-audit --no-fund
supabase_cli_version=$(
  "$WORK_ROOT/ops/staging-backup/node_modules/.bin/supabase" --version | tr -d '\r\n'
)
test "$supabase_cli_version" = 2.117.0

pushd "$WORK_ROOT" >/dev/null
SKYCAR_BACKUP_POSTGRES_TEST=1 \
  node --test --test-reporter=tap tests/ops/staging-backup-postgres.test.mjs \
  | tee "$METRICS_ROOT/postgres.tap"
node tests/ops/staging-recovery-capacity/near-limit-crypto.mjs \
  > "$METRICS_ROOT/near-limit.json"
popd >/dev/null

grep -Eq '^# tests 1$' "$METRICS_ROOT/postgres.tap"
grep -Eq '^# pass 1$' "$METRICS_ROOT/postgres.tap"
grep -Eq '^# skipped 0$' "$METRICS_ROOT/postgres.tap"

kill "$monitor_pid" 2>/dev/null || true
wait "$monitor_pid" 2>/dev/null || true
monitor_pid=''

memory_peak_bytes=$(read_cgroup memory.peak)
oom_events=$(awk '$1 == "oom" { print $2 }' /sys/fs/cgroup/memory.events)
oom_kill_events=$(awk '$1 == "oom_kill" { print $2 }' /sys/fs/cgroup/memory.events)
disk_peak_bytes=$(awk 'max < $2 { max = $2 } END { print max + 0 }' "$METRICS_ROOT/disk-samples.tsv")
elapsed_seconds=$((SECONDS - START_SECONDS))

node "$SOURCE_ROOT/tests/ops/staging-recovery-capacity/write-metrics.mjs" \
  "$METRICS_ROOT/near-limit.json" \
  "$METRICS_ROOT/metrics.env" \
  "$memory_max_bytes" \
  "$memory_swap_max_bytes" \
  "$cpu_quota_us/$cpu_period_us" \
  "$memory_peak_bytes" \
  "$oom_events" \
  "$oom_kill_events" \
  "$disk_peak_bytes" \
  "$elapsed_seconds" \
  "$RUNNER_FREE_BYTES" \
  "$EXPECTED_NODE_VERSION" \
  '17.6' \
  "$supabase_cli_version" \
  "$EXPECTED_OPERATIONS_SHA"
