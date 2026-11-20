#!/bin/sh
set -eu

psql --set=ON_ERROR_STOP=1 \
  --username "$POSTGRES_USER" \
  --dbname "$POSTGRES_DB" \
  --set=app_user="$TEST_APP_DB_USER" \
  --set=app_password="$TEST_APP_DB_PASSWORD" <<'SQL'
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

SELECT format(
  'CREATE ROLE %I LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION',
  :'app_user',
  :'app_password'
)
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'app_user')
\gexec

GRANT CONNECT, TEMPORARY ON DATABASE streamtube_phase03_test TO :"app_user";
GRANT USAGE, CREATE ON SCHEMA public TO :"app_user";
SQL
