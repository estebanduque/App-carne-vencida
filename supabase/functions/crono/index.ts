// Arranca un cronómetro desde fuera de la app: el reloj, un widget, un atajo.
//
// Desde que el cronómetro vive en la tabla 'cronometro' (ver setup-cronometro.sql),
// no hace falta pasar por el teléfono: cualquier cosa que sepa abrir una URL puede
// arrancarlo, y la app se entera sola la próxima vez que mire la base.
//
// Responde a un GET simple, sin cabeceras ni cuerpo, porque eso es lo único que un
// botón de reloj sabe hacer:
//
//   .../functions/v1/crono?k=<CRONO_KEY>&a=civil
//   .../functions/v1/crono?k=<CRONO_KEY>&tipo=tiempo&e1=Hogar&e2=Cocinar
//
// La hora de arranque la pone el servidor: un botón de reloj no sabe calcular un
// timestamp ISO, y ese era justamente el motivo por el que no alcanzaba con pegarle
// directo a la API REST.
//
// Configuración (Project Settings -> Edge Functions):
//   CRONO_KEY   la clave que va en ?k=. Sin ella la función no atiende a nadie.
//   SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY las inyecta Supabase sola.
// Además hay que desactivar "Verify JWT" en esta función: el reloj no manda cabeceras.

import { createClient } from "npm:@supabase/supabase-js@2";

// Atajos con nombre, para que la URL del botón sea corta y legible en un reloj.
// 'tipo' tiene que ser uno de los tres que entiende la app: tiempo | estudio | gym.
// En 'estudio', e1 debe coincidir exactamente con el nombre del tema en la app.
const ATAJOS: Record<string, { tipo: string; e1: string; e2: string }> = {
  // Estudio
  civil:      { tipo: "estudio", e1: "Droit civil",      e2: "" },
  comercial:  { tipo: "estudio", e1: "Droit commercial", e2: "" },
  procedures: { tipo: "estudio", e1: "Procédures",       e2: "" },
  deonto:     { tipo: "estudio", e1: "Déontologie",      e2: "" },
  // Mi Tiempo
  hogar:      { tipo: "tiempo", e1: "Hogar",             e2: "" },
  ocio:       { tipo: "tiempo", e1: "Ocio",              e2: "" },
  dormir:     { tipo: "tiempo", e1: "Dormir",            e2: "" },
  cuidado:    { tipo: "tiempo", e1: "Cuidado personal",  e2: "" },
  transporte: { tipo: "tiempo", e1: "Transporte",        e2: "" },
  trabajo:    { tipo: "tiempo", e1: "Trabajo",           e2: "" },
  proyecto:   { tipo: "tiempo", e1: "Proyecto personal", e2: "" },
  otro:       { tipo: "tiempo", e1: "Otro",              e2: "" },
  // El gimnasio tiene cronómetro propio en la app, con su propio tipo.
  gym:        { tipo: "gym",    e1: "",                  e2: "" },
};

const TIPOS = ["tiempo", "estudio", "gym"];

// Una respuesta que se pueda leer en una pantalla de reloj: dos líneas grandes y ya.
function pagina(titulo: string, detalle: string, color: string, status = 200): Response {
  const html = `<!doctype html><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  html,body{margin:0;height:100%;background:#0A1628;color:#fff;
    font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center}
  div{text-align:center;padding:16px}
  h1{font-size:22px;margin:0 0 6px;color:${color}}
  p{font-size:14px;margin:0;color:rgba(255,255,255,0.6);line-height:1.35}
</style>
<div><h1>${titulo}</h1><p>${detalle}</p></div>`;
  return new Response(html, {
    status,
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
  });
}

function esc(s: string): string {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// Segundos que lleva una fila del cronómetro: lo acumulado más, si está corriendo,
// lo que pasó desde que arrancó. Es el mismo cálculo que hace la app.
function segundosDe(fila: { base?: number | null; arranque?: string | null }): number {
  let s = Number(fila.base) || 0;
  if (fila.arranque) s += Math.floor((Date.now() - new Date(fila.arranque).getTime()) / 1000);
  return s;
}

Deno.serve(async (req: Request) => {
  try {
    const url = new URL(req.url);

    // Falla cerrado: si no hay clave configurada, no atiende. Es preferible a quedar
    // abierta sin que nadie se entere.
    const clave = Deno.env.get("CRONO_KEY");
    if (!clave) return pagina("Sin configurar", "Falta el secreto CRONO_KEY", "#EF9F27", 500);
    if (url.searchParams.get("k") !== clave) return pagina("No", "Clave incorrecta", "#E24B4A", 403);

    // Qué arrancar: o un atajo con nombre, o los campos sueltos.
    const a = (url.searchParams.get("a") || "").toLowerCase().trim();
    let destino = ATAJOS[a];
    if (!destino) {
      const tipo = (url.searchParams.get("tipo") || "").toLowerCase().trim();
      if (!tipo) {
        return pagina("¿Qué arranco?", "Atajos: " + Object.keys(ATAJOS).join(", "), "#EF9F27", 400);
      }
      if (!TIPOS.includes(tipo)) {
        return pagina("Tipo inválido", "Tiene que ser: " + TIPOS.join(", "), "#E24B4A", 400);
      }
      destino = {
        tipo,
        e1: (url.searchParams.get("e1") || "").trim(),
        e2: (url.searchParams.get("e2") || "").trim(),
      };
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // ---- Lo que ya estaba corriendo no se tira ----
    // La app pregunta antes de cerrar un cronómetro con tiempo encima; un botón de
    // reloj no puede preguntar nada, así que aquí la decisión ya está tomada: se
    // guarda como sesión. Perder media hora por tocar el botón equivocado sería el
    // peor comportamiento posible, y es justo el escenario más probable en un reloj.
    const { data: actual, error: errLeer } = await supabase
      .from("cronometro").select("*").eq("id", 1).maybeSingle();
    if (errLeer) throw errLeer;

    let guardado = "";
    if (actual) {
      const minutos = Math.round(segundosDe(actual) / 60);
      if (minutos >= 1) {
        const created_at = new Date().toISOString();
        const e1 = actual.etiqueta1 || "";
        const e2 = actual.etiqueta2 || "";
        if (actual.tipo === "estudio") {
          const { error } = await supabase.from("estudio")
            .insert([{ tema: e1, subtema: e2 || "General", minutos, created_at }]);
          if (error) throw error;
          guardado = `Guardé ${minutos} min de ${e1}`;
        } else {
          // El cronómetro del gimnasio se guarda en Mi Tiempo como Deporte · Gym,
          // igual que cuando se termina desde la app.
          const categoria = actual.tipo === "gym" ? "Deporte" : (e1 || "Otro");
          const subcategoria = actual.tipo === "gym" ? "Gym" : (e2 || "General");
          const { error } = await supabase.from("tiempo")
            .insert([{ categoria, subcategoria, minutos, created_at }]);
          if (error) throw error;
          guardado = `Guardé ${minutos} min de ${categoria}`;
        }
      }
    }

    // ---- Arranca el nuevo ----
    // base 0 y arranque ahora: a partir de acá el reloj avanza solo, sin que nadie
    // tenga que escribir nada más.
    const { error: errGuardar } = await supabase.from("cronometro").upsert({
      id: 1,
      tipo: destino.tipo,
      etiqueta1: destino.e1,
      etiqueta2: destino.e2,
      base: 0,
      arranque: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    if (errGuardar) throw errGuardar;

    const nombre = destino.tipo === "gym" ? "Gym" : (destino.e1 || destino.tipo);
    const detalle = destino.e2 ? esc(destino.e2) : "";
    return pagina(
      "▶ " + esc(nombre),
      [detalle, esc(guardado)].filter(Boolean).join("<br>") || "Corriendo",
      "#5DCAA5",
    );
  } catch (e: any) {
    return pagina("Falló", esc(e?.message ?? String(e)), "#E24B4A", 500);
  }
});
