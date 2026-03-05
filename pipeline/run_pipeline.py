"""
run_pipeline.py — Script maestro del pipeline de datos Qinsa Reputation.

Uso:
    python run_pipeline.py --restaurant-id <uuid>   # procesar un restaurante
    python run_pipeline.py --all                    # procesar todos los prospects
"""
import argparse
import logging
import sys
from scraper import scrape_reviews
from analyzer import build_insights
from loader import upsert_restaurant_data, insert_reviews, insert_insights, get_prospects

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)


def process_restaurant(restaurant: dict) -> None:
    restaurant_id = restaurant["id"]
    name = restaurant.get("name", restaurant_id)
    google_maps_url = restaurant.get("google_maps_url")

    if not google_maps_url:
        logger.warning(f"Restaurante {name} sin google_maps_url — omitido")
        return

    logger.info(f"--- Procesando: {name} ---")

    result = scrape_reviews(google_maps_url)
    reviews = result["reviews"]
    place_data = result["place_data"]

    upsert_restaurant_data(restaurant_id, place_data)
    insert_reviews(restaurant_id, reviews)

    insights = build_insights(reviews)
    if insights:
        insert_insights(restaurant_id, insights)

    logger.info(f"--- Completado: {name} ---")


def main():
    parser = argparse.ArgumentParser(description="Pipeline de datos Qinsa Reputation")
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--restaurant-id", help="UUID del restaurante a procesar")
    group.add_argument("--all", action="store_true", help="Procesar todos los prospects")
    args = parser.parse_args()

    from loader import supabase  # importar aquí para validar env vars

    if args.all:
        prospects = get_prospects()
        logger.info(f"Procesando {len(prospects)} restaurantes prospect")
        for restaurant in prospects:
            try:
                process_restaurant(restaurant)
            except Exception as e:
                logger.error(f"Error procesando {restaurant.get('name')}: {str(e)}")
    else:
        response = supabase.table("restaurants").select("*").eq("id", args.restaurant_id).single().execute()
        if not response.data:
            logger.error(f"Restaurante {args.restaurant_id} no encontrado")
            sys.exit(1)
        process_restaurant(response.data)


if __name__ == "__main__":
    main()
