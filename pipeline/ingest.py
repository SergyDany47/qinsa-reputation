"""
ingest.py — Operación canónica de ingesta incremental.

ÚNICA fuente de verdad del ciclo "buscar reseñas nuevas": la usan tanto el botón
manual del backoffice (vía SSE en admin.py) como el scheduler automático
(scheduler.py). Así el modo manual y el programado son EXACTAMENTE lo mismo.

Es síncrona y bloqueante (Apify + Gemini). `emit(step, status, message)` es un
callback opcional de progreso; el endpoint SSE lo conecta a su stream, el
scheduler lo deja por defecto (no-op) y registra el resultado.
"""
import logging
from datetime import datetime, timezone

from loader import (
    supabase,
    get_restaurant_by_id,
    get_restaurant_context,
    insert_reviews_deduped,
    upsert_insights,
)
from scraper import scrape_reviews
from analyzer import analyze_reviews, generate_suggested_reply

logger = logging.getLogger(__name__)


def _noop(**kwargs):
    pass


def run_incremental_ingest(restaurant_id, *, max_reviews=10, generate_replies=True,
                           model="gemini-2.5-flash", emit=_noop) -> dict:
    """
    Scrape recientes → dedupe → (respuestas IA para nuevas) → insights → ficha.
    Devuelve {"inserted": n, "scraped": m}. Lanza ValueError en errores duros.
    """
    restaurant = get_restaurant_by_id(restaurant_id)
    if not restaurant:
        raise ValueError("Restaurante no encontrado.")
    if not restaurant.get("google_maps_url"):
        raise ValueError("El restaurante no tiene google_maps_url. Asígnale un place_id en el onboarding.")

    name = restaurant.get("name", "Restaurante")
    context = get_restaurant_context(restaurant_id)

    # Paso 1 — scraping
    emit(step=1, status="running", message=f"Recopilando hasta {max_reviews} reseñas de Google Maps…")
    result = scrape_reviews(restaurant["google_maps_url"], max_reviews)
    reviews = result["reviews"]

    # Actualizar métricas de la ficha desde el scraper
    place_data = result.get("place_data") or {}
    ficha = {k: place_data[k] for k in ("google_rating", "review_count", "response_rate")
             if place_data.get(k) is not None}

    now_iso = datetime.now(timezone.utc).isoformat()

    if not reviews:
        # Sin reseñas no es un error: marcamos la ejecución y salimos
        supabase.table("restaurants").update({**ficha, "last_ingest_at": now_iso}).eq("id", restaurant_id).execute()
        emit(step=1, status="done", message="No se encontraron reseñas nuevas.")
        emit(step=3, status="done", message="0 reseñas nuevas")
        return {"inserted": 0, "scraped": 0}

    emit(step=1, status="done", message=f"{len(reviews)} reseñas obtenidas")

    # Paso 2 — detectar nuevas (+ respuestas si procede)
    emit(step=2, status="running", message="Detectando reseñas nuevas…")
    existing = (
        supabase.table("reviews").select("review_id,author_name,review_date")
        .eq("restaurant_id", restaurant_id).execute()
    )
    existing_ids = {r.get("review_id") for r in existing.data if r.get("review_id")}
    existing_pairs = {(r.get("author_name"), r.get("review_date")) for r in existing.data}

    new_reviews = []
    for r in reviews:
        rid = r.get("review_id")
        pair = (r.get("author_name"), r.get("review_date"))
        if (rid and rid in existing_ids) or pair in existing_pairs:
            continue
        new_reviews.append(r)

    if generate_replies and new_reviews:
        emit(step=2, status="running", message=f"Generando respuestas IA para {len(new_reviews)} reseña(s)…")
        for r in new_reviews:
            if r.get("text"):
                r["suggested_reply"] = generate_suggested_reply(r, name, context, model)

    emit(step=2, status="done", message=f"{len(new_reviews)} reseña(s) nueva(s)")

    # Paso 3 — guardar + recalcular insights + ficha
    emit(step=3, status="running", message="Guardando y recalculando insights…")
    inserted = insert_reviews_deduped(restaurant_id, new_reviews)

    if inserted > 0:
        all_resp = (
            supabase.table("reviews")
            .select("rating,text,author_name,review_date,owner_replied,reply_text")
            .eq("restaurant_id", restaurant_id).execute()
        )
        insights = analyze_reviews(all_resp.data, name, model)
        upsert_insights(restaurant_id, insights)

    supabase.table("restaurants").update({**ficha, "last_ingest_at": now_iso}).eq("id", restaurant_id).execute()

    emit(step=3, status="done", message=f"{inserted} reseña(s) guardada(s), insights actualizados")
    return {"inserted": inserted, "scraped": len(reviews)}
