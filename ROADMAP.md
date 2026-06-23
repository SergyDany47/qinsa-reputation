# ROADMAP — Qinsa Reputation

Plan de trabajo a partir de junio 2026. Documento vivo. El detalle de decisiones
técnicas ya tomadas está en `CLAUDE.md`; aquí va el **qué viene y en qué orden**.

## Visión
Motor de **reputación + SEO/GEO local** multi-tenant para hostelería: ingesta de
reseñas → análisis IA → respuestas sugeridas personalizadas → publicación →
informes, con SEO local potenciado por las respuestas y el flujo de reseñas.

## Estado actual (construido y verificado)
- Multi-tenant (organizations/memberships, RLS por `auth.uid()`), Supabase local.
- Backoffice interno (orgs, usuarios, onboarding por place_id, ingesta manual, config).
- App de cliente responsive (Ocean & Lime), solo-lectura + copiar sugerencia.
- Pipeline: scrape (Apify) → análisis Gemini (insights, staff, distribución) →
  sugerencias de respuesta **personalizadas** (presets de tono, emojis, idioma
  espejo, keywords/platos SEO, instrucciones libres) → regenerar sin re-scrapear.

## Principios de secuenciación (mi criterio)
1. **El motor primero.** El ciclo de ingesta es el latido del que cuelga todo lo demás (alertas, informes). Va primero.
2. **Contenido antes que canal.** Construir lo que se envía (alertas, informes, aprobaciones) antes que el canal de envío (WhatsApp).
3. **Aislar el riesgo externo.** La escritura en Google (GBP API + OAuth + aprobación de Google) es la mayor incógnita → spike de viabilidad separado, y construir antes el modelo de datos que comparten WhatsApp-aprobación y Google-publicación.
4. **Vender SEO real, no humo.** Narrativa compuesta (respuestas + velocidad/recencia de reseñas + tasa de respuesta + consistencia de keywords), no promesas de ranking.
5. **Coste presente.** Cada ejecución de ingesta gasta Apify; la frecuencia es una palanca de coste, no solo un parámetro.

## Deuda previa (pequeña, habilita fases)
- **D1 — Históricos de insights:** el loader hace select-then-update (sobrescribe). Para informes/comparativas hay que **insertar una fila por período** (el esquema ya lo soporta: `insights` 1:N + `period_start/end`). Prerrequisito de la Fase 2.
- **D2 — Consolidar la ingesta incremental:** una única función compartida para que **el botón manual y el job programado sean exactamente la misma ejecución** (hoy la lógica vive duplicada entre `api.py:/refresh` y `admin.py:ingest`). Prerrequisito de la Fase 1.
- **D3 — `schema.sql` v2 snapshot** (la fuente operativa es `supabase/migrations/`).

---

## Fase 1 — Motor de ingesta autónomo  ← SIGUIENTE
**Objetivo:** el ciclo que busca reseñas nuevas, disponible como **botón manual** y como **ejecución periódica por restaurante**, activable/desactivable desde el backoffice. El botón manual ES la misma ejecución que se programará.
- Op canónica incremental (D2): scrape recientes → dedupe → sugerencias para nuevas → recalcular insights → actualizar ficha.
- Config por restaurante: `auto_ingest_enabled` + `frecuencia` (cada X horas).
- Scheduler que recorre los restaurantes activos y lanza la op.
- Backoffice: toggle on/off + frecuencia + "ejecutar ahora".
- **Tecnología del scheduler — DECIDIDO: APScheduler dentro de FastAPI** (lógica en nuestro código, sin infra extra). Requiere que el backend esté siempre en marcha. Se descartaron pg_cron (parte la lógica DB/backend) y n8n (infra extra) para esta fase.
- **Guardarraíl de coste:** frecuencia mínima 3-6 h configurable; horaria desaconsejada (overkill + coste Apify).

## Fase 2 — Generador de informes (semanal + comparativa)
**Objetivo:** informe con insights de la semana + **comparativa con la anterior** (sentimiento, volumen, rating, temas, staff). Botón manual ahora; programado semanal después.
- **Deps:** D1 (históricos) + Fase 1 (scheduler para la versión automática).
- Salida estructurada reutilizable por el canal (WhatsApp/email) de la Fase 4.

## Fase 3 — Groundwork de publicación y aprobación
**Objetivo:** preparar el terreno (lo comparten WhatsApp y Google).
- Modelo de estados de respuesta: `borrador | aprobada | publicada`.
- Modo de publicación por restaurante: `manual | pre-aprobación | automática`, con reglas por rating (p. ej. auto solo 5★).
- **Spike de viabilidad GBP** (Google Business Profile API: OAuth por cliente + aprobación de Google + cuotas) — investigación aislada antes de comprometer la Fase 5.

## Fase 4 — WhatsApp (canal de entrega)
**Objetivo:** entregar por WhatsApp lo que ya producen las fases previas.
- Alertas de reseñas críticas (Fase 1), informes semanales (Fase 2), peticiones de aprobación de respuestas (Fase 3).
- Integración Meta Cloud API / Twilio, por cliente (verificación, plantillas, coste por mensaje).

## Fase 5 — Publicación en Google
**Objetivo:** publicar respuestas (tras el spike de la Fase 3).
- v1: un clic "publicar" (manual/pre-aprobación). v2: auto-publicación con toggle por restaurante y rating.

## Track transversal — SEO/GEO (en paralelo)
- **Doc de estrategia** (ahora, barato): cómo funciona el SEO/GEO local, qué palancas REALES mueve nuestra app, y la **narrativa de venta compuesta** (SEO por respuestas + potenciación del flujo/recencia de reseñas + tasa de respuesta). Gestionar expectativas: levers reales pero acotados.
- **Booster de flujo de reseñas** (QR/NFC): facilitar dejar reseña (NUNCA filtrar — el review gating está prohibido por Google). Feature concreta y vendible.
- **Tuning de keyword injection** (en curso): ya es opcional y anti-fabricación; iterar con casos reales.
- **Auditoría GEO** (metodología + sonda grounded opcional bajo demanda) — más adelante.

---

## Orden recomendado
`D2 → Fase 1 → (D1 → Fase 2) → Fase 3 (+ spike GBP) → Fase 4 → Fase 5`
Track SEO en paralelo: doc de estrategia ya; QR cuando se aborde hardware.
