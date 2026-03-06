"""
loader.py — Carga de datos del pipeline en Supabase.

Funciones públicas:
    upsert_restaurant(place_data, google_maps_url) → restaurant_id (str)
    insert_reviews_deduped(restaurant_id, reviews)  → int (reseñas insertadas)
    upsert_insights(restaurant_id, insights)        → None
    get_prospects()                                  → list[dict]
"""
import logging
import os

from supabase import create_client
from dotenv import load_dotenv

load_dotenv()
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger(__name__)

supabase = create_client(
    os.getenv("SUPABASE_URL"),
    os.getenv("SUPABASE_SERVICE_ROLE_KEY"),
)

# Campos de la tabla `insights` en Supabase
_INSIGHTS_SCHEMA_FIELDS = {
    "top_problems", "top_strengths", "keywords",
    "summary", "sentiment_score", "response_quality", "model_used",
    "staff_mentions", "rating_distribution", "recurring_issues", "recurring_praise",
}


def upsert_restaurant(place_data: dict, google_maps_url: str) -> str:
    """
    Crea o actualiza un restaurante usando google_maps_url como clave de deduplicación.

    - Si no existe: inserta con los datos del scraper, profile_status=prospect.
    - Si existe:    actualiza google_rating, review_count y response_rate.

    Returns:
        restaurant_id (UUID str)
    """
    try:
        existing = (
            supabase.table("restaurants")
            .select("id,name")
            .eq("google_maps_url", google_maps_url)
            .execute()
        )
    except Exception as e:
        logger.error(f"Error buscando restaurante por google_maps_url: {str(e)}")
        raise

    if existing.data:
        restaurant_id = existing.data[0]["id"]
        restaurant_name = existing.data[0]["name"]

        # Solo actualizamos los campos numéricos que vienen del scraper
        update_data = {
            k: place_data[k]
            for k in ("google_rating", "review_count", "response_rate")
            if k in place_data and place_data[k] is not None
        }
        if update_data:
            try:
                supabase.table("restaurants").update(update_data).eq("id", restaurant_id).execute()
            except Exception as e:
                logger.error(f"Error actualizando restaurante {restaurant_id}: {str(e)}")
                raise

        logger.info(f"Restaurante existente actualizado: '{restaurant_name}' ({restaurant_id})")
        return restaurant_id

    else:
        insert_data = {
            "name":           place_data.get("name") or "Sin nombre",
            "google_maps_url": google_maps_url,
            "google_rating":  place_data.get("google_rating"),
            "review_count":   place_data.get("review_count"),
            "response_rate":  place_data.get("response_rate"),
            "city":           "Madrid",
            "profile_status": "prospect",
        }
        try:
            response = supabase.table("restaurants").insert(insert_data).execute()
        except Exception as e:
            logger.error(f"Error creando restaurante: {str(e)}")
            raise

        restaurant_id = response.data[0]["id"]
        logger.info(f"Restaurante creado: '{insert_data['name']}' ({restaurant_id})")
        return restaurant_id


def insert_reviews_deduped(restaurant_id: str, reviews: list) -> int:
    """
    Inserta solo las reseñas que no existen aún.
    Clave primaria de deduplicación: review_id (del actor Apify).
    Fallback: (author_name, review_date) para reseñas sin review_id o datos históricos.

    Returns:
        Número de reseñas nuevas insertadas.
    """
    if not reviews:
        return 0

    # Cargar review_id Y (author_name, review_date) para deduplicación robusta
    try:
        existing_resp = (
            supabase.table("reviews")
            .select("review_id,author_name,review_date")
            .eq("restaurant_id", restaurant_id)
            .execute()
        )
    except Exception as e:
        logger.error(f"Error obteniendo reseñas existentes para {restaurant_id}: {str(e)}")
        raise

    existing_review_ids = {
        r.get("review_id")
        for r in existing_resp.data
        if r.get("review_id")
    }
    existing_pairs = {
        (r.get("author_name"), r.get("review_date"))
        for r in existing_resp.data
    }

    new_reviews = []
    for r in reviews:
        rid = r.get("review_id")
        pair = (r.get("author_name"), r.get("review_date"))
        # Duplicate si review_id coincide (fuente definitiva) o si coincide el par histórico
        if rid and rid in existing_review_ids:
            continue
        if pair in existing_pairs:
            continue
        new_reviews.append({"restaurant_id": restaurant_id, **r})

    skipped = len(reviews) - len(new_reviews)
    if skipped:
        logger.info(f"Omitidas {skipped} reseñas ya existentes")

    if not new_reviews:
        logger.info("No hay reseñas nuevas que insertar")
        return 0

    try:
        response = supabase.table("reviews").insert(new_reviews).execute()
    except Exception as e:
        logger.error(f"Error insertando reseñas: {str(e)}")
        raise

    count = len(response.data)
    logger.info(f"Insertadas {count} reseñas nuevas ({skipped} duplicadas omitidas)")
    return count


def upsert_insights(restaurant_id: str, insights: dict) -> None:
    """
    Inserta o actualiza el registro de insights para un restaurante.
    Solo persiste los campos definidos en el schema de Supabase.
    Los campos extra del analyzer (staff_mentions, rating_distribution, etc.)
    no se persisten — se usan solo para el resumen en consola.
    """
    record = {"restaurant_id": restaurant_id}
    for field in _INSIGHTS_SCHEMA_FIELDS:
        if field in insights:
            record[field] = insights[field]

    try:
        existing = (
            supabase.table("insights")
            .select("id")
            .eq("restaurant_id", restaurant_id)
            .execute()
        )
    except Exception as e:
        logger.error(f"Error buscando insights para {restaurant_id}: {str(e)}")
        raise

    try:
        if existing.data:
            supabase.table("insights").update(record).eq("restaurant_id", restaurant_id).execute()
            logger.info(f"Insights actualizados para restaurante {restaurant_id}")
        else:
            supabase.table("insights").insert(record).execute()
            logger.info(f"Insights creados para restaurante {restaurant_id}")
    except Exception as e:
        logger.error(f"Error guardando insights para {restaurant_id}: {str(e)}")
        raise


def get_restaurant_by_id(restaurant_id: str) -> dict:
    """Carga un restaurante por ID incluyendo google_maps_url."""
    try:
        resp = (
            supabase.table("restaurants")
            .select("id,name,neighborhood,city,google_rating,review_count,response_rate,profile_status,google_maps_url")
            .eq("id", restaurant_id)
            .single()
            .execute()
        )
        return resp.data
    except Exception as e:
        logger.error(f"Error obteniendo restaurante {restaurant_id}: {str(e)}")
        raise


def get_restaurant_context(restaurant_id: str):
    """
    Carga el contexto del restaurante (tono, instrucciones, nombre del dueño)
    para la generación de respuestas sugeridas con IA.
    Devuelve None si no hay contexto configurado para este restaurante.
    """
    try:
        resp = (
            supabase.table("restaurant_context")
            .select("owner_name,tone,instructions")
            .eq("restaurant_id", restaurant_id)
            .limit(1)
            .execute()
        )
        return resp.data[0] if resp.data else None
    except Exception as e:
        logger.warning(f"No se pudo cargar restaurant_context para {restaurant_id}: {str(e)}")
        return None


def get_prospects() -> list:
    """Devuelve todos los restaurantes con profile_status = 'prospect'."""
    try:
        response = (
            supabase.table("restaurants")
            .select("*")
            .eq("profile_status", "prospect")
            .execute()
        )
        return response.data
    except Exception as e:
        logger.error(f"Error obteniendo prospects: {str(e)}")
        raise
