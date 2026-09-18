-- ============================================================
-- Plantillas de tareas recurrentes
-- Ejecutar en Supabase -> SQL Editor.
--
-- Las tareas ya vivian en la base, pero las plantillas que las generan (limpieza
-- cada 15 dias, regar las plantas cada 4) seguian en localStorage, o sea en cada
-- navegador por separado. Con 'ultima_generacion' local, dos dispositivos abiertos
-- casi a la vez podian crear dos veces la misma limpieza: ninguno sabia que el otro
-- acababa de generarla.
--
-- La clave es el 'key' de la plantilla y no un id generado: es el mismo identificador
-- que llevan las tareas en 'template_key', y asi la plantilla es una sola aunque se
-- siembre desde dos dispositivos.
-- ============================================================

create table if not exists tareas_recurrentes (
  key               text primary key,              -- 'regar-plantas', 'limpieza-bano'…
  texto             text not null,
  urgencia          smallint not null default 3,   -- 1 urgente, 2 alta, 3 media, 4 baja
  intervalo_dias    smallint not null,
  ico               text,
  ultima_generacion bigint not null default 0,     -- milisegundos; 0 = todavia ninguna
  activa            boolean not null default true,
  created_at        timestamptz not null default now()
);

-- ------------------------------------------------------------
-- Permisos (RLS)
-- La app no tiene login: todo entra con la anon key, igual que el resto de las
-- tablas del proyecto. Una tabla creada por SQL ya viene sin RLS, pero si la
-- creaste desde el Table Editor si lo tiene, y sin politicas el select devuelve []
-- en silencio y el insert falla con 42501. Esta linea la deja como las demas.
-- ------------------------------------------------------------

alter table public.tareas_recurrentes disable row level security;
