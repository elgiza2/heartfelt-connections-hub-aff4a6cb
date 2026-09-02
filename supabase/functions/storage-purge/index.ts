/**
 * @doc Deletes Supabase Storage objects that were already migrated to Telegram.
 *
 * POST /storage-purge  { dry_run?: boolean, limit?: number }
 * Header: x-purge-secret: <STORAGE_PURGE_SECRET>
 *
 * Only removes objects whose `bucket_id/name` exists as `telegram_media.fallback_path`,
 * so nothing that is not safely stored on Telegram is ever touched.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-purge-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);

  const expected = Deno.env.get("STORAGE_PURGE_SECRET");
  if (!expected || req.headers.get("x-purge-secret") !== expected) {
    return json({ ok: false, error: "unauthorized" }, 401);
  }

  try {
    const body = await req.json().catch(() => ({}));
    const dryRun = body?.dry_run === true;
    const limit = Math.min(Math.max(Number(body?.limit ?? 1000) || 1000, 1), 5000);

    const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

    const { data: rows, error } = await admin
      .from("telegram_media")
      .select("fallback_path")
      .not("fallback_path", "is", null)
      .limit(limit);
    if (error) return json({ ok: false, error: error.message }, 500);

    const byBucket = new Map<string, string[]>();
    for (const r of rows ?? []) {
      const fp = String((r as { fallback_path: string }).fallback_path);
      const slash = fp.indexOf("/");
      if (slash <= 0) continue;
      const bucket = fp.slice(0, slash);
      const path = fp.slice(slash + 1);
      const list = byBucket.get(bucket) ?? [];
      list.push(path);
      byBucket.set(bucket, list);
    }

    const result: Record<string, { candidates: number; removed: number; errors: string[] }> = {};
    for (const [bucket, paths] of byBucket) {
      const entry = { candidates: paths.length, removed: 0, errors: [] as string[] };
      if (!dryRun) {
        for (let i = 0; i < paths.length; i += 100) {
          const chunk = paths.slice(i, i + 100);
          const { data, error: rmError } = await admin.storage.from(bucket).remove(chunk);
          if (rmError) entry.errors.push(rmError.message);
          else entry.removed += data?.length ?? 0;
        }
      }
      result[bucket] = entry;
    }

    return json({ ok: true, dry_run: dryRun, buckets: result });
  } catch (e) {
    return json({ ok: false, error: e instanceof Error ? e.message : "purge_failed" }, 500);
  }
});
