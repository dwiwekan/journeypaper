#!/usr/bin/env bash
# Checks, with only the public (publishable) key, that Supabase does not expose our data:
#   1. GET /rest/v1/papers is not readable (404, PGRST205, or the Data API is off).
#   2. The same with Accept-Profile: journey is refused (406, PGRST106, or 404).
#   3. GET /rest/v1/alembic_version (Alembic's table in public) is refused or not found.
#   4. Auth settings say sign-up is disabled and anonymous sign-ins are off.
#   5. Our API (API_URL, or PROD_API in web/js/config.js) refuses a list and an edit sent
#      without Authorization (401). Skipped while there is no API URL yet.
# Read-only: it never signs up, never sends Authorization and never writes anything.
# Exits 0 only when all of them hold.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SUPABASE_URL="${SUPABASE_URL:-https://xxgdylyvbbohjpibwucv.supabase.co}"
KEY="$(sed -n "s/^export const SUPABASE_KEY = '\(sb_publishable_[A-Za-z0-9_-]*\)';.*/\1/p" "$ROOT/web/js/config.js")"
if [ -z "$KEY" ]; then echo "FAIL: no publishable key found in web/js/config.js"; exit 1; fi
API_URL="${API_URL:-$(sed -n "s/^export const PROD_API = '\([^']*\)';.*/\1/p" "$ROOT/web/js/config.js")}"
API_URL="${API_URL%/}"

TMP="$(mktemp)"
trap 'rm -f "$TMP"' EXIT
# get PATH [HEADER]: prints the HTTP status; the body goes to $TMP
get() {
  local extra=()
  if [ $# -gt 1 ]; then extra=(-H "$2"); fi
  curl -sS -o "$TMP" -w '%{http_code}' --max-time 20 -H "apikey: $KEY" "${extra[@]}" "$SUPABASE_URL$1" || echo 000
}
has() { grep -q "$1" "$TMP"; }

bad=0
status="$(get '/rest/v1/papers?select=id&limit=1')"
if [ "$status" = 404 ] || has '"PGRST205"'; then echo "ok: public.papers not found"
elif [ "${status:0:1}" = 2 ]; then echo "FAIL: public.papers is readable with the publishable key ($status)"; bad=1
else echo "FAIL: unexpected answer for public.papers ($status): $(head -c 200 "$TMP")"; bad=1; fi

status="$(get '/rest/v1/papers?select=id&limit=1' 'Accept-Profile: journey')"
if [ "$status" = 406 ] || [ "$status" = 404 ] || has '"PGRST106"'; then echo "ok: journey schema not exposed"
elif [ "${status:0:1}" = 2 ]; then echo "FAIL: journey schema is exposed to the Data API ($status)"; bad=1
else echo "FAIL: unexpected answer for the journey schema ($status): $(head -c 200 "$TMP")"; bad=1; fi

status="$(get '/rest/v1/alembic_version?select=version_num&limit=1')"
if [ "${status:0:1}" = 2 ]; then echo "FAIL: public.alembic_version is reachable with the publishable key ($status); run make migrate-prod"; bad=1
elif [ "$status" = 401 ] || [ "$status" = 403 ] || [ "$status" = 404 ] || has '"42501"' || has '"PGRST205"'; then echo "ok: alembic_version closed"
else echo "FAIL: unexpected answer for public.alembic_version ($status): $(head -c 200 "$TMP")"; bad=1; fi

status="$(get '/auth/v1/settings')"
if [ "$status" = 200 ] && grep -Eq '"disable_signup" *: *true' "$TMP"; then echo "ok: sign-up disabled"
elif [ "$status" = 200 ]; then echo "FAIL: sign-up is open (Authentication -> Sign In / Providers)"; bad=1
else echo "FAIL: unexpected answer for auth settings ($status)"; bad=1; fi
if [ "$status" = 200 ] && grep -Eq '"anonymous_users" *: *true' "$TMP"; then
  echo "FAIL: anonymous sign-ins are on (Authentication -> Sign In / Providers)"; bad=1
fi

# api METHOD PATH: our API, no apikey and no Authorization; prints the HTTP status
api() {
  curl -sS -o "$TMP" -w '%{http_code}' --max-time 20 -X "$1" -H 'Content-Type: application/json' \
    ${2:+--data '{}'} "$API_URL/api/v1$3" || echo 000
}
if [ -z "$API_URL" ]; then echo "skip: API checks (no API URL yet)"
else
  status="$(api GET '' /papers)"
  if [ "$status" = 401 ]; then echo "ok: anonymous list refused"
  elif [ "${status:0:1}" = 2 ]; then echo "FAIL: anonymous list is readable ($status)"; bad=1
  else echo "FAIL: unexpected answer for an anonymous list ($status): $(head -c 200 "$TMP")"; bad=1; fi

  status="$(api PATCH body /papers/x)"
  if [ "$status" = 401 ]; then echo "ok: anonymous edit refused"
  elif [ "${status:0:1}" = 2 ]; then echo "FAIL: anonymous edit was accepted ($status)"; bad=1
  else echo "FAIL: unexpected answer for an anonymous edit ($status): $(head -c 200 "$TMP")"; bad=1; fi
fi

if [ "$bad" = 0 ]; then echo "OK: tables not exposed, sign-up closed"; fi
exit "$bad"
