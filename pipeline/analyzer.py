"""
analyzer.py — Análisis de reseñas con Gemini API (gemini-2.0-flash).

Reemplaza la implementación anterior de Google Natural Language API.
Decisión documentada en CLAUDE.md [2026-03-05].

Uso directo (scraper + analyzer en una sola llamada):
    python analyzer.py "https://www.google.com/maps/place/?q=place_id:ChIJ..."
    python analyzer.py "https://www.google.com/maps/place/?q=place_id:ChIJ..." --max 50

Uso como módulo desde run_pipeline.py:
    from analyzer import analyze_reviews
    insights = analyze_reviews(reviews, restaurant_name="El Kiosko Boadilla")
"""
import argparse
import json
import logging
import os
import sys

from google import genai
from google.genai import types
from dotenv import load_dotenv
from tenacity import retry, wait_exponential, stop_after_attempt, retry_if_exception_type

load_dotenv()
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger(__name__)

MODEL = "gemini-2.5-flash"

@retry(wait=wait_exponential(multiplier=2, min=3, max=30), stop=stop_after_attempt(5))
def analyze_reviews(reviews: list, restaurant_name: str = "el restaurante", model: str = "gemini-2.5-flash") -> dict:
    """
    Analiza una lista de reseñas con Gemini y devuelve insights accionables.

    Args:
        reviews: lista de dicts con campos del schema Supabase
                 {rating, text, author_name, owner_replied, reply_text}
        restaurant_name: nombre del restaurante para personalizar el análisis

    Returns:
        dict con estructura completa de insights lista para insertar en tabla `insights`
    """
    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        raise RuntimeError("GEMINI_API_KEY no está definido en el entorno")

    if not reviews:
        logger.warning("No hay reseñas para analizar")
        return {}

    client = genai.Client(api_key=api_key)

    # rating_distribution se calcula localmente — no necesita tokens de IA
    rating_distribution = _compute_rating_distribution(reviews)

    reviews_text = _format_reviews_for_prompt(reviews)
    prompt = _build_prompt(reviews_text, restaurant_name, len(reviews))

    logger.info(f"Enviando {len(reviews)} reseñas a Gemini ({model})...")

    try:
        response = client.models.generate_content(
            model=model,
            contents=prompt,
            config=types.GenerateContentConfig(
                response_mime_type="application/json",
                temperature=0.2,  # baja temperatura para consistencia en análisis
            ),
        )
    except Exception as e:
        logger.error(f"Error llamando a Gemini: {str(e)}")
        raise

    try:
        gemini_result = json.loads(response.text)
    except json.JSONDecodeError as e:
        logger.error(f"Gemini no devolvió JSON válido: {response.text[:500]}")
        raise RuntimeError(f"JSON inválido de Gemini: {e}")

    result = {
        "top_problems":        gemini_result.get("top_problems", [])[:3],
        "top_strengths":       gemini_result.get("top_strengths", [])[:3],
        "keywords":            gemini_result.get("keywords", [])[:5],
        "summary":             gemini_result.get("summary", ""),
        "sentiment_score":     gemini_result.get("sentiment_score", 0),
        "response_quality":    gemini_result.get("response_quality", ""),
        "staff_mentions":      gemini_result.get("staff_mentions", []),
        "rating_distribution": rating_distribution,
        "recurring_issues":    gemini_result.get("recurring_issues", []),
        "recurring_praise":    gemini_result.get("recurring_praise", []),
        "model_used":          model,
    }

    logger.info(
        f"Análisis completado — sentiment={result['sentiment_score']}/10 | "
        f"problemas={len(result['top_problems'])} | "
        f"fortalezas={len(result['top_strengths'])} | "
        f"staff_mentions={len(result['staff_mentions'])}"
    )

    return result


# ── Catálogo de personalización (guiado-híbrido) ───────────────────────────────
# Los presets son fragmentos de prompt que controlamos y versionamos nosotros:
# el cliente elige una voz, nunca escribe el prompt. `label`/`description` se
# exponen al backoffice; `prompt` es la instrucción real que ve Gemini.

TONE_PRESETS = {
    "cercano_desenfadado": {
        "label": "Cercano y desenfadado",
        "description": "Cálido, con gracia y tuteo. Suena humano y nada corporativo.",
        "prompt": "Habla de TÚ, con cercanía y un punto de buen humor, como quien contesta a un amigo que ha venido a comer. Espontáneo y natural, jamás corporativo ni acartonado.",
    },
    "cercano_profesional": {
        "label": "Cercano y profesional",
        "description": "Cálido pero contenido, tuteo, sin caer en lo coloquial.",
        "prompt": "Habla de TÚ, con calidez pero manteniendo un punto cuidado y profesional. Cercano sin ser excesivamente coloquial.",
    },
    "elegante": {
        "label": "Elegante y sobrio",
        "description": "Refinado, trato de usted, sin emojis.",
        "prompt": "Trata de USTED, con un tono refinado, sobrio y elegante. Lenguaje cuidado, sin coloquialismos ni florituras.",
    },
    "de_barrio": {
        "label": "De barrio / familiar",
        "description": "Campechano y de toda la vida, tuteo.",
        "prompt": "Habla de TÚ, con un tono familiar y campechano de bar de barrio de toda la vida. Sincero, cercano y sin pretensiones.",
    },
}
DEFAULT_PRESET = "cercano_desenfadado"

EMOJI_RULES = {
    "ninguno":   "No uses ningún emoji.",
    "sutil":     "Como mucho 1 emoji, y solo si encaja con naturalidad (puede no haber ninguno).",
    "expresivo": "Puedes usar 1 o 2 emojis con naturalidad, sin abusar.",
}
DEFAULT_EMOJI = "sutil"

LANGUAGE_RULES = {
    "mirror": "Responde SIEMPRE en el mismo idioma en que está escrita la reseña (si la reseña está en inglés, responde en inglés).",
    "es":     "Responde siempre en español.",
}
DEFAULT_LANGUAGE = "mirror"


def context_options() -> dict:
    """Catálogo para el backoffice (presets + niveles), sin exponer los prompts."""
    return {
        "tone_presets": [{"key": k, "label": v["label"], "description": v["description"]} for k, v in TONE_PRESETS.items()],
        "emoji_levels": [{"key": k, "label": k.capitalize()} for k in EMOJI_RULES],
        "language_modes": [{"key": "mirror", "label": "Idioma del cliente"}, {"key": "es", "label": "Siempre español"}],
        "defaults": {"tone_preset": DEFAULT_PRESET, "emoji_level": DEFAULT_EMOJI, "language_mode": DEFAULT_LANGUAGE},
    }


def _build_reply_prompt(review: dict, restaurant_name: str, context: dict) -> str:
    """
    Construye el prompt de respuesta a una reseña (función pura, sin red).

    Compila la configuración estructurada (preset de tono, emojis, idioma, platos,
    keywords SEO, firma, instrucciones libres) en un prompt de calidad controlada.

    Inyección SEO: si hay `keywords_objetivo` o `dishes` y la reseña es positiva
    (4-5★), se pide integrar 1-2 términos con naturalidad. En negativas/neutras
    NO se inyecta (sonaría oportunista).
    """
    ctx = context or {}
    preset    = TONE_PRESETS.get(ctx.get("tone_preset") or DEFAULT_PRESET, TONE_PRESETS[DEFAULT_PRESET])
    emoji     = EMOJI_RULES.get(ctx.get("emoji_level") or DEFAULT_EMOJI, EMOJI_RULES[DEFAULT_EMOJI])
    language  = LANGUAGE_RULES.get(ctx.get("language_mode") or DEFAULT_LANGUAGE, LANGUAGE_RULES[DEFAULT_LANGUAGE])
    signature = ctx.get("signature") or ctx.get("owner_name") or f"El equipo de {restaurant_name}"
    instructions = (ctx.get("instructions") or "").strip()
    keywords  = ctx.get("keywords_objetivo") or []
    dishes    = ctx.get("dishes") or []

    rating = int(review.get("rating", 0) or 0)
    text   = (review.get("text") or "").strip()

    # Ganchos SEO (keywords + platos) solo en reseñas positivas
    seo_line = ""
    if rating >= 4 and (keywords or dishes):
        terms = ", ".join(f'"{t}"' for t in [*keywords, *dishes])
        seo_line = (
            f"- SEO (OPCIONAL, no obligatorio): solo PUEDES mencionar alguno de estos términos —{terms}— "
            f"si el cliente YA ha aludido a ese tema o plato en su reseña. "
            f"PROHIBIDO TERMINANTEMENTE afirmar o insinuar que el cliente probó, pidió o disfrutó algo que NO ha nombrado "
            f"(no inventes platos ni experiencias). Si la reseña es genérica y ningún término encaja con total naturalidad, "
            f"NO menciones ninguno: es mucho mejor no inyectar que sonar forzado o falso."
        )
    extra_line = f"- Instrucción del local: {instructions}" if instructions else ""

    return f"""Eres quien responde las reseñas de Google de "{restaurant_name}". Escribe una respuesta breve, humana y única a esta reseña.

VOZ DEL LOCAL: {preset['prompt']}

REGLAS:
- 2 o 3 frases. Nunca más.
- {language}
- Emojis: {emoji}
- PROHIBIDO: aperturas genéricas ("Muchas gracias por tu reseña", "Gracias por compartir tu experiencia"), lenguaje corporativo ("estimado cliente", "lamentamos los inconvenientes", "no dude en contactarnos") y exclamaciones de relleno.
- Varía SIEMPRE cómo empiezas; que dos respuestas nunca suenen calcadas.
- Positiva (4-5★): reconoce algo CONCRETO que menciona el cliente (un plato, un camarero…) e invita a volver con naturalidad.
- Negativa (1-2★): reconoce el problema sin excusas y ofrece un paso concreto.
- Neutra (3★): agradece y reconoce lo mejorable, sin ponerte a la defensiva.
{seo_line}
{extra_line}
- Firma al final como: {signature}

RESEÑA ({rating}★ de 5):
{text}

Responde SOLO con el texto de la respuesta. Sin comillas, sin explicaciones, sin formato."""


@retry(wait=wait_exponential(multiplier=2, min=3, max=30), stop=stop_after_attempt(5))
def generate_suggested_reply(review: dict, restaurant_name: str, context: dict, model: str = "gemini-2.5-flash") -> str:
    """
    Genera una respuesta sugerida a una reseña usando Gemini.

    El prompt incluye el texto de la reseña, el rating, el tono del restaurante,
    el nombre del dueño y las instrucciones personalizadas de restaurant_context.
    La respuesta tiene máximo 150 palabras y suena humana, no corporativa.

    Args:
        review:          dict con campos rating, text (puede ser vacío)
        restaurant_name: nombre del restaurante
        context:         dict con owner_name, tone, instructions (puede ser None)

    Returns:
        Texto de la respuesta sugerida (string plano, listo para copiar)
    """
    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        raise RuntimeError("GEMINI_API_KEY no está definido en el entorno")

    rating = review.get("rating", 0)
    text   = (review.get("text") or "").strip()

    # Si la reseña no tiene texto, devolver respuesta genérica sin llamar a Gemini
    if not text:
        owner_name = (context or {}).get("owner_name") or "El equipo del restaurante"
        if int(rating) >= 4:
            return f"¡Muchas gracias por tu valoración! Es un placer tenerte en {restaurant_name}. Esperamos verte muy pronto. Un saludo, {owner_name}"
        else:
            return f"Gracias por compartir tu experiencia. Lamentamos no haber cumplido tus expectativas en {restaurant_name}. Nos ponemos a tu disposición para mejorar. {owner_name}"

    prompt = _build_reply_prompt(review, restaurant_name, context)

    client = genai.Client(api_key=api_key)
    try:
        response = client.models.generate_content(
            model=model,
            contents=prompt,
            config=types.GenerateContentConfig(
                temperature=0.7,  # más creatividad que el análisis de insights
            ),
        )
        return response.text.strip()
    except Exception as e:
        logger.error(f"Error generando respuesta sugerida: {str(e)}")
        raise


def _compute_rating_distribution(reviews: list) -> dict:
    """Calcula la distribución de ratings sin llamada a IA."""
    distribution = {"1": 0, "2": 0, "3": 0, "4": 0, "5": 0}
    for review in reviews:
        rating = review.get("rating")
        if rating and 1 <= int(rating) <= 5:
            distribution[str(int(rating))] += 1
    return distribution


def _format_reviews_for_prompt(reviews: list) -> str:
    """
    Formatea las reseñas para el prompt.
    Incluye respuestas del dueño cuando existen — necesarias para response_quality.
    """
    lines = []
    for i, r in enumerate(reviews, 1):
        rating = r.get("rating") or "?"
        text = (r.get("text") or "").strip()
        if not text:
            continue

        line = f"[Reseña {i} | {rating}★] {text}"

        if r.get("owner_replied") and r.get("reply_text"):
            reply = r["reply_text"].strip()[:400]
            line += f"\n  → Respuesta del dueño: {reply}"

        lines.append(line)

    return "\n\n".join(lines)


def _build_prompt(reviews_text: str, restaurant_name: str, total_reviews: int) -> str:
    return f"""Eres un analista experto en reputación online de restaurantes en España.
Analiza las siguientes {total_reviews} reseñas de Google Maps de "{restaurant_name}" y extrae insights accionables para el dueño del negocio.

REGLAS CRÍTICAS — sigue estas reglas sin excepción:

1. ESPECIFICIDAD: cada insight debe ser concreto y accionable.
   VÁLIDO: "El tiempo de espera para pedir supera los 20 minutos en hora punta".
   INVÁLIDO: "El servicio es lento".

2. RECURRENCIA OBLIGATORIA: top_problems y top_strengths solo pueden incluir patrones
   que aparecen en 3 o más reseñas. Si algo solo se menciona una o dos veces, va a
   recurring_issues o recurring_praise según corresponda.

3. DETECCIÓN DE EMPLEADOS: busca nombres propios de personas del staff que los clientes
   mencionan explícitamente (camareros, cocineros, encargados, etc.).
   Para cada uno, indica cuántas veces aparece, si las menciones son positivas/negativas/mixed,
   y cita fragmentos literales de reseñas como ejemplos.

4. TIPOS DE PROBLEMA: distingue entre problemas estructurales (ocurren de forma repetida,
   requieren cambio de proceso o gestión) y anecdóticos (incidente puntual, no patrón).
   Solo los estructurales van en top_problems.

5. PUNTUACIÓN DE SENTIMIENTO: sentiment_score es un float de 0 a 10.
   Basa el cálculo en el balance real de reseñas positivas vs negativas, el tono general
   y la gravedad de los problemas reportados. No promedies estrellas mecánicamente.

6. RESPUESTAS DEL DUEÑO: analiza si el dueño responde, con qué frecuencia, si las
   respuestas son personalizadas o genéricas, si el tono es profesional o defensivo.
   Si no hay respuestas o son muy escasas, indícalo claramente.

7. IDIOMA: responde siempre en español.

8. SIN REFERENCIAS INTERNAS: Nunca cites números de reseña ni referencias del tipo
   [R1], [R10], [R18], "la reseña 5", "en la reseña número 12", etc. en ningún campo
   del JSON. Todos los textos de salida deben redactarse como observaciones directas
   en lenguaje natural, como si fueras tú quien las describe ("varios clientes mencionan
   que...", "los clientes destacan...", etc.).

RESEÑAS DE "{restaurant_name}" ({total_reviews} reseñas):

{reviews_text}

Devuelve ÚNICAMENTE un JSON válido con esta estructura exacta (sin markdown, sin texto adicional):
{{
  "top_problems": [
    "problema estructural específico y recurrente 1",
    "problema estructural específico y recurrente 2",
    "problema estructural específico y recurrente 3"
  ],
  "top_strengths": [
    "fortaleza específica y recurrente 1",
    "fortaleza específica y recurrente 2",
    "fortaleza específica y recurrente 3"
  ],
  "keywords": ["keyword1", "keyword2", "keyword3", "keyword4", "keyword5"],
  "summary": "Resumen ejecutivo de 3-4 frases para el dueño. Incluye el tono general de las reseñas, los puntos más valorados, el problema principal que requiere atención y una recomendación prioritaria.",
  "sentiment_score": 7.4,
  "response_quality": "Análisis detallado de cómo gestiona el dueño las respuestas: frecuencia de respuesta, personalización, tono y oportunidades de mejora.",
  "staff_mentions": [
    {{
      "name": "Nombre del empleado",
      "mention_count": 5,
      "sentiment": "positive",
      "sample_quotes": ["fragmento literal de reseña donde se menciona", "otro fragmento literal"]
    }}
  ],
  "recurring_issues": [
    "problema que aparece en 2+ reseñas pero no alcanza el umbral de top_problems"
  ],
  "recurring_praise": [
    "elogio que aparece en 2+ reseñas pero no alcanza el umbral de top_strengths"
  ]
}}"""


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Analiza reseñas de un restaurante con Gemini API"
    )
    parser.add_argument("url", help="URL de Google Maps con place_id")
    parser.add_argument("--max", type=int, default=50, help="Máximo de reseñas (default: 50)")
    parser.add_argument("--name", type=str, default="el restaurante", help="Nombre del restaurante")
    args = parser.parse_args()

    # Importar scraper solo en el __main__ para no crear dependencia circular
    try:
        from scraper import scrape_reviews
    except ImportError:
        logger.error("No se puede importar scraper.py — asegúrate de ejecutar desde /pipeline/")
        sys.exit(1)

    logger.info(f"Scrapeando reseñas de: {args.url}")
    try:
        scrape_result = scrape_reviews(args.url, max_reviews=args.max)
    except Exception as e:
        logger.error(f"Error en el scraper: {e}")
        sys.exit(1)

    reviews = scrape_result["reviews"]
    place_data = scrape_result["place_data"]

    restaurant_name = args.name if args.name != "el restaurante" else (place_data.get("name") or "el restaurante")

    logger.info(f"Analizando {len(reviews)} reseñas de '{restaurant_name}'...")
    try:
        insights = analyze_reviews(reviews, restaurant_name=restaurant_name)
    except Exception as e:
        logger.error(f"Error en el analyzer: {e}")
        sys.exit(1)

    print("\n" + "=" * 70)
    print(f"INSIGHTS — {restaurant_name}")
    print("=" * 70)
    print(json.dumps(insights, ensure_ascii=False, indent=2))
