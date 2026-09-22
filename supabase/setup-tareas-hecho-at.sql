-- ============================================================
-- Fecha de completado de una tarea
-- Ejecutar en Supabase -> SQL Editor.
--
-- Las tareas recurrentes (regar plantas, limpiezas) volvian a generarse contando
-- los dias desde que se CREO la tarea anterior, no desde que se marco hecha. Si la
-- regabas con un par de dias de atraso, la siguiente igual aparecia pegada a la
-- fecha vieja, adelantada respecto de cuando regaste en realidad.
--
-- Con esta columna el intervalo arranca en el momento del check, que es lo que
-- 'regenerarTareasRecurrentes()' en index.html ahora usa como base cuando existe.
-- Las tareas hechas antes de esta migracion no tienen esta fecha: la app sigue
-- usando 'created' como respaldo para esas, asi que no hace falta backfill.
-- ============================================================

alter table tareas add column if not exists hecho_at bigint;  -- milisegundos, como 'created'
