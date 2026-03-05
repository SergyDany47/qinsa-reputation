import logging
import os
from apify_client import ApifyClient
from dotenv import load_dotenv

load_dotenv()
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

ACTOR_ID = "compass/google-maps-reviews-scraper"


def scrape_reviews(google_maps_url: str, max_reviews: int = 100) -> dict:
    """
    Lanza el actor de Apify y devuelve reseñas + datos del lugar.
    IMPORTANTE: usar campo 'stars' para la puntuación, NO 'rating' (viene null).
    """
    client = ApifyClient(os.getenv("APIFY_API_TOKEN"))

    run_input = {
        "startUrls": [{"url": google_maps_url}],
        "maxReviews": max_reviews,
        "reviewsSort": "newest",
        "reviewsOrigin": "google",
        "language": "es",
        "personalData": True,
    }

    logger.info(f"Lanzando scraper para: {google_maps_url}")
    try:
        run = client.actor(ACTOR_ID).call(run_input=run_input)
        items = list(client.dataset(run["defaultDatasetId"]).iterate_items())
    except Exception as e:
        logger.error(f"Error scraping {google_maps_url}: {str(e)}")
        raise

    reviews = []
    place_data = {}

    for item in items:
        if not place_data:
            place_data = {
                "google_rating": item.get("totalScore"),
                "review_count": item.get("reviewsCount"),
            }

        review = {
            "author_name": item.get("name"),
            "rating": item.get("stars"),  # USAR stars, NO rating
            "text": item.get("text", ""),
            "review_date": item.get("publishedAtDate", "")[:10] if item.get("publishedAtDate") else None,
            "owner_replied": item.get("responseFromOwnerText") is not None,
            "reply_text": item.get("responseFromOwnerText"),
            "source": item.get("reviewOrigin", "google").lower(),
        }
        reviews.append(review)

    if reviews:
        replied = sum(1 for r in reviews if r["owner_replied"])
        place_data["response_rate"] = round((replied / len(reviews)) * 100, 2)

    logger.info(f"Recopiladas {len(reviews)} reseñas. response_rate={place_data.get('response_rate')}%")
    return {"reviews": reviews, "place_data": place_data}
