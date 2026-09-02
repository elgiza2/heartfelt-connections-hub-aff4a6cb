/**
 * @doc Public read endpoint for files stored on Telegram.
 *
 * GET /tg-file/<telegram_media_id>        -> 302 to a fresh Telegram download URL
 * GET /tg-file?id=<telegram_media_id>     -> same
 *
 * Telegram download links expire (~1h), so the freshest URL is minted on demand
 * and cached on the row. No auth: these replace formerly public storage URLs.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const GATEWAY = "https://connector-gateway.lovable.dev/telegram";
const CACHE_MS = 50 * 60 * 1000;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, range",
  "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
};

function gatewayHeaders(): Record<string, string> {
  const lovableKey = Deno.env.get("LOVABLE_API_KEY");
  const connKey = Deno.env.get("TELEGRAM_API_KEY");
  if (!lovableKey || !connKey) throw new Error("telegram connector is not configured");
  return { Authorization: `Bearer ${lovableKey}`, "X-Connection-Api-Key": connKey };
}

async function freshUrl(fileId: string): Promise<string> {
  const res = await fetch(`${GATEWAY}/getFile`, {
    method: "POST",
    headers: { ...gatewayHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({ file_id: fileId }),
  });
  const parsed = await res.json().catch(() => null);
  const path = parsed?.result?.file_path;
  if (!path) throw new Error("telegram getFile failed");
  return `${GATEWAY}/file/${path}`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  try {
    const url = new URL(req.url);
    const tail = url.pathname.split("/").filter(Boolean).pop() ?? "";
    const id = url.searchParams.get("id") || (tail !== "tg-file" ? tail : "");
    if (!id) return new Response("missing id", { status: 400, headers: cors });

    const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
    const { data: row } = await admin
      .from("telegram_media")
      .select("id, file_id, cached_url, cached_until, mime_type")
      .eq("id", id)
      .maybeSingle();
    if (!row) return new Response("not found", { status: 404, headers: cors });

    let target = row.cached_url as string | null;
    if (!target || !row.cached_until || new Date(row.cached_until) <= new Date()) {
      target = await freshUrl(row.file_id);
      await admin
        .from("telegram_media")
        .update({
          cached_url: target,
          cached_until: new Date(Date.now() + CACHE_MS).toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", row.id);
    }

    // Stream the bytes so browsers can embed/download them without CORS surprises.
    const upstream = await fetch(target!, { headers: gatewayHeaders() });
    if (!upstream.ok || !upstream.body) {
      return new Response("upstream error", { status: 502, headers: cors });
    }
    return new Response(upstream.body, {
      status: 200,
      headers: {
        ...cors,
        "Content-Type": row.mime_type || upstream.headers.get("content-type") || "application/octet-stream",
        "Cache-Control": "public, max-age=86400",
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "tg_file_failed";
    console.error("tg-file error:", msg);
    return new Response(msg, { status: 500, headers: cors });
  }
});
