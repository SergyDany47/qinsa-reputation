#!/usr/bin/env bash
# =============================================================================
# Crea (idempotente) un usuario STAFF de Qinsalabs para el backoffice interno y
# lo marca como administrador de plataforma (poderes cross-tenant).
#
# Es DISTINTO del usuario cliente (seed_dev_user.sh): staff ≠ cliente.
# Re-ejecutar tras cada `supabase db reset`.
#
# Uso:  ./scripts/seed_platform_admin.sh
# =============================================================================
set -euo pipefail

EMAIL="${ADMIN_EMAIL:-admin@qinsalabs.com}"
PASSWORD="${ADMIN_PASSWORD:-qinsa1234}"

STATUS_JSON="$(supabase status -o json)"
API_URL="$(printf '%s' "$STATUS_JSON" | python3 -c 'import sys,json; print(json.load(sys.stdin)["API_URL"])')"
SR_KEY="$(printf '%s' "$STATUS_JSON" | python3 -c 'import sys,json; print(json.load(sys.stdin)["SERVICE_ROLE_KEY"])')"

echo "→ Creando staff $EMAIL (si no existe)…"
curl -s -o /dev/null -X POST "$API_URL/auth/v1/admin/users" \
  -H "apikey: $SR_KEY" -H "Authorization: Bearer $SR_KEY" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\",\"email_confirm\":true}" || true

USER_ID="$(curl -s "$API_URL/auth/v1/admin/users" \
  -H "apikey: $SR_KEY" -H "Authorization: Bearer $SR_KEY" \
  | python3 -c "import sys,json; us=json.load(sys.stdin).get('users',[]); print(next((u['id'] for u in us if u['email']=='$EMAIL'), ''))")"

if [ -z "$USER_ID" ]; then
  echo "✗ No se pudo obtener el id de $EMAIL" >&2
  exit 1
fi
echo "→ user_id: $USER_ID"

echo "→ Marcando como platform admin…"
curl -s -o /dev/null -X POST "$API_URL/rest/v1/platform_admins?on_conflict=user_id" \
  -H "apikey: $SR_KEY" -H "Authorization: Bearer $SR_KEY" \
  -H "Content-Type: application/json" \
  -H "Prefer: resolution=ignore-duplicates" \
  -d "{\"user_id\":\"$USER_ID\",\"note\":\"seed staff\"}"

echo ""
echo "✓ Listo. Backoffice login:"
echo "    email:    $EMAIL"
echo "    password: $PASSWORD"
