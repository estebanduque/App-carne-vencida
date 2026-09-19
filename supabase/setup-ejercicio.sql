-- ============================================================
-- Seguimiento de ejercicio: tonelaje, cardio con gasto, y la bici de transporte
-- Ejecutar en Supabase -> SQL Editor.
--
-- NO se crean tablas 'fuerza' ni 'cardio'. La tabla 'gym' YA guarda las dos cosas:
--   fuerza -> grupo, maquina, series, reps, peso
--   cardio -> grupo = 'Cardio', maquina = la actividad, tiempo = minutos
-- Partir eso en tablas nuevas romperia el historial en dos y obligaria a leer de dos
-- lados para dibujar la misma lista. Se extiende con las dos columnas que faltaban.
--
-- El tonelaje NO se guarda: es Σ(peso × series × reps) y se calcula al dibujar. Un
-- total guardado se queda viejo en cuanto se corrige una serie.
--
-- La bici sí es tabla nueva: un trayecto de transporte no es una sesion de gimnasio
-- (no tiene grupo muscular ni series) y se mide con un cronometro en la calle.
--
-- IMPORTANTE, decision de arquitectura (Modelo A, empirico): 'kcal_est' es INFORMATIVO.
-- No se suma ni se resta en el calculo del deficit ni en la recalibracion de TDEE de
-- Mi Peso. Esa recalibracion ya mide el gasto real por lo que hace la balanza, y ahi
-- dentro ya esta lo que gastaste entrenando: sumarlo aparte seria contarlo dos veces.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Cardio dentro de 'gym': distancia y gasto estimado
-- ------------------------------------------------------------
-- Las dos son opcionales: las sesiones que ya existen se quedan vacias y siguen
-- contando igual. No hay nada que migrar.
alter table public.gym add column if not exists distancia_km numeric(6,2);
alter table public.gym add column if not exists kcal_est     numeric(6,1);

-- ------------------------------------------------------------
-- 2. Bici de transporte
-- ------------------------------------------------------------
create table if not exists bici (
  id           bigint generated always as identity primary key,
  fecha        date not null,                  -- el dia del trayecto, en hora local
  inicio       timestamptz not null,
  fin          timestamptz not null,
  duracion_seg integer not null,
  distancia_km numeric(6,2),                   -- opcional: se escribe al parar
  kcal_est     numeric(6,1),                   -- MET x peso x horas. Informativo.
  created_at   timestamptz not null default now()
);

-- Lo que mas se consulta: los trayectos de hoy y del ultimo mes.
create index if not exists bici_fecha_idx on bici (fecha desc);

-- ------------------------------------------------------------
-- Permisos (RLS)
-- Igual que 'gym', 'carnes' y 'peso': la app no tiene login y todo entra con la anon
-- key. Una tabla creada por SQL ya viene sin RLS, pero si la creaste desde el Table
-- Editor si lo tiene, y sin politicas el select devuelve [] en silencio y el insert
-- falla con 42501.
-- ------------------------------------------------------------

alter table public.bici disable row level security;

-- ------------------------------------------------------------
-- Comprobaciones: las columnas nuevas y el RLS de la tabla nueva.
-- ------------------------------------------------------------
select column_name
  from information_schema.columns
 where table_name = 'gym' and column_name in ('distancia_km', 'kcal_est');

select relname, relrowsecurity
  from pg_class
 where relname in ('bici', 'gym', 'carnes');
