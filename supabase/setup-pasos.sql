-- ============================================================
-- Pasos del dia: una metrica de constancia, y nada mas
-- Ejecutar en Supabase -> SQL Editor.
--
-- El dato entra A MANO, mirando Samsung Health o lo que sea que los cuente. Una PWA
-- en el navegador no puede leer esos datos del telefono, asi que no hay integracion
-- automatica que valga: se teclea el numero del dia.
--
-- IMPORTANTE: los pasos NO se convierten a calorias en ningun punto de la app, y no
-- entran en el balance, ni en el deficit, ni en la recalibracion. Dos razones, y las
-- dos son doble conteo:
--   1. Los pasos son NEAT. La recalibracion mide el gasto real por lo que hace la
--      balanza, y ahi dentro ya esta lo que caminaste.
--   2. El suelo de vigilia del balance (basal x 1,2) ya asume que una persona
--      despierta camina. Sumarle el gasto de los pasos seria cobrarlo dos veces
--      contra ese mismo suelo.
-- Por eso esta tabla guarda un entero y nada mas: no hay kcal que derivar de aca.
-- ============================================================

create table if not exists pasos (
  id         bigint generated always as identity primary key,
  fecha      date not null unique,        -- un dia, una fila (upsert por fecha)
  pasos      integer not null,
  created_at timestamptz not null default now()
);

-- Lo que mas se consulta: hoy y los ultimos 7 dias para la media.
create index if not exists pasos_fecha_idx on pasos (fecha desc);

-- ------------------------------------------------------------
-- Permisos (RLS)
-- Igual que 'carnes', 'gym' y 'peso': la app no tiene login y todo entra con la anon
-- key. Una tabla creada por SQL ya viene sin RLS, pero si la creaste desde el Table
-- Editor si lo tiene, y sin politicas el select devuelve [] en silencio y el insert
-- falla con 42501.
-- ------------------------------------------------------------

alter table public.pasos disable row level security;

-- ------------------------------------------------------------
-- Comprobacion: tiene que salir con relrowsecurity = false.
-- ------------------------------------------------------------
select relname, relrowsecurity
  from pg_class
 where relname in ('pasos', 'gym', 'carnes');
