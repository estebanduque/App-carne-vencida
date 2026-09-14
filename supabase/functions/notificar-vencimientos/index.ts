// Envía las notificaciones push diarias: vencimiento de carnes y recordatorios de
// tareas pospuestas con el botón "3 días hábiles".
// Se ejecuta una vez por día desde un cron de Supabase (ver supabase/cron.sql).
//
// Variables de entorno necesarias (Project Settings -> Edge Functions -> Secrets):
//   VAPID_PUBLIC_KEY   la misma que está en index.html
//   VAPID_PRIVATE_KEY  la privada (NUNCA en el repo)
//   VAPID_SUBJECT      "mailto:tu@correo.com"
// SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY las inyecta Supabase sola.

import webpush from "npm:web-push@3.6.7";
import { createClient } from "npm:@supabase/supabase-js@2";

// Zona horaria en la que se interpretan "hoy" y "mañana".
const TZ = "Europe/Paris";

function fechaEnTZ(offsetDias = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDias);
  return d.toLocaleDateString("en-CA", { timeZone: TZ }); // YYYY-MM-DD
}

Deno.serve(async (req: Request) => {
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

    const { data: filas, error: errCarnes } = await supabase
      .from("carnes")
      .select("tipo, desc, fecha, ubicacion")
      .in("fecha", [hoy, manana]);
    if (errCarnes) throw errCarnes;

    // Lo que esta en el congelador tiene el vencimiento en pausa: no avisa.
    // Se filtra aca y no en la query para que una 'ubicacion' nula (registros
    // viejos) no quede fuera por las reglas de comparacion con null de SQL.
    const carnes = (filas ?? []).filter((c) => c.ubicacion !== "Congelador");

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
      return Response.json({ ok: true, enviadas: 0, motivo: "nada vence hoy ni mañana", hoy });
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
      title = vencenHoy.length === 1 ? "🔴 ¡Carne vence HOY!" : `🔴 ${vencenHoy.length} carnes vencen HOY`;
      body = vencenHoy.map(nombre).join("\n");
      if (vencenManana.length > 0) {
        body += `\n\nMañana vence${vencenManana.length > 1 ? "n" : ""}: ` +
          vencenManana.map(nombre).join(", ");
      }
    } else if (vencenManana.length > 0) {
      title = vencenManana.length === 1 ? "⚠️ Carne vence mañana" : `⚠️ ${vencenManana.length} carnes vencen mañana`;
      body = vencenManana.map(nombre).join("\n") + "\n¡Úsalas hoy!";
    } else {
      // No vence ninguna carne: el aviso es solo de recordatorios.
      title = recordatorios.length === 1 ? "⏰ Te lo recordé" : `⏰ ${recordatorios.length} recordatorios`;
      body = recordatorios.map((t) => t.texto).join("\n");
    }
    // Si ademas de la carne hay recordatorios, se suman al final del mismo aviso.
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
                           enviadas, eliminadas, errores });
  } catch (e: any) {
    return Response.json({ ok: false, error: e?.message ?? String(e) }, { status: 500 });
  }
});
