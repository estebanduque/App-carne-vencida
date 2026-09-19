-- ============================================================
-- Mi Peso: la pesada del dia y lo que se comio ese dia
-- Ejecutar en Supabase -> SQL Editor.
--
-- El peso de una mañana no dice nada: sube y baja con el agua, la sal y la hora.
-- Lo que si dice algo es el promedio de los ultimos 7 dias, y por eso el modulo
-- guarda una fila por fecha (no varias pesadas sueltas) y dibuja la linea sobre
-- ese promedio. 'fecha' es unica justamente para eso: volver a pesarse el mismo
-- dia corrige la fila, no agrega otra.
--
-- Las kcal son opcionales porque no siempre se anotan, pero sin ellas no hay
-- recalibracion: el gasto real se despeja de lo que se comio y de lo que se bajo.
-- ============================================================

create table if not exists peso (
  id             bigint generated always as identity primary key,
  fecha          date not null unique,          -- un dia, una fila (upsert por fecha)
  peso_kg        numeric(5,2) not null,
  kcal_ingeridas numeric(6,1),                  -- opcional: si falta, ese dia no entra en la media
  created_at     timestamptz not null default now()
);

-- Lo que mas se consulta: los ultimos dias, de mas nuevo a mas viejo.
create index if not exists peso_fecha_idx on peso (fecha desc);

-- Una sola fila de configuracion (id = 1). El check lo garantiza: sin el, un
-- insert distraido crearia una segunda config y la app leeria la equivocada.
create table if not exists peso_config (
  id             smallint primary key default 1,
  peso_objetivo  numeric(5,2),                  -- lo carga el usuario desde la app
  tdee_objetivo  numeric(6,1) default 2755,     -- gasto estimado, se recalibra solo
  deficit        numeric(5,1) default 640,      -- ingesta objetivo = tdee_objetivo - deficit
  altura_cm      numeric(5,1) default 180,
  edad           smallint default 34,
  updated_at     timestamptz not null default now(),
  constraint peso_config_single_row check (id = 1)
);

insert into peso_config (id, peso_objetivo) values (1, null) on conflict (id) do nothing;

-- Cuando se acepto por ultima vez una recalibracion. Va aparte de 'updated_at'
-- porque updated_at tambien se mueve al guardar la meta, y entonces cambiar el
-- peso objetivo reiniciaria sin querer el plazo de las 2 semanas.
-- Si esta columna no existe, la app guarda igual: solo vuelve a proponer el
-- ajuste en la siguiente apertura.
alter table peso_config add column if not exists recalibrado_at date;

-- ------------------------------------------------------------
-- Permisos (RLS)
-- La app no tiene login: todo entra con la anon key, igual que 'carnes' y 'gym'.
-- Una tabla creada por SQL ya viene sin RLS, pero si la creaste desde el Table
-- Editor si lo tiene, y sin politicas el select devuelve [] en silencio y el
-- insert falla con 42501. Estas dos lineas las dejan como las demas.
-- ------------------------------------------------------------

alter table public.peso        disable row level security;
alter table public.peso_config disable row level security;

-- ------------------------------------------------------------
-- Comprobacion: las dos tienen que salir con relrowsecurity = false.
-- ------------------------------------------------------------
select relname, relrowsecurity
  from pg_class
 where relname in ('peso', 'peso_config', 'carnes', 'gym');
