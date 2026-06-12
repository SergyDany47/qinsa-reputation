# PIPELINE_ARCHITECTURE.md — Arquitectura del Pipeline de Datos

Documentación técnica generada a partir del código fuente real (junio 2026).
No contiene suposiciones — todo está derivado directamente de los archivos en `/pipeline/`.

---

## 1. Visión General

El pipeline tiene dos modos de entrada:

- **CLI directo** (`run_pipeline.py`) — para ingesta manual o batch desde terminal.
- **API HTTP** (`api.py`) — para la demo app React, con progreso en tiempo real via SSE (Server-Sent Events).

Ambos modos ejecutan los mismos tres pasos internos: `scraper → analyzer → loader`.

```
ENTRADA
  ├── --place-id <ChIJ...>          # construye URL, crea restaurante si no existe
  ├── --restaurant-id <uuid>        # lee google_maps_url de Supabase
  └── --all                         # itera todos los restaurants con profile_status='prospect'

  └──> _run_pipeline(google_maps_url, name_hint, max_reviews)
         │
         ├── [1/3] scraper.scrape_reviews()      → {reviews: [], place_data: {}}
         ├── [2/3] analyzer.analyze_reviews()    → {insights completos}
         └── [3/3] loader.*                      → persistencia en Supabase

SALIDA → tabla restaurants + tabla reviews + tabla insights (Supabase)
```

---

## 2. Flujo de Datos Secuencial

### 2.1 Entrada por `--place-id` (flujo más común)

```
python run_pipeline.py --place-id ChIJ7dkd3PibQQ0RwV6PkU_5tTo --max 50
```

1. `run_for_place_id(place_id)` construye la URL con la plantilla:
   ```python
   PLACE_URL_TEMPLATE = "https://www.google.com/maps/place/?q=place_id:{place_id}"
   # → "https://www.google.com/maps/place/?q=place_id:ChIJ7dkd3PibQQ0RwV6PkU_5tTo"
   ```
2. Llama a `_run_pipeline(google_maps_url, restaurant_name_hint="", max_reviews=50)`.

### 2.2 Entrada por `--restaurant-id`

```
python run_pipeline.py --restaurant-id 3f1b8e2a-...
```

1. `run_for_restaurant_id(uuid)` consulta Supabase:
   ```python
   sb.table("restaurants").select("name,google_maps_url").eq("id", restaurant_id).single()
   ```
2. Usa el `google_maps_url` almacenado en la BD para llamar a `_run_pipeline()`.

### 2.3 Entrada `--all`

1. `get_prospects()` devuelve todos los registros con `profile_status = 'prospect'`.
2. Itera la lista y llama a `run_for_restaurant_id()` para cada uno.
3. Los fallos individuales se loguean y no interrumpen el batch.

### 2.4 Pipeline interno — `_run_pipeline()`

```
Paso 1: scrape_reviews(google_maps_url, max_reviews)
  │  → ApifyClient("compass/google-maps-reviews-scraper").call(run_input)
  │  → itera items del dataset
  │  → extrae place_data del primer item
  │  → mapea cada item que tenga stars/text a estructura review
  │  → calcula response_rate localmente
  └─> retorna {"reviews": [...], "place_data": {...}}

Paso 2: analyze_reviews(reviews, restaurant_name, model)
  │  → calcula rating_distribution localmente (sin tokens IA)
  │  → formatea reseñas para el prompt (incluye respuestas del dueño)
  │  → llama a genai.Client.models.generate_content() con mime "application/json"
  │  → parsea JSON de respuesta
  └─> retorna dict con todos los campos de insights

Paso 3: loader (3 llamadas a Supabase)
  │  → upsert_restaurant(place_data, google_maps_url)
  │     · select por google_maps_url → si existe, actualiza métricas; si no, inserta
  │  → insert_reviews_deduped(restaurant_id, reviews)
  │     · carga review_id + (author_name, review_date) existentes
  │     · filtra duplicados y batch-inserta solo las nuevas
  │  → upsert_insights(restaurant_id, insights)
  │     · select por restaurant_id → si existe, update; si no, insert
  └─> restaurante, reseñas e insights persistidos
```

### 2.5 Flujo API — `GET /analyze` (demo app)

El endpoint `api.py:/analyze` ejecuta los mismos 3 pasos pero en un `asyncio` loop usando `run_in_executor` para no bloquear el event loop, y emite eventos SSE entre cada paso:

```
Frontend React → GET /analyze?place_id=ChIJ...&max_reviews=50&model=gemini-2.5-flash
                    ↓ SSE stream
  {"step":1,"status":"running","message":"Conectando con Google Maps..."}
  {"step":1,"status":"done","message":"50 reseñas obtenidas de «El Kiosko»"}
  {"step":2,"status":"running","message":"Analizando 50 reseñas con Gemini..."}
  {"step":2,"status":"done","message":"Análisis completado · sentimiento 7.8/10"}
  {"step":3,"status":"running","message":"Guardando en Supabase..."}
  {"step":3,"status":"done","message":"50 reseñas guardadas"}
  event: done
  data: {"restaurant_id":"3f1b...","restaurant":{...campos completos...}}
```

### 2.6 Flujo API — `GET /refresh` (actualización incremental)

Pensado para detectar reseñas nuevas y generar `suggested_reply` automáticamente:

```
GET /refresh?restaurant_id=<uuid>&max_reviews=10&model=gemini-2.5-flash

1. get_restaurant_by_id() + get_restaurant_context()   # tono, dueño, instrucciones
2. scrape_reviews(google_maps_url, 10)                 # últimas 10 reseñas
3. Comparar review_id + (author_name, review_date) vs BD
4. Para cada reseña nueva con texto:
   generate_suggested_reply(review, name, context, model) → guarda en r["suggested_reply"]
5. insert_reviews_deduped() → guarda solo las nuevas (con suggested_reply)
6. Si inserted > 0: regenera insights con TODAS las reseñas de la BD
```

### 2.7 Flujo API — `POST /generate-reply` (demanda explícita)

```
POST /generate-reply
Body: {"review_id": "<uuid>", "restaurant_id": "<uuid>", "model": "gemini-2.5-flash"}

1. Carga la reseña de Supabase (rating, text, author_name)
2. Carga restaurant + restaurant_context
3. generate_suggested_reply() → Gemini con temperatura 0.7
4. UPDATE reviews SET suggested_reply = <texto> WHERE id = review_id
5. Retorna {"suggested_reply": "<texto>"}
```

---

## 3. Contratos de Datos Reales

### 3.1 Output del Actor Apify (item crudo)

Cada item del dataset devuelto por `compass/google-maps-reviews-scraper` tiene esta forma.
Los campos críticos que usamos están marcados con `★`:

```json
{
  "★ title": "EL KIOSKO | Boadilla",
  "★ totalScore": 4.5,
  "★ reviewsCount": 312,
  "★ placeId": "ChIJ7dkd3PibQQ0RwV6PkU_5tTo",
  "★ name": "María García",
  "★ stars": 5,
  "rating": null,
  "★ text": "Excelente servicio y comida muy buena. Alejandro atendió fenomenal.",
  "★ publishedAtDate": "2024-11-15T10:30:00.000Z",
  "★ reviewOrigin": "Google",
  "★ responseFromOwnerText": "¡Muchas gracias, María! Nos alegra mucho...",
  "responseFromOwnerDate": "2024-11-16T09:00:00.000Z",
  "reviewId": "ChZDSUhNMG9nS...",
  "reviewUrl": "https://www.google.com/maps/...",
  "likes": 0,
  "publishAt": "hace 2 meses"
}
```

**Trampas conocidas documentadas en CLAUDE.md:**
- `rating` siempre viene `null` — usar `stars` para la puntuación.
- `reviewOrigin` puede ser `""` o ausente para reseñas nativas de Google — el filtro acepta `"google"` y `""`.
- Items sin `stars` ni `text` son registros del lugar (metadatos), no reseñas — se ignoran.
- Los datos del lugar (`title`, `totalScore`, `reviewsCount`, `placeId`) vienen duplicados en **cada** item — solo se extrae del primero.

### 3.2 Contrato de Salida del Scraper

`scrape_reviews()` devuelve:

```python
{
    "reviews": [
        {
            "review_id":     "ChZDSUhNMG9nS...",   # reviewId del actor
            "author_name":   "María García",         # item["name"]
            "rating":        5,                       # item["stars"]
            "text":          "Excelente servicio...", # item["text"] o ""
            "review_date":   "2024-11-15",            # item["publishedAtDate"][:10]
            "owner_replied": True,                    # responseFromOwnerText is not None
            "reply_text":    "¡Muchas gracias, María! ...",  # responseFromOwnerText
            "source":        "google"                 # reviewOrigin.lower()
        },
        # ... más reseñas
    ],
    "place_data": {
        "name":          "EL KIOSKO | Boadilla",   # item["title"]
        "google_rating": 4.5,                        # item["totalScore"]
        "review_count":  312,                        # item["reviewsCount"]
        "place_id":      "ChIJ7dkd3PibQQ0RwV6PkU_5tTo",  # item["placeId"]
        "response_rate": 43.6                        # calculado: (replied/total)*100
    }
}
```

### 3.3 Prompt Enviado a Gemini

El prompt se construye en `_build_prompt()` e incluye:

- Rol: "analista experto en reputación online de restaurantes en España"
- 8 reglas críticas de análisis (especificidad, recurrencia mínima 3 reseñas, detección de staff, tipos de problema, puntuación de sentimiento, análisis de respuestas, idioma español, prohibición de referencias a números de reseña)
- Las reseñas formateadas como:
  ```
  [Reseña 1 | 5★] Texto de la reseña...
    → Respuesta del dueño: Texto de la respuesta...

  [Reseña 2 | 2★] Texto de otra reseña...
  ```
- Instrucción de devolver JSON puro (sin markdown) con `response_mime_type="application/json"` y `temperature=0.2`

### 3.4 Contrato de Salida de Gemini (JSON devuelto)

```json
{
  "top_problems": [
    "El tiempo de espera para pedir supera los 20 minutos en hora punta según varios clientes",
    "Los clientes detectan inconsistencia en las raciones según el día o el turno",
    "El ruido en la sala dificulta la conversación en grupos grandes"
  ],
  "top_strengths": [
    "El servicio del personal de sala es destacado de forma recurrente, especialmente en rapidez y amabilidad",
    "La relación calidad-precio se menciona positivamente como uno de los mejores de la zona",
    "La cocina destaca por platos específicos como el chuletón y la tortilla"
  ],
  "keywords": ["servicio", "espera", "precio", "terraza", "chuletón"],
  "summary": "EL KIOSKO | Boadilla mantiene una valoración positiva sostenida...",
  "sentiment_score": 7.8,
  "response_quality": "El dueño responde aproximadamente al 44% de las reseñas...",
  "staff_mentions": [
    {
      "name": "Alejandro",
      "mention_count": 7,
      "sentiment": "positive",
      "sample_quotes": [
        "Alejandro atendió fenomenal, muy atento y rápido",
        "El chico Alejandro siempre tan simpático"
      ]
    },
    {
      "name": "Julio",
      "mention_count": 7,
      "sentiment": "positive",
      "sample_quotes": ["Julio como siempre, de diez"]
    }
  ],
  "recurring_issues": [
    "Algunos clientes mencionan dificultad para aparcar cerca del local"
  ],
  "recurring_praise": [
    "La decoración y el ambiente son valorados positivamente por varios clientes"
  ]
}
```

### 3.5 Objeto Final de `analyze_reviews()` (después del post-procesado)

```python
{
    # Campos de Gemini (truncados en el post-procesado)
    "top_problems":        [...],     # máx. 3 items → gemini_result["top_problems"][:3]
    "top_strengths":       [...],     # máx. 3 items → gemini_result["top_strengths"][:3]
    "keywords":            [...],     # máx. 5 items → gemini_result["keywords"][:5]
    "summary":             "...",
    "sentiment_score":     7.8,
    "response_quality":    "...",
    "staff_mentions":      [...],     # lista completa de dicts {name, mention_count, sentiment, sample_quotes}
    "recurring_issues":    [...],     # puede ser lista vacía — comportamiento correcto
    "recurring_praise":    [...],

    # Campo calculado localmente (sin tokens IA)
    "rating_distribution": {"1": 2, "2": 3, "3": 5, "4": 18, "5": 22},

    # Metadata
    "model_used":          "gemini-2.5-flash"
}
```

### 3.6 Mapeo a Supabase — qué persiste y qué no

`upsert_insights()` usa `_INSIGHTS_SCHEMA_FIELDS` para filtrar qué campos escribe en Supabase:

```python
_INSIGHTS_SCHEMA_FIELDS = {
    "top_problems", "top_strengths", "keywords",
    "summary", "sentiment_score", "response_quality", "model_used",
    "staff_mentions", "rating_distribution",        # añadidas en migración 2026-03-06
    "recurring_issues", "recurring_praise",          # añadidas en migración 2026-03-06
}
```

Todos los campos del objeto `analyze_reviews()` persisten en Supabase desde la migración de 2026-03-06.

---

## 4. Deduplicación de Reseñas

La deduplicación en `insert_reviews_deduped()` opera en dos niveles:

| Nivel | Clave | Uso |
|-------|-------|-----|
| Primario | `review_id` (reviewId de Apify) | Para reseñas nuevas con ID del actor |
| Fallback | `(author_name, review_date)` | Para datos históricos sin review_id |

Ambas comprobaciones se hacen antes de insertar. Una reseña se descarta si **cualquiera** de las dos claves coincide con un registro existente.

---

## 5. Dependencias Críticas

### 5.1 `requirements.txt` (raíz del proyecto)

```
supabase>=2.28.0        # Cliente Python de Supabase (PostgREST API)
apify-client==1.8.1     # SDK de Apify para lanzar actores y leer datasets
google-genai>=1.47.0    # SDK nuevo de Google GenAI (reemplaza google-generativeai, deprecada)
openai==1.51.0          # Reservado para generación de respuestas creativas (no usado aún)
python-dotenv==1.0.1    # Carga de variables de entorno desde .env
fastapi==0.115.0        # Framework HTTP para la API de la demo app
uvicorn==0.31.0         # Servidor ASGI para FastAPI
```

**Nota**: `tenacity` está importado en `analyzer.py` para el retry automático sobre fallos de red o cuota de Gemini, pero no aparece en `requirements.txt`. Debe añadirse.

### 5.2 SDKs y clientes — uso exacto en el código

#### Apify (`apify-client`)
```python
from apify_client import ApifyClient
client = ApifyClient(token)
run = client.actor("compass/google-maps-reviews-scraper").call(run_input=run_input)
items = list(client.dataset(run["defaultDatasetId"]).iterate_items())
```

#### Google GenAI (`google-genai`) — SDK nuevo, no el deprecado
```python
from google import genai
from google.genai import types

client = genai.Client(api_key=api_key)
response = client.models.generate_content(
    model="gemini-2.5-flash",
    contents=prompt,
    config=types.GenerateContentConfig(
        response_mime_type="application/json",
        temperature=0.2,
    ),
)
result = json.loads(response.text)
```

**Modelo actual**: `gemini-2.5-flash` (constante `MODEL` en `analyzer.py`).  
Migración documentada: `google-generativeai` (deprecada) → `google-genai>=1.47.0`.  
Patrón antiguo (NO usar): `genai.configure(api_key=...)` + `genai.GenerativeModel(MODEL).generate_content(...)`.

#### Supabase (`supabase-py`)
```python
from supabase import create_client
supabase = create_client(os.getenv("SUPABASE_URL"), os.getenv("SUPABASE_SERVICE_ROLE_KEY"))
```

La `SERVICE_ROLE_KEY` usa el nuevo formato `sb_secret_...` (no JWT). Requiere `supabase>=2.28.0`.

#### Tenacity (retry en analyzer)
```python
from tenacity import retry, wait_exponential, stop_after_attempt, retry_if_exception_type

@retry(wait=wait_exponential(multiplier=2, min=3, max=30), stop=stop_after_attempt(5))
def analyze_reviews(...): ...

@retry(wait=wait_exponential(multiplier=2, min=3, max=30), stop=stop_after_attempt(5))
def generate_suggested_reply(...): ...
```
Configuración: espera exponencial de 3s a 30s, máximo 5 intentos.

### 5.3 Variables de Entorno Requeridas

| Variable | Usada en | Notas |
|----------|----------|-------|
| `APIFY_API_TOKEN` | `scraper.py` | Token del workspace de Apify |
| `GEMINI_API_KEY` | `analyzer.py` | Google AI Studio — no requiere Google Cloud |
| `SUPABASE_URL` | `loader.py` | URL del proyecto Supabase |
| `SUPABASE_SERVICE_ROLE_KEY` | `loader.py` | Formato `sb_secret_...` (nuevo), no JWT |
| `SUPABASE_ANON_KEY` | Solo frontend React | No usado en el pipeline Python |
| `OPENAI_API_KEY` | No usado aún | Reservado para respuestas creativas |

---

## 6. Gestión de Errores y Resiliencia

| Componente | Mecanismo |
|------------|-----------|
| Gemini (`analyze_reviews`) | `@retry` con backoff exponencial: 5 intentos, 3–30s de espera |
| Gemini (`generate_suggested_reply`) | Mismo `@retry`. Sin texto en la reseña: respuesta genérica hard-coded sin llamar a la API |
| Apify | `try/except` con re-raise — sin retry (el actor ya tiene su propia resiliencia) |
| Supabase | `try/except` con log + re-raise en todas las funciones públicas |
| API SSE (cuota agotada) | Captura strings `"429"`, `"Quota"`, `"RESOURCE_EXHAUSTED"` → mensaje amigable al frontend |
| `--all` batch | Fallos individuales logueados, el batch continúa con el siguiente restaurante |

---

## 7. Archivos del Pipeline — Responsabilidades

| Archivo | Responsabilidad |
|---------|-----------------|
| `scraper.py` | Conexión Apify, mapeo campos crudo→Supabase, cálculo response_rate |
| `analyzer.py` | Construcción de prompt, llamada Gemini, post-procesado JSON, generación de suggested_reply |
| `loader.py` | Toda la escritura en Supabase: deduplicación, upserts, select-then-insert |
| `run_pipeline.py` | Orquestación CLI: argumentos, flujos de entrada, formato de salida en consola |
| `api.py` | Endpoints HTTP + SSE para la demo app React |

Los imports de `scraper`, `analyzer` y `loader` en `run_pipeline.py` están **dentro de las funciones** (no en el top-level) para evitar dependencias circulares cuando se importa solo un módulo.

---

## 8. Modelo de Datos Supabase — Estado Actual

La tabla `insights` tiene las siguientes columnas adicionales respecto al schema inicial (migración aplicada 2026-03-06 via SQL dashboard):

```sql
-- Columnas añadidas en migración 2026-03-06
staff_mentions      jsonb   -- array de {name, mention_count, sentiment, sample_quotes}
rating_distribution jsonb   -- dict {"1":n, "2":n, "3":n, "4":n, "5":n}
recurring_issues    jsonb   -- array de strings (problemas con 2+ menciones, no top)
recurring_praise    jsonb   -- array de strings (elogios con 2+ menciones, no top)
```

La tabla `reviews` tiene la columna adicional:
```sql
review_id           text    -- reviewId de Apify, clave primaria de deduplicación
suggested_reply     text    -- respuesta generada por Gemini, guardada por /refresh o /generate-reply
```

La tabla `restaurant_context` es leída por `loader.get_restaurant_context()` pero su definición SQL no está en `schema.sql` — fue creada manualmente. Estructura usada:
```sql
restaurant_id   uuid FK → restaurants.id
owner_name      text
tone            text
instructions    text
```
