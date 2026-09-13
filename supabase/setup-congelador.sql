-- ============================================================
-- Congelador para Mis Carnes
-- Ejecutar en Supabase -> SQL Editor.
--
-- Al pasar una carne al congelador el vencimiento se detiene: se guardan
-- aqui los dias que le quedaban en ese momento. Al sacarla, la app
-- recalcula 'fecha' como hoy + dias_restantes y vuelve a correr el reloj.
--
-- Mientras esta congelada, 'fecha' queda con el valor viejo (no se borra,
-- para no perder el dato) y nadie la mira: ni las tarjetas, ni el orden,
-- ni las alertas, ni la funcion de push -- todas miran 'ubicacion' primero.
-- ============================================================

alter table carnes add column if not exists dias_restantes int;

-- 'carnes' ya existe y funciona con la anon key, asi que no hace falta
-- tocar permisos: agregar una columna no cambia el RLS de la tabla.
