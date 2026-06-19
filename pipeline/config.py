"""
config.py — Lectura de la configuración operativa de plataforma.

La config no-secreta vive en la tabla `platform_settings` (editable desde el
backoffice). Los secretos (APIFY_API_TOKEN, GEMINI_API_KEY) NO están aquí:
siguen en el .env del servidor.

Uso:
    from config import get_setting
    model = get_setting("default_model", "gemini-2.5-flash")
"""
import logging

from loader import supabase  # cliente service_role

logger = logging.getLogger(__name__)

# Modelos de Gemini permitidos en la UI / validación
ALLOWED_MODELS = [
    "gemini-2.5-flash",
    "gemini-2.0-flash",
    "gemini-flash-lite-latest",
]


def get_setting(key: str, default=None):
    """Lee un valor de platform_settings. Devuelve `default` si no existe o falla."""
    try:
        res = supabase.table("platform_settings").select("value").eq("key", key).execute()
        if res.data:
            return res.data[0]["value"]
    except Exception as e:
        logger.warning("No se pudo leer setting '%s': %s", key, e)
    return default


def get_all_settings() -> dict:
    """Devuelve toda la config operativa como dict {key: value}."""
    try:
        rows = supabase.table("platform_settings").select("key,value").execute().data or []
        return {r["key"]: r["value"] for r in rows}
    except Exception as e:
        logger.warning("No se pudo leer platform_settings: %s", e)
        return {}
