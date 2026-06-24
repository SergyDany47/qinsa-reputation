-- =============================================================================
-- Qinsa Reputation — Historial de ejecuciones de ingesta
-- 20260624120000_ingest_runs.sql
--
-- Registra cada ejecución del motor de ingesta (manual o programada): cuándo,
-- si fue exitosa, cuántas reseñas se recopilaron y cuántas nuevas se almacenaron.
-- Da trazabilidad/control del gasto Apify por restaurante.
--
-- RLS idéntico a reports/insights: miembros de la org leen los suyos; el pipeline
-- (service_role) inserta. Anon, cero.
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.ingest_runs (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    restaurant_id    uuid NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
    trigger          text NOT NULL DEFAULT 'manual',   -- manual | scheduled
    status           text NOT NULL,                    -- success | error
    reviews_scraped  integer,                          -- total recopiladas de Apify
    reviews_inserted integer,                          -- nuevas realmente almacenadas
    error_message    text,
    created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ingest_runs_restaurant_created
    ON public.ingest_runs (restaurant_id, created_at DESC);

-- --- RLS ---------------------------------------------------------------------
ALTER TABLE public.ingest_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS service_all_ingest_runs ON public.ingest_runs;
CREATE POLICY service_all_ingest_runs ON public.ingest_runs
    FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS ingest_run_member_select ON public.ingest_runs;
CREATE POLICY ingest_run_member_select ON public.ingest_runs
    FOR SELECT TO authenticated
    USING (app_private.user_can_view_restaurant(restaurant_id));

-- --- GRANTs ------------------------------------------------------------------
GRANT ALL    ON public.ingest_runs TO service_role;
GRANT SELECT ON public.ingest_runs TO authenticated;
REVOKE ALL   ON public.ingest_runs FROM anon;

COMMIT;
