"""
api.py — FastAPI + SSE para la demo app de Qinsa Reputation.

Endpoints:
  GET /analyze?place_id=<ID>&max_reviews=<N>
      Pipeline completo (scraping → análisis IA → guardado). SSE.

  GET /refresh?restaurant_id=<UUID>&max_reviews=10
      Busca reseñas nuevas, genera suggested_reply con Gemini para cada una,
      guarda y regenera insights si hay cambios. SSE.

  POST /generate-reply
      Genera suggested_reply para una reseña concreta y la guarda en Supabase.
      Body JSON: {review_id, restaurant_id}

  GET /health

Uso:
    cd /Users/sergiodani/workspace/qinsa-reputation/pipeline
    uvicorn api:app --reload --port 8000
"""
import asyncio
import json
import logging
import os
import sys

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from dotenv import load_dotenv

load_dotenv()

sys.path.insert(0, os.path.dirname(__file__))

from scraper import scrape_reviews
from analyzer import analyze_reviews, generate_suggested_reply
from loader import (
    upsert_restaurant,
    insert_reviews_deduped,
    upsert_insights,
    get_restaurant_by_id,
    get_restaurant_context,
    supabase,
)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger(__name__)

app = FastAPI(title="Qinsa Pipeline API", version="0.2.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
)

PLACE_URL_TEMPLATE = "https://www.google.com/maps/place/?q=place_id:{place_id}"


# ── Helpers SSE ────────────────────────────────────────────────────────────────

def _sse(data: dict) -> str:
    return f"data: {json.dumps(data, ensure_ascii=False)}\n\n"


def _sse_named(event: str, data: dict) -> str:
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


_SSE_HEADERS = {
    "Cache-Control": "no-cache",
    "X-Accel-Buffering": "no",
    "Connection": "keep-alive",
}


# ── GET /analyze ───────────────────────────────────────────────────────────────

@app.get("/analyze")
async def analyze(
    place_id: str = Query(..., description="Google Maps Place ID (formato: ChIJ...)"),
    max_reviews: int = Query(50, ge=10, le=200),
):
    """Pipeline completo para un lugar nuevo. Emite progreso via SSE."""
    loop = asyncio.get_running_loop()
    google_maps_url = PLACE_URL_TEMPLATE.format(place_id=place_id)

    async def generate():
        try:
            # Paso 1: Scraping
            yield _sse({"step": 1, "status": "running",
                        "message": f"Conectando con Google Maps (máx. {max_reviews} reseñas)…"})

            result = await loop.run_in_executor(
                None, lambda: scrape_reviews(google_maps_url, max_reviews)
            )
            reviews   = result["reviews"]
            place_data = result["place_data"]

            if not reviews:
                yield _sse({"step": 1, "status": "error",
                            "message": "No se encontraron reseñas. Comprueba el Place ID."})
                return

            yield _sse({"step": 1, "status": "done",
                        "message": f"{len(reviews)} reseñas obtenidas de «{place_data.get('name', '')}»"})

            # Paso 2: Análisis IA
            restaurant_name = place_data.get("name") or "Restaurante"
            yield _sse({"step": 2, "status": "running",
                        "message": f"Analizando {len(reviews)} reseñas con Gemini…"})

            insights = await loop.run_in_executor(
                None, lambda: analyze_reviews(reviews, restaurant_name)
            )

            yield _sse({"step": 2, "status": "done",
                        "message": f"Análisis completado · sentimiento {insights.get('sentiment_score', '?')}/10"})

            # Paso 3: Guardado
            yield _sse({"step": 3, "status": "running", "message": "Guardando en Supabase…"})

            restaurant_id = await loop.run_in_executor(
                None, lambda: upsert_restaurant(place_data, google_maps_url)
            )
            inserted = await loop.run_in_executor(
                None, lambda: insert_reviews_deduped(restaurant_id, reviews)
            )
            await loop.run_in_executor(
                None, lambda: upsert_insights(restaurant_id, insights)
            )

            yield _sse({"step": 3, "status": "done",
                        "message": f"{inserted} reseñas guardadas"})

            restaurant = await loop.run_in_executor(
                None, lambda: get_restaurant_by_id(restaurant_id)
            )
            yield _sse_named("done", {"restaurant_id": restaurant_id, "restaurant": restaurant})

        except Exception as e:
            logger.error(f"Error en /analyze para {place_id}: {e}", exc_info=True)
            yield _sse({"status": "error", "message": str(e)})

    return StreamingResponse(generate(), media_type="text/event-stream", headers=_SSE_HEADERS)


# ── GET /refresh ───────────────────────────────────────────────────────────────

@app.get("/refresh")
async def refresh(
    restaurant_id: str = Query(..., description="UUID del restaurante en Supabase"),
    max_reviews: int = Query(10, ge=5, le=50,
                             description="Reseñas más recientes a comprobar"),
):
    """
    Busca las `max_reviews` reseñas más recientes, detecta las nuevas por review_id,
    genera una suggested_reply con Gemini para cada una usando el contexto del restaurante,
    las guarda y regenera insights si hubo cambios.
    """
    loop = asyncio.get_running_loop()

    async def generate():
        try:
            # Cargar datos del restaurante y su contexto de respuestas
            restaurant = await loop.run_in_executor(
                None, lambda: get_restaurant_by_id(restaurant_id)
            )
            if not restaurant or not restaurant.get("google_maps_url"):
                yield _sse({"status": "error",
                            "message": "Restaurante no encontrado o sin URL de Google Maps configurada."})
                return

            context = await loop.run_in_executor(
                None, lambda: get_restaurant_context(restaurant_id)
            )
            restaurant_name = restaurant.get("name", "Restaurante")

            # Paso 1: Scraping de reseñas recientes
            yield _sse({"step": 1, "status": "running",
                        "message": f"Obteniendo las {max_reviews} reseñas más recientes…"})

            result = await loop.run_in_executor(
                None, lambda: scrape_reviews(restaurant["google_maps_url"], max_reviews)
            )
            reviews = result["reviews"]

            if not reviews:
                yield _sse({"step": 1, "status": "error",
                            "message": "No se encontraron reseñas para este restaurante."})
                return

            yield _sse({"step": 1, "status": "done",
                        "message": f"{len(reviews)} reseñas obtenidas"})

            # Paso 2: Detectar nuevas y generar respuestas sugeridas
            yield _sse({"step": 2, "status": "running",
                        "message": "Detectando reseñas nuevas y generando respuestas con IA…"})

            existing_resp = supabase.table("reviews") \
                .select("review_id,author_name,review_date") \
                .eq("restaurant_id", restaurant_id) \
                .execute()

            existing_ids = {
                r.get("review_id") for r in existing_resp.data if r.get("review_id")
            }
            existing_pairs = {
                (r.get("author_name"), r.get("review_date")) for r in existing_resp.data
            }

            new_reviews = []
            for r in reviews:
                rid  = r.get("review_id")
                pair = (r.get("author_name"), r.get("review_date"))
                if rid and rid in existing_ids:
                    continue
                if pair in existing_pairs:
                    continue
                new_reviews.append(r)

            if not new_reviews:
                yield _sse({"step": 2, "status": "done",
                            "message": "No hay reseñas nuevas desde la última actualización."})
                yield _sse_named("done", {"new_count": 0})
                return

            # Generar suggested_reply para cada reseña nueva con texto
            for r in new_reviews:
                if r.get("text"):
                    # Captura de r en el closure para evitar bug de referencia tardía
                    reply = await loop.run_in_executor(
                        None, lambda rv=r: generate_suggested_reply(rv, restaurant_name, context)
                    )
                    r["suggested_reply"] = reply

            yield _sse({"step": 2, "status": "done",
                        "message": f"{len(new_reviews)} reseña(s) nueva(s) · respuestas generadas"})

            # Paso 3: Guardar y regenerar insights
            yield _sse({"step": 3, "status": "running",
                        "message": "Guardando reseñas y actualizando insights…"})

            inserted = await loop.run_in_executor(
                None, lambda: insert_reviews_deduped(restaurant_id, new_reviews)
            )

            if inserted > 0:
                # Regenerar insights con todas las reseñas del restaurante
                all_resp = supabase.table("reviews") \
                    .select("rating,text,author_name,review_date,owner_replied,reply_text") \
                    .eq("restaurant_id", restaurant_id) \
                    .execute()

                insights = await loop.run_in_executor(
                    None, lambda: analyze_reviews(all_resp.data, restaurant_name)
                )
                await loop.run_in_executor(
                    None, lambda: upsert_insights(restaurant_id, insights)
                )

            yield _sse({"step": 3, "status": "done",
                        "message": f"{inserted} reseña(s) guardada(s), insights actualizados"})

            yield _sse_named("done", {"new_count": inserted})

        except Exception as e:
            logger.error(f"Error en /refresh para {restaurant_id}: {e}", exc_info=True)
            yield _sse({"status": "error", "message": str(e)})

    return StreamingResponse(generate(), media_type="text/event-stream", headers=_SSE_HEADERS)


# ── POST /generate-reply ──────────────────────────────────────────────────────

class GenerateReplyRequest(BaseModel):
    review_id: str       # UUID de la fila en tabla reviews
    restaurant_id: str   # UUID del restaurante


@app.post("/generate-reply")
async def generate_reply_endpoint(body: GenerateReplyRequest):
    """
    Genera una suggested_reply para una reseña concreta con Gemini,
    la guarda en Supabase y la devuelve al frontend.
    Usa el restaurant_context del restaurante para personalizar tono e instrucciones.
    """
    loop = asyncio.get_running_loop()

    # Cargar la reseña
    review_resp = supabase.table("reviews") \
        .select("id,rating,text,author_name") \
        .eq("id", body.review_id) \
        .single() \
        .execute()
    review = review_resp.data

    if not review:
        raise HTTPException(status_code=404, detail="Reseña no encontrada")

    # Cargar restaurante y contexto
    restaurant = await loop.run_in_executor(
        None, lambda: get_restaurant_by_id(body.restaurant_id)
    )
    context = await loop.run_in_executor(
        None, lambda: get_restaurant_context(body.restaurant_id)
    )

    # Generar respuesta con Gemini
    reply = await loop.run_in_executor(
        None, lambda: generate_suggested_reply(review, restaurant["name"], context)
    )

    # Guardar en Supabase
    supabase.table("reviews") \
        .update({"suggested_reply": reply}) \
        .eq("id", body.review_id) \
        .execute()

    return {"suggested_reply": reply}


# ── GET /health ────────────────────────────────────────────────────────────────

@app.get("/health")
async def health():
    return {"status": "ok"}
