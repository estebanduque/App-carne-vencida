// Convierte una nota de voz dictada ("necesito leche, pan y una caja de doliprane")
// en una lista de artículos con los tipos de tienda donde se consigue cada uno.
//
// La transcripción la hace el teléfono (Web Speech API) y llega aquí como texto:
// esta función solo interpreta. La clave de Anthropic vive únicamente acá, nunca
// en index.html, que es público.
//
// Variables de entorno (Project Settings -> Edge Functions -> Secrets):
//   ANTHROPIC_API_KEY   clave de la API de Claude (console.anthropic.com)
//
// Desplegada en Supabase con el slug 'bright-worker' (el que va en la URL); en el
// panel se la ve como 'interpretar-compras'. El slug lo asigna Supabase al crear la
// funcion y no se puede cambiar, asi que index.html invoca 'bright-worker'.

import Anthropic from "npm:@anthropic-ai/sdk@0.125.0";

// Las mismas categorías que muestra la app. Si cambian ahí, cambiarlas acá.
const CATEGORIAS = [
  "supermercado",
  "panaderia",
  "carniceria",
  "verduleria",
  "farmacia",
  "ferreteria",
  "papeleria",
  "ropa",
  "otro",
] as const;

const ESQUEMA = {
  type: "object",
  additionalProperties: false,
  required: ["items"],
  properties: {
    items: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["nombre", "cantidad", "categorias"],
        properties: {
          nombre: {
            type: "string",
            description: "El artículo, en singular y sin la cantidad. Ej: 'leche entera'",
          },
          cantidad: {
            type: "string",
            description:
              "Cantidad tal como se dijo ('2 litros', '1 caja', 'media docena'). Cadena vacía si no se mencionó.",
          },
          categorias: {
            type: "array",
            minItems: 1,
            maxItems: 3,
            items: { type: "string", enum: CATEGORIAS },
            description:
              "Todos los tipos de tienda donde se consigue habitualmente en Francia, de la más específica a la más general",
          },
        },
      },
    },
  },
} as const;

const SISTEMA = `Extraés artículos de una lista de compras dictada por voz y en desorden.

Quien dicta vive en Francia y habla español, mezclando a veces palabras en francés
(marcas y productos locales: Doliprane, baguette, crème fraîche, Monoprix...).
La transcripción viene de un dictado, así que puede traer errores de reconocimiento,
muletillas, repeticiones y frases cortadas.

Reglas:
- Un artículo por entrada. "leche y pan" son dos entradas.
- Corregí lo que claramente es un error de transcripción de un producto conocido
  ("doli prone" -> "Doliprane"). Si no estás seguro, dejá lo que se dijo.
- Ignorá muletillas y lo que no sea un artículo ("eh", "a ver", "no me olvido de").
- Si repite un artículo, va una sola vez.
- 'categorias' son todos los tipos de tienda donde el artículo se consigue
  habitualmente en Francia, ordenados de la más específica a la más general.
  Muchas cosas están en más de un lado y hay que ponerlas todas: el pan brioche
  se consigue en la panadería y en el supermercado; el pegamento instantáneo en
  la ferretería y en el supermercado; las esponjas en el supermercado y en la
  ferretería.
- Poné solo las tiendas donde el artículo realmente se encuentra. Un medicamento
  va solo a farmacia; un corte de carne al peso, solo a carnicería; un destornillador,
  solo a ferretería. Si algo se consigue en cualquier lado, alcanza con supermercado.
- Si no se entiende nada o no hay ningún artículo, devolvé la lista vacía.`;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  try {
    const { texto } = await req.json();
    if (!texto || typeof texto !== "string" || !texto.trim()) {
      return Response.json({ ok: false, error: "falta 'texto'" }, { status: 400, headers: cors });
    }

    const client = new Anthropic({ apiKey: Deno.env.get("ANTHROPIC_API_KEY")! });

    const response = await client.messages.create({
      model: "claude-opus-5",
      max_tokens: 4000,
      // Extracción corta y acotada: no necesita pensar mucho.
      output_config: {
        effort: "low",
        format: { type: "json_schema", schema: ESQUEMA },
      },
      system: SISTEMA,
      messages: [{ role: "user", content: texto.trim() }],
    });

    if (response.stop_reason === "refusal") {
      return Response.json(
        { ok: false, error: "la petición fue rechazada", detalle: response.stop_details },
        { status: 422, headers: cors },
      );
    }

    const texto_salida = response.content
      .filter((b) => b.type === "text")
      .map((b) => (b as { text: string }).text)
      .join("");

    let datos: { items?: unknown[] };
    try {
      datos = JSON.parse(texto_salida);
    } catch {
      return Response.json(
        { ok: false, error: "respuesta ilegible del modelo", crudo: texto_salida.slice(0, 500) },
        { status: 502, headers: cors },
      );
    }

    // Se saneia acá y no en el cliente: lo que salga de esta función entra derecho a la base.
    const items = (Array.isArray(datos.items) ? datos.items : [])
      .map((x) => x as Record<string, unknown>)
      .filter((x) => typeof x?.nombre === "string" && (x.nombre as string).trim())
      .map((x) => {
        const crudas = Array.isArray(x.categorias) ? (x.categorias as unknown[]) : [];
        const validas = [...new Set(
          crudas.filter((c): c is string =>
            typeof c === "string" && CATEGORIAS.includes(c as typeof CATEGORIAS[number])
          ),
        )];
        // Un articulo sin ninguna tienda reconocible igual tiene que entrar a la lista:
        // el supermercado es el cajon de sastre que casi siempre acierta.
        const categorias = validas.length ? validas : ["supermercado"];
        return {
          nombre: (x.nombre as string).trim().slice(0, 120),
          cantidad: typeof x.cantidad === "string" ? x.cantidad.trim().slice(0, 40) : "",
          categoria: categorias[0],
          categorias,
        };
      });

    return Response.json({ ok: true, items, uso: response.usage }, { headers: cors });
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
