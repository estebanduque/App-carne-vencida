// Dos usos en un mismo archivo, porque comparten slug y no vale la pena gastar otro:
//
// 1. Sin body (o con ?test=1 en la URL): el aviso push diario de siempre — alimentos
//    que vencen (Mi DLC) y recordatorios de tareas pospuestas. Lo dispara un cron de
//    Supabase una vez al día (ver supabase/cron.sql).
// 2. Con { tipo, ubicacion } en el body: index.html la llama cuando el usuario deja la
//    fecha de vencimiento vacía al cargar un producto, y le devuelve una fecha estimada
//    por IA en vez de obligarlo a tipearla.
//
// Variables de entorno necesarias (Project Settings -> Edge Functions -> Secrets):
//   VAPID_PUBLIC_KEY   la misma que está en index.html
//   VAPID_PRIVATE_KEY  la privada (NUNCA en el repo)
//   VAPID_SUBJECT      "mailto:tu@correo.com"
//   ANTHROPIC_API_KEY  clave de la API de Claude (console.anthropic.com), la misma que
//                      ya usan interpretar-compras, interpretar-tareas y analizar-etiqueta
// SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY las inyecta Supabase sola.

import webpush from "npm:web-push@3.6.7";
import { createClient } from "npm:@supabase/supabase-js@2";
import Anthropic from "npm:@anthropic-ai/sdk@0.125.0";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Zona horaria en la que se interpretan "hoy" y "mañana".
const TZ = "Europe/Paris";

function fechaEnTZ(offsetDias = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDias);
  return d.toLocaleDateString("en-CA", { timeZone: TZ }); // YYYY-MM-DD
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  // Un body con 'tipo' y 'ubicacion' es index.html pidiendo una fecha estimada; el
  // cron no manda body, así que cualquier otra cosa cae en el aviso diario de siempre.
  let cuerpo: { tipo?: string; desc?: string; ubicacion?: string } | null = null;
  try { cuerpo = await req.json(); } catch { /* sin body: es el cron */ }

  if (cuerpo && cuerpo.tipo && cuerpo.ubicacion) {
    return estimarFecha(cuerpo.tipo, cuerpo.desc, cuerpo.ubicacion);
  }
  return avisarVencimientos(req);
});

async function estimarFecha(tipo: string, desc: string | undefined, ubicacion: string) {
  try {
    const client = new Anthropic({ apiKey: Deno.env.get("ANTHROPIC_API_KEY")! });

    const prompt = `Estima la vida útil típica, en días desde hoy, de "${tipo}"${desc ? ` (${desc})` : ""} guardado en "${ubicacion}" (Refrigerador, Congelador o Despensa).

Da una estimación conservadora y realista, basada en las prácticas de seguridad alimentaria habituales. Ejemplos de referencia:
- Leche entera en Refrigerador: 7
- Huevos en Refrigerador: 21
- Carne molida en Congelador: 90
- Pan blanco en Despensa: 3
- Arroz blanco en Despensa: 365
- Yogur natural en Refrigerador: 14`;

    const response = await client.messages.create({
      model: "claude-opus-5",
      max_tokens: 200,
      output_config: {
        effort: "low",
        format: {
          type: "json_schema",
          schema: {
            type: "object",
            properties: { dias: { type: "integer", minimum: 1 } },
            required: ["dias"],
          },
        },
      },
      system: "Eres un experto en seguridad alimentaria y vida útil de productos. Das estimaciones conservadoras y realistas.",
      messages: [{ role: "user", content: prompt }],
    });

    const salida = response.content
      .filter((b) => b.type === "text")
      .map((b) => (b as { text: string }).text)
      .join("");

    let datos: { dias?: unknown };
    try {
      datos = JSON.parse(salida);
    } catch {
      return Response.json({ ok: false, error: "respuesta ilegible del modelo" }, { status: 502, headers: cors });
    }

    const dias = Number(datos.dias);
    if (!Number.isFinite(dias) || dias <= 0) {
      return Response.json({ ok: false, error: `estimación inválida: "${salida}"` }, { status: 502, headers: cors });
    }

    const fecha = new Date();
    fecha.setDate(fecha.getDate() + dias);
    const fecha_estimada = fecha.toISOString().split("T")[0];

    return Response.json({ ok: true, fecha_estimada, dias_estimados: dias, uso: response.usage }, { headers: cors });
  } catch (e: unknown) {
    const err = e as { message?: string };
    return Response.json({ ok: false, error: err?.message ?? String(e) }, { status: 500, headers: cors });
  }
}

async function avisarVencimientos(req: Request) {
  try {
    webpush.setVapidDetails(
      Deno.env.get("VAPID_SUBJECT") ?? "mailto:admin@example.com",
      Deno.env.get("VAPID_PUBLIC_KEY")!,
      Deno.env.get("VAPID_PRIVATE_KEY")!,
    );

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const hoy = fechaEnTZ(0);
    const manana = fechaEnTZ(1);

    // ?test=1 manda un aviso de prueba aunque no venza nada, para verificar la cadena completa.
    const esPrueba = new URL(req.url).searchParams.get("test") === "1";

    // 'destino' marca lo que ya salio del inventario (consumido o tirado). Se pide
    // con select('*') y se filtra en memoria para que la funcion siga andando
    // aunque supabase/setup-dlc.sql todavia no se haya corrido: sin esa columna,
    // pedirla por nombre tumbaria el aviso entero.
    const { data: filas, error: errCarnes } = await supabase
      .from("carnes")
      .select("*")
      .in("fecha", [hoy, manana]);
    if (errCarnes) throw errCarnes;

    // No avisa de lo que ya salio del inventario: recordarte que vence algo que te
    // comiste anteayer es ruido, y justo lo que el boton de consumido vino a evitar.
    // Lo del congelador tiene el vencimiento en pausa y tampoco avisa; se filtra aca
    // y no en la query para que una 'ubicacion' nula (registros viejos) no quede
    // fuera por las reglas de comparacion con null de SQL.
    const carnes = (filas ?? []).filter((c) =>
      c.ubicacion !== "Congelador" && !c.destino
    );

    // Tareas cuyo recordatorio ya llego. Se piden aparte porque el push es uno solo al
    // dia: si hay carne venciendo y ademas un recordatorio, van en el mismo aviso.
    const { data: tareasCrudas, error: errTareas } = await supabase
      .from("tareas")
      .select("id, texto, recordar")
      .eq("hecho", false)
      .not("recordar", "is", null)
      .lte("recordar", hoy);
    // Si la columna 'recordar' todavia no existe, esto no debe tumbar el aviso de
    // carnes, que es el que ya venia funcionando.
    const recordatorios: { id: number; texto: string }[] = errTareas ? [] : ((tareasCrudas ?? []) as any);
    if (errTareas) console.log("recordatorios no disponibles:", errTareas.message);

    if (!esPrueba && carnes.length === 0 && recordatorios.length === 0) {
      return Response.json({ ok: true, enviadas: 0, motivo: "nada vence hoy ni mañana", hoy }, { headers: cors });
    }

    const vencenHoy = carnes.filter((c) => c.fecha === hoy);
    const vencenManana = carnes.filter((c) => c.fecha === manana);
    const nombre = (c: { tipo: string; desc?: string | null }) =>
      c.tipo + (c.desc ? " · " + c.desc : "");

    // Un solo aviso por día, resumiendo todo lo que vence.
    let title: string, body: string;
    if (esPrueba && vencenHoy.length === 0 && vencenManana.length === 0) {
      title = "🔔 Prueba de notificaciones";
      body = "Si ves esto, los push están funcionando.";
    } else if (vencenHoy.length > 0) {
      title = vencenHoy.length === 1 ? "🔴 ¡Vence HOY!" : `🔴 ${vencenHoy.length} alimentos vencen HOY`;
      body = vencenHoy.map(nombre).join("\n");
      if (vencenManana.length > 0) {
        body += `\n\nMañana vence${vencenManana.length > 1 ? "n" : ""}: ` +
          vencenManana.map(nombre).join(", ");
      }
    } else if (vencenManana.length > 0) {
      title = vencenManana.length === 1 ? "⚠️ Vence mañana" : `⚠️ ${vencenManana.length} alimentos vencen mañana`;
      body = vencenManana.map(nombre).join("\n") + "\n¡Úsalos hoy!";
    } else {
      // No vence ningun alimento: el aviso es solo de recordatorios.
      title = recordatorios.length === 1 ? "⏰ Te lo recordé" : `⏰ ${recordatorios.length} recordatorios`;
      body = recordatorios.map((t) => t.texto).join("\n");
    }
    // Si ademas del alimento hay recordatorios, se suman al final del mismo aviso.
    if (recordatorios.length > 0 && (vencenHoy.length > 0 || vencenManana.length > 0)) {
      body += "\n\n⏰ Te lo recordé: " + recordatorios.map((t) => t.texto).join(", ");
    }
    const payload = JSON.stringify({ title, body });

    const { data: subs, error: errSubs } = await supabase
      .from("push_subscriptions")
      .select("id, subscription");
    if (errSubs) throw errSubs;

    // Un mismo dispositivo puede estar guardado varias veces: se avisa una sola vez.
    const porEndpoint = new Map<string, { id: number; subscription: any }>();
    for (const s of subs ?? []) {
      const ep = s.subscription?.endpoint;
      if (ep && !porEndpoint.has(ep)) porEndpoint.set(ep, s as any);
    }

    let enviadas = 0, eliminadas = 0;
    const errores: string[] = [];

    for (const s of porEndpoint.values()) {
      try {
        await webpush.sendNotification(s.subscription, payload);
        enviadas++;
      } catch (e: any) {
        const code = e?.statusCode;
        if (code === 404 || code === 410) {
          // Suscripción muerta (el navegador la revocó o se borraron los datos del sitio).
          await supabase.from("push_subscriptions").delete().eq("id", s.id);
          eliminadas++;
        } else if (code === 403) {
          // Firmada con otra clave VAPID. No se borra: es un problema de configuración
          // y conviene verlo en la respuesta en vez de que desaparezca la evidencia.
          errores.push(`403 clave VAPID no coincide (id=${s.id})`);
        } else {
          errores.push(`${code ?? "?"} (id=${s.id}): ${e?.message ?? e}`);
        }
      }
    }

    // El recordatorio se apaga una vez avisado: si no, volveria a sonar todos los dias.
    // La tarea sigue pendiente en la lista, que es el recordatorio de fondo. Solo se
    // apaga si el aviso salio de verdad hacia algun dispositivo.
    let recordatoriosApagados = 0;
    if (enviadas > 0 && recordatorios.length > 0) {
      const ids = recordatorios.map((t) => t.id);
      const { error } = await supabase.from("tareas").update({ recordar: null }).in("id", ids);
      if (error) errores.push("no se pudieron apagar los recordatorios: " + error.message);
      else recordatoriosApagados = ids.length;
    }

    return Response.json({ ok: true, hoy, vencenHoy: vencenHoy.length, vencenManana: vencenManana.length,
                           recordatorios: recordatorios.length, recordatoriosApagados,
                           enviadas, eliminadas, errores }, { headers: cors });
  } catch (e: any) {
    return Response.json({ ok: false, error: e?.message ?? String(e) }, { status: 500, headers: cors });
  }
}
