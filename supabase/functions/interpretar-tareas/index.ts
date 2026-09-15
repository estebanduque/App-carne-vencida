// Convierte una nota de voz dictada ("mañana sin falta llamar al plomero antes de que
// se inunde, y cuando pueda ordenar los papeles") en una lista de tareas con su urgencia.
//
// La transcripción la hace el teléfono (Web Speech API) y llega aquí como texto: esta
// función solo interpreta. La clave de Anthropic vive únicamente acá, nunca en
// index.html, que es público.
//
// Por qué existe, habiendo reglas en el cliente: las reglas solo entienden las palabras
// que están en su lista ("urgente", "sin apuro"). No entienden que "antes de que se
// inunde" es urgente, ni separan bien un párrafo largo. Las reglas siguen en la app
// como respaldo para cuando esta función no esté disponible.
//
// Variables de entorno (Project Settings -> Edge Functions -> Secrets):
//   ANTHROPIC_API_KEY   clave de la API de Claude (console.anthropic.com). Es la misma
//                       que ya usa interpretar-compras: no hace falta una nueva.
//
// OJO con el nombre: Supabase le asigna un slug al crearla y ese slug es el que va en
// la URL. Anotá el que te toque y ponelo en index.html (como pasó con 'bright-worker'
// y 'super-responder').

import Anthropic from "npm:@anthropic-ai/sdk@0.125.0";

// La misma escala que muestra la app. Si cambia allá, cambiarla acá.
//   1 Urgente · 2 Alta · 3 Media · 4 Baja
const ESQUEMA = {
  type: "object",
  additionalProperties: false,
  required: ["tareas"],
  properties: {
    tareas: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["texto", "urgencia"],
        properties: {
          texto: {
            type: "string",
            description:
              "La tarea en imperativo y sin las palabras de urgencia. Ej: 'llamar al plomero'",
          },
          urgencia: {
            type: "integer",
            enum: [1, 2, 3, 4],
            description: "1 urgente, 2 alta, 3 media, 4 baja",
          },
        },
      },
    },
  },
} as const;

const SISTEMA = `Extraés tareas de una nota dictada por voz y en desorden.

La transcripción viene de un dictado en un teléfono Android, así que puede traer
errores de reconocimiento, muletillas, frases cortadas y sobre todo REPETICIONES:
el motor a veces entrega la misma frase varias veces, cada vez un poco más larga.
Quien dicta vive en Francia y habla español, mezclando a veces palabras en francés.

Reglas:
- Una tarea por entrada. "llamar al banco y sacar la basura" son dos.
- Si la misma tarea aparece repetida o en versiones parciales de sí misma
  ("lavar", "lavar nevera", "lavar nevera"), va UNA sola vez, en su versión más
  completa.
- 'texto' va en imperativo, breve y SIN las palabras de urgencia: si dijo
  "lavar la nevera urgencia media", el texto es "lavar la nevera".
- La urgencia sale de lo que dijo, no solo de palabras sueltas:
  · 1 (urgente): lo dice explícitamente ("urgente", "urgencia máxima", "ya mismo",
    "para hoy"), o hay una consecuencia inmediata si no se hace ("antes de que se
    inunde", "vence mañana", "si no me cortan la luz").
  · 2 (alta): "importante", "prioridad alta", "esta semana", "pronto", o algo con
    fecha cercana pero sin consecuencia grave.
  · 3 (media): lo normal, y cuando no hay ninguna señal. Es el valor por defecto.
  · 4 (baja): "sin apuro", "cuando pueda", "algún día", "prioridad baja".
- Si dice la urgencia con todas las letras, eso manda por encima del tono de la frase.
- Ignorá muletillas y lo que no sea una tarea ("eh", "a ver", "no me olvido de",
  "recordarme que", "tengo que").
- No inventes tareas que no estén. Si no se entiende nada, devolvé la lista vacía.`;

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
      max_tokens: 2000,
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

    const salida = response.content
      .filter((b) => b.type === "text")
      .map((b) => (b as { text: string }).text)
      .join("");

    let datos: { tareas?: unknown[] };
    try {
      datos = JSON.parse(salida);
    } catch {
      return Response.json(
        { ok: false, error: "respuesta ilegible del modelo", crudo: salida.slice(0, 500) },
        { status: 502, headers: cors },
      );
    }

    // Se sanea acá y no en el cliente: lo que salga de esta función entra derecho a la base.
    const vistos = new Set<string>();
    const tareas = (Array.isArray(datos.tareas) ? datos.tareas : [])
      .map((x) => x as Record<string, unknown>)
      .filter((x) => typeof x?.texto === "string" && (x.texto as string).trim().length >= 2)
      .map((x) => {
        const u = Number(x.urgencia);
        return {
          texto: (x.texto as string).trim().slice(0, 300),
          // Cualquier cosa fuera de la escala cae en Media, que es el valor neutro:
          // es preferible a descartar la tarea por un número raro.
          urgencia: u === 1 || u === 2 || u === 3 || u === 4 ? u : 3,
        };
      })
      .filter((t) => {
        const k = t.texto.toLowerCase();
        if (vistos.has(k)) return false;
        vistos.add(k);
        return true;
      });

    return Response.json({ ok: true, tareas, uso: response.usage }, { headers: cors });
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
