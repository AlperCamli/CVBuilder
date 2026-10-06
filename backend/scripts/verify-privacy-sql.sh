#!/usr/bin/env bash
set -euo pipefail
# Runs only against an isolated temporary PostgreSQL instance. Never reads .env
# or connects to the linked Supabase project.
privacy_repo_dir="$(cd "$(dirname "$0")/.." && pwd)"
privacy_pg_dir="$(mktemp -d "${TMPDIR:-/tmp}/cv-privacy-db.XXXXXX")"
privacy_pg_port="${PRIVACY_TEST_PG_PORT:-55440}"
cleanup() { pg_ctl -D "$privacy_pg_dir" stop -m immediate >/dev/null 2>&1 || true; rm -rf "$privacy_pg_dir"; }
trap cleanup EXIT
initdb -D "$privacy_pg_dir" -A trust -U privacy_test >/dev/null
pg_ctl -D "$privacy_pg_dir" -l "$privacy_pg_dir/server.log" -o "-p $privacy_pg_port -h 127.0.0.1 -k $privacy_pg_dir" start >/dev/null
privacy_psql=(psql -h 127.0.0.1 -p "$privacy_pg_port" -U privacy_test postgres -v ON_ERROR_STOP=1 -q)
"${privacy_psql[@]}" <<'SQL'
create role anon;
create role authenticated;
create role service_role bypassrls;
create schema auth;
grant usage on schema auth to anon,authenticated,service_role;
create schema storage;
create table storage.buckets(id text primary key,public boolean not null default true);
create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text);
alter table storage.objects enable row level security;
grant usage on schema storage to authenticated,service_role;
grant select,insert,update,delete on storage.objects to authenticated,service_role;
create policy fixture_storage_access on storage.objects for all to authenticated using(true) with check(true);
insert into storage.buckets(id) values('imports'),('exports'),('cv-assets');
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
create function auth.role() returns text language sql stable as $$ select current_setting('request.jwt.claim.role',true) $$;
SQL
for migration in "$privacy_repo_dir"/supabase/migrations/*.sql; do
  "${privacy_psql[@]}" -f "$migration" >/dev/null
done
"${privacy_psql[@]}" -f "$privacy_repo_dir/scripts/replay-privacy-erasures.sql"
"${privacy_psql[@]}" -f "$privacy_repo_dir/tests/sql/guest-onboarding.sql"
"${privacy_psql[@]}" -f "$privacy_repo_dir/tests/sql/privacy-controls.sql"
"${privacy_psql[@]}" -f "$privacy_repo_dir/tests/sql/guest-ai-tracking.sql"

"${privacy_psql[@]}" -f "$privacy_repo_dir/tests/sql/privacy-restore.sql"
