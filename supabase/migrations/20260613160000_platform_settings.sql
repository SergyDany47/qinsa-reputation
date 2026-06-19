-- =============================================================================
-- Qinsa Reputation — Configuración operativa de plataforma
-- 20260613160000_platform_settings.sql
--
-- Config NO secreta, editable desde el backoffice (modelo Gemini por defecto,
-- nº de reseñas por defecto en ingesta/refresh). Key-value con valor jsonb.
--
-- Los SECRETOS (APIFY_API_TOKEN, GEMINI_API_KEY) NO viven aquí: permanecen en
-- el .env del servidor (fuente de verdad). El backoffice solo muestra su estado
-- enmascarado. Decisión [2026-06-13].
--
-- Gestionada solo por service_role (vía la API FastAPI del backoffice).
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.platform_settings (
    key        text PRIMARY KEY,
    value      jsonb NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.platform_settings IS
    'Config operativa no-secreta editable desde el backoffice. Los secretos viven en .env.';

ALTER TABLE public.platform_settings ENABLE ROW LEVEL SECURITY;

GRANT ALL ON public.platform_settings TO service_role;
REVOKE ALL ON public.platform_settings FROM anon, authenticated;

DROP POLICY IF EXISTS service_all_platform_settings ON public.platform_settings;
CREATE POLICY service_all_platform_settings ON public.platform_settings
    FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Trigger de updated_at (la función tg_set_updated_at existe desde la v2)
DROP TRIGGER IF EXISTS set_updated_at ON public.platform_settings;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.platform_settings
    FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- Defaults (no se sobreescriben si ya existen)
INSERT INTO public.platform_settings (key, value) VALUES
    ('default_model',            '"gemini-2.5-flash"'::jsonb),
    ('default_refresh_count',    '10'::jsonb),
    ('default_historical_count', '100'::jsonb)
ON CONFLICT (key) DO NOTHING;

COMMIT;
