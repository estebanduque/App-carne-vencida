// Recibe unas coordenadas, mira si caen dentro de alguna tienda guardada y,
// si ahi te falta algo, manda el push. Con la app cerrada.
//
// La llama una automatizacion del telefono (MacroDroid) en cada desbloqueo:
// el navegador no puede leer la ubicacion en segundo plano, pero una app de
// automatizacion si, y este es el puente entre esa lectura y tu lista.
//
// Variables de entorno (Project Settings -> Edge Functions -> Secrets):
//   VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY / VAPID_SUBJECT  (las mismas que ya usas)
//   COMPRAS_SECRET   opcional. Si la definis, hay que mandarla en la cabecera
//                    'x-compras-secret'. Recomendado: la anon key es publica,
//                    asi que sin esto cualquiera podria hacer sonar tu telefono.

import webpush from "npm:web-push@3.6.7";
import { createClient } from "npm:@supabase/supabase-js@2";

// Un supermercado grande tambien resuelve lo de la panaderia, la carniceria y
// la verduleria. Tiene que coincidir con CUBRE_COMPRA de index.html.
const CUBRE: Record<string, string[]> = {
  supermercado: ["supermercado", "panaderia", "carniceria", "verduleria"],
};

// No repetir el aviso del mismo lugar dentro de esta ventana.
const HORAS_SILENCIO = 4;

function distanciaM(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000, rad = (x: number) => (x * Math.PI) / 180;
  const dLat = rad(lat2 - lat1), dLon = rad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

Deno.serve(async (req: Request) => {
  try {
    const secreto = Deno.env.get("COMPRAS_SECRET");
    if (secreto && req.headers.get("x-compras-secret") !== secreto) {
      return Response.json({ ok: false, error: "no autorizado" }, { status: 401 });
    }

    const url = new URL(req.url);
    const cuerpo = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    // Ojo con Number(null) === 0: sin este control, una lectura de GPS fallida
    // (MacroDroid manda el campo vacio) se tomaria como la coordenada 0,0.
    const crudo = (v: unknown) => (v === null || v === undefined || String(v).trim() === "" ? null : String(v).trim());
    const latCrudo = crudo(cuerpo.lat) ?? crudo(url.searchParams.get("lat"));
    const lonCrudo = crudo(cuerpo.lon) ?? crudo(url.searchParams.get("lon"));
    if (latCrudo === null || lonCrudo === null) {
      return Response.json({ ok: false, error: "faltan lat/lon" }, { status: 400 });
    }
    const lat = Number(latCrudo), lon = Number(lonCrudo);
    if (!isFinite(lat) || !isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
      return Response.json({ ok: false, error: "lat/lon no son coordenadas validas" }, { status: 400 });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: lugares, error: errL } = await supabase
      .from("lugares").select("id, nombre, categoria, lat, lon, radio");
    if (errL) throw errL;

    const dentro = (lugares ?? [])
      .map((l) => ({ ...l, distancia: Math.round(distanciaM(lat, lon, l.lat, l.lon)) }))
      .filter((l) => l.distancia <= (l.radio ?? 120));

    if (!dentro.length) {
      return Response.json({ ok: true, coincide: false, enviadas: 0 });
    }

    const { data: pendientes, error: errC } = await supabase
      .from("compras").select("nombre, categoria").eq("comprado", false);
    if (errC) throw errC;

    // Entre varias tiendas posibles gana aquella donde realmente te falta algo.
    const faltanEn = (categoria: string) => {
      const cubre = CUBRE[categoria] ?? [categoria];
      return (pendientes ?? []).filter((c) => cubre.includes(c.categoria));
    };
    dentro.sort((a, b) =>
      ((faltanEn(a.categoria).length ? 0 : 1) - (faltanEn(b.categoria).length ? 0 : 1)) ||
      (a.distancia - b.distancia)
    );
    const lugar = dentro[0];
    const faltan = faltanEn(lugar.categoria);
    if (!faltan.length) {
      return Response.json({ ok: true, coincide: true, enviadas: 0, motivo: "nada pendiente aqui" });
    }

    // Se avisa una vez y se calla unas horas: esto corre en cada desbloqueo y
    // dentro del super desbloqueas el telefono muchas veces.
    const corte = new Date(Date.now() - HORAS_SILENCIO * 3600 * 1000).toISOString();
    const { data: aviso } = await supabase
      .from("avisos_compra").select("cuando").eq("lugar_id", lugar.id).maybeSingle();
    if (aviso && aviso.cuando > corte) {
      return Response.json({ ok: true, coincide: true, enviadas: 0, motivo: "ya avisado hace poco" });
    }

    webpush.setVapidDetails(
      Deno.env.get("VAPID_SUBJECT") ?? "mailto:admin@example.com",
      Deno.env.get("VAPID_PUBLIC_KEY")!,
      Deno.env.get("VAPID_PRIVATE_KEY")!,
    );

    const { data: subsCrudas, error: errS } = await supabase
      .from("push_subscriptions").select("id, subscription");
    if (errS) throw errS;

    const vistos = new Set<string>();
    const subs = (subsCrudas ?? []).filter((s) => {
      const ep = s.subscription?.endpoint;
      if (!ep || vistos.has(ep)) return false;
      vistos.add(ep);
      return true;
    });

    const lista = faltan.slice(0, 5).map((c) => c.nombre).join(", ");
    const payload = JSON.stringify({
      title: `🛒 Estás en ${lugar.nombre}`,
      body: `Te faltan ${faltan.length}: ${lista}${faltan.length > 5 ? "…" : ""}`,
    });

    let enviadas = 0, eliminadas = 0;
    const errores: string[] = [];
    for (const s of subs) {
      try {
        await webpush.sendNotification(s.subscription, payload);
        enviadas++;
      } catch (e: any) {
        const code = e?.statusCode;
        if (code === 404 || code === 410) {
          await supabase.from("push_subscriptions").delete().eq("id", s.id);
          eliminadas++;
        } else if (code === 403) {
          errores.push(`403 clave VAPID no coincide (id=${s.id})`);
        } else {
          errores.push(`${code ?? "?"} (id=${s.id}): ${e?.message ?? e}`);
        }
      }
    }

    if (enviadas) {
      await supabase.from("avisos_compra")
        .upsert({ lugar_id: lugar.id, cuando: new Date().toISOString() });
    }

    // La respuesta no lleva la lista ni el nombre del lugar: la anon key es
    // publica, y esto se responde a quien sea que llame. El detalle esta en
    // los logs de la funcion.
    return Response.json({ ok: true, coincide: true, enviadas, eliminadas, errores });
  } catch (e: any) {
    return Response.json({ ok: false, error: e?.message ?? String(e) }, { status: 500 });
  }
});
