-- ============================================================
-- Mi DLC: alimentos que salen del inventario, y como salieron
-- Ejecutar en Supabase -> SQL Editor.
--
-- El modulo nacio siendo solo carnes y con un unico boton, la papelera, que
-- borraba la fila. Pero comerse algo y tirarlo no son lo mismo: uno es que el
-- control funciono y el otro es comida perdida. Con un solo boton esa diferencia
-- no quedaba en ningun lado y no habia forma de saber cuanto se desperdicia.
--
-- Por eso el alimento ya no se borra al salir: se marca con su destino y se va
-- del inventario activo. La tabla sigue llamandose 'carnes' porque ahi estan los
-- datos de siempre; renombrarla no cambiaria nada de lo que se ve.
-- ============================================================

-- 'consumido' o 'tirado'. NULL = sigue en el inventario.
alter table carnes add column if not exists destino    text;
alter table carnes add column if not exists destino_at timestamptz;

-- Lo que mas se consulta: el inventario activo, por fecha de vencimiento.
create index if not exists carnes_activas_idx
  on carnes (destino, fecha);
