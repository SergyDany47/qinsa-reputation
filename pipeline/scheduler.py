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
from report_generator import generate_and_store, iso_week_bounds

logger = logging.getLogger(__name__)

TICK_MINUTES = 15
MIN_FREQUENCY_HOURS = 3   # guardarraíl de coste Apify
REPORT_TICK_HOURS = 12    # con qué frecuencia se comprueba si toca informe semanal

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
            res = run_incremental_ingest(r["id"], max_reviews=count, generate_replies=True,
                                         model=model, trigger="scheduled")
            logger.info("Auto-ingesta '%s': %s nueva(s) de %s", r.get("name"), res["inserted"], res["scraped"])
        except Exception as e:
            logger.error("Auto-ingesta falló para '%s': %s", r.get("name"), e)


def report_tick():
    """
    Genera el informe semanal de la última semana COMPLETA para los restaurantes
    con auto_report_enabled. Idempotente: si ya existe el informe de ese período,
    no lo regenera (así la frecuencia del tick no produce duplicados ni gasta IA).
    """
    try:
        rows = (
            supabase.table("restaurants")
            .select("id,name,auto_report_enabled")
            .eq("auto_report_enabled", True).execute().data
        ) or []
    except Exception as e:
        logger.error("Scheduler informes: no se pudieron leer restaurantes: %s", e)
        return
    if not rows:
        return

    cur_start, cur_end = iso_week_bounds()  # última semana completa
    model = get_setting("default_model", "gemini-2.5-flash")

    for r in rows:
        try:
            existing = (
                supabase.table("reports").select("id")
                .eq("restaurant_id", r["id"])
                .eq("period_start", cur_start.isoformat())
                .limit(1).execute().data
            )
            if existing:
                continue
            generate_and_store(r["id"], model=model, freeze=True, week_start=cur_start)
            logger.info("Informe semanal generado para '%s' (%s→%s)", r.get("name"), cur_start, cur_end)
        except Exception as e:
            logger.error("Informe semanal falló para '%s': %s", r.get("name"), e)


def start_scheduler():
    global _scheduler
    if _scheduler is not None:
        return
    _scheduler = BackgroundScheduler(timezone="UTC")
    _scheduler.add_job(tick, "interval", minutes=TICK_MINUTES, id="ingest_tick",
                       max_instances=1, coalesce=True)
    _scheduler.add_job(report_tick, "interval", hours=REPORT_TICK_HOURS, id="report_tick",
                       max_instances=1, coalesce=True)
    _scheduler.start()
    logger.info("Scheduler arrancado (ingesta cada %s min · informes cada %s h)",
                TICK_MINUTES, REPORT_TICK_HOURS)


def stop_scheduler():
    global _scheduler
    if _scheduler is not None:
        _scheduler.shutdown(wait=False)
        _scheduler = None
