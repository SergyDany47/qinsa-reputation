# DATABASE_MODEL.md — Modelo de Datos y Análisis de Seguridad

Auditoría técnica generada en junio 2026 a partir de `/database/schema.sql` y el estado real en Supabase.
Orientada a informar la futura migración multi-tenant del MVP.

---

## 1. Mapa de Relaciones — Las 6 Tablas

### 1.1 Diagrama de relaciones

```
                        ┌─────────────────────┐
                        │      restaurants     │
                        │─────────────────────│
                        │ id (PK, uuid)        │
                        │ name (NOT NULL)      │
                        │ address              │
                        │ neighborhood         │
                        │ city (DEFAULT Madrid)│
                        │ category             │
                        │ google_maps_url      │
                        │ google_rating        │
                        │ review_count         │
                        │ response_rate        │
                        │ profile_status ✓CHK  │
                        │ created_at           │
                        └──────────┬──────────┘
                                   │ ON DELETE CASCADE
             ┌─────────────────────┼──────────────────────┐
             │                     │                       │
    ┌────────▼──────┐   ┌─────────▼──────┐    ┌──────────▼────────┐
    │    reviews    │   │    insights     │    │   field_visits    │
    │───────────────│   │────────────────│    │───────────────────│
    │ id (PK)       │   │ id (PK)        │    │ id (PK)           │
    │ restaurant_id │   │ restaurant_id  │    │ restaurant_id     │
    │ source        │   │  (UNIQUE ← 1:1)│    │ visit_date        │
    │ author_name   │   │ top_problems ⬡ │    │ visited_by (text) │
    │ rating ✓CHK   │   │ top_strengths ⬡│    │ status ✓CHK       │
    │ text          │   │ keywords ⬡     │    │ owner_met         │
    │ review_date   │   │ summary        │    │ demo_shown        │
    │ owner_replied │   │ sentiment_score│    │ reaction_score    │
    │ reply_text    │   │ response_qual. │    │ notes             │
    │ collected_at  │   │ generated_at   │    │ follow_up_date    │
    └───────────────┘   │ model_used     │    └───────────────────┘
                        └────────────────┘
                                   │
             ┌─────────────────────┘
             │
    ┌────────▼──────────┐    ┌───────────────────┐
    │  survey_responses │    │       leads        │
    │───────────────────│    │───────────────────│
    │ id (PK)           │    │ id (PK)            │
    │ restaurant_id     │    │ restaurant_id      │
    │ owner_name        │    │ owner_name         │
    │ q1_time_weekly    │    │ email   ← PII      │
    │ q2_tools_used     │    │ phone   ← PII      │
    │ q3_importance ✓   │    │ plan_interest ✓CHK │
    │ q4_biggest_pain   │    │ demo_requested     │
    │ q5_willing_to_use │    │ source ✓CHK        │
    │ submitted_at      │    │ created_at         │
    └───────────────────┘    │ contacted_at       │
                             └────────────────────┘

⬡ = columna de tipo jsonb
✓CHK = tiene CHECK constraint
PII = datos personales identificables
```

### 1.2 Naturaleza de las relaciones

| Relación | Tipo | FK | Cascade |
|----------|------|-----|---------|
| restaurants → reviews | 1:N | reviews.restaurant_id | ON DELETE CASCADE |
| restaurants → insights | **1:1** | insights.restaurant_id UNIQUE | ON DELETE CASCADE |
| restaurants → field_visits | 1:N | field_visits.restaurant_id | ON DELETE CASCADE |
| restaurants → survey_responses | 1:N | survey_responses.restaurant_id | ON DELETE CASCADE |
| restaurants → leads | 1:N | leads.restaurant_id | ON DELETE CASCADE |

`restaurants` es el nodo raíz de todo el modelo. No existen relaciones directas entre tablas hijas (por ejemplo, `leads` no referencia a `field_visits`). El grafo de dependencias es un árbol puro, sin ciclos ni relaciones laterales.

### 1.3 Constraints notables

| Tabla | Columna | Constraint |
|-------|---------|------------|
| restaurants | profile_status | CHECK IN ('prospect','visited','lead','client') |
| reviews | rating | CHECK BETWEEN 1 AND 5 |
| field_visits | status | CHECK IN ('pending','visited','interested','rejected') |
| field_visits | reaction_score | CHECK BETWEEN 1 AND 5 |
| survey_responses | q3_google_importance | CHECK BETWEEN 1 AND 5 |
| leads | plan_interest | CHECK IN ('basic','growth','undecided') |
| leads | source | CHECK IN ('field_visit','landing','referral') |
| insights | restaurant_id | UNIQUE (garantiza relación 1:1) |

### 1.4 Columnas que existen en BD pero no en schema.sql

Estas columnas fueron añadidas en migraciones posteriores (2026-03-06) directamente via el dashboard SQL de Supabase y no están reflejadas en el archivo `schema.sql`:

| Tabla | Columna añadida | Tipo |
|-------|-----------------|------|
| reviews | review_id | text (reviewId de Apify) |
| reviews | suggested_reply | text (respuesta generada por Gemini) |
| insights | staff_mentions | jsonb |
| insights | rating_distribution | jsonb |
| insights | recurring_issues | jsonb |
| insights | recurring_praise | jsonb |
| — | restaurant_context | tabla completa (no en schema.sql) |

**Acción pendiente**: sincronizar `schema.sql` con el estado real de la BD antes del MVP.

### 1.5 Índices declarados

```sql
idx_restaurants_status      ON restaurants(profile_status)
idx_reviews_restaurant_id   ON reviews(restaurant_id)
idx_reviews_rating          ON reviews(rating)
idx_reviews_date            ON reviews(review_date DESC)
idx_insights_restaurant_id  ON insights(restaurant_id)
idx_field_visits_restaurant ON field_visits(restaurant_id)
idx_field_visits_status     ON field_visits(status)
idx_leads_restaurant_id     ON leads(restaurant_id)
idx_survey_restaurant_id    ON survey_responses(restaurant_id)
```

Ausente: índice en `reviews.review_id` (campo usado para deduplicación — su ausencia implica un seq scan en cada ejecución del pipeline para restaurantes con muchas reseñas).

---

## 2. Análisis de Políticas RLS

### 2.1 Estado actual de RLS

RLS está habilitado en las 6 tablas. El esquema define exactamente **8 políticas** distribuidas en dos roles: `anon` y `service_role`.

```sql
ALTER TABLE restaurants      ENABLE ROW LEVEL SECURITY;  -- ✓
ALTER TABLE reviews          ENABLE ROW LEVEL SECURITY;  -- ✓
ALTER TABLE insights         ENABLE ROW LEVEL SECURITY;  -- ✓
ALTER TABLE field_visits     ENABLE ROW LEVEL SECURITY;  -- ✓
ALTER TABLE survey_responses ENABLE ROW LEVEL SECURITY;  -- ✓
ALTER TABLE leads            ENABLE ROW LEVEL SECURITY;  -- ✓
```

### 2.2 Políticas para el rol `anon`

`anon` es el rol de Supabase para peticiones sin autenticación (usando la `ANON_KEY`). Es el rol que usa la demo app React desde el frontend.

| Política | Tabla | Operación | Condición |
|----------|-------|-----------|-----------|
| `anon_select_restaurants` | restaurants | SELECT | `USING (true)` |
| `anon_select_insights` | insights | SELECT | `USING (true)` |

**Qué permite**: cualquier cliente anónimo puede leer **todos** los registros de `restaurants` e `insights` sin ningún filtro de fila.

**Qué bloquea**: el rol `anon` no tiene ninguna política para `reviews`, `field_visits`, `survey_responses` ni `leads`. Dado que RLS está habilitado, la ausencia de política equivale a denegación total — ningún cliente anónimo puede leer ni escribir en esas 4 tablas.

```
Tabla               │ anon SELECT │ anon INSERT/UPDATE/DELETE
────────────────────┼─────────────┼──────────────────────────
restaurants         │     ✓ (ALL) │           ✗
reviews             │     ✗       │           ✗
insights            │     ✓ (ALL) │           ✗
field_visits        │     ✗       │           ✗
survey_responses    │     ✗       │           ✗
leads               │     ✗       │           ✗
```

### 2.3 Políticas para el rol `service_role`

`service_role` es el rol privilegiado que usa el pipeline Python (con `SUPABASE_SERVICE_ROLE_KEY`). En Supabase, este rol ignora RLS por definición del sistema, pero el schema también declara políticas explícitas para él.

| Política | Tabla | Operación | Condición |
|----------|-------|-----------|-----------|
| `service_all_restaurants` | restaurants | ALL | `USING (true) WITH CHECK (true)` |
| `service_all_reviews` | reviews | ALL | `USING (true) WITH CHECK (true)` |
| `service_all_insights` | insights | ALL | `USING (true) WITH CHECK (true)` |
| `service_all_field_visits` | field_visits | ALL | `USING (true) WITH CHECK (true)` |
| `service_all_survey_responses` | survey_responses | ALL | `USING (true) WITH CHECK (true)` |
| `service_all_leads` | leads | ALL | `USING (true) WITH CHECK (true)` |

Acceso total (SELECT, INSERT, UPDATE, DELETE) sin restricción de fila en las 6 tablas.

### 2.4 Rol `authenticated` — ausencia total de políticas

**Este es el gap crítico de seguridad para el producto**: el rol `authenticated` de Supabase (usuarios logueados con Supabase Auth) no tiene **ninguna** política definida en ninguna de las 6 tablas.

Consecuencia directa: si en el MVP se añade login para los dueños de restaurante, un usuario autenticado con `anon_key` (el token que el navegador recibe tras el login) tendría **el mismo acceso que un usuario anónimo**, porque las únicas políticas activas son las de `anon`. No podría leer sus propias reseñas ni sus propios insights a través de Supabase Auth.

Actualmente esto no es un problema porque:
- La demo app usa el rol `anon` con acceso de solo lectura a datos que son todos públicos de Google Maps.
- El pipeline usa `service_role` en un entorno de servidor controlado.
- No hay usuarios reales registrados en el sistema.

### 2.5 Resumen del modelo de seguridad actual

```
Rol           │ Contexto de uso           │ Acceso efectivo
──────────────┼───────────────────────────┼──────────────────────────────────
anon          │ Demo app frontend (React) │ SELECT en restaurants + insights (sin filtro)
service_role  │ Pipeline Python           │ ALL en las 6 tablas (sin filtro)
authenticated │ (no usado aún)            │ Idéntico a anon (herencia implícita)
```

---

## 3. Informe de Limitaciones Multi-tenant

### 3.1 Definición del problema

El esquema actual está diseñado para un único operador interno (Qinsalabs) que gestiona todos los restaurantes como parte de su proceso de validación comercial. El modelo **no soporta** los siguientes escenarios del producto futuro:

- **Escenario A — Dueño autogestionado**: el dueño de "El Kiosko | Boadilla" se registra, inicia sesión, y solo ve sus propias reseñas e insights. No puede ver los datos de otro restaurante.
- **Escenario B — Admin multi-local**: el mismo dueño gestiona 3 restaurantes en Madrid. Puede alternar entre ellos desde un selector.
- **Escenario C — Agencia con clientes**: una agencia de marketing gestiona la reputación de 15 restaurantes independientes. Cada restaurante-cliente tiene su panel aislado. La agencia puede ver todos, cada cliente solo el suyo.

### 3.2 Limitación 1: No existe concepto de propietario en `restaurants`

La tabla `restaurants` no tiene ninguna columna que vincule un restaurante con un usuario o cuenta:

```sql
-- Estado actual — sin vínculo de propiedad
CREATE TABLE restaurants (
    id             uuid PRIMARY KEY,
    name           text NOT NULL,
    -- ... métricas y datos de Google Maps ...
    profile_status text  -- 'prospect' | 'visited' | 'lead' | 'client'
    -- ✗ AUSENTE: owner_id uuid REFERENCES auth.users(id)
    -- ✗ AUSENTE: tenant_id uuid REFERENCES tenants(id)
);
```

`profile_status` refleja el estado del pipeline comercial de Qinsalabs, no la relación de acceso entre un usuario y su restaurante. Son conceptos distintos que el modelo actual confunde en una sola columna.

Sin una FK a `auth.users` o a una tabla de tenants, es imposible escribir una política RLS que restrinja el acceso por propietario.

### 3.3 Limitación 2: Las políticas RLS usan `USING (true)` sin condición de fila

Las políticas `anon_select_restaurants` y `anon_select_insights` conceden acceso a **todas las filas** sin condición:

```sql
-- Política actual — acceso sin filtro de fila
CREATE POLICY anon_select_restaurants
    ON restaurants FOR SELECT TO anon USING (true);

-- Política necesaria para multi-tenant — filtro por propietario
-- (no implementable con el schema actual por ausencia de owner_id)
CREATE POLICY owner_select_own_restaurant
    ON restaurants FOR SELECT TO authenticated
    USING (auth.uid() = owner_id);
```

En el escenario B (dueño multi-local), la política correcta requeriría una tabla de unión:

```sql
-- Política para multi-tenant con múltiples locales por usuario
CREATE POLICY owner_select_own_restaurants
    ON restaurants FOR SELECT TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM user_restaurant_memberships
            WHERE user_id = auth.uid()
              AND restaurant_id = restaurants.id
        )
    );
```

Nada de esto es posible hoy porque no existen ni `owner_id` ni `user_restaurant_memberships`.

### 3.4 Limitación 3: No existe tabla de tenants ni de cuentas

El Escenario C (agencia) requiere una capa adicional de agrupación por encima de `auth.users`. Una agencia es una entidad que puede tener varios usuarios internos con roles distintos (gestor de cuentas, analista, admin) y varios restaurantes-clientes asignados.

El schema actual no tiene ni el concepto de `tenant/organization/account`, ni una tabla de membresías que permita definir `(user_id, tenant_id, role)` o `(user_id, restaurant_id, role)`.

Sin esta capa, no es posible distinguir entre:
- Un usuario que es dueño de su propio restaurante.
- Un usuario que es empleado de una agencia con permisos de solo lectura sobre N restaurantes.
- Un usuario administrador de Qinsalabs con acceso global.

### 3.5 Limitación 4: `insights` es estrictamente 1:1 por restaurante

```sql
restaurant_id uuid UNIQUE REFERENCES restaurants(id)
```

La constraint `UNIQUE` en `insights.restaurant_id` significa que solo puede existir un registro de insights por restaurante. El pipeline lo gestiona con un select-then-update, sobreescribiendo siempre el análisis anterior.

Consecuencias para el producto futuro:
- No es posible almacenar histórico de análisis (comparar sentimiento de marzo vs. junio).
- No es posible que un restaurante tenga insights separados por período de tiempo o por fuente.
- No es posible que una agencia genere un análisis "de prueba" sin sobreescribir el análisis actual del cliente.

La solución requiere un campo `period` o `generated_at` como parte de la clave compuesta, eliminando la constraint UNIQUE sobre `restaurant_id` sola.

### 3.6 Limitación 5: `field_visits.visited_by` es texto libre, no FK a usuario

```sql
visited_by text
```

En el contexto actual (solo Sergio hace visitas), guardar el nombre como texto libre es suficiente. En un modelo multi-tenant con un equipo comercial, este campo debería ser:

```sql
visited_by uuid REFERENCES auth.users(id)
```

Sin esa FK, no es posible filtrar por comercial, calcular métricas de rendimiento por agente, ni restringir visibilidad de visitas a quien las realizó.

### 3.7 Limitación 6: Datos de PII sin aislamiento por tenant

`leads` y `survey_responses` contienen datos personales identificables (email, teléfono, nombre del dueño). Las políticas actuales son binarias: o acceso total (service_role) o acceso nulo (cualquier otro rol).

En un escenario multi-tenant, el aislamiento de PII por tenant es un requisito tanto funcional como legal (GDPR). Una agencia no debe poder acceder a los leads o encuestas de otro cliente. El schema actual no tiene los mecanismos para implementar ese aislamiento.

### 3.8 Tabla de columnas/tablas faltantes para el MVP multi-tenant

| Elemento | Estado actual | Necesario para multi-tenant |
|----------|---------------|------------------------------|
| `restaurants.owner_id` | ✗ Ausente | FK → auth.users(id) |
| `restaurants.tenant_id` | ✗ Ausente | FK → tenants(id) para escenario agencia |
| Tabla `tenants` | ✗ No existe | (id, name, plan, created_at) |
| Tabla `user_restaurant_memberships` | ✗ No existe | (user_id, restaurant_id, role) |
| `insights.restaurant_id UNIQUE` | Constraint activa | Eliminar; usar (restaurant_id, period) |
| `field_visits.visited_by` | text libre | uuid FK → auth.users(id) |
| Política `authenticated` en todas las tablas | ✗ Ninguna | Políticas con `auth.uid()` |
| Índice en `reviews.review_id` | ✗ Ausente | Necesario para deduplicación eficiente |

### 3.9 Resumen ejecutivo de la deuda multi-tenant

El esquema actual es correcto y suficiente para la **fase de validación** en la que está el proyecto: un único operador (Qinsalabs) gestiona todos los restaurantes internamente con acceso service_role. La demo app publica datos de lectura sin autenticación porque en esta fase todos los datos son de Google Maps y no contienen información sensible del cliente.

La migración al MVP multi-tenant requiere:
1. Añadir tabla `tenants` y FK `tenant_id` en `restaurants`.
2. Añadir tabla `user_restaurant_memberships` (o `user_tenant_memberships` para el escenario agencia).
3. Reemplazar todas las políticas `anon` por políticas `authenticated` con condiciones de fila basadas en `auth.uid()`.
4. Cambiar `insights.restaurant_id` de UNIQUE a parte de clave compuesta con campo temporal.
5. Cambiar `field_visits.visited_by` de `text` a `uuid REFERENCES auth.users(id)`.
6. Añadir índice en `reviews.review_id`.
7. Sincronizar `schema.sql` con el estado real de la BD (columnas añadidas en marzo 2026).

Esta migración no es urgente para la validación actual, pero debería planificarse antes de incorporar el primer cliente real del MVP.
