// Convierte lo que comiste —escrito ("dos huevos fritos y un café con leche") o
// fotografiado (el plato servido, o la tabla nutricional de un envase)— en una lista
// de alimentos con sus calorías, para que Mi Peso no dependa de que alguien busque
// cada número a mano.
//
// La clave de Anthropic vive únicamente acá, nunca en index.html, que es público.
//
// Variables de entorno (Project Settings -> Edge Functions -> Secrets):
//   ANTHROPIC_API_KEY   la misma que ya usan interpretar-compras, interpretar-tareas
//                       y analizar-etiqueta.
//
// El slug con el que se la invoca es 'contar-kcal', con guion (comprobado contra el
// endpoint). A 'analizar-etiqueta' Supabase le comió el guion y quedó como
// 'analizaretiqueta', así que el slug se comprueba, no se adivina. Vive en index.html,
// en la constante FN_KCAL.

import Anthropic from "npm:@anthropic-ai/sdk@0.125.0";

const ESQUEMA = {
  type: "object",
  additionalProperties: false,
  required: ["items", "nota"],
  properties: {
    items: {
      type: "array",
      // Sin 'maxItems': los esquemas de structured outputs no lo aceptan y la API
      // devuelve un 400. El tope de 20 lo pone el saneo de mas abajo, que es donde
      // de todos modos tiene que estar: lo que llega del modelo no se cree.
      description:
        "Un elemento por alimento distinto. Si se comieron 3 galletas, es UN elemento " +
        "con cantidad '3 unidades' y las kcal de las tres, no tres elementos.",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["nombre", "cantidad", "kcal"],
        properties: {
          nombre: {
            type: "string",
            description:
              "El alimento o plato, corto y en minúsculas. Ej: 'huevo frito', " +
              "'café con leche', 'pasta con salsa de tomate'.",
          },
          cantidad: {
            type: "string",
            description:
              "La porción a la que corresponden las kcal: '2 unidades', '150 g', " +
              "'1 taza', '1 plato'. Cadena vacía solo si no hay forma de estimarla.",
          },
          kcal: {
            type: "number",
            description:
              "Calorías TOTALES de esa cantidad, no por 100 g. Número entero.",
          },
        },
      },
    },
    nota: {
      type: "string",
      description:
        "Una frase corta y solo si hace falta: qué se supuso cuando el dato no estaba " +
        "(tamaño de la porción, si lleva aceite, etc.). Cadena vacía si no hay nada que aclarar.",
    },
  },
} as const;

const SISTEMA =
  `Estimás las calorías de lo que una persona comió, para el diario de un módulo de
peso. Quien te consulta vive en Francia y la app está en español: los productos y las
porciones suelen ser franceses y la respuesta va siempre en español.

Cómo estimar:
- Si ves una tabla nutricional (etiqueta de un envase), usá SUS números. Vienen casi
  siempre por 100 g o por porción: convertilos a lo que se comió de verdad. Si la foto
  no deja ver cuánto se comió, asumí una porción del envase y decilo en la nota.
- Si ves un plato servido, estimá la porción por lo que se ve al lado (el tamaño del
  plato, los cubiertos) y cobrá lo que no se ve pero está: el aceite de una fritura,
  la manteca de un salteado, el azúcar de un café cortado.
- Si te lo escriben, tomá las porciones típicas de esos alimentos en Francia.
- Agrupá por alimento, no por unidad: '3 galletas' es un elemento de 3.

Sobre la precisión:
- Esto alimenta un cálculo de déficit calórico donde lo que importa es la media de dos
  semanas, no el dato de una comida. Una estimación razonable sirve; una precisión
  fingida (347 kcal) no es más verdadera que 350 y da falsa confianza. Redondeá.
- Si no reconocés comida en la imagen o el texto, devolvé la lista vacía y explicá en
  la nota qué viste. Inventar un plato que no está es peor que no devolver nada: esto
  se va a sumar al día de alguien.
- Las bebidas cuentan. El agua, el café solo y el té sin azúcar son 0 kcal, y está
  bien devolverlos con 0: sirve para que quede registrado que se tomaron.`;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const TIPOS_IMAGEN = ["image/jpeg", "image/png", "image/webp", "image/gif"];

// Topes de cordura: esto entra derecho a la suma del día. Un modelo que devuelve
// 99999 kcal por un yogur arruinaria dos semanas de calculo sin que se note.
const KCAL_MAX_ITEM = 5000;

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  try {
    const { texto, imageData, mediaType } = await req.json();
    const hayTexto = typeof texto === "string" && texto.trim().length > 0;
    const hayImagen = typeof imageData === "string" && imageData.length > 0;
    if (!hayTexto && !hayImagen) {
      return Response.json(
        { ok: false, error: "falta 'texto' o 'imageData'" },
        { status: 400, headers: cors },
      );
    }
    const tipoImagen = TIPOS_IMAGEN.includes(mediaType) ? mediaType : "image/jpeg";

    const client = new Anthropic({ apiKey: Deno.env.get("ANTHROPIC_API_KEY")! });

    // El contenido va en el orden que mejor lee el modelo: primero la imagen, después
    // la instruccion. Si vienen las dos cosas, el texto describe la foto (por ejemplo
    // "me comi la mitad"), asi que se manda junto y no en dos llamadas.
    const contenido: Anthropic.ContentBlockParam[] = [];
    if (hayImagen) {
      contenido.push({
        type: "image",
        source: { type: "base64", media_type: tipoImagen, data: imageData },
      });
    }
    contenido.push({
      type: "text",
      text: hayTexto
        ? (hayImagen
          ? `Esto es lo que comí. Lo que aclaro por escrito manda sobre lo que se ve en la foto: ${texto.trim()}`
          : `Esto es lo que comí: ${texto.trim()}`)
        : "Esto es lo que comí. Contame qué hay y cuántas calorías son.",
    });

    const response = await client.messages.create({
      model: "claude-opus-5",
      max_tokens: 4000,
      // Estimar una porcion pide algo de cabeza (lo que no se ve: el aceite, el
      // azucar), pero no es un problema dificil. 'medium' es el punto donde deja de
      // mejorar la respuesta y solo sube la espera con el telefono en la mano.
      output_config: {
        effort: "medium",
        format: { type: "json_schema", schema: ESQUEMA },
      },
      system: SISTEMA,
      messages: [{ role: "user", content: contenido }],
    });

    if (response.stop_reason === "refusal") {
      return Response.json(
        { ok: false, error: "la petición fue rechazada", detalle: response.stop_details },
        { status: 422, headers: cors },
      );
    }

    const salida = response.content
      .filter((b) => b.type === "text")
      .map((b) => (b as { text: string }).text)
      .join("");

    let datos: Record<string, unknown>;
    try {
      datos = JSON.parse(salida);
    } catch {
      return Response.json(
        { ok: false, error: "respuesta ilegible del modelo", crudo: salida.slice(0, 500) },
        { status: 502, headers: cors },
      );
    }

    // Se sanea aca y no en el cliente: de aca sale un numero que se suma al dia.
    const crudos = Array.isArray(datos.items) ? datos.items : [];
    const items = crudos
      .map((x) => {
        const it = x as Record<string, unknown>;
        const kcal = Number(it.kcal);
        return {
          nombre: typeof it.nombre === "string" ? it.nombre.trim().slice(0, 60) : "",
          cantidad: typeof it.cantidad === "string" ? it.cantidad.trim().slice(0, 40) : "",
          kcal: Number.isFinite(kcal) ? Math.min(Math.max(Math.round(kcal), 0), KCAL_MAX_ITEM) : 0,
        };
      })
      .filter((it) => it.nombre.length > 0)
      .slice(0, 20);

    const total = items.reduce((a, it) => a + it.kcal, 0);
    const nota = typeof datos.nota === "string" ? datos.nota.trim().slice(0, 240) : "";

    return Response.json({ ok: true, items, total, nota, uso: response.usage },
                         { headers: cors });
  } catch (e: unknown) {
    const err = e as { status?: number; message?: string };
    if (err instanceof Anthropic.AuthenticationError) {
      return Response.json(
        { ok: false, error: "ANTHROPIC_API_KEY invalida o no configurada" },
        { status: 401, headers: cors },
      );
    }
    if (err instanceof Anthropic.RateLimitError) {
      return Response.json(
        { ok: false, error: "limite de peticiones alcanzado, probá en un momento" },
        { status: 429, headers: cors },
      );
    }
    // 529 = la API está saturada. Pasa, y no es culpa de lo que mandaste: el mensaje
    // tiene que decir "probá de nuevo" y no un volcado de JSON en un alert.
    if (err?.status === 529) {
      return Response.json(
        { ok: false, error: "la IA está saturada en este momento, probá de nuevo en un minuto" },
        { status: 529, headers: cors },
      );
    }
    return Response.json(
      { ok: false, error: err?.message ?? String(e) },
      { status: err?.status ?? 500, headers: cors },
    );
  }
});
