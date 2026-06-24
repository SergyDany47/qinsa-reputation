# CLAUDE.md — Contexto del Proyecto Qinsa Reputation

## Quien soy y que estamos construyendo

Soy Sergio, desarrollador con 5 años de experiencia. Estoy construyendo **Qinsa Reputation**, un SaaS de gestión inteligente de reputación online para restaurantes. El producto forma parte de **Qinsalabs**, una empresa paraguas de productos digitales y automatización.

El objetivo inmediato NO es construir el producto final. Es construir un **sistema de validación en campo** compuesto por:
1. Un pipeline de datos (reseñas → análisis IA)
2. Una base de datos estructurada en Supabase
3. Una demo app mobile-first para mostrar en visitas comerciales
4. Una landing híbrida (presentación + encuesta + captación)

Con este sistema saldremos a hablar con 20+ restaurantes en Madrid para validar el problema antes de construir el MVP completo.

---

## Stack tecnológico

| Capa | Tecnología | Notas |
|------|-----------|-------|
| Base de datos | Supabase (PostgreSQL) | Tablas ya definidas en el esquema |
| Backend / scripts | Python 3.11+ | FastAPI para endpoints cuando sea necesario |
| Análisis de reseñas | Gemini API (gemini-2.0-flash) | Sentiment analysis + insights + entity extraction. Librería: google-generativeai. Variable: GEMINI_API_KEY |
| Frontend demo app | React + Tailwind CSS | Mobile-first, desplegado en Vercel |
| Landing | React o HTML/CSS puro | Simple, rápida, funcional |
| Orquestación futura | n8n | Para automatizaciones del MVP |
| Scraping reseñas | Apify (Google Maps Reviews) | Actor: compass/google-maps-reviews-scraper |
| Autenticación | Supabase Auth | Solo para panel admin interno |
| Despliegue | Vercel (frontend) + Railway (backend si necesario) | |

---

## Estructura del proyecto

```
qinsa-reputation/
├── CLAUDE.md                  # Este fichero — siempre léelo primero
├── DEVELOPMENT.md             # Buenas prácticas y decisiones técnicas
├── .env.example               # Variables de entorno necesarias
├── /pipeline/                 # Scripts Python de recopilación y análisis
│   ├── scraper.py             # Recopilación de reseñas con Apify
│   ├── analyzer.py            # Análisis de sentimiento e insights con Gemini API
│   ├── loader.py              # Carga de datos en Supabase
│   └── run_pipeline.py        # Script maestro que orquesta los tres
├── /database/
│   ├── schema.sql             # Esquema completo de Supabase
│   └── seed_data.sql          # Datos de prueba para desarrollo
├── /demo-app/                 # React app para visitas comerciales
│   ├── src/
│   │   ├── components/
│   │   ├── pages/
│   │   └── lib/supabase.js
│   └── package.json
└── /landing/                  # Landing híbrida de captación
    ├── src/
    └── package.json
```

---

## Variables de entorno necesarias

```bash
# Supabase
SUPABASE_URL=
SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=

# Gemini (análisis de sentimiento e insights — reemplaza Google NL API)
GEMINI_API_KEY=

# Apify
APIFY_API_TOKEN=

# OpenAI (opcional — para generación de respuestas IA en el futuro)
OPENAI_API_KEY=
```

---

## Esquema de base de datos (Supabase)

### Tabla: restaurants
```sql
id              uuid PK
name            text NOT NULL
address         text
neighborhood    text
city            text DEFAULT 'Madrid'
category        text
google_maps_url text
google_rating   numeric(2,1)
review_count    integer
response_rate   numeric(5,2)
profile_status  text DEFAULT 'prospect'
  -- valores: prospect | visited | lead | client
created_at      timestamptz DEFAULT now()
```

### Tabla: reviews
```sql
id              uuid PK
restaurant_id   uuid FK → restaurants.id
source          text DEFAULT 'google'
author_name     text
rating          integer CHECK (rating BETWEEN 1 AND 5)
text            text
review_date     date
owner_replied   boolean DEFAULT false
reply_text      text
collected_at    timestamptz DEFAULT now()
```

### Tabla: insights
```sql
id              uuid PK
restaurant_id   uuid FK → restaurants.id
top_problems    jsonb   -- array de 3 strings
top_strengths   jsonb   -- array de 3 strings
keywords        jsonb   -- array de 5 strings
summary         text
sentiment_score numeric(4,2)  -- 0 a 10
response_quality text
generated_at    timestamptz DEFAULT now()
model_used      text DEFAULT 'gemini-2.0-flash'
```

### Tabla: field_visits
```sql
id              uuid PK
restaurant_id   uuid FK → restaurants.id
visit_date      date DEFAULT CURRENT_DATE
visited_by      text
status          text DEFAULT 'pending'
  -- valores: pending | visited | interested | rejected
owner_met       boolean DEFAULT false
demo_shown      boolean DEFAULT false
reaction_score  integer CHECK (reaction_score BETWEEN 1 AND 5)
notes           text
follow_up_date  date
```

### Tabla: survey_responses
```sql
id                  uuid PK
restaurant_id       uuid FK → restaurants.id
owner_name          text
q1_time_weekly      text
q2_tools_used       text
q3_google_importance integer CHECK (q3_google_importance BETWEEN 1 AND 5)
q4_biggest_pain     text
q5_willing_to_use   text
submitted_at        timestamptz DEFAULT now()
```

### Tabla: leads
```sql
id              uuid PK
restaurant_id   uuid FK → restaurants.id
owner_name      text
email           text
phone           text
plan_interest   text  -- basic | growth | undecided
demo_requested  boolean DEFAULT false
source          text  -- field_visit | landing | referral
created_at      timestamptz DEFAULT now()
contacted_at    timestamptz
```

---

## Apify — Actor de scraping: compass/google-maps-reviews-scraper

### Formato de URL — CRÍTICO
El actor `compass/google-maps-reviews-scraper` **requiere una URL con `placeId` embebido**.
Las URLs de coordenadas (formato `/@lat,lng,zoom`) **no funcionan** — el actor devuelve error `fid: null`.

**URL válida:**
```
https://www.google.com/maps/place/?q=place_id:ChIJ7dkd3PibQQ0RwV6PkU_5tTo
```

**URL inválida (coordenadas):**
```
https://www.google.com/maps/place/Nombre/@40.4116,-3.9205,16z   ← NO FUNCIONA
```

Para obtener la URL con `place_id` a partir del nombre de un restaurante, usar el actor
`compass/crawler-google-places` con `searchStringsArray: ["Nombre restaurante Madrid"]`.
Devuelve el `placeId` en el campo `placeId` del resultado.

El `placeId` también se puede guardar en la tabla `restaurants` para reutilizarlo.

### Input del actor (parámetros exactos)
```python
run_input = {
    "startUrls": [{"url": "https://www.google.com/maps/place/?q=place_id:<ID>"}],
    "maxReviews": 100,           # máximo de reseñas a recopilar
    "reviewsSort": "newest",     # ordenar por más recientes
    "reviewsOrigin": "google",   # solo reseñas de Google (no TripAdvisor)
    "language": "es",            # idioma de los resultados
    "personalData": True         # incluir nombre y datos del revisor
}
```

### Mapeo de campos del output al esquema de Supabase
El actor devuelve estos campos relevantes — mapeo exacto a nuestra tabla `reviews`:

| Campo Apify | Campo Supabase | Notas |
|-------------|---------------|-------|
| `name` | `author_name` | Nombre del reviewer |
| `stars` | `rating` | Puntuación 1-5 (campo `stars`, NO `rating` que viene null) |
| `text` | `text` | Texto de la reseña |
| `publishedAtDate` | `review_date` | ISO date — convertir a DATE |
| `responseFromOwnerText` | `reply_text` | Null si no respondió |
| `responseFromOwnerDate` | — | Para calcular `owner_replied` |
| `reviewOrigin` | `source` | Filtrar solo "Google" |

### Campos del lugar (para actualizar tabla `restaurants`)
| Campo Apify | Campo Supabase |
|-------------|---------------|
| `totalScore` | `google_rating` |
| `reviewsCount` | `review_count` |
| `title` | `name` (verificar) |
| `placeId` | — (guardar para referencia futura) |

### Cálculo de response_rate
```python
# owner_replied = True si responseFromOwnerText no es None
owner_replied = review.get("responseFromOwnerText") is not None
# response_rate = (reseñas_con_respuesta / total_reseñas) * 100
```

---



### Por qué Gemini API (gemini-2.0-flash) para sentimiento e insights
- Sustituye a Google Natural Language API (decisión 2026-03-05)
- Un único modelo cubre análisis de sentimiento, extracción de entidades y generación de insights
- `gemini-2.0-flash` es más rápido y barato que GPT para análisis masivo
- No requiere Google Cloud service account ni fichero de credenciales JSON
- Variable: `GEMINI_API_KEY`. Librería: `google-generativeai`
- OpenAI se reserva para generación de respuestas personalizadas (requiere creatividad y contexto del dueño)

### Por qué Supabase y no MongoDB
Los datos son relacionales: restaurante → reseñas → insights → visitas → leads. PostgreSQL maneja esto de forma natural y eficiente. Supabase añade API REST, auth y dashboard gratuito.

### Por qué la demo app es independiente de la landing
La demo app es una herramienta interna de uso durante visitas. La landing es pública. Diferentes audiencias, diferentes requisitos, diferentes despliegues.

### Principio de Privacy by Design
- Nunca identificamos personas en los análisis, solo tendencias
- Los author_name de reseñas se pueden anonimizar en producción
- No cruzamos datos personales entre restaurantes

---

## Contexto del negocio — para decisiones de producto

**Cliente objetivo:**
- Restaurante independiente con 1-5 locales
- Entre 100 y 2.000 reseñas en Google Maps
- Dueño implicado, mentalidad moderna
- Madrid y área metropolitana (fase 1)

**Planes del producto:**
- Basic (39€/mes): Smart Responder IA, Alertas WhatsApp, Sentiment Analytics, Reporte mensual
- Growth (79€/mes + hardware): Todo Basic + Shield QR, NFC, SEO Booster, Análisis competitivo

**Objetivo de la fase actual:**
Validar el problema con 20 restaurantes reales antes de construir el MVP completo. El sistema que estamos construyendo ahora es la herramienta de validación, no el producto final.

---

## Reglas de desarrollo para este proyecto

1. **Simplicidad sobre completitud** — Estamos en fase de validación. No sobreingenieres.
2. **Mobile-first siempre** — La demo app se usa desde el móvil en visitas comerciales.
3. **Datos reales desde el día 1** — Cada componente que construyas debe funcionar con datos reales de Supabase, no mocks.
4. **Un fichero .env nunca va a git** — Usa siempre .env.example con las claves vacías.
5. **Commits semánticos** — feat:, fix:, chore:, docs: como prefijos.
6. **TypeScript opcional** — Para la velocidad de esta fase, JavaScript está bien en el frontend.
7. **Sin over-engineering** — Si algo se puede hacer en 20 líneas, no uses una librería.

---

## Instrucciones para Claude Code

Al finalizar cada tarea debes:
1. Actualizar este fichero CLAUDE.md si has tomado alguna decisión técnica nueva
2. Documentar cualquier cambio en el esquema, stack o arquitectura
3. Añadir a la sección de decisiones de diseño el motivo de cada cambio importante

Ejemplos de lo que debe quedar documentado aquí:
- Cambio de librería (ej. "cambiamos Google NL API por Gemini")
- Campos del actor Apify que difieren de la documentación
- Errores conocidos y cómo se resolvieron
- Decisiones de estructura de código

**Este fichero está vivo.** Al inicio de cada sesión nueva léelo completo — contiene todo el historial de decisiones técnicas del proyecto.

---

## Estado actual del proyecto (actualizado 2026-06-13)

### Documentación técnica
- **`ROADMAP.md`** (raíz) — Plan de trabajo por fases a partir de junio 2026: motor de ingesta autónomo → informes → groundwork de publicación → WhatsApp → publicación Google, + track SEO/GEO transversal. Ver registro [2026-06-19] roadmap.
- **`PIPELINE_ARCHITECTURE.md`** (raíz del proyecto) — Arquitectura completa del pipeline documentada a partir del código fuente real. Incluye: flujo secuencial paso a paso para cada modo de entrada (`--place-id`, `--restaurant-id`, `--all`, API SSE), contratos de datos exactos (item crudo Apify → scraper output → Gemini JSON → Supabase), listado de dependencias con versiones y uso exacto de cada SDK, mecánica de deduplicación de reseñas, y tabla de responsabilidades por archivo.

### Componentes implementados y verificados
- **`pipeline/scraper.py`** — Scraping via Apify `compass/google-maps-reviews-scraper`, mapeo de campos, cálculo de response_rate.
- **`pipeline/analyzer.py`** — Análisis con `gemini-2.5-flash` via SDK `google-genai`, generación de `suggested_reply`, retry automático con tenacity.
- **`pipeline/loader.py`** — Toda la persistencia en Supabase con deduplicación robusta (review_id + fallback por par author/date).
- **`pipeline/run_pipeline.py`** — Orquestador CLI con 3 modos de entrada.
- **`pipeline/api.py`** — FastAPI con SSE para `/analyze`, `/refresh`, `/generate-reply` y `/health`.
- **`demo-app/`** — App de **cliente** autenticado (Supabase Auth + RLS). React **responsive** (sidebar escritorio / bottom-nav móvil), sistema de diseño Ocean & Lime tokenizado. 3 secciones: Resumen (con distribución), Equipo, Reseñas (solo-lectura + copiar sugerencia). Sin operativa (movida al backoffice). Ver registro [2026-06-19].
- **`backoffice/`** — App **interna** de Qinsalabs (separada de demo-app). React + React Query, desktop-responsive. Gestión de organizaciones, usuarios y onboarding de restaurantes. Consume `/admin/*` de FastAPI.
- **`pipeline/admin.py`** — Router FastAPI `/admin/*` (frontera de confianza del backoffice): valida JWT contra GoTrue, comprueba `platform_admins`, y opera con `service_role`. Incluye `GET /admin/restaurants/{id}/ingest` (SSE) para ingesta manual y `GET/PUT /admin/settings` (config operativa + estado de secretos). Ver registros [2026-06-13].
- **`pipeline/config.py`** — Lectura de `platform_settings` (config operativa editable: modelo Gemini por defecto, counts). Los secretos siguen en `.env`.

### Entorno de desarrollo: Supabase local vía CLI (decisión [2026-06-13])
- **El stack de Supabase corre en local** (Docker) durante toda la fase de validación del MVP. Promoción a la nube cuando se valide: `supabase db push`.
- **`supabase/migrations/`** es la **fuente operativa única** del esquema. Tres migraciones, todas idempotentes:
  - `20260613140000_schema_v1.sql` — esquema base v1 (copia de `database/schema.sql`).
  - `20260613140100_multitenant_v2.sql` — migración multi-tenant v2 (copia de `database/migration_multitenant.sql`).
  - `20260613140200_grants_roles.sql` — GRANTs de tabla por rol (ver registro [2026-06-13] sobre GRANT vs RLS).
  - `20260613150000_platform_admins.sql` — tabla `platform_admins` (staff de plataforma cross-tenant) + helper `app_private.is_platform_admin()`.
  - `20260613160000_platform_settings.sql` — tabla `platform_settings` (config operativa key-value editable; secretos NO van aquí, ver registro [2026-06-13] config).
  - Los ficheros en `database/` se conservan como snapshot de referencia legible. **Cambios nuevos de esquema = fichero nuevo en `supabase/migrations/`**, no editar los existentes.
- **`.env` repuntado a local** (`http://127.0.0.1:54321` + claves de `supabase status`); las credenciales de producción quedan comentadas en el mismo fichero para el futuro `db push`. Igual en `demo-app/.env`.
- **`supabase/seed.sql`** — datos de negocio de ejemplo (2 restaurantes en la org interna + contexto + reseñas) para tener algo que mostrar en local. Se aplica en `supabase start` y `supabase db reset`.
- **Comandos clave:** `supabase start` (levanta todo), `supabase db reset` (re-aplica migraciones+seed desde cero), `supabase status` (URLs y claves), Studio en `http://localhost:54323`.
- **CLI instalado** como binario en `~/.local/bin` (`supabase` + `supabase-go`, son dos ficheros; el primero es un shim que invoca al segundo). v2.106.0. No hay Homebrew en la máquina.

### Migración multi-tenant
- **`database/migration_multitenant.sql`** — Script idempotente v1→v2 (organizations, memberships, RLS estricta, histórico de insights, índices de dedupe). Verificado en PostgreSQL 15 local con tests de aislamiento RLS y replicado como migración del CLI de Supabase. Ver registro [2026-06-13].

### Usuarios de desarrollo (local)
- **Cliente** (demo-app): `dueno@elkiosko.com` / `demo1234` — `owner` de la org interna. Crear con `./scripts/seed_dev_user.sh`.
- **Staff** (backoffice): `admin@qinsalabs.com` / `qinsa1234` — platform admin. Crear con `./scripts/seed_platform_admin.sh`.
- **Re-ejecutar ambos scripts tras cada `supabase db reset`** (no recrea usuarios de auth).

### Issues conocidos pendientes
- `schema.sql` sigue siendo el snapshot v1 — regenerarlo como v2 tras aplicar `migration_multitenant.sql` en producción.
- La demo-app lee con la ANON_KEY tras login: depende de Supabase Auth (ver registro auth [2026-06-13]).

---

## Registro de decisiones técnicas

### [2026-06-24] Fix "Not found" al generar informe + historial de ejecuciones de ingesta
- **Bug "Not found" (404) en "Generar informe" — causa raíz:** el `uvicorn` del usuario se había arrancado **sin `--reload`** (`uvicorn api:app --port 8000`), antes de que se añadiera `GET /admin/.../report`. El proceso vivo no tenía esa ruta → 404 "Not Found". No era bug de código (el refresh/`/ingest` funcionaba porque existía al arrancar). **Verificado** inspeccionando el OpenAPI del proceso vivo (sin rutas `report`). **Solución:** reiniciar el API; **se relanzó con `--reload`** (logs a `/tmp/qinsa-api.log`) para que los cambios de código se recojan sin reinicios manuales. Confirmado: `/report` y `/runs` ahora responden 401 (no 404). **Lección operativa: en dev arrancar siempre `uvicorn … --reload`.**
- **Historial de ejecuciones (`ingest_runs`)** — petición del usuario para tener control del gasto Apify. Tabla nueva (migración `20260624120000`): `restaurant_id`, `trigger` (manual|scheduled), `status` (success|error), `reviews_scraped`, `reviews_inserted`, `error_message`, `created_at`. RLS/GRANTs calcados de `reports`.
- **Registro en la op canónica:** `loader.log_ingest_run` (NUNCA lanza — registrar no debe romper la ingesta) se llama desde `run_incremental_ingest` (que ahora acepta `trigger`): un `success` con scraped/inserted en cada camino de salida (incl. "0 reseñas"), y un `error` con el mensaje en el `except` antes de propagar. Como es la op compartida, cubre **manual y programada** sin duplicar. El scheduler pasa `trigger="scheduled"`; el SSE de admin, `"manual"`.
- **API + UI:** `GET /admin/restaurants/{id}/runs?limit=` (admin-gated). Backoffice: botón "Historial" en `RestaurantRow` → `components/RunHistory.jsx` (tabla: fecha · origen · estado · recopiladas · nuevas; errores con su mensaje). Se invalida `['runs', id]` al terminar cada ingesta (éxito o error) para refrescar.
- **Verificado sin gastar Apify:** rutas registradas, round-trip real de `ingest_runs` (manual/scheduled, success/error, scraped/inserted) con limpieza, build backoffice limpio (133 módulos), y servidor reiniciado sirviendo las rutas nuevas.

### [2026-06-24] Fase 2 — Vista de informes en la app de cliente (demo-app)
- **Página nueva `demo-app/src/pages/Informes.jsx`** (ruta `/informes` + item de nav "Informes"): el cliente consulta sus informes semanales **leyendo `reports` directamente por RLS** (no pasa por la API; `supabase.from('reports')` con el JWT del usuario → la política `report_member_select` filtra por organización). Ordenados por período desc, hasta 12.
- **UX (Ocean & Lime, responsive):** selector horizontal de semanas (chips) arriba; debajo, el detalle del informe seleccionado (el más reciente por defecto): (1) **narrativa de dirección** parseada en sus 3 viñetas con acento de color por bloque, (2) **métricas de la semana** (reseñas, rating, positivas, tasa de respuesta) con **flechas de variación ▲▼** coloreadas según si subir es bueno para cada métrica, (3) distribución por estrellas de la semana, (4) foco operativo desde el snapshot de insights (personal mencionado, focos a vigilar). `parseBullets` cae con elegancia a párrafo si el summary es el fallback determinista (sin viñetas).
- **Verificado:** build demo-app limpio (88 módulos); `parseBullets` probado sobre el formato real (3 viñetas → títulos/cuerpos correctos; fallback→párrafo); y **la RLS ejercitada como el usuario real**: login `dueno@elkiosko.com` → siembra de un informe (service_role) → el cliente LO LEE con `payload` jsonb completo; `anon` → permission denied. Datos de prueba limpiados. **Con esto la Fase 2 queda funcional E2E** (generación manual + scheduler semanal + persistencia + vista de cliente). El render real con un informe de Gemini lo verá el usuario al pulsar "Generar informe" en el backoffice.

### [2026-06-24] Fase 2 — Informes persistidos: botón manual + scheduler semanal
- **Decisión clave — los informes se PERSISTEN** (tabla `reports`): el scheduler nadie lo observa al ejecutarse, sus informes deben quedar guardados; y la vista de cliente (siguiente paso) solo tendrá que leer. Migración `20260623120000_reports.sql`: tabla `reports` (`restaurant_id`, `period_start/end`, `summary`, `payload jsonb`, `model_used`, `created_at`) con **UNIQUE (restaurant_id, period_start)** → idempotencia del scheduler + upsert del botón. RLS calcado de `insights` (miembros leen los suyos vía `user_can_view_restaurant`, service_role todo, anon cero) + GRANTs. `restaurants` += `auto_report_enabled`, `last_report_at`. **Aplicada en local con `supabase migration up`.**
- **Op canónica compartida (mismo patrón que `run_incremental_ingest`):** `report_generator.generate_and_store(restaurant_id, model, freeze, week_start)` = `build_weekly_report` → (freeze opcional del snapshot vivo) → `loader.save_report` (upsert + set `last_report_at`). La usan **por igual** el botón manual y el scheduler, así no divergen. `loader.save_report` / `loader.get_reports` nuevos.
- **Endpoint refactorizado:** `GET /admin/restaurants/{id}/report?freeze=` ahora delega en `generate_and_store` (genera **y guarda**). Sigue 404/500. Corre en `run_in_executor` (Gemini bloquea).
- **Programación:** `PUT /admin/restaurants/{id}/report-schedule` (toggle `auto_report_enabled`, cadencia semanal fija por producto — sin selector de frecuencia). El detalle de org devuelve `auto_report_enabled` + `last_report_at`.
- **Scheduler:** segundo job `report_tick` (cada `REPORT_TICK_HOURS=12`) junto al de ingesta. Para cada restaurante con `auto_report_enabled`, genera el informe de la **última semana completa** (`iso_week_bounds()`) **si no existe ya** (chequeo en `reports` → idempotente, no duplica ni regasta IA). Semanas sin reseñas no gastan Gemini (corto-circuito `count==0`).
- **UI backoffice (`RestaurantRow`):** botón "Generar informe" (si hay datos; muestra el resumen de 3 viñetas + período + si congeló snapshot) y toggle "Informe semanal" + "Último informe: …". `api.generateReport` (GET, `freeze=true`) y `api.updateReportSchedule`.
- **Verificado sin gastar IA:** `import api` limpio, rutas `report[GET]`/`report-schedule[PUT]` registradas, ambos jobs del scheduler definidos, **round-trip real de `reports`** (upsert idempotente no duplica, `payload jsonb` y `summary` correctos, limpieza posterior), build backoffice limpio (133 módulos). La generación real (Gemini) la dispara el usuario con el botón. **Pendiente:** vista de cliente para consultar los informes guardados.

### [2026-06-23] Fase 2 — Endpoint de informes bajo demanda (`GET /admin/restaurants/{id}/report`)
- **Endpoint nuevo en `admin.py`**, bajo la misma frontera de confianza (`require_platform_admin`): genera el informe semanal de un restaurante invocando `report_generator.build_weekly_report(restaurant_id, model=<default de plataforma>)`. El modelo se lee de la config operativa con `get_setting("default_model", …)`, no hardcodeado.
- **Parámetro `freeze` (query, bool, default false):** si `true`, además de computar el informe **congela el snapshot de insights VIVO** como fila histórica del período del informe, vía `loader.snapshot_insights(restaurant_id, live_insights, period_start, period_end)` (cierra el bucle de la deuda D1: da material a las comparativas futuras). Si aún no hay insights, devuelve `frozen=false` en vez de fallar.
- **Concurrencia:** `build_weekly_report` es síncrona y bloqueante (llama a Gemini) → se ejecuta en `run_in_executor` para no bloquear el event loop (mismo patrón que ingest/regenerate).
- **Control de errores robusto:** 404 si el restaurante no existe (select previo de `id`); 500 con log `exc_info` si el cálculo falla. La narrativa-IA tiene su propio fallback determinista dentro de `report_generator`, así que un fallo de Gemini NO produce 500 — el informe sale con resumen determinista.
- **Verificado sin gastar IA/Apify:** `import api` limpio, ruta `GET /admin/restaurants/{id}/report` registrada, scheduler de Fase 1 y endpoints `ingest`/`schedule` intactos, dependencias del endpoint resueltas. La generación real (Gemini) la dispara el usuario. **Pendiente Fase 2:** disparo programado (cron semanal sobre el scheduler) y vista en frontend (backoffice/cliente).

### [2026-06-23] Fase 2 — Narrativa de informes con Gemini ("Operativo-Accionable y de Dirección")
- **Sustituido el stub de `report_generator.py:_narrative` por integración real con `gemini-2.5-flash`** vía `google-genai` (mismo patrón que `analyzer.py`: `genai.Client` + `client.models.generate_content` + `types.GenerateContentConfig`, `temperature=0.4`, retry con tenacity `stop_after_attempt(4)`).
- **Enfoque de la narrativa (decisión del usuario):** parte de consultor de restauración a DIRECCIÓN, no marketing. El prompt obliga a EXACTAMENTE 3 viñetas con títulos literales: **Diagnóstico de Flujo** (volumen/delta/rating/balance +−), **Auditoría de Sala (Staff y Cocina)** (cruza `staff_mentions` + problemas/elogios recurrentes, señala por nombre) y **Acción SEO/GEO Recomendada** (una palanca ejecutable esta semana). Estilo directo, 1-2 frases por viñeta, prohibido el relleno corporativo, no inventar datos ausentes.
- **El prompt razona sobre datos, no impresiones:** `_build_narrative_prompt` (función PURA, testeable sin red) serializa a JSON las métricas de la semana + deltas + el snapshot de insights. Para alimentarlo, `build_weekly_report` ahora incluye un bloque `insights` (`_insights_digest`) leído del **snapshot vivo** vía el nuevo `loader.get_live_insights` (fila `period_start IS NULL`).
- **Control de errores — la IA nunca rompe el informe:** `_narrative` envuelve la llamada en try/except y, si Gemini falla o no hay `GEMINI_API_KEY`, cae al `_fallback_summary` determinista (el antiguo stub). Las métricas estructuradas son la fuente de verdad; la narrativa es enriquecimiento. `build_weekly_report(..., narrative=False)` permite el informe sin gastar IA.
- **Verificado en frío (sin gastar Gemini):** import limpio; el prompt contiene las 3 viñetas obligatorias + tono consultor + métricas/staff/keywords serializados; el fallback se dispara correctamente ante IA simulada caída; caso 0 reseñas corta antes de llamar a la IA.
- **Pendiente Fase 2:** endpoint en `admin.py`, disparo programado (cron semanal sobre el scheduler de Fase 1) y vista en frontend. La narrativa real con datos de Rosi la dispara el usuario (gasta cuota).

### [2026-06-23] D1 (históricos de insights) + esqueleto Fase 2 (informes)
- **Encrucijada resuelta (Camino A vs B):** tras la Fase 1 se evaluó "Fire-Test E2E" (activar auto-ingesta real y auditar un tick) vs "saldar D1 + arrancar Fase 2". **Decisión: Camino B.** Razón: el botón manual y el scheduler ejecutan la MISMA función (`run_incremental_ingest`), ya validada E2E con créditos sobre Rosi; re-validar gastando Apify aporta poco frente a su coste, mientras que D1 bloquea *físicamente* toda la Fase 2 y es coste cero. El Fire-Test real queda como acción de gasto consciente que dispara el usuario.
- **D1 — Históricos de insights (saldada):** se separan dos conceptos en la tabla `insights` (que ya soporta 1:N + `period_start/end` desde la migración multitenant):
  - **Snapshot VIVO** = fila con `period_start IS NULL`. La mantiene `upsert_insights` (sobrescribe en cada ingesta); es la que lee la app de cliente. **No prolifera** con cada tick del scheduler. (Antes el select-then-update era por `restaurant_id`; ahora se ancla explícitamente a la fila de period NULL, comportamiento idéntico para los datos ya existentes, que se crearon sin período.)
  - **Histórico CONGELADO** = filas con `period_start/period_end` != NULL, una por período. Las crea `snapshot_insights(restaurant_id, insights, period_start, period_end)` (siempre INSERT). Material de las comparativas.
  - Helpers nuevos en `loader.py`: `get_insights_history(restaurant_id, limit)` (filas históricas, más reciente primero) y `get_reviews_in_period(restaurant_id, start, end)` (materia prima determinista de las métricas, intervalo semiabierto `[start, end)`).
- **Esqueleto Fase 2 — `pipeline/report_generator.py`:** informe semanal con comparativa vs. semana anterior. **Métricas deterministas** (computadas desde `reviews`, sin IA): volumen, rating medio, distribución, positivas/negativas, tasa de respuesta, y deltas período-a-período. Ventanas ISO semiabiertas (`iso_week_bounds` default = última semana completa, `previous_window`). `build_weekly_report` devuelve un dict estructurado serializable; `freeze_period` congela vía `snapshot_insights`. La **narrativa en lenguaje natural es un STUB determinista marcado TODO** — se enriquecerá con Gemini en la Fase 2 para no gastar cuota mientras se valida la estructura.
- **Verificado sin gastar IA/Apify ni tocar la BD:** imports limpios; ventanas ISO (semiabierto) y aritmética de período correctas; `_period_metrics`/`_compare`/`_narrative` con casos de prueba (avg, positivas/negativas, tasa de respuesta, deltas, flechas ▲▼); query builders de PostgREST (`.is_(...,'null')`, `.not_.is_(...)`, `gte/lt`) construyen sin error. **Cold-audit extra del scheduler** (honra la decisión B): due-logic, guardarraíl 3h y parseo robusto de timestamptz verificados.
- **Pendiente Fase 2:** narrativa Gemini, endpoint en `admin.py`, disparo programado (scheduler Fase 1), vista en frontend.

### [2026-06-23] Fase 1 — Motor de ingesta autónomo (consolidación + scheduler)
- **Consolidación (deuda D2 saldada):** toda la ingesta incremental vive ahora en una **única función** `pipeline/ingest.py:run_incremental_ingest(restaurant_id, max_reviews, generate_replies, model, emit)` — síncrona, con callback `emit` de progreso. La usan **lo mismo** el botón manual (SSE) y el scheduler, así no divergen. Incluye el fix de métricas de ficha y setea `last_ingest_at` en cada ejecución.
- **SSE sobre función síncrona:** `admin.py:/ingest` corre `run_incremental_ingest` en un hilo (`run_in_executor`) y puentea su `emit` al stream con una `asyncio.Queue` + `call_soon_threadsafe`. Sentinela `_done`/`_error` para cerrar.
- **Scheduler:** `pipeline/scheduler.py` con **APScheduler** (`BackgroundScheduler`, in-process). Un tick cada 15 min relee la BD y ejecuta `run_incremental_ingest` en los restaurantes con `auto_ingest_enabled` que toquen (`last_ingest_at` + `ingest_frequency_hours`). `max_instances=1`, parse robusto de timestamptz (py3.9), guardarraíl `MIN_FREQUENCY_HOURS=3`. Arranca/para en `api.py` (`on_event` startup/shutdown). **Asume 1 worker**; con varios habría que dedicar un proceso.
- **Modelo de datos:** `restaurants` += `auto_ingest_enabled`, `ingest_frequency_hours` (default 6), `last_ingest_at` (migración `20260619140000`).
- **Endpoint:** `PUT /admin/restaurants/{id}/schedule` (valida freq 3-168h → 422). El detalle de org devuelve los 3 campos.
- **Limpieza:** eliminados de `api.py` los endpoints muertos `/analyze`, `/refresh`, `/generate-reply` (ningún frontend los usaba; la lógica está en admin + ingest). `api.py` queda mínimo: CORS + router admin + scheduler + health.
- **UI backoffice:** en `RestaurantRow`, toggle "Auto-ingesta" + selector de frecuencia + "Última: …". El "ejecutar ahora" es el botón Refresh ya existente.
- **Verificado sin gastar Apify:** imports OK, scheduler arranca (log), `/analyze` y `/refresh` → 404, `PUT /schedule` 200 + 422 en freq<3, lógica `_is_due`/`_parse_ts` correcta, build backoffice limpio (133 módulos). Rosi quedó **desactivado** para que el tick no dispare Apify. `apscheduler` añadido a requirements.

### [2026-06-19] Regenerar respuestas IA sin re-scrapear (iteración de tono)
- **Problema detectado por el usuario:** `Refresh` deduplica y solo genera `suggested_reply` para reseñas NUEVAS; tras cambiar el contexto (tono/keywords) no se re-aplica a las reseñas ya guardadas. Además `Refresh` gasta créditos de Apify aunque no haya nada nuevo.
- **Solución:** operación **separada** `GET /admin/restaurants/{id}/regenerate-replies` (SSE, admin-gated) que **NO toca Apify**: carga las reseñas ya en BD (con texto; por defecto solo `owner_replied=false`, donde la sugerencia aporta) y regenera `suggested_reply` con el contexto actual + modelo. Progreso procesadas/total. No recalcula insights (no cambian al regenerar respuestas).
- **Decisión de granularidad:** se empieza por **"regenerar todas"** (el bucle real: cambias preset → regeneras → comparas). Por-reseña/seleccionadas se difiere a cuando el backoffice tenga vista de reseñas individuales.
- **UI:** botón "Regenerar respuestas IA" en `RestaurantRow` (visible si hay reseñas) + barra de progreso; `streamRegenerate` reutiliza el lector SSE genérico `streamSSE` (refactor de `streamIngest`).
- **Verificado:** gating 401/403, endpoint registrado, targeting correcto (Rosi → 10 reseñas), build limpio. La regeneración real (Gemini) la dispara el usuario.

### [2026-06-19] Sistema de personalización de respuestas IA — guiado-híbrido
- **Decisión (confirmada con el usuario):** **guiado-primero, híbrido**. Se descartó texto libre puro (inconsistente; el hostelero no sabe escribir prompts) y guiado rígido (sin flexibilidad). La calidad la controlamos nosotros vía **presets curados**; el cliente elige, no escribe el prompt.
- **Defaults acordados:** plantilla por defecto **"cercano_desenfadado" + emojis "sutil" + idioma "mirror"** (responde en el idioma de la reseña). El feedback fue que Rosi sonaba "demasiado corporativa".
- **Catálogo (en `analyzer.py`, versionado en código):** `TONE_PRESETS` = `cercano_desenfadado` (default) · `cercano_profesional` · `elegante` (usted, sin emojis) · `de_barrio`. `EMOJI_RULES` (ninguno/sutil/expresivo), `LANGUAGE_RULES` (mirror/es). Cada preset es un fragmento de prompt nuestro; `context_options()` expone label/description al backoffice **sin** revelar los prompts.
- **Compilador `_build_reply_prompt` (función pura, testeable sin red):** compila preset + emojis + idioma + firma + **ganchos SEO** (keywords_objetivo **+** dishes, solo en reseñas 4-5★) + instrucciones libres. Refuerza anti-repetición y prohíbe aperturas genéricas/corporativas.
- **Modelo de datos** (`20260619120000_context_personalization.sql`): `restaurant_context` += `tone_preset, emoji_level, language_mode, signature, dishes`. `instructions` (texto libre, escape hatch) y `keywords_objetivo` ya existían. `signature` cae a `owner_name` → `El equipo de {nombre}`.
- **Hallazgo que motivó los `dishes`:** la inyección SEO no disparaba con reseñas genéricas por falta de material; dar **platos estrella** le da a la IA ganchos naturales además de las keywords.
- **Endpoints:** `GET/PUT /admin/restaurants/{id}/context` (admin-gated, service_role; valida preset/emoji/idioma → 422). El GET incluye el catálogo de opciones.
- **UI backoffice:** `components/ContextEditor.jsx` (selStates de tono/emoji/idioma + firma + `TagInput` de keywords y platos + instrucciones) desplegable por restaurante desde `RestaurantRow` ("Configurar IA"). Aplica en la próxima ingesta/refresh.
- **Verificado:** compilador con los 4 presets (voz/usted/emoji/idioma/SEO/firma) sin gastar Gemini; endpoints 200/422; build backoffice limpio. **Pendiente (gasta créditos, lo dispara el usuario):** re-Refresh de Rosi La Loca (ya tiene contexto sembrado: desenfadado + keywords/platos mexicanos) para ver el nuevo tono + inyección SEO + idioma espejo en acción.

### [2026-06-19] Rediseño responsive de la app de cliente + sistema de diseño Ocean & Lime
- **Contexto:** primer scrape real (El Kiosko Boadilla, 10 reseñas) validó el flujo E2E. Pero El Kiosko responde el 100% de sus reseñas → 0 sugerencias útiles; y se confirmó que la app de cliente necesitaba rediseño. Análisis de datos: insights y sugerencias IA de calidad (respetan el prompt), pero **dos hallazgos**: (1) la ficha del restaurante tenía `google_rating/review_count/response_rate` en NULL (la ingesta no las actualizaba) → Ratings vacío; (2) la **inyección SEO disparó 0 veces** (reseñas genéricas sin gancho gastronómico + guardrail anti-spam "no fuerces") → pendiente de tuning con un restaurante con reseñas que mencionen platos.
- **Sistema de diseño — Ocean & Lime (tokenizado):** paleta `#19485f` (ocean, chrome/marca) + `#d9e0a4` (lime, acento claro). Definida como **variables CSS** en `src/index.css` (formato "R G B" para `<alpha-value>`) y referenciada en `tailwind.config.js` (`ocean`/`lime` con escala 50-900). Semánticos (verde/ámbar/rojo) se conservan para datos (sentimiento, ratings). **Branding posterior = cambiar SOLO las variables.** `qinsa-*` queda como alias de compatibilidad.
- **Layout responsive (decisión del usuario):** **sidebar lateral en escritorio (`lg`) + bottom-nav fijo en móvil**. `components/AppLayout.jsx` (Outlet) + `Sidebar.jsx` (desktop) + `BottomNav.jsx` (`lg:hidden fixed bottom-0`). Marco `max-w-[430px]` eliminado. Header con **selector de restaurante** (`RestaurantSwitcher.jsx`, auto si solo hay 1) que reemplaza la pestaña "Buscar". `lib/RestaurantContext.jsx` carga los locales del usuario (RLS) y persiste la selección.
- **IA consolidada a 3 secciones** (antes 5): **Resumen** (fusiona la antigua "Ratings"/Distribución), **Equipo**, **Reseñas**. Kit de UI compartido en `components/ui.jsx` (Card, SectionLabel, PageHeader, EmptyState).
- **Features operativas movidas FUERA del cliente** (van al backoffice/onboarding): pestaña "Nuevo" (análisis por place_id), botón "Actualizar"/refresh, y **selector de modelo Gemini**. La app de cliente queda **solo-lectura + copiar respuesta sugerida**. Eliminados `pages/Home.jsx`, `Onboarding.jsx`, `Distribucion.jsx`.
- **Fix de datos:** `admin.py` (ingesta) ahora actualiza `google_rating/review_count/response_rate` de la ficha desde `place_data` del scraper (arregla el Ratings vacío en la próxima ingesta).
- **Verificado E2E en navegador real** (jefe@boadilla.com) a 1280/800/375 px: sidebar+grid en escritorio, bottom-nav fijo + columna única en móvil, login Ocean&Lime, 0 errores de consola, build Vite limpio (87 módulos).
- **Pendiente (siguiente fase, acordado):** onboarding de un restaurante con reseñas **sin responder** → validar sugerencias IA visibles + tuning de inyección SEO + insights. El branding (logos, afinar paleta) es fase posterior; el camino queda preparado (solo tocar tokens).

### [2026-06-14] Redefinición estratégica — Motor SEO/GEO Local (sobre base multi-tenant ya construida)
- **Reposicionamiento:** Qinsa pasa de "gestor pasivo de reseñas" a **motor de posicionamiento (SEO Local) + optimización para motores de IA (GEO/AEO)**, sobre la arquitectura multi-tenant que ya existe. Documento de producto recibido el 2026-06-14.
- **CLAVE — el documento de producto daba por construir cosas ya hechas.** Sus secciones 4 (modelo de datos) y 5 (ejecución) describen el multi-tenant como pendiente, pero ya está implementado y verificado (junio 2026): `organizations`/`memberships`, `restaurants.organization_id NOT NULL`, `insights` sin UNIQUE + histórico (`period_start/period_end`), índice de dedup `uq_reviews_restaurant_review_id`, `restaurant_context` formalizado, RLS por `auth.uid()`. **No re-ejecutar esa parte.** Lo único nuevo a nivel de datos es `restaurant_context.keywords_objetivo`.
- **Planes comerciales:** Basic 39€/mes/local (reputación + inbox + alertas + asistente IA manual) · Growth 79€/mes/local (+ keyword injection, auto-pilot, auditoría GEO, mapeo RRHH avanzado, hardware QR/NFC). Gating sobre `organizations.plan` (ya existe: basic/growth).
- **Valoración de feasibility (verdictos):**
  - **Keyword Injection (SEO activo) 🟢** — barato, alto valor, bajo riesgo. Inyectar 1-2 keywords de `keywords_objetivo` orgánicamente en las respuestas IA. Riesgo: sobreoptimizar = spam; mitigación = 1-2 términos máx.
  - **Auditoría GEO/AEO 🟡** — **enfoque decidido: GEO como metodología que ejecutamos + explicación clara al cliente, NO un score sintético** (evita métrica vanidosa desmentible). El mensaje probabilístico debe respaldarse con palancas reales (consistencia keywords, recencia/volumen reseñas, sentiment, info estructurada, NAP). "Verificar con sus ojos" = feature opcional on-demand FUTURA, solo contra modelo con grounding (Perplexity / Gemini+Search); sirve también de prueba antes/después interna.
  - **Piloto Automático (auto-publicar en Google) 🔴** — el más arriesgado. Apify scrapea pero NO publica; publicar respuestas exige **Google Business Profile API + OAuth por cliente + aprobación de Google**. NO es "fricción cero". **Enfoque decidido: manual primero, luego coexistencia con toggle por cliente.** Frontera de coste real = la GBP write API, compartida por "un clic manual" y "auto"; v1 = copy/paste (cero dep Google, casi hecho en demo-app), luego spike GBP, y al activarla se desbloquean ambos modos (toggle por restaurante y por rating, auto solo 5★).
  - **WhatsApp (alertas/aprobación) 🟡** — integración nueva (Meta Cloud/Twilio), factible.
  - **Frecuencia de ingesta 3h/1h 🟡** — necesita scheduler; **aviso de economía:** scrapear cada hora × N locales puede comerse el margen Apify y es overkill (los locales no reciben reseñas cada hora). Tratar como gancho comercial, no necesidad técnica; cada 3-6h sobra.
  - **Hardware QR/NFC 🟢 software trivial / 🔴 "Shield"** — generar QR a la URL de reseña es trivial; *filtrar* (felices→Google, descontentos→privado) es **review gating, prohibido por Google**. Diseñar como "facilitar reseña", no filtrar.
- **Roadmap revisado (orden acordado con el usuario):**
  1. **Keyword Injection** (en curso): columna `keywords_objetivo` + refactor `analyzer.py` + probar con scrape real. ← primer paso elegido.
  2. Ejecuciones manuales / primer scrape real (lo que estábamos a punto de hacer).
  3. UI de edición de `restaurant_context` (tono, instrucciones, keywords) — "Configuración del Local" del cliente.
  4. Auto-publicación: v1 manual (copy/paste, ya) → spike GBP API → coexistencia manual+auto con toggle.
  5. Auditoría GEO (metodología + sonda opcional grounded).
  6. Scheduler de ingesta por plan + integración WhatsApp.
  7. `schema.sql` v2 snapshot (deuda pendiente).

### [2026-03-05] Migración de Google Natural Language API a Gemini API
- **Motivo:** Gemini cubre sentimiento, entidades e insights en un solo modelo, sin necesidad de Google Cloud service account ni fichero de credenciales JSON.
- **Modelo:** `gemini-2.0-flash`
- **Librería:** `google-generativeai` (reemplaza `google-cloud-language`)
- **Variable de entorno:** `GEMINI_API_KEY` (reemplaza `GOOGLE_APPLICATION_CREDENTIALS` + `GOOGLE_CLOUD_PROJECT`)
- **Ficheros afectados:** `pipeline/analyzer.py`, `requirements.txt`, `env.example`
- **Campo `model_used` en tabla `insights`:** cambia default de `'google-natural-language'` a `'gemini-2.0-flash'`

### [2026-03-05] Formato de URL para el actor de Apify
- **Problema descubierto:** El actor `compass/google-maps-reviews-scraper` no acepta URLs de coordenadas (formato `/@lat,lng,zoom`). Devuelve error `fid: null` y 0 reseñas.
- **Causa:** La URL compartida desde Google Maps (`/place/Nombre/@lat,lng,zoom`) no contiene el `placeId` embebido que el actor necesita para identificar el lugar.
- **Solución:** Usar la URL con `place_id` explícito: `https://www.google.com/maps/place/?q=place_id:<ID>`
- **Cómo obtener el `place_id`:** Con el actor `compass/crawler-google-places`, pasando `searchStringsArray: ["Nombre restaurante Madrid"]`. El campo `placeId` del resultado es el ID que necesitamos.
- **Ejemplo real verificado:** EL KIOSKO | Boadilla → `placeId: ChIJ7dkd3PibQQ0RwV6PkU_5tTo`
- **Acción pendiente:** Añadir columna `place_id text` a la tabla `restaurants` para almacenar el ID y reutilizarlo sin tener que buscarlo cada vez.

### [2026-03-05] Token del MCP de Supabase
- **Problema:** La `service role key` del proyecto (`sb_secret_...`) no sirve para el MCP de Supabase. El servidor MCP usa la Management API de Supabase, que requiere un Personal Access Token (PAT) diferente.
- **PAT format:** `sbp_...` — se obtiene en `app.supabase.com/account/tokens`
- **Service role key** (`sb_secret_...`) solo sirve para el cliente Supabase en Python/JS (PostgREST API).

### [2026-03-05] Estructura del scraper — separación de responsabilidades
- `_extract_place_data(item)` — extrae datos del lugar (rating, count, placeId) del primer item
- `_map_review(item)` — mapea exactamente los campos Apify → Supabase según CLAUDE.md
- El filtro `reviewOrigin` se aplica en el loop aunque el input ya pida `reviewsOrigin: "google"`, como defensa en profundidad
- Items sin `stars` ni `text` se ignoran (son registros de lugar, no reseñas)

### [2026-03-05] Migración de google-generativeai a google-genai (SDK nuevo)
- **Motivo:** La librería `google-generativeai` está deprecada. El SDK nuevo es `google-genai`.
- **Librería anterior:** `google-generativeai==0.8.3` → devuelve FutureWarning en cada import
- **Librería nueva:** `google-genai>=1.47.0` (instalada como `from google import genai`)
- **Cambio de API:**
  - Antes: `genai.configure(api_key=...)` + `genai.GenerativeModel(MODEL).generate_content(...)`
  - Ahora: `client = genai.Client(api_key=...)` + `client.models.generate_content(model=MODEL, contents=..., config=types.GenerateContentConfig(...))`
- **requirements.txt:** actualizado a `google-genai>=1.47.0`

### [2026-03-05] Modelo Gemini actualizado a gemini-2.5-flash
- **Motivo:** El cupo diario del free tier de `gemini-2.0-flash` se agotó durante el desarrollo. `gemini-2.5-flash` es la versión más reciente, tiene cuota separada y es superior en capacidad de razonamiento.
- **Modelo anterior:** `gemini-2.0-flash` → campo `model_used` en tabla `insights`
- **Modelo actual:** `gemini-2.5-flash`
- **Impacto:** El campo `model_used` en la tabla `insights` guardará `'gemini-2.5-flash'`. El default de la columna en Supabase sigue siendo `'gemini-2.0-flash'` — se sobreescribe en cada insert desde el pipeline.
- **Nota:** Si se activa billing en Google AI Studio, `gemini-2.0-flash` podría volver a ser viable por su menor coste. La constante `MODEL` en `analyzer.py` es fácil de cambiar.

### [2026-03-05] Estructura del analyzer — decisiones de diseño
- `rating_distribution` se calcula localmente (no gasta tokens de IA) desde los datos del scraper
- `top_problems` y `top_strengths` pueden tener menos de 3 entradas si Gemini no detecta suficientes patrones recurrentes (correcto — mejor pocos específicos que relleno genérico)
- El prompt instruye a Gemini a distinguir problemas estructurales vs incidentes puntuales
- Las respuestas del dueño se incluyen en el prompt para que Gemini analice `response_quality`
- Test verificado con 20 reseñas reales de EL KIOSKO | Boadilla: sentiment=7.4, 4 empleados detectados (Roxana×3, Julio×3, Alejandro×2, Fran×2), respuesta en JSON válido
- `staff_mentions` incluye citas literales de reseñas como `sample_quotes`
- `recurring_issues` puede estar vacío si no hay patrones secundarios suficientes (comportamiento correcto)

### [2026-03-05] supabase-py actualizado a >=2.28.0
- **Problema:** `supabase==2.10.0` rechazaba la `service_role_key` con formato `sb_secret_...` (nuevo formato de Supabase). Error: `Invalid API key`.
- **Causa:** La librería v2.10.0 solo validaba claves en formato JWT (`eyJ...`). El nuevo formato de Supabase para `service_role_key` es `sb_secret_...`, que no es un JWT.
- **Solución:** `pip install --upgrade supabase` → v2.28.0 acepta ambos formatos.
- **requirements.txt:** cambiado a `supabase>=2.28.0`.
- **Nota:** La `SUPABASE_ANON_KEY` sigue siendo JWT (`eyJ...`). Solo la `SERVICE_ROLE_KEY` usa el nuevo formato.

### [2026-03-05] Estructura del loader — decisiones de diseño
- `upsert_restaurant(place_data, google_maps_url)` usa `google_maps_url` como clave de deduplicación con select-then-insert (no upsert de BD, ya que no hay unique constraint en esa columna)
- `insert_reviews_deduped(restaurant_id, reviews)` carga pares `(author_name, review_date)` existentes y filtra antes de insertar — evita duplicados sin necesitar unique constraint en BD
- `upsert_insights(restaurant_id, insights)` hace select-then-insert/update — los campos extra del analyzer (`staff_mentions`, `rating_distribution`, `recurring_issues`, `recurring_praise`) se omiten al persistir (no están en el schema de Supabase)
- Los campos jsonb (`top_problems`, `top_strengths`, `keywords`, `staff_mentions`, `rating_distribution`, `recurring_issues`, `recurring_praise`) se pasan como listas/dicts Python — supabase-py serializa a JSON automáticamente
- Migración aplicada [2026-03-06]: columnas `staff_mentions`, `rating_distribution`, `recurring_issues`, `recurring_praise` añadidas a la tabla `insights` via SQL dashboard de Supabase

### [2026-03-05] run_pipeline.py — flujo --place-id
- `--place-id ChIJ...` construye la URL con `PLACE_URL_TEMPLATE` y crea el restaurante en Supabase si no existe
- `--restaurant-id <uuid>` procesa un restaurante ya registrado usando su `google_maps_url` de la BD
- `--all` itera todos los prospects de Supabase
- Test verificado: El Kiosko Boadilla — 50 reseñas scrapeadas, 50 insertadas, insights en Supabase con sentiment=7.8, 4 empleados detectados (Alejandro×7, Julio×7, Roxana×5, Fran×2)

### [2026-06-12] Auditoría del modelo de datos — preparación para migración multi-tenant
- **Documento generado:** `DATABASE_MODEL.md` en la raíz del proyecto.
- **Alcance:** Mapa de relaciones de las 6 tablas, análisis de las 8 políticas RLS activas, e informe técnico de las 6 limitaciones estructurales que impiden el soporte nativo multi-tenant.
- **Hallazgos clave:**
  - El rol `authenticated` (Supabase Auth) no tiene ninguna política RLS — un usuario logueado no puede acceder a sus propios datos por el canal de autenticación estándar.
  - `restaurants` no tiene `owner_id` ni `tenant_id` — imposible filtrar por propietario en RLS.
  - `insights.restaurant_id` tiene constraint UNIQUE — impide histórico de análisis por período.
  - `field_visits.visited_by` es texto libre — no es FK a un usuario real.
  - Faltan: tabla `tenants`, tabla `user_restaurant_memberships`, índice en `reviews.review_id`.
  - `schema.sql` está desactualizado — no refleja las columnas añadidas en marzo 2026 (`review_id`, `suggested_reply` en reviews; `staff_mentions`, `rating_distribution`, `recurring_issues`, `recurring_praise` en insights; tabla `restaurant_context`).
- **Impacto en la fase actual:** Ninguno — el esquema es correcto para la validación con un único operador interno usando `service_role`.
- **Acción futura:** Ejecutar la migración multi-tenant antes de incorporar el primer cliente real del MVP. Ver sección 3.8 de `DATABASE_MODEL.md` para la lista completa de cambios necesarios.

### [2026-06-13] Migración multi-tenant v2 — `database/migration_multitenant.sql`
- **Qué es:** Script SQL idempotente y no destructivo que transforma el esquema plano de validación en el modelo multi-tenant del MVP. Verificado en PostgreSQL 15 (Docker) con doble ejecución (idempotencia) y suite de tests de aislamiento RLS con usuarios simulados.
- **Topología de tenancy:** `organizations` → `memberships(user_id, organization_id, role)` → `restaurants.organization_id`. La membresía se ancla a nivel de organización (no de restaurante): cubre dueño independiente (N=1 sin penalización), grupo gastronómico y agencia. Roles como ENUM nativo `org_role`: `owner | admin | member | viewer`. Granularidad por-restaurante diferida: se añadiría con una columna opcional `restaurant_id` en `memberships` sin romper nada.
- **Organización interna con UUID fijo:** `00000000-0000-0000-0000-000000000001` ("Qinsalabs Internal", plan `internal`). `restaurants.organization_id` es `NOT NULL DEFAULT <ese uuid>` → **el pipeline Python actual sigue funcionando sin cambios**: los restaurantes nuevos caen automáticamente en la organización interna. Convertir un prospect en cliente real = `UPDATE restaurants SET organization_id = ...`.
- **RLS con helpers `SECURITY DEFINER`:** funciones en schema `app_private` (no expuesto por PostgREST): `user_org_ids()`, `user_has_org_role()`, `user_can_view_restaurant()`, `user_manages_restaurant()`. Evitan la recursión infinita de políticas sobre `memberships` y se evalúan una vez por statement (InitPlan). Se usa `(SELECT auth.uid())` por rendimiento.
- **Matriz de acceso `authenticated`:** lectura de restaurantes/reseñas/insights/contexto para cualquier miembro de la organización; escritura de restaurantes y `restaurant_context` solo `owner|admin`; `UPDATE` de reviews para miembros (aprobar suggested_reply); `field_visits`, `survey_responses` y `leads` (PII/GDPR) solo `owner|admin`; INSERT de reseñas e insights exclusivo del pipeline (`service_role`). Alta de organizaciones y primera membresía: solo backoffice via `service_role`.
- **⚠ BREAKING CHANGE:** se eliminan `anon_select_restaurants` y `anon_select_insights` (`USING (true)`). La demo-app deja de leer con la ANON_KEY — debe migrar a Supabase Auth o consumir la API FastAPI. Hay un bloque transitorio comentado en el script para re-habilitar lectura anon limitada a la organización interna durante visitas comerciales.
- **Histórico de insights:** eliminada la constraint UNIQUE de `insights.restaurant_id` (relación pasa de 1:1 a 1:N); añadidas `period_start`/`period_end` (NULL = snapshot completo) e índice `(restaurant_id, generated_at DESC)`. El select-then-update del loader sigue funcionando, pero ahora puede pasarse a insert-always para acumular histórico.
- **Deduplicación en BD:** índice único parcial `uq_reviews_restaurant_review_id ON reviews(restaurant_id, review_id) WHERE review_id IS NOT NULL`. Elimina el seq scan del loader, garantiza el dedupe a nivel de BD (antes solo defensivo en Python) y habilita migrar el loader a `ON CONFLICT DO NOTHING`.
- **Consolidación de columnas en caliente:** `reviews.review_id`, `reviews.suggested_reply`, `insights.staff_mentions/rating_distribution/recurring_issues/recurring_praise` declaradas con `ADD COLUMN IF NOT EXISTS`; tabla `restaurant_context` formalizada (PK, UNIQUE en `restaurant_id`, `updated_at` con trigger); añadido `restaurants.place_id` (cierra la acción pendiente de marzo).
- **`field_visits`:** añadida `visited_by_user_id uuid FK → auth.users` con `ON DELETE SET NULL`; `visited_by` (text) se conserva como dato legacy de la fase de validación.
- **Tests verificados en local:** aislamiento total entre 2 organizaciones (usuario A no ve restaurantes/reseñas/leads de B), rol `member` no puede UPDATE en restaurants (0 filas afectadas), `anon` ve 0 filas en todo, 2 insights históricos conviven para el mismo restaurante, y un `review_id` duplicado es rechazado con `unique_violation`.
- **Post-migración manual:** crear la membresía `owner` del admin interno (template comentado al final del script) y regenerar `schema.sql` como snapshot v2 (pendiente).
- **Estado:** script creado y verificado localmente. **Pendiente de ejecutar en Supabase producción.**

### [2026-06-13] Configuración editable: operativa en DB, secretos en .env
- **Decisión (confirmada con el usuario):** dos niveles. **Config operativa** (modelo Gemini por defecto, nº de reviews de refresh/histórico) → tabla `platform_settings` editable desde el backoffice. **Secretos** (`APIFY_API_TOKEN`, `GEMINI_API_KEY`) → siguen en `.env` del servidor (fuente de verdad); el backoffice solo muestra su **estado enmascarado** (`configurado` + pista de los últimos 4 caracteres), nunca editables por web. Se descartó guardar secretos en DB en texto plano (regresión de seguridad).
- **Tabla `platform_settings`** (`20260613160000`): key-value con valor `jsonb`, solo `service_role`, defaults sembrados (`default_model=gemini-2.5-flash`, `default_refresh_count=10`, `default_historical_count=100`). Helper `pipeline/config.py` (`get_setting`/`get_all_settings`) con fallback a default.
- **Endpoints:** `GET /admin/settings` (config + `allowed_models` + estado de secretos enmascarado) y `PUT /admin/settings` (valida modelo contra `ALLOWED_MODELS` y rangos de counts). `admin.py` importa de `config.py`.
- **La config alimenta la ingesta:** `RestaurantRow` lee `['settings']` (React Query) y usa `default_model` + counts configurados en sus botones, en vez de valores hardcodeados.
- **Bug encontrado y corregido — CORS:** el `PUT` desde el navegador fallaba con "Failed to fetch" porque el `CORSMiddleware` de `api.py` solo permitía `GET, POST, OPTIONS`. El preflight de `PUT` se bloqueaba (curl no lo detectó porque no hace preflight). Añadido `PUT, DELETE` a `allow_methods`. **Lección:** verificar mutaciones desde el navegador real, no solo con curl.
- **Verificado E2E en navegador real:** página Configuración renderiza config editable + secretos enmascarados; cambiar el modelo y Guardar persiste en DB (confirmado vía API); modelo inválido → 422.

### [2026-06-13] Ingesta manual desde el backoffice — un endpoint, dos perillas
- **Insight de diseño:** las 3 acciones que pedía el operador (primera ingesta del onboarding, carga histórica, refresh manual) son **la misma operación** parametrizada por `max_reviews` y `generate_replies`. No se proliferan endpoints:
  - Primera ingesta / Refresh: `max_reviews=10`, `generate_replies=true` (reseñas frescas que el dueño querrá responder).
  - Carga histórica: `max_reviews=100`, `generate_replies=false` (reseñas viejas solo construyen insights/contexto; generar 100 respuestas quemaría cuota de Gemini sin sentido).
- **Endpoint:** `GET /admin/restaurants/{id}/ingest?max_reviews=&generate_replies=&model=` en `admin.py`, admin-gated, **SSE** (3 pasos: scraping → análisis → guardado). Orquesta `scrape_reviews` + dedupe + `generate_suggested_reply` (condicional) + `analyze_reviews`/`upsert_insights`, reutilizando las funciones modulares del pipeline.
- **SSE con auth — por qué fetch+stream y no EventSource:** `EventSource` no admite el header `Authorization`, así que no puede mandar el JWT del staff. El backoffice consume el SSE con `fetch` + `ReadableStream` (`streamIngest` en `src/lib/api.js`), que sí permite el Bearer. La app de cliente sí usa `EventSource` porque sus endpoints (`/refresh`, `/analyze`) son abiertos.
- **No se auto-dispara Apify en el onboarding:** el alta crea el restaurante; la ingesta es una acción **explícita y visible** (botón con progreso) para que el operador controle cuándo gasta créditos de Apify. UI: `components/RestaurantRow.jsx` muestra "Primera ingesta (10)" o "Refresh (10)" según haya datos, más "Carga histórica (100)"; al terminar invalida `['organization', id]` (React Query) y refresca conteos.
- **`/refresh` (api.py) intacto:** lo usa la app de cliente (Resenas.jsx); la ingesta admin se mantiene separada para no acoplar el camino del cliente al del backoffice (duplicación menor y justificada; consolidación futura posible).
- **Verificado sin gastar créditos:** gating 401/403/200, SSE en vivo y validación (restaurante sin `google_maps_url` → error por SSE sin llamar a Apify), y render de los controles en navegador real. El camino feliz (Apify+Gemini reales) queda listo para dispararse con un clic; no se ejecutó para no gastar la cuota del usuario.

### [2026-06-13] Backoffice interno separado, con FastAPI como frontera de service_role
- **Decisión de producto:** el **backoffice interno** (`backoffice/`) es una app **separada** de la app de cliente (`demo-app/`). Audiencias, despliegues y modelos de acceso distintos. El cliente usa `authenticated` + RLS; el staff usa el backoffice.
- **Por qué un backend (FastAPI) y no un frontend directo:** las operaciones del backoffice (crear organizaciones, dar de alta el primer usuario de un cliente, asignar restaurantes a cualquier org) son justo las que el RLS reserva a `service_role`. Y `service_role` **nunca** puede vivir en un navegador. Por eso el backoffice llama a FastAPI, que es la **única frontera de confianza**: el navegador del staff se autentica como `authenticated` normal vía Supabase Auth, manda su JWT, y FastAPI valida + autoriza + opera con service_role.
- **Modelo de staff — tabla `platform_admins` (explícito > implícito):** un admin de plataforma tiene poderes **cross-tenant**, ortogonales a la membresía de un tenant. Se modela como tabla propia (`platform_admins(user_id)`), NO reutilizando la membresía de la org interna (que conflaría "trabajo en Qinsalabs" con "puedo administrar todos los tenants"). Migración `20260613150000_platform_admins.sql`. Gestionada solo por service_role; helper `app_private.is_platform_admin()` para RLS futuras.
- **Cadena de autorización (`pipeline/admin.py`):** dependencia `require_platform_admin` → (1) extrae Bearer, (2) valida el JWT contra GoTrue (`/auth/v1/user`; los tokens son ES256/JWKS, por eso se valida server-side y no con secret local), (3) comprueba `platform_admins` con service_role. Sin token → 401; usuario no-admin → 403; staff → 200. **Verificado E2E** con los 3 actores.
- **Endpoints `/admin/*`:** `GET /me`, `GET/POST /organizations`, `GET /organizations/{id}` (detalle con miembros+restaurantes, emails resueltos vía admin API de GoTrue), `POST /organizations/{id}/members` (crea/encuentra usuario + membresía), `POST /organizations/{id}/restaurants` (onboarding por place_id; la primera ingesta se dispara aparte con `GET /refresh?restaurant_id=`). Listados sin N+1 (conteos con 2 queries + Counter).
- **Frontend (`backoffice/`):** stack igual que demo-app (Vite+React+Tailwind+router) **+ React Query** (caché, refetch, invalidación en mutaciones = refresco fluido). **Desktop-responsive**, no el marco mobile. Puerto 5174. `src/lib/api.js` adjunta el JWT del staff a cada llamada y normaliza errores (`ApiError` con status). **Verificado E2E en navegador real:** login staff → lista de orgs con conteos → detalle (usuario owner + restaurante) → crear org desde la UI refresca la lista al instante.
- **Aislamiento confirmado:** el owner de un cliente creado por el backoffice (`jefe@boadilla.com`) ve solo su restaurante; el cliente interno sigue viendo solo los suyos.
- **Deps nuevas:** `httpx` (directo en admin.py) y `tenacity` (deuda pendiente de analyzer) añadidas a `requirements.txt`.

### [2026-06-13] Auth en la demo-app con Supabase Auth (invite-only, email+password)
- **Decisión de producto:** acceso **invite-only** (sin registro público en la UI). Los clientes se dan de alta manualmente desde el backoffice/visita comercial. Login con email+password (no magic-link). Reversible si más adelante se quiere auto-registro.
- **Cambio conceptual de la app:** de herramienta interna anónima (navegar todos los restaurantes con la ANON_KEY) a **app de cliente autenticado** que ve solo su organización. Las queries de datos **no cambiaron**: al autenticarse, supabase-js adjunta el JWT y el RLS filtra por organización automáticamente. El único trabajo fue poner la app detrás de login.
- **Ficheros nuevos:** `src/lib/AuthContext.jsx` (provider de sesión: `getSession` + `onAuthStateChange`, expone `session/user/signIn/signOut`), `src/pages/Login.jsx` (formulario branded). Modificados: `src/App.jsx` (`AuthProvider` + guard `RequireAuth` que redirige a `/login` conservando destino + ruta pública `/login`), `src/pages/Home.jsx` (botón Salir + email en cabecera).
- **Usuario de dev:** `scripts/seed_dev_user.sh` crea (idempotente, vía admin API de GoTrue) `dueno@elkiosko.com` / `demo1234` y lo ancla como `owner` de la org interna. **Re-ejecutar tras cada `supabase db reset`** (el reset no recrea usuarios de auth; el seed.sql no los toca por fragilidad del esquema de GoTrue).
- **Marco mobile `max-w-[430px]` conservado a propósito** — el rediseño responsive (siguiente fase) lo eliminará; no se medio-hizo aquí.
- **Verificado E2E en navegador real:** sin sesión la raíz redirige a `/login`; login correcto → Home con los 2 restaurantes de la organización vía RLS; build de Vite limpio (84 módulos). `anon` sigue bloqueado (`42501`).

### [2026-06-13] Entorno de desarrollo local: stack de Supabase vía CLI (no Postgres plano)
- **Decisión:** Para la nueva versión multi-tenant se desarrolla contra el **stack local de Supabase** (`supabase start`, todo en Docker), no contra un Postgres plano ni directamente contra la nube. Promoción a producción cuando se valide: `supabase db push`.
- **Por qué no Postgres plano:** el modelo de seguridad v2 (RLS + `auth.uid()` + roles `anon`/`authenticated`/`service_role` + PostgREST) son primitivas de Supabase. Sobre Postgres plano habría que **simularlas con un stub** (como en el test de Docker de la migración), validando el producto contra un modelo de auth que no es el real — justo la parte más cara si falla. Además se perdería PostgREST (la API REST que la demo-app ya consume) y GoTrue (login/JWT multi-tenant).
- **Por qué el CLI y no la nube directamente:** el CLI levanta la plataforma **entera** en local (Postgres 17 + GoTrue + PostgREST + Studio + Kong + Realtime + Storage), gratis, rápido y offline. Mismas primitivas que producción → cero sorpresas en la migración.
- **Frontera de seguridad elegida:** la **base de datos** (RLS), no la capa FastAPI. Se descartó mover la auth a la API porque dejaría el RLS v2 como peso muerto; queda como alternativa documentada si en el futuro se prescinde de Supabase Auth.
- **Estructura creada:** `supabase/config.toml` (Postgres major_version 17), `supabase/migrations/` (2 migraciones bootstrap idempotentes = fuente operativa única), `supabase/seed.sql` (datos demo). Los `database/*.sql` quedan como snapshot de referencia.
- **CLI:** instalado como binario en `~/.local/bin` (`supabase` shim + `supabase-go`; **ambos ficheros son obligatorios** — el shim falla con "supabase-go not found alongside the shim" si falta el segundo). v2.106.0. La máquina no tiene Homebrew.

### [2026-06-13] GRANTs de tabla vs RLS — hallazgo al validar contra el stack real
- **Problema:** Al probar la migración v2 contra el stack local de Supabase (no el stub de PostgreSQL que usé al escribirla), TANTO `service_role` (pipeline) COMO `authenticated` (miembro logueado) recibían `permission denied for table ...` — el RLS ni se evaluaba.
- **Causa raíz:** RLS y GRANT son **dos capas independientes**. El GRANT decide si el rol puede *tocar* la tabla; el RLS decide *qué filas*. En hosted Supabase los GRANT a `anon/authenticated/service_role` llegan vía *default privileges* preconfigurados; en el stack local del CLI esos defaults no se aplicaron a las tablas creadas por nuestras migraciones. El test inicial pasó porque usé el rol `postgres` (superusuario), que salta ambas capas.
- **Lección:** validar el modelo de seguridad **con los roles reales** (`SET ROLE authenticated/anon` y vía PostgREST por HTTP), nunca como superusuario. El stub de Docker enmascaraba el problema porque incluía un `GRANT ... TO authenticated, anon` manual.
- **Solución:** nueva migración `supabase/migrations/20260613140200_grants_roles.sql` que concede privilegios explícitamente (sin depender de default privileges): `service_role` → ALL; `authenticated` → exactamente lo que requiere cada política RLS; `anon` → REVOKE ALL (acceso cero post-v2). Es una migración separada, no una edición de la v2, respetando el principio de migraciones inmutables.
- **Verificación E2E vía PostgREST (HTTP, el camino real del pipeline y la app):** `service_role` lee 2 restaurantes y hace INSERT (201); `authenticated` miembro ve su organización y puede UPDATE de `suggested_reply`; `authenticated` sin membresía ve 0 filas; `anon` → `42501 permission denied`.

### [2026-03-10] Mejoras Funcionales del MVP Frontend
- **Filtros de Reseñas:** Añadidos filtros para aislar reseñas por "Todas", "Sin responder", "Positivas" y "Negativas", lo cual es clave para la demostración del problema en visitas comerciales.
- **Flujo "Copiar respuesta":** Se añadió un botón de portapapeles en la sugerencia IA. Al hacer clic, copia el texto y simula localmente el cambio interno de estado a "Respondida", para cerrar el ciclo en las demos.
- **Resumen Completo:** La vista de Resumen incorpora las Palabras Clave (`keywords`) directamente desde `insights` y mapea las 3 últimas reseñas como timeline de "Actividad reciente" unificando los datos extraídos de la BD en una sola request concurrente `Promise.all`.
- **Nuevo Modelo en UI:** Añadida la opción `gemini-flash-lite-latest` al frontend ("Flash Lite Ilimitado") como salvavidas anti-agotamiento de cuota de la capa gratuita, y configurada la captura limpia del error HTTP 429 en `api.py`.
