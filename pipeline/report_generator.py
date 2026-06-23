"""
report_generator.py — Generador de informes (Fase 2 · ESQUELETO).

Produce un informe de un restaurante para un período (semana por defecto) con
**comparativa contra el período anterior**: volumen de reseñas, rating medio,
distribución, tasa de respuesta, sentimiento y temas/staff.

Filosofía de diseño (ver ROADMAP.md Fase 2 + CLAUDE.md [2026-06-23]):
  - Las MÉTRICAS son DETERMINISTAS: se computan desde la tabla `reviews` y los
    snapshots de `insights`. No gastan IA y son testeables en local.
  - La NARRATIVA en lenguaje natural (el texto que verá el dueño / irá a
    WhatsApp en la Fase 4) es lo único que usará Gemini → hoy es un STUB
    determinista marcado con TODO, para no gastar cuota mientras se valida la
    estructura.
  - La salida es un dict estructurado y serializable, reutilizable por el canal
    de entrega (Fase 4) y por el frontend.

Estado: esqueleto lógico. Pendiente de la Fase 2: enriquecer `_narrative` con
Gemini, decidir disparo (manual ahora, programado semanal con el scheduler de
la Fase 1) y exponer un endpoint en admin.py.
"""
import logging
from datetime import date, datetime, timedelta
from typing import Optional

from loader import (
    get_reviews_in_period,
    get_insights_history,
    snapshot_insights,
)

logger = logging.getLogger(__name__)

POSITIVE_THRESHOLD = 4   # rating >= → positiva
NEGATIVE_THRESHOLD = 2   # rating <= → negativa


# ──────────────────────────────────────────────────────────────────────────
# Ventanas temporales
# ──────────────────────────────────────────────────────────────────────────
def iso_week_bounds(ref: Optional[date] = None) -> tuple:
    """
    Devuelve (lunes, lunes_siguiente) como `date` de la semana ISO que contiene
    `ref`. El intervalo es semiabierto [inicio, fin): casa con el gte/lt del
    loader. Sin argumento usa la última semana COMPLETA (la anterior a hoy).
    """
    if ref is None:
        ref = date.today() - timedelta(days=7)
    monday = ref - timedelta(days=ref.weekday())
    return monday, monday + timedelta(days=7)


def previous_window(start: date, end: date) -> tuple:
    """El período inmediatamente anterior, de la misma duración."""
    span = end - start
    return start - span, start


# ──────────────────────────────────────────────────────────────────────────
# Métricas deterministas (sin IA)
# ──────────────────────────────────────────────────────────────────────────
def _period_metrics(reviews: list) -> dict:
    """Agrega métricas básicas de una lista de reseñas del período."""
    total = len(reviews)
    if total == 0:
        return {
            "count": 0, "avg_rating": None, "rating_distribution": {str(i): 0 for i in range(1, 6)},
            "positive": 0, "negative": 0, "replied": 0, "response_rate": None,
        }

    dist = {str(i): 0 for i in range(1, 6)}
    rating_sum = 0
    rated = 0
    positive = negative = replied = 0
    for r in reviews:
        rating = r.get("rating")
        if rating:
            dist[str(rating)] = dist.get(str(rating), 0) + 1
            rating_sum += rating
            rated += 1
            if rating >= POSITIVE_THRESHOLD:
                positive += 1
            elif rating <= NEGATIVE_THRESHOLD:
                negative += 1
        if r.get("owner_replied") or r.get("reply_text"):
            replied += 1

    return {
        "count": total,
        "avg_rating": round(rating_sum / rated, 2) if rated else None,
        "rating_distribution": dist,
        "positive": positive,
        "negative": negative,
        "replied": replied,
        "response_rate": round(replied / total * 100, 1) if total else None,
    }


def _delta(curr, prev):
    """Diferencia numérica curr-prev; None si falta algún operando."""
    if curr is None or prev is None:
        return None
    return round(curr - prev, 2)


def _compare(current: dict, previous: dict) -> dict:
    """Deltas período-a-período de las métricas comparables."""
    return {
        "count": current["count"] - previous["count"],
        "avg_rating": _delta(current["avg_rating"], previous["avg_rating"]),
        "positive": current["positive"] - previous["positive"],
        "negative": current["negative"] - previous["negative"],
        "response_rate": _delta(current["response_rate"], previous["response_rate"]),
    }


# ──────────────────────────────────────────────────────────────────────────
# Narrativa (STUB — pendiente de Gemini en la Fase 2)
# ──────────────────────────────────────────────────────────────────────────
def _narrative(report: dict) -> str:
    """
    TODO (Fase 2): generar con Gemini un resumen cercano y accionable a partir
    del dict `report` (mismo tono/personalización que las respuestas). De momento
    devuelve un resumen templado determinista — útil y testeable sin gastar IA.
    """
    cur = report["current"]
    d = report["deltas"]
    if cur["count"] == 0:
        return "Sin reseñas nuevas esta semana."

    def arrow(x):
        if x is None:
            return "—"
        return f"▲{x}" if x > 0 else (f"▼{abs(x)}" if x < 0 else "=")

    return (
        f"{cur['count']} reseñas nuevas ({arrow(d['count'])} vs. semana anterior), "
        f"rating medio {cur['avg_rating']} ({arrow(d['avg_rating'])}), "
        f"{cur['positive']} positivas / {cur['negative']} negativas, "
        f"tasa de respuesta {cur['response_rate']}% ({arrow(d['response_rate'])})."
    )


# ──────────────────────────────────────────────────────────────────────────
# Orquestación
# ──────────────────────────────────────────────────────────────────────────
def build_weekly_report(restaurant_id: str, week_start: Optional[date] = None) -> dict:
    """
    Construye el informe semanal con comparativa contra la semana anterior.
    `week_start` (date) fija la semana; por defecto, la última semana completa.

    Devuelve un dict estructurado y serializable. NO gasta IA (la narrativa es
    el stub determinista). NO congela nada: usar `freeze_period(...)` para eso.
    """
    cur_start, cur_end = iso_week_bounds(week_start)
    prev_start, prev_end = previous_window(cur_start, cur_end)

    cur_reviews = get_reviews_in_period(restaurant_id, cur_start.isoformat(), cur_end.isoformat())
    prev_reviews = get_reviews_in_period(restaurant_id, prev_start.isoformat(), prev_end.isoformat())

    current = _period_metrics(cur_reviews)
    previous = _period_metrics(prev_reviews)

    report = {
        "restaurant_id": restaurant_id,
        "period": {"start": cur_start.isoformat(), "end": cur_end.isoformat()},
        "previous_period": {"start": prev_start.isoformat(), "end": prev_end.isoformat()},
        "current": current,
        "previous": previous,
        "deltas": _compare(current, previous),
        "generated_at": datetime.utcnow().isoformat() + "Z",
    }
    report["summary"] = _narrative(report)
    return report


def freeze_period(restaurant_id: str, insights: dict,
                  week_start: Optional[date] = None) -> dict:
    """
    Congela los `insights` del analyzer como snapshot histórico del período,
    para que las comparativas futuras tengan contra qué medir (deuda D1).
    Fina capa sobre `loader.snapshot_insights`.
    """
    start, end = iso_week_bounds(week_start)
    return snapshot_insights(restaurant_id, insights, start.isoformat(), end.isoformat())


__all__ = [
    "iso_week_bounds",
    "previous_window",
    "build_weekly_report",
    "freeze_period",
]
