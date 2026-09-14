-- ============================================================
-- Recordatorios de tareas
-- Ejecutar en Supabase -> SQL Editor.
--
-- Guarda para que dia se pidio el recordatorio de una tarea. El boton "3 dias"
-- de la app escribe aqui, y el cron diario (notificar-vencimientos) manda el push
-- cuando llega la fecha. Sin esta columna el recordatorio solo podria avisarte al
-- abrir la app, que es justo cuando ya te acordaste solo.
-- ============================================================

alter table tareas add column if not exists recordar date;

-- Lo que consulta el cron: las pendientes con recordatorio ya vencido.
create index if not exists tareas_recordar_idx
  on tareas (recordar) where recordar is not null;
