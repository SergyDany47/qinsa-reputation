import logging
import os
from google.cloud import language_v1
from dotenv import load_dotenv

load_dotenv()
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)


def analyze_sentiment(text: str) -> dict:
    """
    Retorna score (-1 a 1) y magnitude (0 a infinito).
    score: negativo = negativo, positivo = positivo
    magnitude: intensidad del sentimiento
    """
    client = language_v1.LanguageServiceClient()
    document = language_v1.Document(
        content=text,
        type_=language_v1.Document.Type.PLAIN_TEXT,
        language="es",
    )
    try:
        sentiment = client.analyze_sentiment(request={"document": document}).document_sentiment
    except Exception as e:
        logger.error(f"Error analizando sentimiento: {str(e)}")
        raise

    return {
        "score": round(sentiment.score, 3),
        "magnitude": round(sentiment.magnitude, 3),
    }


def normalize_score_to_10(score: float) -> float:
    """Convierte score de -1/+1 a escala 0-10 para mostrar al usuario."""
    return round((score + 1) * 5, 1)


def build_insights(reviews: list) -> dict:
    """
    Agrega sentimiento de todas las reseñas y genera un resumen de insights.
    Devuelve el dict listo para insertar en la tabla `insights`.
    """
    if not reviews:
        return {}

    scores = []
    for review in reviews:
        text = review.get("text", "")
        if not text:
            continue
        try:
            result = analyze_sentiment(text)
            scores.append(result["score"])
        except Exception:
            logger.warning(f"Reseña omitida en análisis de sentimiento")

    avg_score = sum(scores) / len(scores) if scores else 0
    sentiment_score = normalize_score_to_10(avg_score)

    logger.info(f"Sentimiento medio: {avg_score:.3f} → {sentiment_score}/10")

    return {
        "sentiment_score": sentiment_score,
        "top_problems": [],    # TODO: extraer con NL entity analysis
        "top_strengths": [],   # TODO: extraer con NL entity analysis
        "keywords": [],        # TODO: extraer keywords frecuentes
        "summary": "",         # TODO: generar con OpenAI
        "response_quality": "",
        "model_used": "google-natural-language",
    }
