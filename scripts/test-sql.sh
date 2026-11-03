#!/usr/bin/env bash
# Runs every file in supabase/tests against a scratch database that already has the migrations.
# Usage: DATABASE_URL=postgres://... scripts/test-sql.sh   (psql must be installed)
set -euo pipefail
: "${DATABASE_URL:?set DATABASE_URL to a scratch database (never production)}"
for f in "$(dirname "$0")"/../supabase/tests/*.sql; do
  echo "== $f"
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -f "$f"
done
