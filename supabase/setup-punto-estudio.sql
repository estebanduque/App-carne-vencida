-- ============================================================
-- Tercer nivel en Mi Estudio: tema › subtema › punto
-- Ejecutar en Supabase -> SQL Editor.
--
-- Hasta ahora el tiempo se clasificaba en dos niveles, pero el repaso ya trabajaba
-- en tres: 'puntos_repaso' guarda los puntos de cada subtema y 'notas_estudio' ya
-- puntúa por punto. Faltaba que el cronómetro pudiera decir en cuál de ellos
-- estuviste.
--
-- Las dos columnas son opcionales: las sesiones que ya existen se quedan con el
-- punto vacío y siguen contando igual. No hay nada que migrar.
-- ============================================================

-- Dónde se guarda el punto de cada sesión de estudio.
alter table public.estudio
  add column if not exists punto text;

-- La tercera etiqueta del cronómetro en curso, para que el punto sobreviva a una
-- pausa y se vea desde el otro dispositivo, igual que el tema y el subtema.
alter table public.cronometro
  add column if not exists etiqueta3 text;

-- ------------------------------------------------------------
-- Comprobación: las dos tienen que aparecer.
-- ------------------------------------------------------------
select table_name, column_name
  from information_schema.columns
 where (table_name = 'estudio'    and column_name = 'punto')
    or (table_name = 'cronometro' and column_name = 'etiqueta3');
