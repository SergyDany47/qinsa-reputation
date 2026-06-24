-- =============================================================================
-- Qinsa Reputation — Ciclo de vida de la respuesta + modo de publicación (Fase 3)
-- 20260624130000_reply_lifecycle.sql
--
-- Groundwork compartido por WhatsApp-aprobación (Fase 4) y Google-publicación
-- (Fase 5). NO integra GBP todavía (ver GBP_SPIKE.md): solo modela estados y modo.
--
--   reviews.reply_status:  none → draft → approved → published
--                          (+ pending|rejected reservados para la moderación de
--                           Google, que se rellenarán en la Fase 5).
--   restaurants.publish_mode: manual | pre_approval | automatic
--     default 'manual' y 'automatic' gateada por rating (auto solo ≥ N★),
--     por el riesgo de moderación/rechazo silencioso hallado en el spike.
--
-- Las columnas viven en tablas con RLS/GRANT ya existentes (reviews: SELECT+UPDATE
-- de miembros; restaurants: UPDATE de owner|admin), así que no hacen falta nuevas
-- políticas: el GRANT de tabla cubre las columnas nuevas.
-- =============================================================================

BEGIN;

-- --- reviews: ciclo de vida de NUESTRA respuesta sugerida ---------------------
ALTER TABLE public.reviews
    ADD COLUMN IF NOT EXISTS reply_status text NOT NULL DEFAULT 'none'
        CHECK (reply_status IN ('none', 'draft', 'approved', 'published', 'pending', 'rejected'));
ALTER TABLE public.reviews ADD COLUMN IF NOT EXISTS reply_approved_at  timestamptz;
ALTER TABLE public.reviews ADD COLUMN IF NOT EXISTS reply_approved_by  uuid REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public.reviews ADD COLUMN IF NOT EXISTS reply_published_at timestamptz;

-- Backfill: las reseñas que ya tienen sugerencia generada entran como 'draft'.
UPDATE public.reviews
   SET reply_status = 'draft'
 WHERE reply_status = 'none'
   AND suggested_reply IS NOT NULL AND suggested_reply <> '';

-- --- restaurants: modo de publicación -----------------------------------------
ALTER TABLE public.restaurants
    ADD COLUMN IF NOT EXISTS publish_mode text NOT NULL DEFAULT 'manual'
        CHECK (publish_mode IN ('manual', 'pre_approval', 'automatic'));
ALTER TABLE public.restaurants
    ADD COLUMN IF NOT EXISTS auto_publish_min_rating integer NOT NULL DEFAULT 5
        CHECK (auto_publish_min_rating BETWEEN 1 AND 5);

COMMIT;
