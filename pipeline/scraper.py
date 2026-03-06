"""
scraper.py — Recopilación de reseñas de Google Maps con Apify.

Actor: compass/google-maps-reviews-scraper
Documentación del mapeo de campos en CLAUDE.md, sección 'Apify'.

Uso directo:
    python scraper.py "https://www.google.com/maps/place/?q=place_id:ChIJ..."
    python scraper.py "https://www.google.com/maps/place/?q=place_id:ChIJ..." --max 50

IMPORTANTE sobre el formato de URL:
    El actor necesita una URL con placeId embebido. Las URLs de coordenadas
    (formato /@lat,lng,zoom) no funcionan. Usa la URL con place_id, que puedes
    obtener desde el actor compass/crawler-google-places buscando por nombre.
    Formato válido: https://www.google.com/maps/place/?q=place_id:<ID>
"""
import argparse
import json
import logging
import os
import sys

from apify_client import ApifyClient
from dotenv import load_dotenv

load_dotenv()
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger(__name__)

ACTOR_ID = "compass/google-maps-reviews-scraper"


def scrape_reviews(google_maps_url: str, max_reviews: int = 100) -> dict:
    """
    Lanza el actor de Apify y devuelve reseñas + datos del lugar.

    Returns:
        {
            "reviews": list[dict],   # lista de reseñas mapeadas al schema Supabase
            "place_data": dict       # datos del lugar para actualizar tabla restaurants
        }

    IMPORTANTE: el actor devuelve 'stars' para la puntuación, NO 'rating' (viene null).
    """
    token = os.getenv("APIFY_API_TOKEN")
    if not token:
        raise RuntimeError("APIFY_API_TOKEN no está definido en el entorno")

    client = ApifyClient(token)

    # Input exacto definido en CLAUDE.md — no modificar sin actualizar el doc
    run_input = {
        "startUrls": [{"url": google_maps_url}],
        "maxReviews": max_reviews,
        "reviewsSort": "newest",
        "reviewsOrigin": "google",   # solo reseñas de Google, no TripAdvisor
        "language": "es",
        "personalData": True,        # incluir nombre del revisor
    }

    logger.info(f"Lanzando actor Apify para: {google_maps_url} (max={max_reviews})")
    try:
        run = client.actor(ACTOR_ID).call(run_input=run_input)
    except Exception as e:
        logger.error(f"Error lanzando actor Apify para {google_maps_url}: {str(e)}")
        raise

    dataset_id = run.get("defaultDatasetId")
    if not dataset_id:
        raise RuntimeError(f"Actor no devolvió dataset: {run}")

    try:
        items = list(client.dataset(dataset_id).iterate_items())
    except Exception as e:
        logger.error(f"Error leyendo dataset {dataset_id}: {str(e)}")
        raise

    logger.info(f"Items recibidos del actor: {len(items)}")

    reviews = []
    place_data = {}

    for item in items:
        # Datos del lugar — están duplicados en cada item, tomamos del primero
        if not place_data:
            place_data = _extract_place_data(item)

        # Filtro de seguridad: solo reseñas de Google
        if item.get("reviewOrigin", "").lower() not in ("google", ""):
            logger.debug(f"Reseña de origen no-Google ignorada: {item.get('reviewOrigin')}")
            continue

        # stars puede ser None en items que son el registro del lugar (no reseña)
        if item.get("stars") is None and not item.get("text"):
            logger.debug("Item sin stars ni texto ignorado (posible registro de lugar)")
            continue

        review = _map_review(item)
        reviews.append(review)

    # Cálculo de response_rate — definido en CLAUDE.md
    if reviews:
        replied = sum(1 for r in reviews if r["owner_replied"])
        place_data["response_rate"] = round((replied / len(reviews)) * 100, 2)

    logger.info(
        f"Recopiladas {len(reviews)} reseñas | "
        f"response_rate={place_data.get('response_rate', 0)}% | "
        f"rating={place_data.get('google_rating')} | "
        f"lugar='{place_data.get('name')}'"
    )

    return {"reviews": reviews, "place_data": place_data}


def _extract_place_data(item: dict) -> dict:
    """
    Extrae los datos del lugar de un item del actor.
    Mapeo definido en CLAUDE.md sección 'Campos del lugar'.
    """
    return {
        "name":          item.get("title"),           # nombre del lugar (verificar contra BD)
        "google_rating": item.get("totalScore"),      # totalScore → google_rating
        "review_count":  item.get("reviewsCount"),    # reviewsCount → review_count
        "place_id":      item.get("placeId"),         # guardar para referencia futura
    }


def _map_review(item: dict) -> dict:
    """
    Mapeo exacto de campos Apify → schema Supabase (tabla reviews).
    Referencia: CLAUDE.md sección 'Mapeo de campos del output al esquema de Supabase'.
    """
    # publishedAtDate viene en ISO 8601 — convertir a DATE tomando solo los 10 primeros chars
    published = item.get("publishedAtDate")
    review_date = published[:10] if published else None

    # owner_replied = True si responseFromOwnerText no es None
    reply_text = item.get("responseFromOwnerText")
    owner_replied = reply_text is not None

    return {
        "review_id":     item.get("reviewId"),                               # reviewId → review_id (clave única)
        "author_name":   item.get("name"),                                   # name → author_name
        "rating":        item.get("stars"),                                   # stars → rating (NO 'rating')
        "text":          item.get("text") or "",                              # text → text
        "review_date":   review_date,                                         # publishedAtDate[:10]
        "owner_replied": owner_replied,                                       # responseFromOwnerText is not None
        "reply_text":    reply_text,                                          # responseFromOwnerText
        "source":        (item.get("reviewOrigin") or "google").lower(),      # reviewOrigin → source
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Scraper de reseñas Google Maps via Apify")
    parser.add_argument("url", help="URL de Google Maps del restaurante")
    parser.add_argument("--max", type=int, default=100, help="Máximo de reseñas (default: 100)")
    parser.add_argument("--json", action="store_true", help="Output en JSON completo")
    args = parser.parse_args()

    try:
        result = scrape_reviews(args.url, max_reviews=args.max)
    except Exception as e:
        logger.error(f"Fallo del scraper: {e}")
        sys.exit(1)

    reviews = result["reviews"]
    place = result["place_data"]

    if args.json:
        print(json.dumps(result, ensure_ascii=False, indent=2, default=str))
        sys.exit(0)

    print(f"\n{'='*60}")
    print(f"Lugar:           {place.get('name')}")
    print(f"Rating:          {place.get('google_rating')}")
    print(f"Reseñas totales: {place.get('review_count')}")
    print(f"Response rate:   {place.get('response_rate')}%")
    print(f"Recopiladas:     {len(reviews)}")
    print(f"{'='*60}\n")

    for i, r in enumerate(reviews[:3], 1):
        stars = r["rating"] or 0
        text = r["text"] or ""
        print(f"── Reseña {i}")
        print(f"   Autor:           {r['author_name']}")
        print(f"   Rating:          {'⭐' * stars} ({stars})")
        print(f"   Fecha:           {r['review_date']}")
        print(f"   Texto:           {text[:200]}{'...' if len(text) > 200 else ''}")
        print(f"   Dueño respondió: {'Sí' if r['owner_replied'] else 'No'}")
        if r["owner_replied"]:
            reply = r["reply_text"] or ""
            print(f"   Respuesta:       {reply[:150]}{'...' if len(reply) > 150 else ''}")
        print()
