"""
scheduler.py — Ejecución periódica del motor de ingesta (APScheduler in-process).

Un único "tick" cada TICK_MINUTES recorre los restaurantes con
auto_ingest_enabled y lanza `run_incremental_ingest` en los que toca según
ingest_frequency_hours + last_ingest_at. Re-lee la config de la BD en cada tick,
así activar/desactivar o cambiar la frecuencia desde el backoffice tiene efecto
sin reiniciar nada.

Es la MISMA operación que el botón manual del backoffice (ingest.py).

Nota de despliegue: asume un único proceso. Con varios workers de uvicorn habría
que mover el scheduler a un proceso dedicado.
"""
import logging
from datetime import datetime, timezone, timedelta

from apscheduler.schedulers.background import BackgroundScheduler

from loader import supabase
from config import get_setting
from ingest import run_incremental_ingest

logger = logging.getLogger(__name__)

TICK_MINUTES = 15
MIN_FREQUENCY_HOURS = 3  # guardarraíl de coste Apify

_scheduler = None


def _parse_ts(value):
    """Parsea un timestamptz de PostgREST de forma robusta (py3.9)."""
    if not value:
        return None
    try:
        s = value.replace("Z", "+00:00")
        # py3.9 fromisoformat no acepta fracciones de !=3/6 dígitos
        if "." in s:
            head, rest = s.split(".", 1)
            frac = ""
            tz = ""
            for ch in rest:
                if ch.isdigit():
                    frac += ch
                else:
                    tz = rest[len(frac):]
                    break
            s = f"{head}.{frac[:6]}{tz}"
        return datetime.fromisoformat(s)
    except Exception:
        return None


def _is_due(restaurant, now):
    last = _parse_ts(restaurant.get("last_ingest_at"))
    if last is None:
        return True
    freq = max(int(restaurant.get("ingest_frequency_hours") or 6), MIN_FREQUENCY_HOURS)
    return (now - last) >= timedelta(hours=freq)


def tick():
    """Una pasada: ingesta los restaurantes activos que toquen."""
    now = datetime.now(timezone.utc)
    try:
        rows = (
            supabase.table("restaurants")
            .select("id,name,ingest_frequency_hours,last_ingest_at,google_maps_url")
            .eq("auto_ingest_enabled", True).execute().data
        ) or []
    except Exception as e:
        logger.error("Scheduler: no se pudieron leer restaurantes: %s", e)
        return

    due = [r for r in rows if r.get("google_maps_url") and _is_due(r, now)]
    if not due:
        return

    model = get_setting("default_model", "gemini-2.5-flash")
    count = int(get_setting("default_refresh_count", 10) or 10)
    logger.info("Scheduler: %s restaurante(s) a ingestar", len(due))

    for r in due:
        try:
            res = run_incremental_ingest(r["id"], max_reviews=count, generate_replies=True, model=model)
            logger.info("Auto-ingesta '%s': %s nueva(s) de %s", r.get("name"), res["inserted"], res["scraped"])
        except Exception as e:
            logger.error("Auto-ingesta falló para '%s': %s", r.get("name"), e)


def start_scheduler():
    global _scheduler
    if _scheduler is not None:
        return
    _scheduler = BackgroundScheduler(timezone="UTC")
    _scheduler.add_job(tick, "interval", minutes=TICK_MINUTES, id="ingest_tick",
                       max_instances=1, coalesce=True)
    _scheduler.start()
    logger.info("Scheduler de ingesta arrancado (tick cada %s min)", TICK_MINUTES)


def stop_scheduler():
    global _scheduler
    if _scheduler is not None:
        _scheduler.shutdown(wait=False)
        _scheduler = None
