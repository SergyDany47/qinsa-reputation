-- =============================================================================
-- Qinsa Reputation — Personalización de respuestas IA (guiado-híbrido)
-- 20260619120000_context_personalization.sql
--
-- Amplía restaurant_context con la configuración estructurada que controla el
-- tono y comportamiento de las respuestas sugeridas:
--   · tone_preset    — voz curada (el prompt real vive en el código, versionado)
--   · emoji_level    — ninguno | sutil | expresivo
--   · language_mode  — mirror (idioma del cliente) | es (siempre español)
--   · signature      — firma de marca (cae a owner_name si null)
--   · dishes         — platos estrella / señas de identidad (ganchos SEO)
--
-- `instructions` (texto libre) y `keywords_objetivo` ya existen y se conservan.
-- =============================================================================

BEGIN;

ALTER TABLE public.restaurant_context
    ADD COLUMN IF NOT EXISTS tone_preset   text  NOT NULL DEFAULT 'cercano_desenfadado',
    ADD COLUMN IF NOT EXISTS emoji_level   text  NOT NULL DEFAULT 'sutil',
    ADD COLUMN IF NOT EXISTS language_mode text  NOT NULL DEFAULT 'mirror',
    ADD COLUMN IF NOT EXISTS signature     text,
    ADD COLUMN IF NOT EXISTS dishes        jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.restaurant_context.tone_preset IS
    'Clave del preset de voz (cercano_desenfadado | cercano_profesional | elegante | de_barrio). El prompt real está en pipeline/analyzer.py.';

COMMIT;
