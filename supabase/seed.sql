-- =============================================================================
-- Qinsa Reputation — Seed de desarrollo local
-- Se ejecuta automáticamente tras las migraciones en `supabase start` y
-- `supabase db reset`. NO se ejecuta en producción.
--
-- La organización interna ('00000000-...-001') ya la crea la migración v2.
-- Aquí solo añadimos datos de negocio de ejemplo para tener algo que mostrar
-- en local sin depender del pipeline.
-- =============================================================================

-- Restaurantes de ejemplo en la organización interna de Qinsalabs.
INSERT INTO public.restaurants (id, name, neighborhood, category, google_rating, review_count, response_rate, profile_status, organization_id)
VALUES
    ('99999999-0000-0000-0000-0000000000a1', 'EL KIOSKO | Boadilla', 'Boadilla del Monte', 'Hamburguesería', 4.3, 512, 38.5, 'client',
        '00000000-0000-0000-0000-000000000001'),
    ('99999999-0000-0000-0000-0000000000a2', 'La Tasca de Malasaña', 'Malasaña', 'Taberna', 4.2, 312, 12.0, 'prospect',
        '00000000-0000-0000-0000-000000000001')
ON CONFLICT (id) DO NOTHING;

-- Contexto de IA para el restaurante demo (tono de respuestas sugeridas).
INSERT INTO public.restaurant_context (restaurant_id, owner_name, tone, instructions, keywords_objetivo)
VALUES
    ('99999999-0000-0000-0000-0000000000a1', 'Sergio',
        'cercano y profesional',
        'Agradece siempre por su nombre cuando esté disponible. Si la reseña menciona a un empleado, reconócelo. Invita a volver. No prometas descuentos.',
        '["hamburguesas en Boadilla", "mejores patatas de la zona", "terraza"]'::jsonb)
ON CONFLICT (restaurant_id) DO NOTHING;

-- Un par de reseñas de ejemplo para el restaurante demo.
INSERT INTO public.reviews (restaurant_id, author_name, rating, text, review_date, owner_replied, review_id)
VALUES
    ('99999999-0000-0000-0000-0000000000a1', 'María G.', 5, 'Las mejores hamburguesas de la zona. Roxana nos atendió genial.', CURRENT_DATE - 3, false, 'seed_rev_001'),
    ('99999999-0000-0000-0000-0000000000a1', 'Carlos R.', 2, 'La comida bien pero tardaron 40 minutos en sacar los platos.',     CURRENT_DATE - 1, false, 'seed_rev_002')
-- El predicado WHERE es obligatorio: el índice uq_reviews_restaurant_review_id
-- es PARCIAL, y Postgres solo infiere el ON CONFLICT si se repite su condición.
ON CONFLICT (restaurant_id, review_id) WHERE review_id IS NOT NULL DO NOTHING;

-- -----------------------------------------------------------------------------
-- USUARIO DE PRUEBA + MEMBRESÍA (opcional, para probar RLS con login real).
--
-- La creación de usuarios auth se gestiona mejor desde Supabase Studio
-- (http://localhost:54323 → Authentication → Add user) o con la API de Auth,
-- porque el esquema de `auth.users` lo controla GoTrue y varía entre versiones.
--
-- Una vez creado el usuario, ánclalo a la organización interna como owner:
--
--   INSERT INTO public.memberships (user_id, organization_id, role)
--   SELECT id, '00000000-0000-0000-0000-000000000001', 'owner'
--   FROM auth.users WHERE email = 'dev@qinsalabs.com'
--   ON CONFLICT (user_id, organization_id) DO NOTHING;
-- -----------------------------------------------------------------------------
