# DEVELOPMENT.md — Buenas Prácticas del Proyecto

## Principios generales

- **Escribe código que un humano pueda leer en 6 meses sin contexto**
- **Cada función hace una sola cosa**
- **Los errores siempre se loguean con contexto suficiente para debuggear**
- **Nada de credenciales hardcodeadas, nunca, bajo ninguna circunstancia**

---

## Python — Pipeline de datos

### Estructura de un script
```python
# Siempre incluir al inicio
import logging
from dotenv import load_dotenv

load_dotenv()
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)
```

### Manejo de errores
```python
# CORRECTO — error específico con contexto
try:
    result = apify_client.actor(ACTOR_ID).call(run_input=run_input)
except Exception as e:
    logger.error(f"Error scraping {restaurant_name}: {str(e)}")
    raise

# INCORRECTO — nunca silencies errores
try:
    result = apify_client.actor(ACTOR_ID).call(...)
except:
    pass
```

### Integración con Apify — actor compass/google-maps-reviews-scraper
```python
from apify_client import ApifyClient
import os

def scrape_reviews(google_maps_url: str, max_reviews: int = 100) -> dict:
    """
    Lanza el actor de Apify y devuelve reseñas + datos del lugar.
    IMPORTANTE: usar campo 'stars' para la puntuación, NO 'rating' (viene null).
    """
    client = ApifyClient(os.getenv("APIFY_API_TOKEN"))

    run_input = {
        "startUrls": [{"url": google_maps_url}],
        "maxReviews": max_reviews,
        "reviewsSort": "newest",
        "reviewsOrigin": "google",   # solo reseñas Google, no TripAdvisor
        "language": "es",
        "personalData": True
    }

    run = client.actor("compass/google-maps-reviews-scraper").call(run_input=run_input)
    items = list(client.dataset(run["defaultDatasetId"]).iterate_items())

    reviews = []
    place_data = {}

    for item in items:
        # Datos del lugar (son iguales en todos los items, tomamos del primero)
        if not place_data:
            place_data = {
                "google_rating": item.get("totalScore"),
                "review_count": item.get("reviewsCount"),
                "google_place_id": item.get("placeId"),
            }

        # Mapeo exacto de campos Apify → esquema Supabase
        review = {
            "author_name": item.get("name"),
            "rating": item.get("stars"),           # USAR stars, NO rating
            "text": item.get("text", ""),
            "review_date": item.get("publishedAtDate", "")[:10] if item.get("publishedAtDate") else None,
            "owner_replied": item.get("responseFromOwnerText") is not None,
            "reply_text": item.get("responseFromOwnerText"),
            "source": item.get("reviewOrigin", "google").lower(),
        }
        reviews.append(review)

    # Calcular response_rate
    if reviews:
        replied = sum(1 for r in reviews if r["owner_replied"])
        place_data["response_rate"] = round((replied / len(reviews)) * 100, 2)

    return {"reviews": reviews, "place_data": place_data}
```

### Formato estándar de una reseña procesada
```python
review_record = {
    "restaurant_id": "uuid",
    "source": "google",
    "author_name": "Nombre Autor",
    "rating": 4,              # de campo 'stars' del actor Apify
    "text": "Texto...",
    "review_date": "2024-01-15",
    "owner_replied": False,
    "reply_text": None
}
```


```python
from supabase import create_client

supabase = create_client(os.getenv("SUPABASE_URL"), os.getenv("SUPABASE_SERVICE_ROLE_KEY"))

# INSERT
response = supabase.table("reviews").insert(review_data).execute()

# SELECT con filtro
response = supabase.table("restaurants").select("*").eq("profile_status", "prospect").execute()
restaurants = response.data

# UPDATE
supabase.table("restaurants").update({"profile_status": "visited"}).eq("id", restaurant_id).execute()
```

### Google Natural Language API — uso correcto
```python
from google.cloud import language_v1

def analyze_sentiment(text: str) -> dict:
    """
    Retorna score (-1 a 1) y magnitude (0 a infinito).
    score: negativo = negativo, positivo = positivo
    magnitude: intensidad del sentimiento (bajo = neutro, alto = muy positivo/negativo)
    """
    client = language_v1.LanguageServiceClient()
    document = language_v1.Document(content=text, type_=language_v1.Document.Type.PLAIN_TEXT, language="es")
    sentiment = client.analyze_sentiment(request={"document": document}).document_sentiment
    return {
        "score": round(sentiment.score, 3),
        "magnitude": round(sentiment.magnitude, 3)
    }

def normalize_score_to_10(score: float) -> float:
    """Convierte score de -1/+1 a escala 0-10 para mostrar al usuario."""
    return round((score + 1) * 5, 1)
```

### Estructura de datos del pipeline
```python
# Formato estándar de un restaurante para el pipeline
restaurant_input = {
    "google_maps_url": "https://maps.google.com/...",
    "max_reviews": 100
}

# Formato estándar de una reseña procesada
review_record = {
    "restaurant_id": "uuid",
    "source": "google",
    "author_name": "Nombre Autor",
    "rating": 4,
    "text": "Texto de la reseña...",
    "review_date": "2024-01-15",
    "owner_replied": False,
    "reply_text": None
}
```

---

## React — Demo App y Landing

### Estructura de componentes
```
/src
  /components       # Componentes reutilizables (Button, Card, Badge...)
  /pages            # Una carpeta por pantalla principal
  /lib              # Utilidades: supabase.js, formatters.js, constants.js
  /hooks            # Custom hooks: useRestaurant, useInsights...
  App.jsx
  main.jsx
```

### Conexión a Supabase desde React
```javascript
// lib/supabase.js — único punto de entrada
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY

export const supabase = createClient(supabaseUrl, supabaseKey)

// Uso en componente
import { supabase } from '../lib/supabase'

const { data, error } = await supabase
  .from('restaurants')
  .select('*, insights(*)')
  .eq('id', restaurantId)
  .single()
```

### Variables de entorno en React (Vite)
```bash
# .env.local — nunca a git
VITE_SUPABASE_URL=https://xxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJ...
```

### Componente estándar con carga de datos
```jsx
import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'

export default function RestaurantInsights({ restaurantId }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    async function fetchData() {
      try {
        const { data, error } = await supabase
          .from('insights')
          .select('*')
          .eq('restaurant_id', restaurantId)
          .single()

        if (error) throw error
        setData(data)
      } catch (err) {
        setError(err.message)
      } finally {
        setLoading(false)
      }
    }
    fetchData()
  }, [restaurantId])

  if (loading) return <LoadingSpinner />
  if (error) return <ErrorMessage message={error} />
  return <div>{/* contenido */}</div>
}
```

### Tailwind — clases mobile-first
```jsx
// CORRECTO — mobile primero, luego desktop
<div className="p-4 md:p-8 text-sm md:text-base">

// Colores de marca Qinsa
// Azul principal: usar custom color en tailwind.config
// Verde acento: usar custom color en tailwind.config
```

### tailwind.config.js — colores de marca
```javascript
module.exports = {
  theme: {
    extend: {
      colors: {
        qinsa: {
          blue: '#1A3C5E',
          green: '#00A86B',
          light: '#E8F0F7',
        }
      }
    }
  }
}
```

---

## Git — Convenciones

### Commits semánticos
```bash
feat: añadir scraper de reseñas de Google Maps
fix: corregir normalización de score de sentimiento
chore: añadir dependencias de Google NL API
docs: actualizar CLAUDE.md con esquema de bbdd
refactor: extraer lógica de Supabase a módulo propio
```

### .gitignore mínimo para este proyecto
```
.env
.env.local
*.env
google-credentials.json
node_modules/
__pycache__/
*.pyc
.venv/
dist/
.DS_Store
```

---

## Checklist antes de hacer commit

- [ ] No hay credenciales hardcodeadas en ningún fichero
- [ ] Los errores están manejados con logging apropiado
- [ ] El código funciona con datos reales de Supabase (no solo mocks)
- [ ] Los componentes React funcionan en móvil (test en Chrome DevTools)
- [ ] El .env.example está actualizado si añadiste variables nuevas

---

## Comandos útiles del proyecto

```bash
# Pipeline Python
cd pipeline
pip install -r requirements.txt
python run_pipeline.py --restaurant-id <uuid>  # procesar un restaurante
python run_pipeline.py --all                    # procesar todos los prospects

# Demo App
cd demo-app
npm install
npm run dev        # desarrollo local
npm run build      # build para Vercel

# Landing
cd landing
npm install
npm run dev
npm run build
```
