-- ============================================================
-- Tareas (to-do list)
-- Ejecutar en Supabase -> SQL Editor.
--
-- El modulo nacio guardando en localStorage, es decir en un solo navegador: lo que
-- escribias en el telefono no llegaba a la computadora, y se perdia al borrar los
-- datos del sitio. Esta tabla lo pone donde vive el resto de la app.
--
-- El id lo genera el cliente con Date.now(), por eso no es 'identity': asi la tarea
-- ya tiene id antes de llegar al servidor y la pantalla no espera a la red.
-- ============================================================

create table if not exists tareas (
  id           bigint primary key,                 -- Date.now() del cliente
  texto        text not null,
  urgencia     smallint not null default 3,        -- 1 urgente, 2 alta, 3 media, 4 baja
  hecho        boolean not null default false,
  created      bigint not null,                    -- milisegundos, para ordenar
  template_key text,                               -- si nacio de una plantilla recurrente
  created_at   timestamptz not null default now()
);

-- Lo que mas se consulta: las pendientes, ordenadas por urgencia.
create index if not exists tareas_pendientes_idx
  on tareas (hecho, urgencia, created);

-- ------------------------------------------------------------
-- Permisos (RLS)
-- La app no tiene login: todo entra con la anon key, igual que el resto de las
-- tablas del proyecto. Una tabla creada por SQL ya viene sin RLS, pero si la
-- creaste desde el Table Editor si lo tiene, y sin politicas el select devuelve []
-- en silencio y el insert falla con 42501. Esta linea la deja como las demas.
-- ------------------------------------------------------------

alter table public.tareas disable row level security;
