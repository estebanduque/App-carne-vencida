-- ============================================================
-- Push de vencimiento de carnes: preparación de la base
-- Ejecutar en Supabase -> SQL Editor, de arriba hacia abajo.
-- ============================================================

-- 1) Evitar suscripciones duplicadas -------------------------
-- Hoy el mismo dispositivo está guardado varias veces, así que llegaría
-- la misma notificación repetida. Se agrega una columna endpoint con
-- restricción única y se limpian las repetidas.

alter table push_subscriptions add column if not exists endpoint text;

update push_subscriptions
   set endpoint = subscription->>'endpoint'
 where endpoint is null;

delete from push_subscriptions a
 using push_subscriptions b
 where a.id > b.id
   and a.endpoint = b.endpoint;

alter table push_subscriptions
  drop constraint if exists push_subscriptions_endpoint_key;
alter table push_subscriptions
  add constraint push_subscriptions_endpoint_key unique (endpoint);


-- 2) Cron diario --------------------------------------------
-- Llama a la Edge Function una vez por día.
-- OJO: pg_cron corre en UTC. 07:00 UTC = 09:00 en París (verano) / 08:00 (invierno).
-- Reemplazar <SERVICE_ROLE_KEY> por la clave service_role del proyecto
-- (Project Settings -> API). Es secreta: no subirla al repo.

create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.unschedule('notificar-vencimientos-carnes')
 where exists (select 1 from cron.job where jobname = 'notificar-vencimientos-carnes');

select cron.schedule(
  'notificar-vencimientos-carnes',
  '0 7 * * *',
  $$
  select net.http_post(
    url     := 'https://suoqdlnmaemugpkbdpef.supabase.co/functions/v1/super-responder',
    headers := '{"Content-Type":"application/json","Authorization":"Bearer <SERVICE_ROLE_KEY>"}'::jsonb
  );
  $$
);

-- Para verificar / ver el historial:
--   select * from cron.job;
--   select * from cron.job_run_details order by start_time desc limit 10;


-- 3) (Opcional) Cerrar la lectura de las suscripciones -------
-- Hoy cualquiera con la clave anon puede listar tus suscripciones push.
-- La app solo necesita poder insertarlas; leerlas solo las lee la Edge
-- Function, que usa service_role y no pasa por RLS.
--
-- alter table push_subscriptions enable row level security;
-- drop policy if exists "anon puede insertar" on push_subscriptions;
-- create policy "anon puede insertar" on push_subscriptions
--   for insert to anon with check (true);
