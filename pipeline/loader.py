import logging
import os
from supabase import create_client
from dotenv import load_dotenv

load_dotenv()
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

supabase = create_client(
    os.getenv("SUPABASE_URL"),
    os.getenv("SUPABASE_SERVICE_ROLE_KEY"),
)


def upsert_restaurant_data(restaurant_id: str, place_data: dict) -> None:
    """Actualiza google_rating, review_count y response_rate del restaurante."""
    try:
        supabase.table("restaurants").update(place_data).eq("id", restaurant_id).execute()
        logger.info(f"Restaurante {restaurant_id} actualizado con datos del lugar")
    except Exception as e:
        logger.error(f"Error actualizando restaurante {restaurant_id}: {str(e)}")
        raise


def insert_reviews(restaurant_id: str, reviews: list) -> int:
    """Inserta reseñas en la tabla reviews. Devuelve el número de reseñas insertadas."""
    records = [{"restaurant_id": restaurant_id, **r} for r in reviews]
    try:
        response = supabase.table("reviews").insert(records).execute()
        count = len(response.data)
        logger.info(f"Insertadas {count} reseñas para restaurante {restaurant_id}")
        return count
    except Exception as e:
        logger.error(f"Error insertando reseñas para {restaurant_id}: {str(e)}")
        raise


def insert_insights(restaurant_id: str, insights: dict) -> None:
    """Inserta o actualiza insights para un restaurante."""
    record = {"restaurant_id": restaurant_id, **insights}
    try:
        supabase.table("insights").upsert(record, on_conflict="restaurant_id").execute()
        logger.info(f"Insights guardados para restaurante {restaurant_id}")
    except Exception as e:
        logger.error(f"Error guardando insights para {restaurant_id}: {str(e)}")
        raise


def get_prospects() -> list:
    """Devuelve todos los restaurantes con status prospect."""
    try:
        response = supabase.table("restaurants").select("*").eq("profile_status", "prospect").execute()
        return response.data
    except Exception as e:
        logger.error(f"Error obteniendo prospects: {str(e)}")
        raise
