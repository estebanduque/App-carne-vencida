-- ============================================================
-- Balance energetico de Mi Peso: gasto base + actividad, y el deficit del dia
-- Ejecutar en Supabase -> SQL Editor.
--
-- Cambia el modelo: hasta ahora el gasto por ejercicio era informativo y no tocaba el
-- deficit. Ahora SI entra. El dia que andas en bici gastaste mas, asi que ese dia
-- podes comer mas, y el deficit del dia se calcula con el gasto de ESE dia.
--
-- Como se arma el gasto de un dia:
--   gasto = base + actividad registrada
--   base  = metabolismo basal (Mifflin-St Jeor) x factor de vida sedentaria (1,2)
--   actividad = suma de (MET - 1) x peso x horas de lo registrado en Mi Tiempo
--
-- Las actividades se cobran NETAS (MET - 1) porque un MET es el gasto en reposo, y esa
-- hora en reposo ya esta dentro del basal. Una hora de bici de ciudad a 95 kg son
-- (4-1) x 95 = 285 kcal, no 380.
--
-- Y el doble conteo se evita en el otro extremo: cuando la recalibracion mide el gasto
-- real por lo que hizo la balanza, a ese numero se le RESTA la actividad registrada de
-- esas 2 semanas antes de guardarlo. Lo que se guarda es la base; la actividad se suma
-- aparte, dia a dia. Por eso hace falta 'base_kcal' y no alcanza con 'tdee_objetivo'.
-- ============================================================

-- Factor sobre el basal para la vida de estar despierto sin ejercicio (comer, ducharse,
-- caminar por casa). 1,2 es el valor sedentario estandar. La recalibracion lo vuelve
-- irrelevante en cuanto hay 2 semanas de datos: ahi manda lo medido.
alter table peso_config add column if not exists factor_base numeric(4,2) default 1.2;

-- El gasto base MEDIDO, en kcal/dia, que deja una recalibracion aceptada.
-- NULL = todavia no se midio: se usa la formula.
alter table peso_config add column if not exists base_kcal numeric(6,1);

-- ------------------------------------------------------------
-- La tabla 'bici' queda sin uso
-- ------------------------------------------------------------
-- El cronometro de bici propio se fue: la bici de transporte ya se registra en
-- Mi Tiempo como 'Transporte › Bicicleta', que es de donde ahora salen sus calorias.
-- Tener dos sitios donde anotar el mismo trayecto era pedirle al usuario que eligiera.
--
-- La tabla se deja creada y vacia por si acaso. Cuando quieras sacarla:
--   drop table if exists bici;

-- ------------------------------------------------------------
-- Comprobacion: las dos columnas nuevas tienen que aparecer.
-- ------------------------------------------------------------
select column_name, data_type, column_default
  from information_schema.columns
 where table_name = 'peso_config' and column_name in ('factor_base', 'base_kcal');
