/**
 * @doc Client helper for Telegram-backed file storage.
 *
 * Big files (video, large documents) go to a private Telegram channel through
 * the `anything-api` edge function instead of Supabase Storage. Telegram
 * download links expire, so we always keep the record id and re-resolve a fresh
 * URL when needed.
 */
import { supabase } from "@/integrations/supabase/client";

/** Telegram bot uploads cap out around 50MB. */
export const TELEGRAM_MAX_BYTES = 45 * 1024 * 1024;
/** Anything above this prefers Telegram over Supabase Storage. */
export const TELEGRAM_PREFERRED_MIN_BYTES = 5 * 1024 * 1024;

export type TelegramUploadResult = {
  id: string;
  url: string;
  file_id: string;
  kind: "photo" | "video" | "document";
  mime_type: string;
  size_bytes: number;
};

async function fileToBase64(file: Blob): Promise<string> {
  const buf = new Uint8Array(await file.arrayBuffer());
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < buf.length; i += chunk) {
    bin += String.fromCharCode(...buf.subarray(i, i + chunk));
  }
  return btoa(bin);
}

async function call<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke("anything-api", {
    body: { kind: "telegram_storage", ...body },
  });
  if (error) throw new Error(error.message);
  if (!data?.ok) throw new Error(data?.error || "telegram_storage_failed");
  return data as T;
}

/** Upload a File/Blob to Telegram storage. Throws on failure. */
export async function uploadToTelegram(
  file: File | Blob,
  opts: { filename?: string; kind?: "photo" | "video" | "document" } = {},
): Promise<TelegramUploadResult> {
  if (file.size > TELEGRAM_MAX_BYTES) throw new Error("file_too_large");
  const filename = opts.filename ?? (file instanceof File ? file.name : "file");
  return await call<TelegramUploadResult>({
    action: "upload",
    filename,
    mime_type: file.type || undefined,
    kind: opts.kind,
    data_base64: await fileToBase64(file),
  });
}

/** Upload a data URL (or pass through an http URL) to Telegram storage. */
export async function uploadDataUrlToTelegram(
  dataUrl: string,
  filename = "file",
): Promise<TelegramUploadResult> {
  if (!/^data:/.test(dataUrl)) {
    return await call<TelegramUploadResult>({ action: "upload", source_url: dataUrl, filename });
  }
  return await call<TelegramUploadResult>({
    action: "upload",
    filename,
    data_base64: dataUrl,
  });
}

/** Mint a fresh (or cached) download URL for a stored item. */
export async function resolveTelegramUrl(idOrFileId: {
  id?: string;
  file_id?: string;
}): Promise<string> {
  const res = await call<{ url: string }>({ action: "resolve", ...idOrFileId });
  return res.url;
}

/** List the current user's Telegram-stored files. */
export async function listTelegramMedia(limit = 50) {
  const res = await call<{ items: unknown[] }>({ action: "list", limit });
  return res.items;
}

/** Bot / storage-chat health, useful for settings screens. */
export async function telegramStorageStatus() {
  return await call<{ bot: string | null; chat_id: string | null; chat_error: string | null }>({
    action: "status",
  });
}

/**
 * Upload with Telegram preferred for big files and Supabase Storage as the
 * fallback path. Returns a usable URL, plus the Telegram record id when the
 * file landed in Telegram (so callers can re-resolve later).
 */
export async function uploadLargeFile(
  file: File,
  supabaseFallback: (file: File) => Promise<string | null>,
): Promise<{ url: string | null; telegramId?: string }> {
  if (file.size >= TELEGRAM_PREFERRED_MIN_BYTES && file.size <= TELEGRAM_MAX_BYTES) {
    try {
      const res = await uploadToTelegram(file);
      return { url: res.url, telegramId: res.id };
    } catch (e) {
      console.warn("[telegram storage] upload failed, falling back to Supabase", e);
    }
  }
  return { url: await supabaseFallback(file) };
}
