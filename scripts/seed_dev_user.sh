#!/usr/bin/env bash
# =============================================================================
# Crea (idempotente) un usuario de desarrollo en el Supabase local y lo ancla
# como `owner` de la organización interna, para poder probar el login + RLS.
#
# Necesario tras cada `supabase db reset` (el reset no recrea usuarios de auth).
# Uso:  ./scripts/seed_dev_user.sh
# =============================================================================
set -euo pipefail

EMAIL="${DEV_EMAIL:-dueno@elkiosko.com}"
PASSWORD="${DEV_PASSWORD:-demo1234}"
ORG_ID="00000000-0000-0000-0000-000000000001"   # Qinsalabs Internal

# Claves/URL del stack local (dinámicas, sobreviven a cambios de config)
STATUS_JSON="$(supabase status -o json)"
API_URL="$(printf '%s' "$STATUS_JSON" | python3 -c 'import sys,json; print(json.load(sys.stdin)["API_URL"])')"
SR_KEY="$(printf '%s' "$STATUS_JSON" | python3 -c 'import sys,json; print(json.load(sys.stdin)["SERVICE_ROLE_KEY"])')"

echo "→ API: $API_URL"
echo "→ Creando usuario $EMAIL (si no existe)…"

# Admin API de GoTrue: crea el usuario ya confirmado. Si ya existe, GoTrue
# responde 422; lo ignoramos y seguimos a buscar su id.
curl -s -o /dev/null -X POST "$API_URL/auth/v1/admin/users" \
  -H "apikey: $SR_KEY" -H "Authorization: Bearer $SR_KEY" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\",\"email_confirm\":true}" || true

# Recuperar el id del usuario por email
USER_ID="$(curl -s "$API_URL/auth/v1/admin/users" \
  -H "apikey: $SR_KEY" -H "Authorization: Bearer $SR_KEY" \
  | python3 -c "import sys,json; us=json.load(sys.stdin).get('users',[]); print(next((u['id'] for u in us if u['email']=='$EMAIL'), ''))")"

if [ -z "$USER_ID" ]; then
  echo "✗ No se pudo obtener el id del usuario $EMAIL" >&2
  exit 1
fi
echo "→ user_id: $USER_ID"

# Membresía owner en la organización interna (upsert por la unique (user,org))
echo "→ Anclando membresía owner en la organización interna…"
curl -s -o /dev/null -X POST "$API_URL/rest/v1/memberships?on_conflict=user_id,organization_id" \
  -H "apikey: $SR_KEY" -H "Authorization: Bearer $SR_KEY" \
  -H "Content-Type: application/json" \
  -H "Prefer: resolution=ignore-duplicates" \
  -d "{\"user_id\":\"$USER_ID\",\"organization_id\":\"$ORG_ID\",\"role\":\"owner\"}"

echo ""
echo "✓ Listo. Login en la demo-app:"
echo "    email:    $EMAIL"
echo "    password: $PASSWORD"
