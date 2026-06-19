-- =============================================================================
-- Qinsa Reputation — Migración Multi-tenant (v1 → v2)
-- database/migration_multitenant.sql
-- Fecha: 2026-06-13
--
-- Transforma el esquema plano de validación en un modelo multi-tenant nativo:
--   organizations → memberships(user, org, role) → restaurants.organization_id
--
-- Propiedades del script:
--   · IDEMPOTENTE — puede re-ejecutarse sin efectos destructivos.
--   · NO DESTRUCTIVO — no elimina columnas ni datos existentes.
--   · Compatible con producción actual (columnas añadidas en caliente en marzo
--     2026) Y con una BD recién creada desde schema.sql v1.
--
-- Ejecutar en el SQL Editor de Supabase (rol postgres). El pipeline Python
-- actual (service_role) sigue funcionando sin cambios: los restaurantes nuevos
-- caen por DEFAULT en la organización interna de Qinsalabs.
--
-- ⚠ BREAKING CHANGE: se eliminan las políticas anon USING(true). La demo-app
--   deja de poder leer con la ANON_KEY. Ver bloque transitorio en sección 9.
-- =============================================================================

BEGIN;

-- =============================================================================
-- 0. TIPO DE ROL DE MEMBRESÍA
-- =============================================================================

DO $$ BEGIN
    CREATE TYPE public.org_role AS ENUM ('owner', 'admin', 'member', 'viewer');
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

-- =============================================================================
-- 1. CAPA DE TENANCY: organizations + memberships
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.organizations (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name        text NOT NULL,
    slug        text UNIQUE,
    plan        text NOT NULL DEFAULT 'trial'
                CHECK (plan IN ('internal', 'trial', 'basic', 'growth')),
    is_active   boolean NOT NULL DEFAULT true,
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.organizations IS
    'Tenant raíz: dueño independiente (N=1), grupo gastronómico o agencia (N>1).';

CREATE TABLE IF NOT EXISTS public.memberships (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    role            public.org_role NOT NULL DEFAULT 'member',
    created_at      timestamptz NOT NULL DEFAULT now(),
    UNIQUE (user_id, organization_id)
);

COMMENT ON TABLE public.memberships IS
    'Un usuario auth.users puede pertenecer a N organizaciones con un rol por organización.';

-- Organización interna de Qinsalabs (UUID fijo para usarla como DEFAULT).
-- Todos los prospects de la fase de validación viven aquí.
INSERT INTO public.organizations (id, name, slug, plan)
VALUES ('00000000-0000-0000-0000-000000000001', 'Qinsalabs Internal', 'qinsalabs-internal', 'internal')
ON CONFLICT (id) DO NOTHING;

-- =============================================================================
-- 2. CONSOLIDACIÓN DE COLUMNAS CREADAS EN CALIENTE (marzo 2026)
--    Idempotente: en producción ya existen; en una BD desde schema.sql v1, se crean.
-- =============================================================================

ALTER TABLE public.reviews  ADD COLUMN IF NOT EXISTS review_id        text;
ALTER TABLE public.reviews  ADD COLUMN IF NOT EXISTS suggested_reply  text;

ALTER TABLE public.insights ADD COLUMN IF NOT EXISTS staff_mentions      jsonb;
ALTER TABLE public.insights ADD COLUMN IF NOT EXISTS rating_distribution jsonb;
ALTER TABLE public.insights ADD COLUMN IF NOT EXISTS recurring_issues    jsonb;
ALTER TABLE public.insights ADD COLUMN IF NOT EXISTS recurring_praise    jsonb;

-- =============================================================================
-- 3. RESTAURANTS: vínculo de tenancy + place_id (acción pendiente desde marzo)
-- =============================================================================

-- DEFAULT a la organización interna: el pipeline actual (run_pipeline --place-id)
-- sigue creando restaurantes sin conocer el concepto de organización.
ALTER TABLE public.restaurants
    ADD COLUMN IF NOT EXISTS organization_id uuid
        NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001'
        REFERENCES public.organizations(id) ON DELETE RESTRICT;

ALTER TABLE public.restaurants ADD COLUMN IF NOT EXISTS place_id text;

COMMENT ON COLUMN public.restaurants.place_id IS
    'Google placeId (ej. ChIJ7dkd3PibQQ0RwV6PkU_5tTo). Evita re-buscar con compass/crawler-google-places.';

-- =============================================================================
-- 4. INSIGHTS: de 1:1 a histórico por períodos
-- =============================================================================

-- Elimina la constraint UNIQUE que forzaba un único análisis por restaurante.
ALTER TABLE public.insights DROP CONSTRAINT IF EXISTS insights_restaurant_id_key;

-- Dimensión temporal opcional del análisis (NULL = snapshot completo, como hasta ahora).
ALTER TABLE public.insights ADD COLUMN IF NOT EXISTS period_start date;
ALTER TABLE public.insights ADD COLUMN IF NOT EXISTS period_end   date;

-- =============================================================================
-- 5. RESTAURANT_CONTEXT: formalización (existía solo en producción)
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.restaurant_context (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    restaurant_id   uuid NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
    owner_name      text,
    tone            text,
    instructions    text,
    updated_at      timestamptz NOT NULL DEFAULT now()
);

-- Si la tabla ya existía en producción sin estas garantías, se añaden ahora.
ALTER TABLE public.restaurant_context ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
CREATE UNIQUE INDEX IF NOT EXISTS uq_restaurant_context_restaurant
    ON public.restaurant_context (restaurant_id);

-- =============================================================================
-- 6. FIELD_VISITS: comercial como FK real a auth.users
--    visited_by (text) se conserva como dato legacy de la fase de validación.
-- =============================================================================

ALTER TABLE public.field_visits
    ADD COLUMN IF NOT EXISTS visited_by_user_id uuid
        REFERENCES auth.users(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.field_visits.visited_by IS
    'LEGACY: texto libre de la fase de validación. Usar visited_by_user_id en el MVP.';

-- =============================================================================
-- 7. ÍNDICES DE RENDIMIENTO
-- =============================================================================

-- Deduplicación de reseñas a nivel de BD: único parcial (las reseñas históricas
-- sin review_id quedan exentas). Habilita futuros upserts ON CONFLICT y elimina
-- el seq scan del loader en cada ejecución del pipeline.
CREATE UNIQUE INDEX IF NOT EXISTS uq_reviews_restaurant_review_id
    ON public.reviews (restaurant_id, review_id)
    WHERE review_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_restaurants_organization   ON public.restaurants (organization_id);
CREATE INDEX IF NOT EXISTS idx_memberships_user           ON public.memberships (user_id);
CREATE INDEX IF NOT EXISTS idx_memberships_organization   ON public.memberships (organization_id);

-- Query principal del frontend e histórico: "último análisis del restaurante X".
CREATE INDEX IF NOT EXISTS idx_insights_restaurant_generated
    ON public.insights (restaurant_id, generated_at DESC);

CREATE INDEX IF NOT EXISTS idx_field_visits_user          ON public.field_visits (visited_by_user_id);

-- =============================================================================
-- 8. FUNCIONES HELPER PARA RLS (schema privado, SECURITY DEFINER)
--
-- Motivos:
--   · Evitan la recursión infinita de políticas sobre memberships que
--     consultan memberships.
--   · El planner las evalúa una vez por statement (InitPlan), no por fila.
--   · app_private NO está expuesto por PostgREST: no son invocables vía API.
-- =============================================================================

CREATE SCHEMA IF NOT EXISTS app_private;

-- Organizaciones a las que pertenece el usuario autenticado actual.
CREATE OR REPLACE FUNCTION app_private.user_org_ids()
RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
    SELECT organization_id
    FROM public.memberships
    WHERE user_id = (SELECT auth.uid());
$$;

-- ¿Tiene el usuario actual alguno de estos roles en la organización dada?
CREATE OR REPLACE FUNCTION app_private.user_has_org_role(p_org uuid, p_roles public.org_role[])
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.memberships
        WHERE user_id = (SELECT auth.uid())
          AND organization_id = p_org
          AND role = ANY (p_roles)
    );
$$;

-- ¿Puede el usuario actual VER este restaurante? (cualquier rol en su organización)
CREATE OR REPLACE FUNCTION app_private.user_can_view_restaurant(p_restaurant uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.restaurants r
        JOIN public.memberships m ON m.organization_id = r.organization_id
        WHERE r.id = p_restaurant
          AND m.user_id = (SELECT auth.uid())
    );
$$;

-- ¿Puede el usuario actual GESTIONAR este restaurante? (owner o admin de la organización)
CREATE OR REPLACE FUNCTION app_private.user_manages_restaurant(p_restaurant uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.restaurants r
        JOIN public.memberships m ON m.organization_id = r.organization_id
        WHERE r.id = p_restaurant
          AND m.user_id = (SELECT auth.uid())
          AND m.role IN ('owner', 'admin')
    );
$$;

-- Solo el rol authenticated puede ejecutar los helpers. Nunca anon.
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA app_private FROM PUBLIC, anon;
GRANT USAGE ON SCHEMA app_private TO authenticated;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA app_private TO authenticated;

-- Trigger genérico de updated_at
CREATE OR REPLACE FUNCTION public.tg_set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS set_updated_at ON public.organizations;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.organizations
    FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

DROP TRIGGER IF EXISTS set_updated_at ON public.restaurant_context;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.restaurant_context
    FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- =============================================================================
-- 9. ROW LEVEL SECURITY
-- =============================================================================

ALTER TABLE public.organizations      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.memberships        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.restaurant_context ENABLE ROW LEVEL SECURITY;
-- (las 6 tablas v1 ya tienen RLS habilitado desde schema.sql)

-- --- 9.1 ELIMINACIÓN de las políticas abiertas de la fase de validación -----

DROP POLICY IF EXISTS anon_select_restaurants ON public.restaurants;
DROP POLICY IF EXISTS anon_select_insights    ON public.insights;

-- BLOQUE TRANSITORIO (comentado): re-habilitar SOLO si una visita comercial
-- necesita la demo-app antigua antes de migrarla a Supabase Auth. Eliminar
-- definitivamente al desplegar la app cliente con login.
--
-- CREATE POLICY anon_demo_select_restaurants ON public.restaurants
--     FOR SELECT TO anon
--     USING (organization_id = '00000000-0000-0000-0000-000000000001');
-- CREATE POLICY anon_demo_select_insights ON public.insights
--     FOR SELECT TO anon
--     USING (restaurant_id IN (
--         SELECT id FROM public.restaurants
--         WHERE organization_id = '00000000-0000-0000-0000-000000000001'
--     ));

-- --- 9.2 service_role: acceso total (pipeline Python + backoffice) -----------
-- service_role ignora RLS por diseño de Supabase; las políticas explícitas se
-- mantienen como documentación del contrato y defensa en profundidad.

DROP POLICY IF EXISTS service_all_organizations ON public.organizations;
CREATE POLICY service_all_organizations ON public.organizations
    FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS service_all_memberships ON public.memberships;
CREATE POLICY service_all_memberships ON public.memberships
    FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS service_all_restaurant_context ON public.restaurant_context;
CREATE POLICY service_all_restaurant_context ON public.restaurant_context
    FOR ALL TO service_role USING (true) WITH CHECK (true);

-- --- 9.3 organizations -------------------------------------------------------
-- El alta/baja de organizaciones es exclusiva del backoffice (service_role).

DROP POLICY IF EXISTS org_member_select ON public.organizations;
CREATE POLICY org_member_select ON public.organizations
    FOR SELECT TO authenticated
    USING (id IN (SELECT app_private.user_org_ids()));

DROP POLICY IF EXISTS org_owner_update ON public.organizations;
CREATE POLICY org_owner_update ON public.organizations
    FOR UPDATE TO authenticated
    USING (app_private.user_has_org_role(id, ARRAY['owner']::public.org_role[]))
    WITH CHECK (app_private.user_has_org_role(id, ARRAY['owner']::public.org_role[]));

-- --- 9.4 memberships ---------------------------------------------------------
-- Bootstrap (primera membresía de una organización nueva): solo via service_role.

DROP POLICY IF EXISTS membership_select_own_or_admin ON public.memberships;
CREATE POLICY membership_select_own_or_admin ON public.memberships
    FOR SELECT TO authenticated
    USING (
        user_id = (SELECT auth.uid())
        OR app_private.user_has_org_role(organization_id, ARRAY['owner','admin']::public.org_role[])
    );

DROP POLICY IF EXISTS membership_admin_insert ON public.memberships;
CREATE POLICY membership_admin_insert ON public.memberships
    FOR INSERT TO authenticated
    WITH CHECK (app_private.user_has_org_role(organization_id, ARRAY['owner','admin']::public.org_role[]));

DROP POLICY IF EXISTS membership_admin_update ON public.memberships;
CREATE POLICY membership_admin_update ON public.memberships
    FOR UPDATE TO authenticated
    USING (app_private.user_has_org_role(organization_id, ARRAY['owner','admin']::public.org_role[]))
    WITH CHECK (app_private.user_has_org_role(organization_id, ARRAY['owner','admin']::public.org_role[]));

DROP POLICY IF EXISTS membership_admin_delete ON public.memberships;
CREATE POLICY membership_admin_delete ON public.memberships
    FOR DELETE TO authenticated
    USING (
        app_private.user_has_org_role(organization_id, ARRAY['owner','admin']::public.org_role[])
        OR user_id = (SELECT auth.uid())  -- un usuario puede abandonar una organización
    );

-- --- 9.5 restaurants ---------------------------------------------------------

DROP POLICY IF EXISTS restaurant_member_select ON public.restaurants;
CREATE POLICY restaurant_member_select ON public.restaurants
    FOR SELECT TO authenticated
    USING (organization_id IN (SELECT app_private.user_org_ids()));

DROP POLICY IF EXISTS restaurant_admin_insert ON public.restaurants;
CREATE POLICY restaurant_admin_insert ON public.restaurants
    FOR INSERT TO authenticated
    WITH CHECK (app_private.user_has_org_role(organization_id, ARRAY['owner','admin']::public.org_role[]));

DROP POLICY IF EXISTS restaurant_admin_update ON public.restaurants;
CREATE POLICY restaurant_admin_update ON public.restaurants
    FOR UPDATE TO authenticated
    USING (app_private.user_has_org_role(organization_id, ARRAY['owner','admin']::public.org_role[]))
    WITH CHECK (app_private.user_has_org_role(organization_id, ARRAY['owner','admin']::public.org_role[]));

DROP POLICY IF EXISTS restaurant_owner_delete ON public.restaurants;
CREATE POLICY restaurant_owner_delete ON public.restaurants
    FOR DELETE TO authenticated
    USING (app_private.user_has_org_role(organization_id, ARRAY['owner']::public.org_role[]));

-- --- 9.6 reviews -------------------------------------------------------------
-- INSERT/DELETE de reseñas: solo el pipeline (service_role). Los usuarios pueden
-- leer y actualizar (aprobar suggested_reply, marcar como respondida).

DROP POLICY IF EXISTS review_member_select ON public.reviews;
CREATE POLICY review_member_select ON public.reviews
    FOR SELECT TO authenticated
    USING (app_private.user_can_view_restaurant(restaurant_id));

DROP POLICY IF EXISTS review_member_update ON public.reviews;
CREATE POLICY review_member_update ON public.reviews
    FOR UPDATE TO authenticated
    USING (app_private.user_can_view_restaurant(restaurant_id))
    WITH CHECK (app_private.user_can_view_restaurant(restaurant_id));

-- --- 9.7 insights ------------------------------------------------------------
-- Solo lectura para usuarios; los genera exclusivamente el pipeline.

DROP POLICY IF EXISTS insight_member_select ON public.insights;
CREATE POLICY insight_member_select ON public.insights
    FOR SELECT TO authenticated
    USING (app_private.user_can_view_restaurant(restaurant_id));

-- --- 9.8 restaurant_context --------------------------------------------------
-- El cliente configura tono/instrucciones de su local desde la app.

DROP POLICY IF EXISTS context_member_select ON public.restaurant_context;
CREATE POLICY context_member_select ON public.restaurant_context
    FOR SELECT TO authenticated
    USING (app_private.user_can_view_restaurant(restaurant_id));

DROP POLICY IF EXISTS context_admin_write ON public.restaurant_context;
CREATE POLICY context_admin_write ON public.restaurant_context
    FOR INSERT TO authenticated
    WITH CHECK (app_private.user_manages_restaurant(restaurant_id));

DROP POLICY IF EXISTS context_admin_update ON public.restaurant_context;
CREATE POLICY context_admin_update ON public.restaurant_context
    FOR UPDATE TO authenticated
    USING (app_private.user_manages_restaurant(restaurant_id))
    WITH CHECK (app_private.user_manages_restaurant(restaurant_id));

-- --- 9.9 Tablas con PII / operativa interna: field_visits, survey_responses, leads
-- Contienen datos personales (GDPR). Solo owner/admin de la organización
-- propietaria del restaurante; el resto de roles no las necesita.

DROP POLICY IF EXISTS field_visit_admin_select ON public.field_visits;
CREATE POLICY field_visit_admin_select ON public.field_visits
    FOR SELECT TO authenticated
    USING (app_private.user_manages_restaurant(restaurant_id));

DROP POLICY IF EXISTS survey_admin_select ON public.survey_responses;
CREATE POLICY survey_admin_select ON public.survey_responses
    FOR SELECT TO authenticated
    USING (app_private.user_manages_restaurant(restaurant_id));

DROP POLICY IF EXISTS lead_admin_select ON public.leads;
CREATE POLICY lead_admin_select ON public.leads
    FOR SELECT TO authenticated
    USING (app_private.user_manages_restaurant(restaurant_id));

COMMIT;

-- =============================================================================
-- POST-MIGRACIÓN (manual, fuera de la transacción)
--
-- 1. Crear tu membresía de administrador interno (sustituir <TU_AUTH_UID> por
--    el uuid de tu usuario en Authentication > Users del dashboard):
--
--    INSERT INTO public.memberships (user_id, organization_id, role)
--    VALUES ('<TU_AUTH_UID>', '00000000-0000-0000-0000-000000000001', 'owner')
--    ON CONFLICT (user_id, organization_id) DO NOTHING;
--
-- 2. Verificación rápida del aislamiento (debe devolver 0 filas sin membresía):
--
--    SET LOCAL ROLE authenticated;
--    SET LOCAL request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000099"}';
--    SELECT count(*) FROM restaurants;  -- esperado: 0
--    RESET ROLE;
-- =============================================================================
