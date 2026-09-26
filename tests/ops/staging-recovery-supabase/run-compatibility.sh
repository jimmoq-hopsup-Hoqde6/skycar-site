#!/usr/bin/env bash
set -euo pipefail
umask 077

repository_root=$(git rev-parse --show-toplevel)
cli="$repository_root/ops/staging-backup/node_modules/.bin/supabase"
helper="$repository_root/tests/ops/staging-recovery-supabase/compatibility.mjs"
exclude_services='studio,imgproxy,mailpit,edge-runtime,logflare,vector,supavisor'
work_root=$(mktemp -d "${RUNNER_TEMP:?}/skycar-supabase-compatibility.XXXXXX")
source_project="$work_root/source"
target_project="$work_root/target"
recovered="$work_root/recovered"
source_network="skycar-source-${GITHUB_RUN_ID:?}-${GITHUB_RUN_ATTEMPT:?}"
target_network="skycar-target-${GITHUB_RUN_ID}-${GITHUB_RUN_ATTEMPT}"
source_started=false
target_started=false
cleaned=false

safe_remove_tree() {
  local path=$1
  case "$path" in
    "$RUNNER_TEMP"/skycar-supabase-compatibility.*) rm -rf -- "$path" ;;
    *) echo 'Refusing unexpected cleanup path.' >&2; return 1 ;;
  esac
}

cleanup() {
  local status=$?
  set +e
  if $source_started; then "$cli" stop --project-id source --no-backup >/dev/null 2>&1; fi
  if $target_started; then "$cli" stop --project-id target --no-backup >/dev/null 2>&1; fi
  docker network rm "$source_network" "$target_network" >/dev/null 2>&1 || true
  safe_remove_tree "$work_root" || true
  cleaned=true
  return "$status"
}
trap cleanup EXIT INT TERM

# Prove every CLI command and flag used exists in the locked version before use.
test "$($cli --version)" = "$SUPABASE_CLI_VERSION"
for command in init start status stop; do "$cli" "$command" --help >/dev/null; done
"$cli" db dump --help >/dev/null

"$cli" init --workdir "$source_project" --yes >/dev/null
"$cli" init --workdir "$target_project" --yes >/dev/null
test "$(grep -c '^project_id = "source"$' "$source_project/supabase/config.toml")" = 1
test "$(grep -c '^project_id = "target"$' "$target_project/supabase/config.toml")" = 1

create_internal_network() {
  local network=$1
  docker network create --driver bridge --internal "$network" >/dev/null
  test "$(docker network inspect --format '{{.Internal}}' "$network")" = true
}

project_containers() {
  local project=$1
  docker ps -aq --filter "label=com.supabase.cli.project=$project"
}

assert_core_health_and_loopback() {
  local project=$1
  local required=(db auth storage realtime rest kong meta)
  local ids names=''
  ids=$(project_containers "$project")
  test -n "$ids"
  while IFS= read -r id; do
    test -n "$id" || continue
    local name state ports
    name=$(docker inspect --format '{{.Name}}' "$id" | sed 's#^/##')
    state=$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$id")
    test "$state" = healthy -o "$state" = running
    names+=" $name"
    ports=$(docker inspect --format '{{json .NetworkSettings.Ports}}' "$id")
    PORTS_JSON="$ports" node -e '
      const ports = JSON.parse(process.env.PORTS_JSON);
      for (const bindings of Object.values(ports)) {
        for (const binding of bindings || []) {
          if (!["127.0.0.1", "::1"].includes(binding.HostIp)) process.exit(1);
        }
      }
    '
  done <<< "$ids"
  for service in "${required[@]}"; do
    [[ "$names" == *"supabase_${service}_${project}"* ]]
  done
}

record_images() {
  local project=$1 output=$2
  : > "$output"
  while IFS= read -r id; do
    test -n "$id" || continue
    local name image_id digests
    name=$(docker inspect --format '{{.Name}}' "$id" | sed 's#^/##')
    image_id=$(docker inspect --format '{{.Image}}' "$id")
    digests=$(docker image inspect --format '{{join .RepoDigests ","}}' "$image_id")
    test -n "$digests"
    printf '%s=%s\n' "$name" "$digests" >> "$output"
  done <<< "$(project_containers "$project")"
  sort -o "$output" "$output"
}

start_project() {
  local project=$1 network=$2 log=$3
  create_internal_network "$network"
  if ! "$cli" start --workdir "$project" --network-id "$network" \
    --exclude "$exclude_services" --yes >"$log" 2>&1; then
    local category='unclassified CLI start failure'
    if grep -Eqi 'unhealthy|health check' "$log"; then
      category='container health check failure'
    elif grep -Eqi 'network.*(not found|invalid|failed)|failed.*network' "$log"; then
      category='container network failure'
    elif grep -Eqi 'port.*(allocated|available|bind|in use)' "$log"; then
      category='local port allocation failure'
    elif grep -Eqi '(pull|manifest|image).*(denied|failed|not found)' "$log"; then
      category='container image acquisition failure'
    fi
    printf 'Local Supabase %s start failed: %s; private-log-sha256=%s\n' \
      "$project" "$category" "$(sha256sum "$log" | cut -d' ' -f1)" >&2
    while IFS= read -r id; do
      test -n "$id" || continue
      docker inspect --format 'container={{.Name}} state={{.State.Status}} health={{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}} image={{.Config.Image}}' "$id" \
        | sed 's#container=/#container=#' >&2
    done <<< "$(project_containers "$project")"
    return 1
  fi
}

source_started=true
start_project "$source_project" "$source_network" "$work_root/source-start.log"
assert_core_health_and_loopback source
record_images source "$work_root/source-images.txt"
"$cli" status --workdir "$source_project" -o json > "$work_root/source-status.json" 2>/dev/null
source_db=$(node "$helper" status-db "$work_root/source-status.json")
source_manifest_hash=$(node "$helper" manifest "$source_db" "$work_root/source-baseline.json")
source_server_version=$(PGCONNECT_TIMEOUT=10 psql "$source_db" -X -q -A -t -v ON_ERROR_STOP=1 -c 'SHOW server_version;')
node "$helper" fixture "$source_db"
node "$helper" capture "$source_db" "$recovered"

"$cli" stop --project-id source --no-backup >"$work_root/source-stop.log" 2>&1
source_started=false
docker network rm "$source_network" >/dev/null
test -z "$(project_containers source)"

target_started=true
start_project "$target_project" "$target_network" "$work_root/target-start.log"
assert_core_health_and_loopback target
record_images target "$work_root/target-images.txt"
"$cli" status --workdir "$target_project" -o json > "$work_root/target-status.json" 2>/dev/null
target_db=$(node "$helper" status-db "$work_root/target-status.json")
target_manifest_hash=$(node "$helper" manifest "$target_db" "$work_root/target-baseline.json")
test "$source_manifest_hash" = "$target_manifest_hash"

restore_failure="$work_root/restore-failure.log"
for file in roles.sql schema.sql data.sql; do
  if ! PGCONNECT_TIMEOUT=10 psql "$target_db" -X -q -v ON_ERROR_STOP=1 -f "$recovered/$file" \
      >"$work_root/restore-${file%.sql}.log" 2>"$restore_failure"; then
    {
      echo "Restore failed in $file. Sanitised PostgreSQL diagnostics:"
      grep -E '(^psql:|ERROR:|FATAL:|DETAIL:|HINT:)' "$restore_failure" | tail -20
    } >&2
    exit 1
  fi
done

target_after_hash=$(node "$helper" verify "$target_db" \
  "$work_root/source-baseline.json" "$work_root/target-baseline.json" \
  "$work_root/target-after.json" "$recovered")
assert_core_health_and_loopback target

"$cli" stop --project-id target --no-backup >"$work_root/target-stop.log" 2>&1
target_started=false
docker network rm "$target_network" >/dev/null
test -z "$(project_containers target)"
test -z "$(docker volume ls -q --filter label=com.supabase.cli.project=source)"
test -z "$(docker volume ls -q --filter label=com.supabase.cli.project=target)"

{
  echo '## Secret-free local Supabase recovery compatibility'
  echo
  echo '| Evidence | Result |'
  echo '| --- | --- |'
  echo "| Immutable PR checkout | $EXPECTED_HEAD_SHA |"
  echo "| Accepted operations source | $ACCEPTED_OPERATIONS_SHA |"
  echo "| Supabase CLI / Node | $SUPABASE_CLI_VERSION / $(node --version) |"
  echo "| Local PostgreSQL server | $source_server_version |"
  echo "| Source/target baseline manifest | MATCH ($source_manifest_hash) |"
  echo "| Target post-restore manifest | VERIFIED ($target_after_hash) |"
  echo '| Accepted export/encrypt/full-tag decrypt | PASS |'
  echo '| Restore order | roles → schema → data; ON_ERROR_STOP=1 |'
  echo '| Synthetic sentinel and file hashes | PASS |'
  echo '| Required baseline roles/schemas/extensions | PRESERVED |'
  echo '| auth/storage/realtime object manifest | UNCHANGED |'
  echo '| Core DB/Auth/Storage/Realtime/REST/Kong/Meta health | PASS before and after restore |'
  echo '| Published database/API listeners | loopback only |'
  echo '| Source/target containers, volumes, networks and plaintext/key files | REMOVED |'
  echo
  echo '<details><summary>Exact source image digests</summary>'
  echo
  sed 's/^/- `/' "$work_root/source-images.txt" | sed 's/$/`/'
  echo '</details>'
  echo
  echo 'This is a local CLI managed-style rehearsal, not hosted Supabase equivalence. The local image/server version above must be compared with staging PostgreSQL 17.6 and the announced 17.11 extension/operator changes before any hosted recovery claim. No protected environment, external database, real key/archive, artifact, migration or deployment was used.'
} >> "$GITHUB_STEP_SUMMARY"

safe_remove_tree "$work_root"
cleaned=true
trap - EXIT INT TERM
