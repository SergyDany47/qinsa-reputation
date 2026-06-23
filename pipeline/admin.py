"""
admin.py — Router de backoffice interno para Qinsa Reputation.

Frontera de confianza entre el backoffice (frontend interno) y `service_role`:
el navegador del backoffice se autentica como `authenticated` normal vía Supabase
Auth; este router valida ese JWT contra GoTrue, comprueba que el usuario está en
`platform_admins`, y SOLO entonces ejecuta operaciones privilegiadas con la
service_role key (que nunca sale del servidor).

Endpoints (todos bajo /admin, todos exigen platform admin):
    GET  /admin/me
    GET  /admin/organizations
    POST /admin/organizations
    GET  /admin/organizations/{org_id}
    POST /admin/organizations/{org_id}/members
    POST /admin/organizations/{org_id}/restaurants
    GET  /admin/restaurants/{restaurant_id}/ingest   (SSE)
"""
import asyncio
import json
import logging
import os
from collections import Counter
from typing import Optional

import httpx
from fastapi import APIRouter, Depends, Header, HTTPException, Path, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from loader import (
    supabase,  # cliente Supabase con service_role
    get_restaurant_by_id,
    get_restaurant_context,
)
from analyzer import (
    generate_suggested_reply,
    context_options,
    TONE_PRESETS,
    EMOJI_RULES,
    LANGUAGE_RULES,
)
from ingest import run_incremental_ingest
from config import ALLOWED_MODELS, get_all_settings

logger = logging.getLogger(__name__)

SUPABASE_URL = os.getenv("SUPABASE_URL", "").rstrip("/")
SUPABASE_ANON_KEY = os.getenv("SUPABASE_ANON_KEY", "")
SUPABASE_SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")

PLACE_URL_TEMPLATE = "https://www.google.com/maps/place/?q=place_id:{place_id}"

router = APIRouter(prefix="/admin", tags=["admin"])


# ── Cliente HTTP a GoTrue (validación de token + admin de usuarios) ─────────────

def _gotrue_admin_headers() -> dict:
    """Headers para la admin API de GoTrue (requiere service_role)."""
    return {
        "apikey": SUPABASE_SERVICE_ROLE_KEY,
        "Authorization": f"Bearer {SUPABASE_SERVICE_ROLE_KEY}",
        "Content-Type": "application/json",
    }


async def _validate_token(token: str) -> dict:
    """Valida el JWT del usuario contra GoTrue. Devuelve el usuario o lanza 401."""
    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.get(
            f"{SUPABASE_URL}/auth/v1/user",
            headers={"apikey": SUPABASE_ANON_KEY, "Authorization": f"Bearer {token}"},
        )
    if resp.status_code != 200:
        raise HTTPException(status_code=401, detail="Sesión inválida o expirada")
    return resp.json()


async def _list_auth_users() -> dict:
    """Mapa user_id → {email,...} desde la admin API de GoTrue. Para enriquecer membresías."""
    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.get(
            f"{SUPABASE_URL}/auth/v1/admin/users?per_page=200",
            headers=_gotrue_admin_headers(),
        )
    if resp.status_code != 200:
        logger.warning("No se pudo listar usuarios de GoTrue: %s", resp.text)
        return {}
    return {u["id"]: u for u in resp.json().get("users", [])}


async def _find_or_create_auth_user(email: str, password: str) -> str:
    """Devuelve el id del usuario con ese email; lo crea (confirmado) si no existe."""
    users = await _list_auth_users()
    for uid, u in users.items():
        if (u.get("email") or "").lower() == email.lower():
            return uid

    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.post(
            f"{SUPABASE_URL}/auth/v1/admin/users",
            headers=_gotrue_admin_headers(),
            json={"email": email, "password": password, "email_confirm": True},
        )
    if resp.status_code not in (200, 201):
        raise HTTPException(status_code=400, detail=f"No se pudo crear el usuario: {resp.text}")
    return resp.json()["id"]


# ── Dependencia de autorización ────────────────────────────────────────────────

async def require_platform_admin(authorization: Optional[str] = Header(None)) -> dict:
    """Exige un JWT válido de un usuario presente en platform_admins."""
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="Falta el token de autenticación")

    token = authorization.split(" ", 1)[1].strip()
    user = await _validate_token(token)
    uid = user.get("id")

    res = supabase.table("platform_admins").select("user_id").eq("user_id", uid).execute()
    if not res.data:
        raise HTTPException(status_code=403, detail="Acceso restringido a administradores de plataforma")
    return user


# ── Modelos ────────────────────────────────────────────────────────────────────

class OrgCreate(BaseModel):
    name: str = Field(..., min_length=2)
    plan: str = "trial"


class MemberInvite(BaseModel):
    email: str
    password: str = Field(..., min_length=6)
    role: str = "member"


class RestaurantOnboard(BaseModel):
    name: str = Field(..., min_length=2)
    place_id: Optional[str] = None


class SettingsUpdate(BaseModel):
    default_model: Optional[str] = None
    default_refresh_count: Optional[int] = Field(None, ge=5, le=50)
    default_historical_count: Optional[int] = Field(None, ge=20, le=200)


class ScheduleUpdate(BaseModel):
    auto_ingest_enabled: bool = False
    ingest_frequency_hours: int = Field(6, ge=3, le=168)  # mín 3h (coste Apify), máx semanal


class ContextUpdate(BaseModel):
    tone_preset: str = "cercano_desenfadado"
    emoji_level: str = "sutil"
    language_mode: str = "mirror"
    signature: Optional[str] = None
    instructions: Optional[str] = None
    keywords_objetivo: list = Field(default_factory=list)
    dishes: list = Field(default_factory=list)


_VALID_PLANS = {"internal", "trial", "basic", "growth"}
_VALID_ROLES = {"owner", "admin", "member", "viewer"}


# ── Endpoints ──────────────────────────────────────────────────────────────────

@router.get("/me")
async def me(admin: dict = Depends(require_platform_admin)):
    return {"id": admin["id"], "email": admin.get("email")}


@router.get("/organizations")
async def list_organizations(admin: dict = Depends(require_platform_admin)):
    """Lista organizaciones con conteo de restaurantes y miembros (sin N+1)."""
    orgs = supabase.table("organizations").select("*").order("created_at").execute().data or []
    rests = supabase.table("restaurants").select("organization_id").execute().data or []
    mems = supabase.table("memberships").select("organization_id").execute().data or []

    rc = Counter(r["organization_id"] for r in rests if r.get("organization_id"))
    mc = Counter(m["organization_id"] for m in mems if m.get("organization_id"))
    for o in orgs:
        o["restaurant_count"] = rc.get(o["id"], 0)
        o["member_count"] = mc.get(o["id"], 0)
    return orgs


@router.post("/organizations", status_code=201)
async def create_organization(body: OrgCreate, admin: dict = Depends(require_platform_admin)):
    if body.plan not in _VALID_PLANS:
        raise HTTPException(status_code=422, detail=f"Plan inválido. Válidos: {sorted(_VALID_PLANS)}")
    res = supabase.table("organizations").insert({"name": body.name, "plan": body.plan}).execute()
    return res.data[0]


@router.get("/organizations/{org_id}")
async def organization_detail(
    org_id: str = Path(...),
    admin: dict = Depends(require_platform_admin),
):
    org_res = supabase.table("organizations").select("*").eq("id", org_id).execute()
    if not org_res.data:
        raise HTTPException(status_code=404, detail="Organización no encontrada")
    org = org_res.data[0]

    restaurants = (
        supabase.table("restaurants")
        .select("id,name,place_id,profile_status,google_rating,review_count,auto_ingest_enabled,ingest_frequency_hours,last_ingest_at")
        .eq("organization_id", org_id).order("name").execute().data or []
    )
    memberships = (
        supabase.table("memberships")
        .select("user_id,role,created_at")
        .eq("organization_id", org_id).execute().data or []
    )

    # Enriquecer membresías con email (una sola llamada a GoTrue)
    users = await _list_auth_users()
    for m in memberships:
        u = users.get(m["user_id"])
        m["email"] = u.get("email") if u else None

    return {"organization": org, "restaurants": restaurants, "members": memberships}


@router.post("/organizations/{org_id}/members", status_code=201)
async def add_member(
    body: MemberInvite,
    org_id: str = Path(...),
    admin: dict = Depends(require_platform_admin),
):
    if body.role not in _VALID_ROLES:
        raise HTTPException(status_code=422, detail=f"Rol inválido. Válidos: {sorted(_VALID_ROLES)}")
    if not supabase.table("organizations").select("id").eq("id", org_id).execute().data:
        raise HTTPException(status_code=404, detail="Organización no encontrada")

    user_id = await _find_or_create_auth_user(body.email, body.password)

    res = (
        supabase.table("memberships")
        .upsert(
            {"user_id": user_id, "organization_id": org_id, "role": body.role},
            on_conflict="user_id,organization_id",
        )
        .execute()
    )
    return {"user_id": user_id, "email": body.email, "role": body.role, "membership": res.data}


@router.post("/organizations/{org_id}/restaurants", status_code=201)
async def onboard_restaurant(
    body: RestaurantOnboard,
    org_id: str = Path(...),
    admin: dict = Depends(require_platform_admin),
):
    """Da de alta un restaurante en la organización. La primera ingesta se dispara
    aparte con GET /refresh?restaurant_id=<id> (usa el google_maps_url guardado)."""
    if not supabase.table("organizations").select("id").eq("id", org_id).execute().data:
        raise HTTPException(status_code=404, detail="Organización no encontrada")

    row = {
        "name": body.name,
        "organization_id": org_id,
        "profile_status": "client",
        "city": "Madrid",
    }
    if body.place_id:
        row["place_id"] = body.place_id
        row["google_maps_url"] = PLACE_URL_TEMPLATE.format(place_id=body.place_id)

    res = supabase.table("restaurants").insert(row).execute()
    return res.data[0]


# ── Configuración (operativa editable + estado de secretos) ─────────────────────

def _mask_secret(value: Optional[str]) -> dict:
    """Estado de un secreto sin revelarlo: configurado sí/no + pista de los últimos 4."""
    if not value:
        return {"configured": False, "hint": None}
    return {"configured": True, "hint": f"…{value[-4:]}" if len(value) >= 4 else "…"}


def _settings_payload() -> dict:
    return {
        "config": get_all_settings(),
        "allowed_models": ALLOWED_MODELS,
        # Secretos: solo estado, viven en .env del servidor (nunca editables por web)
        "secrets": {
            "apify_api_token": _mask_secret(os.getenv("APIFY_API_TOKEN")),
            "gemini_api_key": _mask_secret(os.getenv("GEMINI_API_KEY")),
        },
    }


@router.get("/settings")
async def get_settings(admin: dict = Depends(require_platform_admin)):
    return _settings_payload()


@router.put("/settings")
async def update_settings(body: SettingsUpdate, admin: dict = Depends(require_platform_admin)):
    updates: dict = {}
    if body.default_model is not None:
        if body.default_model not in ALLOWED_MODELS:
            raise HTTPException(status_code=422, detail=f"Modelo inválido. Válidos: {ALLOWED_MODELS}")
        updates["default_model"] = body.default_model
    if body.default_refresh_count is not None:
        updates["default_refresh_count"] = body.default_refresh_count
    if body.default_historical_count is not None:
        updates["default_historical_count"] = body.default_historical_count

    for key, value in updates.items():
        supabase.table("platform_settings").upsert(
            {"key": key, "value": value}, on_conflict="key"
        ).execute()

    return _settings_payload()


# ── Configuración del local (personalización IA) ───────────────────────────────

@router.get("/restaurants/{restaurant_id}/context")
async def get_context(restaurant_id: str = Path(...), admin: dict = Depends(require_platform_admin)):
    """Devuelve el contexto de personalización del local + el catálogo de opciones."""
    res = (
        supabase.table("restaurant_context")
        .select("owner_name,signature,tone_preset,emoji_level,language_mode,instructions,keywords_objetivo,dishes")
        .eq("restaurant_id", restaurant_id).limit(1).execute()
    )
    ctx = res.data[0] if res.data else None
    return {"context": ctx, "options": context_options()}


@router.put("/restaurants/{restaurant_id}/context")
async def put_context(
    body: ContextUpdate,
    restaurant_id: str = Path(...),
    admin: dict = Depends(require_platform_admin),
):
    if body.tone_preset not in TONE_PRESETS:
        raise HTTPException(status_code=422, detail=f"tone_preset inválido. Válidos: {list(TONE_PRESETS)}")
    if body.emoji_level not in EMOJI_RULES:
        raise HTTPException(status_code=422, detail=f"emoji_level inválido. Válidos: {list(EMOJI_RULES)}")
    if body.language_mode not in LANGUAGE_RULES:
        raise HTTPException(status_code=422, detail=f"language_mode inválido. Válidos: {list(LANGUAGE_RULES)}")
    if not supabase.table("restaurants").select("id").eq("id", restaurant_id).execute().data:
        raise HTTPException(status_code=404, detail="Restaurante no encontrado")

    row = {
        "restaurant_id": restaurant_id,
        "tone_preset": body.tone_preset,
        "emoji_level": body.emoji_level,
        "language_mode": body.language_mode,
        "signature": (body.signature or "").strip() or None,
        "instructions": (body.instructions or "").strip() or None,
        "keywords_objetivo": [str(k).strip() for k in body.keywords_objetivo if str(k).strip()],
        "dishes": [str(d).strip() for d in body.dishes if str(d).strip()],
    }
    res = supabase.table("restaurant_context").upsert(row, on_conflict="restaurant_id").execute()
    return res.data[0] if res.data else row


# ── Programación de ingesta automática ─────────────────────────────────────────

@router.put("/restaurants/{restaurant_id}/schedule")
async def put_schedule(
    body: ScheduleUpdate,
    restaurant_id: str = Path(...),
    admin: dict = Depends(require_platform_admin),
):
    if not supabase.table("restaurants").select("id").eq("id", restaurant_id).execute().data:
        raise HTTPException(status_code=404, detail="Restaurante no encontrado")
    res = (
        supabase.table("restaurants").update({
            "auto_ingest_enabled": body.auto_ingest_enabled,
            "ingest_frequency_hours": body.ingest_frequency_hours,
        }).eq("id", restaurant_id).execute()
    )
    return res.data[0] if res.data else {}


# ── Ingesta manual (SSE) ───────────────────────────────────────────────────────
# Operación unificada para los 3 casos del backoffice (misma lógica, 2 perillas):
#   · Primera ingesta (onboarding):  max_reviews=10,  generate_replies=true
#   · Carga histórica:               max_reviews=100, generate_replies=false
#   · Refresh manual:                max_reviews=10,  generate_replies=true
# Se consume con fetch+stream (no EventSource) para poder mandar el JWT del staff.
# Nota: comparte lógica con GET /refresh (api.py), que sirve a la app de cliente;
# se mantienen separados para no acoplar el camino del cliente al del backoffice.

_SSE_HEADERS = {
    "Cache-Control": "no-cache",
    "X-Accel-Buffering": "no",
    "Connection": "keep-alive",
}


def _sse(data: dict) -> str:
    return f"data: {json.dumps(data, ensure_ascii=False)}\n\n"


def _sse_named(event: str, data: dict) -> str:
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


@router.get("/restaurants/{restaurant_id}/ingest")
async def ingest_restaurant(
    restaurant_id: str = Path(...),
    max_reviews: int = Query(10, ge=5, le=200, description="Reseñas más recientes a recopilar"),
    generate_replies: bool = Query(True, description="Generar suggested_reply para reseñas nuevas (off para carga histórica)"),
    model: str = Query("gemini-2.5-flash"),
    admin: dict = Depends(require_platform_admin),
):
    """Ingesta incremental de un restaurante (la MISMA op que el scheduler).
    Delega en ingest.run_incremental_ingest y puentea su progreso al stream SSE."""
    loop = asyncio.get_running_loop()

    async def generate():
        queue: asyncio.Queue = asyncio.Queue()

        def emit(**kw):
            loop.call_soon_threadsafe(queue.put_nowait, kw)

        def work():
            try:
                res = run_incremental_ingest(
                    restaurant_id, max_reviews=max_reviews,
                    generate_replies=generate_replies, model=model, emit=emit,
                )
                loop.call_soon_threadsafe(queue.put_nowait, {"_done": res})
            except Exception as e:
                logger.error("Error en ingest de %s: %s", restaurant_id, e, exc_info=True)
                msg = str(e)
                if "429" in msg or "Quota" in msg or "RESOURCE_EXHAUSTED" in msg:
                    msg = "Cuota de IA de Google agotada. Cambia de modelo o inténtalo más tarde."
                loop.call_soon_threadsafe(queue.put_nowait, {"_error": msg})

        loop.run_in_executor(None, work)

        while True:
            item = await queue.get()
            if "_error" in item:
                yield _sse({"status": "error", "message": item["_error"]})
                return
            if "_done" in item:
                yield _sse_named("done", item["_done"])
                return
            yield _sse(item)

    return StreamingResponse(generate(), media_type="text/event-stream", headers=_SSE_HEADERS)


@router.get("/restaurants/{restaurant_id}/regenerate-replies")
async def regenerate_replies(
    restaurant_id: str = Path(...),
    only_unanswered: bool = Query(True, description="Solo reseñas sin responder por el dueño (donde la sugerencia aporta)"),
    model: str = Query("gemini-2.5-flash"),
    admin: dict = Depends(require_platform_admin),
):
    """
    Regenera suggested_reply de las reseñas YA almacenadas con el contexto actual
    (tono, keywords, platos…). NO toca Apify: solo Gemini. Para iterar el tono sin
    re-scrapear. Progreso vía SSE (procesadas/total).
    """
    loop = asyncio.get_running_loop()

    async def generate():
        try:
            restaurant = await loop.run_in_executor(None, lambda: get_restaurant_by_id(restaurant_id))
            if not restaurant:
                yield _sse({"status": "error", "message": "Restaurante no encontrado."})
                return
            name = restaurant.get("name", "Restaurante")
            context = await loop.run_in_executor(None, lambda: get_restaurant_context(restaurant_id))

            # Reseñas con texto; por defecto solo las no respondidas por el dueño
            q = (
                supabase.table("reviews")
                .select("id,rating,text,author_name,owner_replied")
                .eq("restaurant_id", restaurant_id)
                .not_.is_("text", "null").neq("text", "")
            )
            if only_unanswered:
                q = q.eq("owner_replied", False)
            targets = (q.execute().data) or []

            total = len(targets)
            if total == 0:
                yield _sse({"processed": 0, "total": 0, "message": "No hay reseñas que regenerar con este filtro."})
                yield _sse_named("done", {"regenerated": 0})
                return

            yield _sse({"processed": 0, "total": total, "message": f"Regenerando {total} respuesta(s) con el contexto actual…"})

            done = 0
            for r in targets:
                reply = await loop.run_in_executor(
                    None, lambda rv=r: generate_suggested_reply(rv, name, context, model)
                )
                await loop.run_in_executor(
                    None, lambda rid=r["id"], rep=reply: supabase.table("reviews").update({"suggested_reply": rep}).eq("id", rid).execute()
                )
                done += 1
                yield _sse({"processed": done, "total": total, "message": f"{done}/{total} regeneradas"})

            yield _sse_named("done", {"regenerated": done})

        except Exception as e:
            logger.error("Error regenerando respuestas de %s: %s", restaurant_id, e, exc_info=True)
            msg = str(e)
            if "429" in msg or "Quota" in msg or "RESOURCE_EXHAUSTED" in msg:
                msg = "Cuota de IA de Google agotada. Cambia de modelo o inténtalo más tarde."
            yield _sse({"status": "error", "message": msg})

    return StreamingResponse(generate(), media_type="text/event-stream", headers=_SSE_HEADERS)
