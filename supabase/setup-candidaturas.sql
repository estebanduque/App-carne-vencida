-- ============================================================
-- Mis Candidaturas: el estado de las candidaturas al MS/LL.M. (rentrée 2027)
-- Ejecutar en Supabase -> SQL Editor.
--
-- Lo que es de las escuelas (sesiones, cierres, documentos exigidos, tasas) es
-- publico y vive en la app. Aca se guarda solo TU estado, en una tabla de clave y
-- valor, para no tener que tocar la base cada vez que una escuela cambia algo:
--
--   'prog:hec'           {"sesion":"hec-r2","estado":"preparando"}
--   'doc:essec:cv'       {"estado":"ready"}          missing | draft | ready
--   'test'               {"tipo":"TOEIC L&R","fecha":"2026-12-05","puntaje":"945"}
--   'abierto:escp-hora'  {"resuelto":true,"nota":"cierra a las 23:59"}
--
-- Ningun documento sube a la base: los PDF se quedan en tu computadora.
-- ============================================================

create table if not exists candidaturas (
  clave      text primary key,
  valor      jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- ------------------------------------------------------------
-- Permisos (RLS)
-- Igual que el resto de las tablas: la app no tiene login y todo entra con la anon
-- key. Una tabla creada por SQL ya viene sin RLS, pero si la creaste desde el Table
-- Editor si lo tiene, y sin politicas el select devuelve [] en silencio.
-- ------------------------------------------------------------

alter table public.candidaturas disable row level security;

-- ------------------------------------------------------------
-- Comprobacion: tiene que salir con relrowsecurity = false.
-- ------------------------------------------------------------
select relname, relrowsecurity
  from pg_class
 where relname = 'candidaturas';
