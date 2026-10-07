-- ============================================================
-- Mi Peso: el banco de comidas por categorias
-- Ejecutar en Supabase -> SQL Editor (despues de setup-comidas.sql).
--
-- 'alimentos' ya guardaba todo lo que se cargaba en un dia, pero la app solo mostraba
-- los 12 mas usados y el resto no se podia volver a usar. Ahora se ve el banco entero,
-- separado por categorias, y lo que esta en el banco no se le vuelve a pedir a la IA.
--
-- La categoria es texto libre a proposito: las que se crean desde la app ("Desayunos",
-- "Frutas") se guardan en la comida misma, y no hay tabla de categorias que mantener.
-- ============================================================

alter table alimentos add column if not exists categoria text;

create index if not exists alimentos_categoria_idx on alimentos (categoria);

-- ------------------------------------------------------------
-- Las comidas que ya estaban en el banco, clasificadas una por una.
-- Solo toca las que no tienen categoria: correrlo de nuevo no pisa lo que se haya
-- cambiado desde la app.
-- ------------------------------------------------------------

update alimentos set categoria = 'Bebidas'
 where categoria is null and id in (1, 13, 14, 15, 16, 19, 21, 23, 24, 25, 49, 63, 67, 118, 134);

update alimentos set categoria = 'Comida rápida'
 where categoria is null and id in (2, 50, 59, 60, 61, 62, 69, 86, 87, 89, 99, 101, 108, 110, 111,
                                    125, 127, 133, 138, 147);

update alimentos set categoria = 'Proteínas'
 where categoria is null and id in (3, 5, 12, 27, 31, 39, 40, 43, 53, 57, 64, 71, 72, 74, 78, 79, 83,
                                    85, 93, 94, 98, 103, 117, 119, 120, 124, 130, 136, 137, 139, 142, 143);

update alimentos set categoria = 'Carbohidratos'
 where categoria is null and id in (4, 9, 18, 37, 42, 45, 52, 55, 56, 73, 91, 102, 106, 140, 144);

update alimentos set categoria = 'Ensaladas'
 where categoria is null and id in (10, 29, 33, 34, 66);

update alimentos set categoria = 'Snacks y dulces'
 where categoria is null and id in (7, 8, 26, 30, 36, 46, 47, 48, 75, 122, 123, 149);

-- Salsas, aceites y lo que no encaja en ninguna. Lo que se agregue despues sin
-- categoria tambien cae aca en la app.
update alimentos set categoria = 'Otros'
 where categoria is null;

-- ------------------------------------------------------------
-- Comprobacion: cuantas comidas quedaron en cada categoria.
-- ------------------------------------------------------------
select categoria, count(*) as comidas
  from alimentos
 group by categoria
 order by comidas desc;
