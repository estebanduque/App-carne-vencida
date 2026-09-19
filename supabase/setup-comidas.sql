-- ============================================================
-- El diario de comidas de Mi Peso
-- Ejecutar en Supabase -> SQL Editor.
--
-- Hasta ahora las kcal del dia se escribian a mano en una sola casilla, lo que obliga
-- a buscar cada numero por fuera de la app y a sumarlos de cabeza. Nadie sostiene eso
-- dos semanas seguidas, y sin kcal no hay recalibracion del gasto.
--
-- Ahora se carga lo que se comio (escrito o de una foto), una funcion lo convierte en
-- alimentos con calorias, y el dia es la suma de esas filas. 'peso.kcal_ingeridas'
-- sigue existiendo y se mantiene sincronizada con esa suma: es lo que lee el calculo
-- del deficit, y los dias viejos cargados a mano siguen valiendo.
--
-- 'alimentos' es la memoria: lo que ya se estimo una vez queda guardado con su porcion
-- y sus kcal, asi el desayuno de todos los dias se agrega con un toque y sin gastar
-- una llamada a la IA.
-- ============================================================

create table if not exists comidas (
  id         bigint generated always as identity primary key,
  fecha      date not null,                 -- a que dia se le suma
  nombre     text not null,
  cantidad   text,                          -- '2 unidades', '150 g', como se estimo
  kcal       numeric(6,1) not null,
  origen     text not null default 'ia',    -- 'ia' | 'guardado' | 'manual'
  created_at timestamptz not null default now()
);

-- Lo que mas se consulta: el dia que estas mirando, y los ultimos 14 para el calculo.
create index if not exists comidas_fecha_idx on comidas (fecha desc);

create table if not exists alimentos (
  id         bigint generated always as identity primary key,
  nombre     text not null unique,          -- en minusculas, es la clave para no duplicar
  etiqueta   text not null,                 -- como se muestra en el chip
  cantidad   text,
  kcal       numeric(6,1) not null,
  veces      integer not null default 0,    -- cuantas veces se agrego: ordena los chips
  ultima_vez timestamptz,
  created_at timestamptz not null default now()
);

-- Los chips salen ordenados por uso, que es lo unico que hace util a esta tabla.
create index if not exists alimentos_veces_idx on alimentos (veces desc);

-- ------------------------------------------------------------
-- Permisos (RLS)
-- Igual que 'peso', 'carnes' y 'gym': la app no tiene login y todo entra con la anon
-- key. Una tabla creada por SQL ya viene sin RLS, pero si la creaste desde el Table
-- Editor si lo tiene, y sin politicas el select devuelve [] en silencio y el insert
-- falla con 42501.
-- ------------------------------------------------------------

alter table public.comidas   disable row level security;
alter table public.alimentos disable row level security;

-- ------------------------------------------------------------
-- Comprobacion: las dos tienen que salir con relrowsecurity = false.
-- ------------------------------------------------------------
select relname, relrowsecurity
  from pg_class
 where relname in ('comidas', 'alimentos', 'peso', 'carnes');
