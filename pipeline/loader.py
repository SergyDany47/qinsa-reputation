"""
loader.py — Carga de datos del pipeline en Supabase.

Funciones públicas:
    upsert_restaurant(place_data, google_maps_url) → restaurant_id (str)
    insert_reviews_deduped(restaurant_id, reviews)  → int (reseñas insertadas)
    upsert_insights(restaurant_id, insights)        → None  (snapshot vivo)
    snapshot_insights(restaurant_id, insights, period_start, period_end) → dict
    get_insights_history(restaurant_id, limit)      → list[dict]
    get_reviews_in_period(restaurant_id, start, end) → list[dict]
    get_prospects()                                  → list[dict]

Modelo de insights (deuda D1 saldada — ver CLAUDE.md [2026-06-23]):
    - El snapshot VIVO es la fila con period_start IS NULL: la mantiene
      `upsert_insights` (sobrescribe en cada ingesta) y es la que lee la
      app de cliente. No prolifera con cada tick.
    - El histórico son filas CONGELADAS con period_start/period_end != NULL,
      una por período; las crea `snapshot_insights` (siempre INSERT). Sobre
      ellas se construyen los informes comparativos de la Fase 2.
"""
import logging
import os
from datetime import datetime, timezone

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


def _insights_record(restaurant_id: str, insights: dict) -> dict:
    """Filtra el dict del analyzer a los campos que existen en el schema."""
    record = {"restaurant_id": restaurant_id}
    for field in _INSIGHTS_SCHEMA_FIELDS:
        if field in insights:
            record[field] = insights[field]
    return record


def upsert_insights(restaurant_id: str, insights: dict) -> None:
    """
    Actualiza (o crea) el SNAPSHOT VIVO de insights del restaurante: la fila con
    period_start IS NULL. Es la que lee la app de cliente y se sobrescribe en cada
    ingesta — NO prolifera con cada tick del scheduler.

    El histórico por período es responsabilidad de `snapshot_insights`.
    Solo persiste los campos definidos en el schema de Supabase.
    """
    record = _insights_record(restaurant_id, insights)

    try:
        existing = (
            supabase.table("insights")
            .select("id")
            .eq("restaurant_id", restaurant_id)
            .is_("period_start", "null")
            .limit(1)
            .execute()
        )
    except Exception as e:
        logger.error(f"Error buscando insights vivos para {restaurant_id}: {str(e)}")
        raise

    try:
        if existing.data:
            supabase.table("insights").update(record).eq("id", existing.data[0]["id"]).execute()
            logger.info(f"Snapshot vivo de insights actualizado para {restaurant_id}")
        else:
            supabase.table("insights").insert(record).execute()
            logger.info(f"Snapshot vivo de insights creado para {restaurant_id}")
    except Exception as e:
        logger.error(f"Error guardando insights vivos para {restaurant_id}: {str(e)}")
        raise


def snapshot_insights(restaurant_id: str, insights: dict,
                      period_start: str, period_end: str) -> dict:
    """
    Congela un registro de insights para un período (siempre INSERT). Habilita el
    histórico y las comparativas de la Fase 2. `period_start`/`period_end` son
    fechas ISO (YYYY-MM-DD); marcan la fila como histórica (no es el snapshot vivo).

    Returns:
        La fila insertada (dict).
    """
    record = _insights_record(restaurant_id, insights)
    record["period_start"] = period_start
    record["period_end"] = period_end
    try:
        resp = supabase.table("insights").insert(record).execute()
        logger.info(f"Insights congelados {period_start}→{period_end} para {restaurant_id}")
        return resp.data[0] if resp.data else {}
    except Exception as e:
        logger.error(f"Error congelando insights para {restaurant_id}: {str(e)}")
        raise


def get_live_insights(restaurant_id: str):
    """
    Snapshot VIVO de insights (fila con period_start IS NULL). Es el análisis más
    reciente del restaurante: sentimiento, staff_mentions, problemas/elogios
    recurrentes. Lo consume el generador de informes para su narrativa.
    Devuelve None si aún no se ha generado ningún insight.
    """
    try:
        resp = (
            supabase.table("insights")
            .select("*")
            .eq("restaurant_id", restaurant_id)
            .is_("period_start", "null")
            .limit(1)
            .execute()
        )
        return resp.data[0] if resp.data else None
    except Exception as e:
        logger.error(f"Error obteniendo insights vivos para {restaurant_id}: {str(e)}")
        raise


def get_insights_history(restaurant_id: str, limit: int = 12) -> list:
    """
    Devuelve los snapshots históricos (period_start NO nulo) de un restaurante,
    del más reciente al más antiguo. Base de las comparativas de informes.
    """
    try:
        resp = (
            supabase.table("insights")
            .select("*")
            .eq("restaurant_id", restaurant_id)
            .not_.is_("period_start", "null")
            .order("period_start", desc=True)
            .limit(limit)
            .execute()
        )
        return resp.data or []
    except Exception as e:
        logger.error(f"Error obteniendo histórico de insights para {restaurant_id}: {str(e)}")
        raise


def get_reviews_in_period(restaurant_id: str, start: str, end: str) -> list:
    """
    Reseñas de un restaurante con review_date en [start, end) (fechas ISO).
    Materia prima determinista de las métricas de informe (volumen, rating,
    tasa de respuesta), sin gastar IA.
    """
    try:
        resp = (
            supabase.table("reviews")
            .select("rating,text,author_name,review_date,owner_replied,reply_text")
            .eq("restaurant_id", restaurant_id)
            .gte("review_date", start)
            .lt("review_date", end)
            .execute()
        )
        return resp.data or []
    except Exception as e:
        logger.error(f"Error obteniendo reseñas del período para {restaurant_id}: {str(e)}")
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
            .select("owner_name,tone,instructions,keywords_objetivo,tone_preset,emoji_level,language_mode,signature,dishes")
            .eq("restaurant_id", restaurant_id)
            .limit(1)
            .execute()
        )
        return resp.data[0] if resp.data else None
    except Exception as e:
        logger.warning(f"No se pudo cargar restaurant_context para {restaurant_id}: {str(e)}")
        return None


def save_report(restaurant_id: str, report: dict) -> dict:
    """
    Persiste un informe semanal (upsert por restaurante+período → idempotente para
    el scheduler y re-generable desde el botón manual). Actualiza `last_report_at`.

    Returns:
        La fila guardada (dict).
    """
    period = report.get("period") or {}
    row = {
        "restaurant_id": restaurant_id,
        "period_start": period.get("start"),
        "period_end": period.get("end"),
        "summary": report.get("summary"),
        "payload": report,
        "model_used": report.get("model_used"),
    }
    try:
        resp = (
            supabase.table("reports")
            .upsert(row, on_conflict="restaurant_id,period_start")
            .execute()
        )
        supabase.table("restaurants").update(
            {"last_report_at": datetime.now(timezone.utc).isoformat()}
        ).eq("id", restaurant_id).execute()
        logger.info(f"Informe guardado {row['period_start']}→{row['period_end']} para {restaurant_id}")
        return resp.data[0] if resp.data else row
    except Exception as e:
        logger.error(f"Error guardando informe para {restaurant_id}: {str(e)}")
        raise


def get_reports(restaurant_id: str, limit: int = 12) -> list:
    """Informes de un restaurante, del más reciente al más antiguo (para la vista de cliente)."""
    try:
        resp = (
            supabase.table("reports")
            .select("*")
            .eq("restaurant_id", restaurant_id)
            .order("period_start", desc=True)
            .limit(limit)
            .execute()
        )
        return resp.data or []
    except Exception as e:
        logger.error(f"Error obteniendo informes para {restaurant_id}: {str(e)}")
        raise


def log_ingest_run(restaurant_id: str, trigger: str, status: str, *,
                   scraped=None, inserted=None, error=None) -> None:
    """
    Registra una ejecución de ingesta en `ingest_runs`. NUNCA lanza: un fallo al
    registrar no debe romper (ni enmascarar) la ingesta en sí.
    """
    try:
        supabase.table("ingest_runs").insert({
            "restaurant_id": restaurant_id,
            "trigger": trigger,
            "status": status,
            "reviews_scraped": scraped,
            "reviews_inserted": inserted,
            "error_message": (error or None) and str(error)[:1000],
        }).execute()
    except Exception as e:
        logger.error(f"No se pudo registrar ingest_run para {restaurant_id}: {str(e)}")


def get_ingest_runs(restaurant_id: str, limit: int = 20) -> list:
    """Historial de ejecuciones de un restaurante, de la más reciente a la más antigua."""
    try:
        resp = (
            supabase.table("ingest_runs")
            .select("*")
            .eq("restaurant_id", restaurant_id)
            .order("created_at", desc=True)
            .limit(limit)
            .execute()
        )
        return resp.data or []
    except Exception as e:
        logger.error(f"Error obteniendo ingest_runs para {restaurant_id}: {str(e)}")
        raise


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
