"""
run_pipeline.py — Orquestador del pipeline completo: scraper → analyzer → loader.

Uso:
    python run_pipeline.py --place-id ChIJ...               # restaurante por placeId (crea si no existe)
    python run_pipeline.py --restaurant-id <uuid>           # restaurante existente en Supabase
    python run_pipeline.py --all                            # todos los prospects en Supabase
    python run_pipeline.py --place-id ChIJ... --max 50     # con límite de reseñas

El flag --place-id construye automáticamente la URL de Google Maps con el placeId
y crea el restaurante en Supabase si no existe todavía.
"""
import argparse
import logging
import sys

from dotenv import load_dotenv

load_dotenv()
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger(__name__)

PLACE_URL_TEMPLATE = "https://www.google.com/maps/place/?q=place_id:{place_id}"


def _run_pipeline(google_maps_url: str, restaurant_name_hint: str, max_reviews: int) -> dict:
    """
    Ejecuta los tres pasos del pipeline para una URL de Google Maps.

    Returns:
        dict con el resumen del resultado (para print_summary).
    """
    from scraper import scrape_reviews
    from analyzer import analyze_reviews
    from loader import upsert_restaurant, insert_reviews_deduped, upsert_insights

    # Paso 1 — Scraping
    logger.info(f"[1/3] Scraping — {google_maps_url}")
    scrape_result = scrape_reviews(google_maps_url, max_reviews=max_reviews)
    reviews = scrape_result["reviews"]
    place_data = scrape_result["place_data"]
    restaurant_name = place_data.get("name") or restaurant_name_hint or "Desconocido"
    logger.info(f"Recopiladas {len(reviews)} reseñas de '{restaurant_name}'")

    # Paso 2 — Análisis IA
    logger.info(f"[2/3] Análisis con Gemini")
    insights = analyze_reviews(reviews, restaurant_name=restaurant_name)

    # Paso 3 — Carga en Supabase
    logger.info(f"[3/3] Cargando en Supabase")
    restaurant_id = upsert_restaurant(place_data, google_maps_url)
    reviews_inserted = insert_reviews_deduped(restaurant_id, reviews)
    upsert_insights(restaurant_id, insights)

    return {
        "restaurant_id":    restaurant_id,
        "restaurant_name":  restaurant_name,
        "reviews_scraped":  len(reviews),
        "reviews_inserted": reviews_inserted,
        "sentiment_score":  insights.get("sentiment_score"),
        "top_problems":     insights.get("top_problems", []),
        "top_strengths":    insights.get("top_strengths", []),
        "staff_mentions":   insights.get("staff_mentions", []),
    }


def run_for_place_id(place_id: str, max_reviews: int = 100) -> dict:
    """Pipeline para un place_id de Google Maps. Crea el restaurante si no existe."""
    google_maps_url = PLACE_URL_TEMPLATE.format(place_id=place_id)
    return _run_pipeline(google_maps_url, restaurant_name_hint="", max_reviews=max_reviews)


def run_for_restaurant_id(restaurant_id: str, max_reviews: int = 100) -> dict:
    """Pipeline para un restaurante ya registrado en Supabase. Lee su google_maps_url de la BD."""
    from loader import supabase as sb

    resp = sb.table("restaurants").select("name,google_maps_url").eq("id", restaurant_id).single().execute()
    if not resp.data:
        raise RuntimeError(f"Restaurante {restaurant_id} no encontrado en Supabase")

    restaurant = resp.data
    google_maps_url = restaurant.get("google_maps_url")
    if not google_maps_url:
        raise RuntimeError(f"Restaurante '{restaurant['name']}' no tiene google_maps_url")

    return _run_pipeline(google_maps_url, restaurant_name_hint=restaurant["name"], max_reviews=max_reviews)


def print_summary(result: dict) -> None:
    w = 65
    print(f"\n{'=' * w}")
    print(f"  PIPELINE COMPLETADO — {result['restaurant_name']}")
    print(f"{'=' * w}")
    print(f"  Restaurante ID  : {result['restaurant_id']}")
    print(f"  Reseñas scraped : {result['reviews_scraped']}")
    print(f"  Reseñas nuevas  : {result['reviews_inserted']}")
    print(f"  Sentiment score : {result['sentiment_score']}/10")

    if result.get("top_problems"):
        print(f"\n  Problemas detectados:")
        for p in result["top_problems"]:
            print(f"    • {p}")

    if result.get("top_strengths"):
        print(f"\n  Fortalezas:")
        for s in result["top_strengths"]:
            print(f"    • {s}")

    if result.get("staff_mentions"):
        print(f"\n  Empleados mencionados:")
        for m in result["staff_mentions"]:
            icon = "+" if m["sentiment"] == "positive" else ("-" if m["sentiment"] == "negative" else "~")
            print(f"    [{icon}] {m['name']} ({m['mention_count']}x) — {m['sentiment']}")
            for q in m.get("sample_quotes", [])[:1]:
                print(f"         \"{q}\"")

    print(f"{'=' * w}\n")


def main():
    parser = argparse.ArgumentParser(description="Pipeline de datos Qinsa Reputation")
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--place-id",       help="Google Maps placeId del restaurante")
    group.add_argument("--restaurant-id",  help="UUID del restaurante en Supabase")
    group.add_argument("--all",            action="store_true", help="Procesar todos los prospects")
    parser.add_argument("--max",           type=int, default=100, help="Máximo de reseñas (default: 100)")
    args = parser.parse_args()

    if args.place_id:
        try:
            result = run_for_place_id(args.place_id, max_reviews=args.max)
            print_summary(result)
        except Exception as e:
            logger.error(f"Pipeline fallido: {str(e)}")
            sys.exit(1)

    elif args.restaurant_id:
        try:
            result = run_for_restaurant_id(args.restaurant_id, max_reviews=args.max)
            print_summary(result)
        except Exception as e:
            logger.error(f"Pipeline fallido: {str(e)}")
            sys.exit(1)

    else:  # --all
        from loader import get_prospects
        prospects = get_prospects()
        logger.info(f"Procesando {len(prospects)} restaurantes prospect")
        failed = 0
        for restaurant in prospects:
            try:
                result = run_for_restaurant_id(restaurant["id"], max_reviews=args.max)
                print_summary(result)
            except Exception as e:
                logger.error(f"Error procesando '{restaurant.get('name')}': {str(e)}")
                failed += 1

        if failed:
            logger.warning(f"{failed} restaurante(s) fallaron — revisa los logs")


if __name__ == "__main__":
    main()
