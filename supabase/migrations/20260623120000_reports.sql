-- =============================================================================
-- Qinsa Reputation — Informes persistidos + programación (Fase 2)
-- 20260623120000_reports.sql
--
-- Persiste los informes semanales generados (bajo demanda o por el scheduler)
-- para que la app de cliente los consulte de forma ordenada. El scheduler nadie
-- lo observa al ejecutarse: sus informes DEBEN quedar guardados.
--
-- Modelo:
--   · reports: una fila por restaurante y período (UNIQUE → idempotencia del
--     scheduler y upsert del botón manual). payload = informe completo (jsonb).
--   · restaurants += auto_report_enabled / last_report_at (programación semanal).
--
-- RLS idéntico a insights/reviews: miembros de la org leen los suyos; el
-- pipeline (service_role) inserta. Anon, cero.
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.reports (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    restaurant_id uuid NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
    period_start  date NOT NULL,
    period_end    date NOT NULL,
    summary       text,
    payload       jsonb NOT NULL,
    model_used    text,
    created_at    timestamptz NOT NULL DEFAULT now()
);

-- Un informe por restaurante y semana: idempotencia del scheduler + upsert manual.
CREATE UNIQUE INDEX IF NOT EXISTS uq_reports_restaurant_period
    ON public.reports (restaurant_id, period_start);

-- Listado ordenado por recencia para la vista de cliente.
CREATE INDEX IF NOT EXISTS idx_reports_restaurant_created
    ON public.reports (restaurant_id, created_at DESC);

-- Programación de informes automáticos (cadencia semanal fija por producto).
ALTER TABLE public.restaurants ADD COLUMN IF NOT EXISTS auto_report_enabled boolean NOT NULL DEFAULT false;
ALTER TABLE public.restaurants ADD COLUMN IF NOT EXISTS last_report_at      timestamptz;

-- --- RLS ---------------------------------------------------------------------
ALTER TABLE public.reports ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS service_all_reports ON public.reports;
CREATE POLICY service_all_reports ON public.reports
    FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS report_member_select ON public.reports;
CREATE POLICY report_member_select ON public.reports
    FOR SELECT TO authenticated
    USING (app_private.user_can_view_restaurant(restaurant_id));

-- --- GRANTs (el RLS filtra filas; el GRANT habilita la tabla) ----------------
GRANT ALL    ON public.reports TO service_role;
GRANT SELECT ON public.reports TO authenticated;
REVOKE ALL   ON public.reports FROM anon;

COMMIT;
