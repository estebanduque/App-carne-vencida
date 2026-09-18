// Lee la etiqueta de un alimento de una foto y devuelve su tipo, una descripción corta
// y la fecha de caducidad, para llenar el formulario de Mi DLC sin tipear.
//
// Reemplaza a un Cloudflare Worker (long-breeze-5893.duqes-j.workers.dev) que hacía lo
// mismo. Se mudó por dos razones: el prompt vivía fuera del repo, así que nadie sabía
// dónde tocarlo cuando el módulo dejó de ser solo carnes; y la clave de Anthropic ya
// estaba cargada acá para las otras dos funciones. Cuando esta ande, el Worker se puede
// borrar desde el panel de Cloudflare.
//
// Variables de entorno (Project Settings -> Edge Functions -> Secrets):
//   ANTHROPIC_API_KEY   clave de la API de Claude (console.anthropic.com). Es la misma
//                       que ya usan interpretar-compras e interpretar-tareas.
//
// OJO con el nombre: Supabase le asigna un slug al crearla y ese slug es el que va en
// la URL. Anotá el que te toque y ponelo en index.html (como pasó con 'bright-worker'
// y 'super-responder').

import Anthropic from "npm:@anthropic-ai/sdk@0.125.0";

// Los mismos tipos que ofrece el selector de la app. Si cambian allá (constante EMOJIS
// en index.html), cambiarlos acá: un tipo que no esté en esta lista llega al cliente y
// no coincide con ninguna opción, así que el selector se queda en la primera.
const TIPOS = [
  "Res / ternera",
  "Pollo",
  "Cerdo",
  "Pescado",
  "Mariscos",
  "Embutidos",
  "Lácteos",
  "Huevos",
  "Frutas y verduras",
  "Pan y panadería",
  "Conservas",
  "Pasta y arroz",
  "Legumbres",
  "Salsas y condimentos",
  "Bebidas",
  "Snacks y dulces",
  "Congelados",
  "Otro",
] as const;

const UBICACIONES = ["Refrigerador", "Congelador", "Despensa"] as const;

const ESQUEMA = {
  type: "object",
  additionalProperties: false,
  required: ["tipo", "desc", "fecha", "ubicacion"],
  properties: {
    tipo: {
      type: "string",
      enum: TIPOS,
      description: "La categoría del alimento. 'Otro' si no encaja en ninguna.",
    },
    desc: {
      type: "string",
      description:
        "Qué es, en dos o tres palabras y en minúscula. Ej: 'muslos de pollo', " +
        "'atún en aceite'. Cadena vacía si la etiqueta no lo dice.",
    },
    fecha: {
      type: ["string", "null"],
      description:
        "Fecha de caducidad en formato YYYY-MM-DD. null si no se lee ninguna.",
    },
    ubicacion: {
      type: "string",
      enum: UBICACIONES,
      description: "Dónde se guarda este alimento según lo que diga la etiqueta.",
    },
  },
} as const;

const SISTEMA =
  `Leés la etiqueta de un alimento en una foto y devolvés sus datos para un
inventario doméstico.

Quien saca la foto vive en Francia y la app está en español, así que la etiqueta
suele estar en francés y la respuesta va en español.

Sobre la fecha:
- Buscá "DLC", "À consommer jusqu'au", "DDM", "À consommer de préférence avant",
  "Best before", "Use by", "Caducidad", "Consumir antes de", o una fecha suelta.
- Los formatos europeos van DÍA/MES/AÑO: "05/11/26" es el 5 de noviembre de 2026,
  no el 11 de mayo. Con año de dos cifras, asumí 20XX.
- Si ves varias fechas, la de caducidad es la que va junto a esas palabras. Una
  fecha de envasado o de fabricación NO es la de caducidad.
- Si no se lee ninguna con claridad, devolvé null. Inventar una fecha es peor que
  no dar ninguna: la app avisa en base a esto.

Sobre la ubicación, de lo que diga la etiqueta:
- "À conserver entre 0°C et +4°C", "Réfrigérer", "Mantener refrigerado" -> Refrigerador
- "À conserver au congélateur", "-18°C", "Surgelé" -> Congelador
- "À conserver au sec", "temperatura ambiente", o una conserva, pasta, arroz,
  legumbre o lata sin indicación de frío -> Despensa
- Si no lo dice, elegí lo razonable para ese alimento: la carne fresca y los
  lácteos al Refrigerador, las latas y los secos a la Despensa.

Sobre el tipo: elegí la categoría de la lista que mejor encaje. 'Otro' solo si de
verdad no entra en ninguna.`;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const TIPOS_IMAGEN = ["image/jpeg", "image/png", "image/webp", "image/gif"];

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  try {
    const { imageData, mediaType } = await req.json();
    if (!imageData || typeof imageData !== "string") {
      return Response.json({ ok: false, error: "falta 'imageData'" }, { status: 400, headers: cors });
    }
    // El cliente manda JPEG siempre (lo reencoda en un canvas antes de subir), pero un
    // media_type que la API no acepta da un 400 poco claro: mejor acotarlo acá.
    const tipoImagen = TIPOS_IMAGEN.includes(mediaType) ? mediaType : "image/jpeg";

    const client = new Anthropic({ apiKey: Deno.env.get("ANTHROPIC_API_KEY")! });

    const response = await client.messages.create({
      model: "claude-opus-5",
      max_tokens: 2000,
      // Leer una etiqueta es directo; lo que cuesta es el OCR, no el razonamiento.
      output_config: {
        effort: "low",
        format: { type: "json_schema", schema: ESQUEMA },
      },
      system: SISTEMA,
      messages: [{
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: tipoImagen, data: imageData } },
          { type: "text", text: "Leé esta etiqueta." },
        ],
      }],
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

    // Se sanea acá y no en el cliente: esto entra derecho al formulario.
    const tipo = TIPOS.includes(datos.tipo as typeof TIPOS[number])
      ? (datos.tipo as string) : "Otro";
    const ubicacion = UBICACIONES.includes(datos.ubicacion as typeof UBICACIONES[number])
      ? (datos.ubicacion as string) : "Refrigerador";
    // Una fecha con formato raro haría que el <input type="date"> quede vacío sin
    // decir por que; mejor tratarla como que no se leyo.
    const cruda = typeof datos.fecha === "string" ? datos.fecha.trim() : "";
    const fecha = /^\d{4}-\d{2}-\d{2}$/.test(cruda) ? cruda : null;
    const desc = typeof datos.desc === "string" ? datos.desc.trim().slice(0, 120) : "";

    return Response.json({ ok: true, tipo, desc, fecha, ubicacion, uso: response.usage },
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
    return Response.json(
      { ok: false, error: err?.message ?? String(e) },
      { status: err?.status ?? 500, headers: cors },
    );
  }
});
