import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const targets: Record<string, string[]> = {
  "docs-uploads": [
    "3863bfb6-7d0d-46da-a2d7-7ec920e4aa85/1779247566419-h5q71g.webp",
    "3863bfb6-7d0d-46da-a2d7-7ec920e4aa85/1779250070589-pogtcx.webp",
    "3863bfb6-7d0d-46da-a2d7-7ec920e4aa85/1779284432479-hz5l40.webp",
    "3863bfb6-7d0d-46da-a2d7-7ec920e4aa85/1779523774985-ovparb.webp",
  ],
  "slide-presentations": [
    "3863bfb6-7d0d-46da-a2d7-7ec920e4aa85/1776796401852-_____ ______ _____ ___ __ _____.pdf",
    "3863bfb6-7d0d-46da-a2d7-7ec920e4aa85/1776800973896-__ ______ ____ _____ __ ____ ________ _______.pdf",
    "3863bfb6-7d0d-46da-a2d7-7ec920e4aa85/1776801916730-____ ___-resume.pdf",
  ],
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);

  const expected = Deno.env.get("STORAGE_PURGE_SECRET");
  if (!expected || req.headers.get("x-purge-secret") !== expected) {
    return json({ ok: false, error: "unauthorized" }, 401);
  }

  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) return json({ ok: false, error: "server_not_configured" }, 500);

  const admin = createClient(url, key, { auth: { persistSession: false } });
  const result: Record<string, { removed: number; error: string | null }> = {};

  for (const [bucket, paths] of Object.entries(targets)) {
    const { data, error } = await admin.storage.from(bucket).remove(paths);
    result[bucket] = { removed: data?.length ?? 0, error: error?.message ?? null };
  }

  return json({ ok: Object.values(result).every((entry) => !entry.error), result });
});