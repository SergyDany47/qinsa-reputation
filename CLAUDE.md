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

## Estado actual del proyecto (actualizado 2026-06-12)

### Documentación técnica
- **`PIPELINE_ARCHITECTURE.md`** (raíz del proyecto) — Arquitectura completa del pipeline documentada a partir del código fuente real. Incluye: flujo secuencial paso a paso para cada modo de entrada (`--place-id`, `--restaurant-id`, `--all`, API SSE), contratos de datos exactos (item crudo Apify → scraper output → Gemini JSON → Supabase), listado de dependencias con versiones y uso exacto de cada SDK, mecánica de deduplicación de reseñas, y tabla de responsabilidades por archivo.

### Componentes implementados y verificados
- **`pipeline/scraper.py`** — Scraping via Apify `compass/google-maps-reviews-scraper`, mapeo de campos, cálculo de response_rate.
- **`pipeline/analyzer.py`** — Análisis con `gemini-2.5-flash` via SDK `google-genai`, generación de `suggested_reply`, retry automático con tenacity.
- **`pipeline/loader.py`** — Toda la persistencia en Supabase con deduplicación robusta (review_id + fallback por par author/date).
- **`pipeline/run_pipeline.py`** — Orquestador CLI con 3 modos de entrada.
- **`pipeline/api.py`** — FastAPI con SSE para `/analyze`, `/refresh`, `/generate-reply` y `/health`.
- **`demo-app/`** — React app mobile-first con filtros de reseñas, flujo "copiar respuesta", vista Resumen con keywords e historial.

### Issue conocido pendiente
- `tenacity` está importado en `analyzer.py` pero no está en `requirements.txt`. Debe añadirse.

---

## Registro de decisiones técnicas

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

### [2026-03-10] Mejoras Funcionales del MVP Frontend
- **Filtros de Reseñas:** Añadidos filtros para aislar reseñas por "Todas", "Sin responder", "Positivas" y "Negativas", lo cual es clave para la demostración del problema en visitas comerciales.
- **Flujo "Copiar respuesta":** Se añadió un botón de portapapeles en la sugerencia IA. Al hacer clic, copia el texto y simula localmente el cambio interno de estado a "Respondida", para cerrar el ciclo en las demos.
- **Resumen Completo:** La vista de Resumen incorpora las Palabras Clave (`keywords`) directamente desde `insights` y mapea las 3 últimas reseñas como timeline de "Actividad reciente" unificando los datos extraídos de la BD en una sola request concurrente `Promise.all`.
- **Nuevo Modelo en UI:** Añadida la opción `gemini-flash-lite-latest` al frontend ("Flash Lite Ilimitado") como salvavidas anti-agotamiento de cuota de la capa gratuita, y configurada la captura limpia del error HTTP 429 en `api.py`.
