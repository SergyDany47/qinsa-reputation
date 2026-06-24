"""
report_generator.py — Generador de informes (Fase 2 · ESQUELETO).

Produce un informe de un restaurante para un período (semana por defecto) con
**comparativa contra el período anterior**: volumen de reseñas, rating medio,
distribución, tasa de respuesta, sentimiento y temas/staff.

Filosofía de diseño (ver ROADMAP.md Fase 2 + CLAUDE.md [2026-06-23]):
  - Las MÉTRICAS son DETERMINISTAS: se computan desde la tabla `reviews` y el
    snapshot vivo de `insights`. No gastan IA y son testeables en local.
  - La NARRATIVA en lenguaje natural (el texto que verá el dueño / irá a
    WhatsApp en la Fase 4) la redacta Gemini (gemini-2.5-flash) con enfoque
    "Operativo-Accionable y de Dirección": síntesis de consultor, sin relleno
    corporativo. Si la IA falla, se cae con elegancia a un resumen determinista
    (`_fallback_summary`) — el informe estructurado nunca se rompe por la IA.
  - La salida es un dict estructurado y serializable, reutilizable por el canal
    de entrega (Fase 4) y por el frontend.

Pendiente de la Fase 2: exponer un endpoint en admin.py y disparo programado
(scheduler de la Fase 1, cron semanal).
"""
import json
import logging
import os
from datetime import date, datetime, timedelta
from typing import Optional

from google import genai
from google.genai import types
from dotenv import load_dotenv
from tenacity import retry, wait_exponential, stop_after_attempt

from loader import (
    get_reviews_in_period,
    get_insights_history,
    get_live_insights,
    snapshot_insights,
    save_report,
)

load_dotenv()
logger = logging.getLogger(__name__)

MODEL = "gemini-2.5-flash"
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
# Narrativa
# ──────────────────────────────────────────────────────────────────────────
def _arrow(x) -> str:
    if x is None:
        return "—"
    return f"▲{x}" if x > 0 else (f"▼{abs(x)}" if x < 0 else "=")


def _fallback_summary(report: dict) -> str:
    """
    Resumen determinista (sin IA). Se usa si Gemini falla o no está configurado,
    para que el informe nunca quede sin texto.
    """
    cur = report["current"]
    d = report["deltas"]
    if cur["count"] == 0:
        return "Sin reseñas nuevas esta semana."
    return (
        f"{cur['count']} reseñas nuevas ({_arrow(d['count'])} vs. semana anterior), "
        f"rating medio {cur['avg_rating']} ({_arrow(d['avg_rating'])}), "
        f"{cur['positive']} positivas / {cur['negative']} negativas, "
        f"tasa de respuesta {cur['response_rate']}% ({_arrow(d['response_rate'])})."
    )


def _build_narrative_prompt(report: dict) -> str:
    """
    Compila el prompt de la narrativa (función pura, sin red). Serializa las
    métricas y el snapshot de insights para que el modelo razone sobre datos,
    no sobre impresiones.
    """
    payload = {
        "periodo": report.get("period"),
        "periodo_anterior": report.get("previous_period"),
        "metricas_semana": report.get("current"),
        "metricas_semana_anterior": report.get("previous"),
        "deltas_vs_anterior": report.get("deltas"),
        "insights": report.get("insights") or {},
    }
    datos = json.dumps(payload, ensure_ascii=False, indent=2)

    return f"""Eres un consultor senior de restauración que entrega un parte semanal a la
DIRECCIÓN de un restaurante. Tu lector es el dueño/gerente: tiene poco tiempo y
quiere saber qué está pasando y qué hacer, no que le doren la píldora.

DATOS DE LA SEMANA (ya calculados, no recalcules; los deltas comparan con la semana anterior):
{datos}

REDACTA una síntesis ejecutiva ULTRA-CONCISA con EXACTAMENTE estas 3 viñetas, en este orden y con estos títulos literales en negrita:

- **Diagnóstico de Flujo:** lee volumen de reseñas, su delta, el rating medio y su tendencia, y el balance positivas/negativas. ¿Sube, baja o se estanca el flujo y la satisfacción? Sé cuantitativo.
- **Auditoría de Sala (Staff y Cocina):** cruza staff_mentions y los problemas/elogios recurrentes. Señala por nombre al personal destacado o problemático y los focos operativos concretos (cocina, espera, servicio). Si no hay datos de staff, dilo en media línea y céntrate en lo operativo.
- **Acción SEO/GEO Recomendada:** UNA palanca concreta y ejecutable esta semana para mejorar posicionamiento local (responder X reseñas pendientes, reforzar tal keyword/plato en las respuestas, pedir reseñas tras un pico positivo…). Que sea accionable, no teoría.

REGLAS DE ESTILO:
- Tono de consultor directo y profesional. Cero relleno de marketing ("nos esforzamos cada día", "tu opinión nos importa").
- Cada viñeta: 1-2 frases. Apóyate en cifras de los datos.
- Si un dato no existe, no lo inventes: trabaja con lo que hay.
- Responde en español.

Devuelve SOLO las 3 viñetas. Sin introducción, sin cierre, sin explicaciones."""


@retry(wait=wait_exponential(multiplier=2, min=3, max=30), stop=stop_after_attempt(4))
def _gemini_narrative(prompt: str, model: str) -> str:
    """Llama a Gemini para la narrativa. Reintentos con backoff (tenacity)."""
    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        raise RuntimeError("GEMINI_API_KEY no está definido en el entorno")

    client = genai.Client(api_key=api_key)
    response = client.models.generate_content(
        model=model,
        contents=prompt,
        config=types.GenerateContentConfig(
            temperature=0.4,  # síntesis de consultor: ni mecánica ni fabuladora
        ),
    )
    return response.text.strip()


def _narrative(report: dict, model: str = MODEL) -> str:
    """
    Narrativa "Operativo-Accionable y de Dirección" vía Gemini. Si la IA falla o
    no está configurada, cae al resumen determinista — el informe nunca se rompe.
    """
    if report.get("current", {}).get("count", 0) == 0:
        return "Sin reseñas nuevas esta semana."
    try:
        return _gemini_narrative(_build_narrative_prompt(report), model)
    except Exception as e:
        logger.error(f"Narrativa IA no disponible, usando resumen determinista: {e}")
        return _fallback_summary(report)


# ──────────────────────────────────────────────────────────────────────────
# Orquestación
# ──────────────────────────────────────────────────────────────────────────
def _insights_digest(restaurant_id: str) -> dict:
    """Extrae del snapshot vivo solo lo que alimenta la narrativa de dirección."""
    ins = get_live_insights(restaurant_id) or {}
    return {
        "sentiment_score": ins.get("sentiment_score"),
        "staff_mentions": ins.get("staff_mentions") or [],
        "recurring_issues": ins.get("recurring_issues") or [],
        "recurring_praise": ins.get("recurring_praise") or [],
        "top_problems": ins.get("top_problems") or [],
        "top_strengths": ins.get("top_strengths") or [],
        "keywords": ins.get("keywords") or [],
    }


def build_weekly_report(restaurant_id: str, week_start: Optional[date] = None,
                        model: str = MODEL, narrative: bool = True) -> dict:
    """
    Construye el informe semanal con comparativa contra la semana anterior.
    `week_start` (date) fija la semana; por defecto, la última semana completa.

    La narrativa la redacta Gemini (modelo `model`); pásalo `narrative=False` para
    obtener solo las métricas deterministas sin gastar IA. NO congela nada: usar
    `freeze_period(...)` para eso.
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
        "insights": _insights_digest(restaurant_id),
        "generated_at": datetime.utcnow().isoformat() + "Z",
    }
    report["summary"] = _narrative(report, model) if narrative else _fallback_summary(report)
    return report


def generate_and_store(restaurant_id: str, *, model: str = MODEL,
                       freeze: bool = True, week_start: Optional[date] = None) -> dict:
    """
    Op canónica de informe: construye el informe semanal, opcionalmente congela el
    snapshot de insights del período (`freeze`) y lo PERSISTE en `reports`. La usan
    por igual el botón manual del backoffice y el scheduler → mismo resultado.

    Devuelve el informe con `report_id` y, si procede, `frozen`.
    """
    report = build_weekly_report(restaurant_id, week_start=week_start, model=model)
    report["model_used"] = model

    if freeze:
        live = get_live_insights(restaurant_id)
        if live:
            p = report["period"]
            snapshot_insights(restaurant_id, live, p["start"], p["end"])
            report["frozen"] = True
        else:
            report["frozen"] = False

    saved = save_report(restaurant_id, report)
    report["report_id"] = saved.get("id")
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
    "generate_and_store",
    "freeze_period",
]
