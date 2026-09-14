-- ============================================================
-- Cronómetro en curso
-- Ejecutar en Supabase -> SQL Editor.
--
-- Hasta ahora el cronómetro vivía solo en el navegador. Si el teléfono se quedaba
-- sin batería, se cerraba la app o se borraban los datos del sitio, el tiempo que
-- llevabas corriendo se perdía; y desde la computadora no había forma de verlo.
--
-- La tabla guarda UNA sola fila: el único cronómetro que puede estar corriendo.
-- Arrancar uno nuevo reemplaza al anterior, que es la regla que ya tenía la app
-- (no podés estar haciendo dos cosas a la vez).
--
-- El tiempo no se guarda como un número que haya que ir actualizando, sino como
-- 'base' (lo acumulado antes de la última pausa) más 'arranque' (el instante en que
-- volvió a correr). Así el reloj sigue avanzando solo aunque nadie escriba nada, y
-- cualquier dispositivo calcula lo mismo.
-- ============================================================

create table if not exists cronometro (
  id         smallint primary key default 1 check (id = 1),  -- una sola fila, siempre
  tipo       text not null,          -- 'tiempo' | 'estudio' | 'gym'
  etiqueta1  text,                   -- categoría (Tiempo) o tema (Estudio)
  etiqueta2  text,                   -- subcategoría o subtema
  base       integer not null default 0,   -- segundos acumulados con el reloj en pausa
  arranque   timestamptz,            -- cuándo empezó a correr; null = en pausa
  updated_at timestamptz not null default now()
);

-- ------------------------------------------------------------
-- Permisos (RLS): como el resto de las tablas del proyecto, sin login.
-- ------------------------------------------------------------

alter table public.cronometro disable row level security;
