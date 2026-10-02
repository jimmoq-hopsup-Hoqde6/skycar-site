#!/usr/bin/env bash
set -euo pipefail
# Ephemeral Ubuntu runner only; no database credentials are supplied here.
# https://www.postgresql.org/download/linux/ubuntu/
. /etc/os-release
test "$ID" = ubuntu
test "$VERSION_CODENAME" = noble
test "$(dpkg --print-architecture)" = amd64
key="$(mktemp)"
trap 'rm -f -- "$key"' EXIT
curl --fail --silent --show-error --proto '=https' \
  https://www.postgresql.org/media/keys/ACCC4CF8.asc -o "$key"
fingerprint="$(gpg --show-keys --with-colons "$key" 2>/dev/null | awk -F: '$1 == "fpr" { print $10; exit }')"
test "$fingerprint" = B97B0AFCAA1A47F044F244A07FCC7D46ACCC4CF8
sudo install -d /usr/share/postgresql-common/pgdg
sudo install -m 0644 "$key" /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc
printf '%s\n' 'deb [arch=amd64 signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] https://apt.postgresql.org/pub/repos/apt noble-pgdg main' \
  | sudo tee /etc/apt/sources.list.d/skycar-pgdg.list >/dev/null
sudo apt-get update -qq
sudo apt-get install -y --no-install-recommends postgresql-client-17
echo /usr/lib/postgresql/17/bin >> "$GITHUB_PATH"
/usr/lib/postgresql/17/bin/pg_dump --version
