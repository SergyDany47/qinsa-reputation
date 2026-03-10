# Contexto para el asistente — Qinsa Reputation

## Quién soy
Sergio, desarrollador 5 años experiencia, MacBook Pro M1 Pro 32GB.
Construyendo QinsaLabs con socio (art director) + comercial. Ventana de 6 meses para validar SaaS antes de buscar empleo 40k+.

## Producto: Qinsa Reputation
SaaS de gestión de reputación online para restaurantes independientes en Madrid.
- **Basic 39€/mes**: Smart Responder IA, Alertas WhatsApp, Sentiment Analytics, Reporte mensual
- **Growth 79€/mes**: Todo Basic + Shield QR, NFC, SEO Booster, Análisis competitivo
- **Objetivo actual**: validar con 20 restaurantes antes de construir MVP

## Stack
- Supabase (PostgreSQL) — proyecto: duntzfgtxdboirzzlqgj.supabase.co
- Python + Gemini API (gemini-2.0-flash) — análisis de reseñas
- React + Tailwind — demo app mobile-first + landing
- Apify (compass/google-maps-reviews-scraper) — scraping
- GitHub: github.com/SergyDany47/qinsa-reputation

## MCPs configurados en Claude Code
- supabase ✅ (PAT sbp_...)
- github ✅ (classic PAT con scope repo)
- apify ✅ (token apify_api_...)
- filesystem ✅ (/Users/sergiodani/workspace)

## Estado actual del proyecto
| Fase | Estado | Notas |
|------|--------|-------|
| Setup entorno | ✅ | MCPs, repo, estructura |
| Fase 1 — Supabase schema | ✅ | 6 tablas, RLS, índices |
| Fase 2A — Scraper | ✅ | Funcionando con place_id |
| Fase 2B — Analyzer Gemini | ⏳ | Siguiente paso |
| Fase 2C — Loader + run_pipeline | ⬜ | Pendiente |
| Fase 3 — Demo app React | ⬜ | Pendiente |
| Fase 4 — Landing | ⬜ | Pendiente |
| Fase 5 — 20 restaurantes reales | ⬜ | Pendiente |

## Lección crítica: URLs de Apify
- ❌ NO funciona: `https://www.google.com/maps/place/Nombre/@lat,lng,zoom`
- ✅ SÍ funciona: `https://www.google.com/maps/place/?q=place_id:ChIJ...`
- Para obtener placeId desde nombre: usar actor `compass/crawler-google-places`

## Restaurante de prueba
- **El Kiosko Boadilla** — placeId: `ChIJ7dkd3PibQQ0RwV6PkU_5tTo`
- Rating: 4.5 | Reseñas: 1251 | Response rate: 15%

## Reglas de trabajo con Claude Code
- Sesiones cortas por fase, no sesiones infinitas
- Cada sesión empieza con: "Lee CLAUDE.md y DEVELOPMENT.md"
- CLAUDE.md es la memoria persistente del proyecto
- Claude Code debe actualizar CLAUDE.md al final de cada tarea

## Cómo usar este fichero
Pega el contenido de este fichero al inicio de un nuevo chat con el asistente con este mensaje:
"Este es el contexto de mi proyecto. Continúa ayudándome desde donde lo dejamos. El siguiente paso es [INDICAR FASE ACTUAL]."
