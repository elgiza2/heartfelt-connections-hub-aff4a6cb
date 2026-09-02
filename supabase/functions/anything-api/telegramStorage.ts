/**
 * @doc Telegram-backed file storage (free, effectively unlimited).
 *
 * Uploads files to a private Telegram chat/channel through the Lovable
 * connector gateway and keeps only the metadata in `public.telegram_media`.
 * Telegram download URLs expire, so `resolve` mints a fresh one on demand and
 * caches it for an hour.
 *
 * Actions (POST JSON, requires the caller's Supabase access token):
 *  - { action: "upload", source_url | data_base64, filename?, mime_type?, kind? }
 *  - { action: "resolve", id | file_id }
 *  - { action: "list", limit? }
 *  - { action: "status" }
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const GATEWAY = "https://connector-gateway.lovable.dev/telegram";
const MAX_BYTES = 45 * 1024 * 1024; // Telegram bot upload ceiling (50MB) with headroom
const CACHE_MS = 55 * 60 * 1000;

function gatewayHeaders(): Record<string, string> {
  const lovableKey = Deno.env.get("LOVABLE_API_KEY");
  const connKey = Deno.env.get("TELEGRAM_API_KEY");
  if (!lovableKey) throw new Error("LOVABLE_API_KEY is not configured");
  if (!connKey) throw new Error("TELEGRAM_API_KEY is not configured");
  return { Authorization: `Bearer ${lovableKey}`, "X-Connection-Api-Key": connKey };
}

async function tg(method: string, body: unknown): Promise<any> {
  const res = await fetch(`${GATEWAY}/${method}`, {
    method: "POST",
    headers: { ...gatewayHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`telegram ${method} [${res.status}]: ${text.slice(0, 400)}`);
  const parsed = JSON.parse(text);
  if (parsed?.ok === false) throw new Error(`telegram ${method}: ${parsed.description ?? "failed"}`);
  return parsed.result;
}

async function tgUpload(method: string, form: FormData): Promise<any> {
  const res = await fetch(`${GATEWAY}/${method}`, {
    method: "POST",
    headers: gatewayHeaders(),
    body: form,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`telegram ${method} [${res.status}]: ${text.slice(0, 400)}`);
  const parsed = JSON.parse(text);
  if (parsed?.ok === false) throw new Error(`telegram ${method}: ${parsed.description ?? "failed"}`);
  return parsed.result;
}

/** The storage chat: an explicit secret, else the most recent chat that messaged the bot. */
async function storageChatId(): Promise<string> {
  const configured = Deno.env.get("TELEGRAM_STORAGE_CHAT_ID");
  if (configured) return configured;
  const updates = await tg("getUpdates", { limit: 20 });
  const chats = (Array.isArray(updates) ? updates : [])
    .map((u: any) => u?.message?.chat?.id ?? u?.channel_post?.chat?.id)
    .filter((id: unknown) => typeof id === "number" || typeof id === "string");
  if (chats.length === 0) {
    throw new Error(
      "No Telegram storage chat yet — send any message to the bot (or add it to a channel) so it can be detected, or set TELEGRAM_STORAGE_CHAT_ID.",
    );
  }
  return String(chats[chats.length - 1]);
}

async function freshUrl(fileId: string): Promise<{ url: string; size: number | null }> {
  const file = await tg("getFile", { file_id: fileId });
  const path = file?.file_path;
  if (!path) throw new Error("Telegram did not return a file path");
  return { url: `${GATEWAY}/file/${path}`, size: file?.file_size ?? null };
}

function pickKind(mime: string, hint?: string): "photo" | "video" | "document" {
  if (hint === "photo" || hint === "video" || hint === "document") return hint;
  if (mime.startsWith("image/") && mime !== "image/gif") return "photo";
  if (mime.startsWith("video/")) return "video";
  return "document";
}

export async function handleTelegramStorage(req: Request, body: any): Promise<Response> {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);

  try {
    const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
    if (!token) return json({ ok: false, error: "unauthorized" }, 401);
    const authClient = createClient(SUPABASE_URL, ANON_KEY || SERVICE_KEY, {
      auth: { persistSession: false },
    });
    const { data: userData } = await authClient.auth.getUser(token);
    const userId = userData?.user?.id;
    if (!userId) return json({ ok: false, error: "unauthorized" }, 401);

    const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
    const action = String(body?.action ?? "upload");

    if (action === "status") {
      const me = await tg("getMe", {});
      let chat: string | null = null;
      let chatError: string | null = null;
      try {
        chat = await storageChatId();
      } catch (e) {
        chatError = e instanceof Error ? e.message : "no chat";
      }
      return json({ ok: true, bot: me?.username ?? null, chat_id: chat, chat_error: chatError });
    }

    if (action === "list") {
      const limit = Math.min(Number(body?.limit ?? 50) || 50, 200);
      const { data, error } = await admin
        .from("telegram_media")
        .select("id, kind, mime_type, size_bytes, original_filename, created_at")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(limit);
      if (error) return json({ ok: false, error: error.message }, 500);
      return json({ ok: true, items: data ?? [] });
    }

    if (action === "resolve") {
      const id = body?.id ? String(body.id) : null;
      const directFileId = body?.file_id ? String(body.file_id) : null;
      if (!id && !directFileId) return json({ ok: false, error: "id or file_id is required" }, 400);

      let row: any = null;
      if (id) {
        const { data } = await admin
          .from("telegram_media")
          .select("*")
          .eq("id", id)
          .eq("user_id", userId)
          .maybeSingle();
        row = data;
        if (!row) return json({ ok: false, error: "not_found" }, 404);
        if (row.cached_url && row.cached_until && new Date(row.cached_until) > new Date()) {
          return json({ ok: true, url: row.cached_url, cached: true, item: row });
        }
      }

      const fileId = row?.file_id ?? directFileId!;
      const { url } = await freshUrl(fileId);
      if (row) {
        await admin
          .from("telegram_media")
          .update({
            cached_url: url,
            cached_until: new Date(Date.now() + CACHE_MS).toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq("id", row.id);
      }
      return json({ ok: true, url, cached: false, item: row });
    }

    if (action !== "upload") return json({ ok: false, error: "unknown_action" }, 400);

    // ---- upload ----
    const sourceUrl = body?.source_url ? String(body.source_url) : null;
    const dataBase64 = body?.data_base64 ? String(body.data_base64) : null;
    if (!sourceUrl && !dataBase64) {
      return json({ ok: false, error: "source_url or data_base64 is required" }, 400);
    }

    let bytes: Uint8Array;
    let mime = String(body?.mime_type ?? "").trim();
    let filename = String(body?.filename ?? "").trim();

    if (sourceUrl) {
      if (!/^https?:\/\//i.test(sourceUrl)) return json({ ok: false, error: "invalid source_url" }, 400);
      const res = await fetch(sourceUrl);
      if (!res.ok) return json({ ok: false, error: `source fetch failed [${res.status}]` }, 502);
      const buf = new Uint8Array(await res.arrayBuffer());
      bytes = buf;
      if (!mime) mime = res.headers.get("content-type")?.split(";")[0] ?? "application/octet-stream";
      if (!filename) filename = sourceUrl.split("?")[0].split("/").pop() || "file";
    } else {
      const clean = dataBase64!.replace(/^data:[^;]+;base64,/, "");
      const inferred = /^data:([^;]+);base64,/.exec(dataBase64!)?.[1];
      if (!mime && inferred) mime = inferred;
      const bin = atob(clean);
      const out = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
      bytes = out;
      if (!mime) mime = "application/octet-stream";
      if (!filename) filename = "file";
    }

    if (bytes.byteLength > MAX_BYTES) {
      return json({ ok: false, error: "file_too_large", max_bytes: MAX_BYTES }, 413);
    }

    const kind = pickKind(mime, body?.kind);
    const chatId = await storageChatId();
    const method = kind === "photo" ? "sendPhoto" : kind === "video" ? "sendVideo" : "sendDocument";
    const field = kind === "photo" ? "photo" : kind === "video" ? "video" : "document";

    const form = new FormData();
    form.append("chat_id", chatId);
    form.append("disable_notification", "true");
    form.append(field, new Blob([bytes], { type: mime }), filename);

    let message: any;
    try {
      message = await tgUpload(method, form);
    } catch (e) {
      // Telegram rejects some images/videos for its typed endpoints — a plain
      // document upload always works, so never fail the whole request here.
      if (kind === "document") throw e;
      const docForm = new FormData();
      docForm.append("chat_id", chatId);
      docForm.append("disable_notification", "true");
      docForm.append("document", new Blob([bytes], { type: mime }), filename);
      message = await tgUpload("sendDocument", docForm);
    }

    const photo = Array.isArray(message?.photo) ? message.photo[message.photo.length - 1] : null;
    const media = message?.document ?? message?.video ?? photo ?? null;
    const fileId = media?.file_id;
    if (!fileId) return json({ ok: false, error: "telegram returned no file id" }, 502);

    const { url } = await freshUrl(fileId);

    const { data: inserted, error: insertErr } = await admin
      .from("telegram_media")
      .insert({
        user_id: userId,
        file_id: fileId,
        file_unique_id: media?.file_unique_id ?? null,
        kind,
        mime_type: media?.mime_type ?? mime,
        size_bytes: media?.file_size ?? bytes.byteLength,
        width: media?.width ?? null,
        height: media?.height ?? null,
        duration: media?.duration ?? null,
        thumbnail_file_id: media?.thumb?.file_id ?? media?.thumbnail?.file_id ?? null,
        cached_url: url,
        cached_until: new Date(Date.now() + CACHE_MS).toISOString(),
        original_filename: filename,
        metadata: { message_id: message?.message_id ?? null, chat_id: chatId },
      })
      .select("id")
      .single();
    if (insertErr) return json({ ok: false, error: insertErr.message }, 500);

    return json({
      ok: true,
      id: inserted.id,
      url,
      file_id: fileId,
      kind,
      mime_type: mime,
      size_bytes: bytes.byteLength,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "telegram_storage_failed";
    console.error("telegram-storage error:", msg);
    return json({ ok: false, error: msg }, 500);
  }
}
