-- Datos de prueba para desarrollo
-- Ejecutar DESPUÉS de schema.sql

INSERT INTO restaurants (name, address, neighborhood, category, google_maps_url, google_rating, review_count, profile_status)
VALUES
    ('La Tasca de Malasaña', 'Calle Manuela Malasaña 20, Madrid', 'Malasaña', 'Taberna', 'https://maps.google.com/?cid=PLACEHOLDER1', 4.2, 312, 'prospect'),
    ('Casa Pepe Retiro', 'Calle Ibiza 14, Madrid', 'Retiro', 'Asador', 'https://maps.google.com/?cid=PLACEHOLDER2', 3.8, 187, 'prospect'),
    ('El Rincón de Chamberí', 'Calle Fuencarral 98, Madrid', 'Chamberí', 'Restaurante', 'https://maps.google.com/?cid=PLACEHOLDER3', 4.5, 521, 'lead');
