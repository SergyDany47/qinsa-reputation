-- =============================================================================
-- Qinsa Reputation — GRANTs de tabla por rol (service_role / authenticated / anon)
-- 20260613140200_grants_roles.sql
--
-- POR QUÉ: el RLS filtra FILAS, pero solo se evalúa si el rol tiene el
-- privilegio de TABLA (GRANT). Son dos capas independientes. En hosted Supabase
-- los grants a service_role/authenticated/anon llegan por "default privileges";
-- en el stack local del CLI esos defaults NO se aplicaron a nuestras tablas, así
-- que TANTO el pipeline (service_role) COMO un miembro (authenticated) recibían
-- `permission denied` antes siquiera de evaluar el RLS.
--
-- Esta migración concede los privilegios explícitamente (portable y sin depender
-- de default privileges):
--   · service_role  → acceso total (pipeline + backoffice). Ignora RLS por su
--                     atributo BYPASSRLS, pero igualmente necesita el GRANT.
--   · authenticated → exactamente lo que sus políticas RLS requieren.
--   · anon          → CERO. Tras la v2 el acceso anónimo queda eliminado.
--
-- INSERT/DELETE de reviews e INSERT de insights quedan fuera de authenticated:
-- son competencia exclusiva del pipeline (service_role).
-- =============================================================================

BEGIN;

-- --- service_role: acceso total (el pipeline conecta con esta clave) --------
GRANT ALL ON ALL TABLES    IN SCHEMA public TO service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO service_role;

-- --- anon: acceso CERO tras la migración multi-tenant -----------------------
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;

-- --- authenticated: privilegios alineados con las políticas RLS -------------
GRANT USAGE ON SCHEMA public TO authenticated;

-- Lectura de su propia organización y de la jerarquía de datos del restaurante.
GRANT SELECT                         ON public.organizations      TO authenticated;
GRANT SELECT                         ON public.insights           TO authenticated;
GRANT SELECT                         ON public.field_visits       TO authenticated;
GRANT SELECT                         ON public.survey_responses   TO authenticated;
GRANT SELECT                         ON public.leads              TO authenticated;

-- owner puede renombrar/ajustar su organización.
GRANT UPDATE                         ON public.organizations      TO authenticated;

-- Gestión de miembros (RLS la limita a owner|admin de la organización).
GRANT SELECT, INSERT, UPDATE, DELETE ON public.memberships        TO authenticated;

-- Gestión de restaurantes (RLS: SELECT cualquier miembro; escritura owner|admin).
GRANT SELECT, INSERT, UPDATE, DELETE ON public.restaurants        TO authenticated;

-- Aprobar/editar suggested_reply y marcar como respondida (RLS: miembros).
GRANT SELECT, UPDATE                 ON public.reviews            TO authenticated;

-- Configuración de tono/instrucciones del local (RLS: SELECT miembros, escritura owner|admin).
GRANT SELECT, INSERT, UPDATE         ON public.restaurant_context TO authenticated;

COMMIT;
