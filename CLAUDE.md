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
