-- =============================================================================
-- Qinsa Reputation — Programación de ingesta por restaurante (Fase 1)
-- 20260619140000_ingest_schedule.sql
--
-- Config de la ejecución periódica del motor de ingesta. El scheduler
-- (APScheduler en FastAPI) recorre los restaurantes con auto_ingest_enabled y
-- lanza la ingesta incremental cuando toca según ingest_frequency_hours.
-- =============================================================================

BEGIN;

ALTER TABLE public.restaurants
    ADD COLUMN IF NOT EXISTS auto_ingest_enabled   boolean     NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS ingest_frequency_hours integer    NOT NULL DEFAULT 6,
    ADD COLUMN IF NOT EXISTS last_ingest_at        timestamptz;

COMMENT ON COLUMN public.restaurants.auto_ingest_enabled IS
    'Si true, el scheduler ingesta este restaurante periódicamente.';
COMMENT ON COLUMN public.restaurants.ingest_frequency_hours IS
    'Cada cuántas horas se reingesta (mínimo recomendado 3-6 por coste Apify).';
COMMENT ON COLUMN public.restaurants.last_ingest_at IS
    'Última ingesta (manual o automática). El scheduler la usa para decidir si toca.';

COMMIT;
