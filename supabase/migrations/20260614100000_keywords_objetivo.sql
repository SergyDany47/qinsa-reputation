-- =============================================================================
-- Qinsa Reputation — Keyword Injection (SEO activo)
-- 20260614100000_keywords_objetivo.sql
--
-- Añade a restaurant_context la lista de keywords estratégicas que la IA
-- inyectará orgánicamente (1-2 por respuesta) en las respuestas a reseñas
-- positivas, para mejorar el posicionamiento local de la ficha.
--
-- Ej.: ["terraza en Ponzano", "mejor tortilla de patatas", "croquetas"]
-- =============================================================================

BEGIN;

ALTER TABLE public.restaurant_context
    ADD COLUMN IF NOT EXISTS keywords_objetivo jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.restaurant_context.keywords_objetivo IS
    'Array de keywords SEO a inyectar orgánicamente en las respuestas IA (platos estrella, ubicación, tipo de cocina).';

COMMIT;
