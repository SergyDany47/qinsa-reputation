# Spike de viabilidad — Publicar respuestas en Google (Business Profile API)

**Fecha:** 2026-06-24 · **Estado:** investigación cerrada, sin compromiso de código.
**Objetivo:** determinar qué exige *de verdad* publicar respuestas a reseñas en Google,
para decidir cuándo (y cómo) abordar la Fase 5 sin sorpresas. Resume hallazgos con
fuentes; las decisiones de producto van al final.

---

## 1. Cómo se publica una respuesta (lo fácil)

La parte técnica de publicar es trivial: un único PUT.

```
PUT https://mybusiness.googleapis.com/v4/accounts/{accountId}/locations/{locationId}/reviews/{reviewId}/reply
Authorization: Bearer <access_token>
{ "comment": "Texto de la respuesta" }
```

- **Scope OAuth:** `https://www.googleapis.com/auth/business.manage` (uno solo, cubre leer reseñas y responder).
- Las **reseñas** se leen del **mismo `v4` legacy** (`mybusiness.googleapis.com/v4/.../reviews`): Google **no** migró reseñas a las nuevas APIs divididas, así que se conviven endpoints nuevos (información, OAuth) con el `v4` antiguo solo para reseñas.
- Solo se puede leer/responder reseñas de **locales que la cuenta autenticada gestiona** (no de cualquier sitio).

→ Si esto fuera todo, sería medio día de trabajo. **No lo es.** El coste está en el acceso y la moderación.

## 2. La barrera real: el *access gate* de Google (lo difícil)

- **Cuota por defecto = 0 QPM.** Un proyecto nuevo de Google Cloud con la API habilitada devuelve **error de cuota en CADA llamada** hasta que Google te aprueba. No es "habilitar y usar".
- Para subir la cuota hay que rellenar el **formulario de Access Request** (número de proyecto GCP, datos de contacto, caso de uso, scopes). **Aprobación manual de Google: de días a semanas.** No hay aprobación instantánea.
- Aprobado el proyecto, la cuota por defecto pasa a **~300 QPM** por API. Suficiente de sobra para nuestro volumen.
- **Verificación OAuth de la app:** `business.manage` es un **scope sensible** → para que clientes reales (no test users) autoricen, Google exige **verificación de la app** (pantalla de consentimiento, dominio, política de privacidad, posible revisión de seguridad). Otro trámite con su propio calendario.

## 3. Novedad 2026 que cambia el diseño: moderación de respuestas

Google introdujo (mayo 2026, `v4.9`) **`ReviewReplyState`**: las respuestas publicadas vía API **pasan por una capa de moderación** antes de hacerse públicas.

- Estados: **`PENDING`** (en cola/screening) y **`REJECTED`** (Google rehúsa publicarla).
- Implica **delay** entre publicar y aparecer, y que una respuesta puede **rechazarse sin aviso** si toca filtros de spam/política.

→ Consecuencia directa: **"publicada por la API" ≠ "visible en Google".** Nuestro modelo de estados necesita reflejar `pending`/`rejected`, y el **auto-publish es más arriesgado de lo que parecía** (podemos creer que respondimos y Google haberla tumbado).

## 4. OAuth por cliente (multi-tenant)

- Cada restaurante = **el dueño autoriza nuestra app** sobre *su* cuenta de Google Business (flujo OAuth de consentimiento). Guardamos un **refresh token por restaurante/cuenta**, cifrado.
- Hay que resolver el mapeo **nuestro `restaurant` ↔ `accountId`+`locationId` de Google** (descubrimiento de locales tras el consentimiento) y **`reviewId` de Google ↔ nuestra fila `reviews`** (hoy guardamos `review_id` de Apify, que **no** es el `reviewId` de la GBP API → harían falta los dos, o re-leer reseñas vía GBP para los clientes que publiquen).

## 5. Veredicto

| Eje | Valoración |
|-----|-----------|
| Escribir el reply (técnico) | 🟢 trivial (1 PUT) |
| Conseguir acceso (cuota + form + verificación OAuth) | 🔴 semanas, trámite manual, fuera de nuestro control |
| Moderación 2026 (PENDING/REJECTED) | 🟡 obliga a modelar estado real y desaconseja auto-publish ciego |
| Mapeo de identidades (account/location/reviewId) | 🟡 trabajo de integración no trivial |

**Conclusión:** la publicación automática **NO es fricción cero** — el cuello de botella es el *access gate* de Google y la verificación OAuth, no el código. Confirma la postura del roadmap: **manual primero** (copy/paste, cero dependencia de Google, ya casi hecho), y la integración GBP real **se difiere** hasta tener (a) app verificada + acceso aprobado, y (b) suficientes clientes que la justifiquen.

## 6. Implicaciones para el groundwork (Fase 3, lo que SÍ construimos ahora)

El spike **no** desbloquea código GBP todavía, pero fija el modelo de datos que construimos ya (compartido por WhatsApp-aprobación y Google-publicación):

- **Estado de la respuesta** en `reviews`, ciclo: `borrador → aprobada → publicada`, **+ estados de Google** `pending`/`rejected` para cuando exista la integración real. Diseñarlo desde ya evita una migración rompedora después.
- **Modo de publicación por restaurante:** `manual | pre-aprobación | automática`. Dado el hallazgo de moderación, **default `manual`** y `automática` gateada (p. ej. solo 5★) y siempre reversible.
- **Campos GBP diferidos** (no se crean hasta la Fase 5): `google_account_id`, `google_location_id` en `restaurants`; `google_review_id`, `reply_state` en `reviews`; tabla de tokens OAuth por restaurante (cifrados).

---

### Fuentes
- [Work with review data — Google Business Profile APIs](https://developers.google.com/my-business/content/review-data)
- [Google Business Profile Update: Review Reply Moderation (gmbapi.com)](https://gmbapi.com/news/gbp-review-moderation/)
- [Implement OAuth with Business Profile APIs](https://developers.google.com/my-business/content/implement-oauth)
- [Prerequisites — Google Business Profile APIs](https://developers.google.com/my-business/content/prereqs)
- [Usage limits — Google Business Profile APIs](https://developers.google.com/my-business/content/limits)
- [Google Business Profile API 2026: Access, Docs & Setup (slashpost.ai)](https://slashpost.ai/blogs/google-business-profile/google-business-profile-api-documentation-2026)
- [Hidden Approval Gate on the Business Profile API (Xovion Labs)](https://xovionlabs.com/blog/google-business-profile-api-hidden-gate/)
