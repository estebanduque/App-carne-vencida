-- ============================================================
-- Mi Gym: ejercicios que se miden en segundos (la plancha)
-- Ejecutar en Supabase -> SQL Editor.
--
-- Un isometrico no tiene repeticiones: se aguanta. Hasta ahora el formulario obligaba
-- a poner reps y la plancha quedaba como "3 series x 0 reps". Ahora esa fila guarda
-- los segundos de cada serie en 'segundos' y deja 'reps' vacio.
--
-- 'segundos' es por serie, igual que 'reps': 3 series x 45 s son 2:15 aguantados.
-- Una fila con 'segundos' es un ejercicio por tiempo; sin el, es por repeticiones.
-- ============================================================

alter table gym add column if not exists segundos integer;

-- 'reps' puede quedar vacio en un ejercicio por tiempo. Si la columna se creo con
-- NOT NULL desde el Table Editor, esto lo quita; si ya lo permitia, no hace nada.
alter table gym alter column reps drop not null;

-- ------------------------------------------------------------
-- Comprobacion: la columna nueva tiene que aparecer.
-- ------------------------------------------------------------
select column_name, data_type, is_nullable
  from information_schema.columns
 where table_name = 'gym' and column_name in ('reps', 'segundos');
