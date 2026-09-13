-- ============================================================
-- Anti-repeticion de los avisos de compras
-- Ejecutar en Supabase -> SQL Editor.
--
-- La funcion 'compras-cerca' se llama en CADA desbloqueo del telefono.
-- Sin esto te avisaria una y otra vez mientras estas dentro del super.
-- Guarda cuando se aviso de cada lugar y no repite dentro de unas horas.
-- ============================================================

create table if not exists avisos_compra (
  lugar_id   bigint primary key,
  cuando     timestamptz not null default now()
);

alter table public.avisos_compra disable row level security;
