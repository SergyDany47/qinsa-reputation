-- =============================================================================
-- Qinsa Reputation — Administradores de plataforma (backoffice interno)
-- 20260613150000_platform_admins.sql
--
-- Un "platform admin" es staff de Qinsalabs con poderes CROSS-TENANT (crear
-- organizaciones, dar de alta el primer usuario de un cliente, asignar
-- restaurantes a cualquier org). Es una capacidad de PLATAFORMA, ortogonal a la
-- membresía de un tenant: un admin no necesita ser "member" de cada org cliente.
--
-- Por eso se modela como tabla propia (explícito > implícito) y NO reutilizando
-- la membresía de la org interna.
--
-- La tabla la gestiona EXCLUSIVAMENTE el backend (service_role, vía la API
-- FastAPI del backoffice). Nunca se expone a `anon` ni a `authenticated`: el
-- navegador del backoffice se autentica como `authenticated` normal y la API es
-- quien comprueba la pertenencia a esta tabla antes de actuar con service_role.
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.platform_admins (
    user_id    uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    note       text,
    created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.platform_admins IS
    'Staff de Qinsalabs con poderes cross-tenant. Capacidad de plataforma, ortogonal a la membresía de tenant. Gestionada solo por service_role (backoffice FastAPI).';

ALTER TABLE public.platform_admins ENABLE ROW LEVEL SECURITY;

-- Solo service_role toca esta tabla. anon/authenticated: acceso cero.
GRANT ALL ON public.platform_admins TO service_role;
REVOKE ALL ON public.platform_admins FROM anon, authenticated;

DROP POLICY IF EXISTS service_all_platform_admins ON public.platform_admins;
CREATE POLICY service_all_platform_admins ON public.platform_admins
    FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Helper para RLS futuras (p.ej. dar a un platform admin lectura cross-tenant
-- por el canal authenticated, si algún día se quiere). No lo usa la API, que
-- comprueba la pertenencia directamente con service_role.
CREATE OR REPLACE FUNCTION app_private.is_platform_admin()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.platform_admins WHERE user_id = (SELECT auth.uid())
    );
$$;

GRANT EXECUTE ON FUNCTION app_private.is_platform_admin() TO authenticated;

COMMIT;
