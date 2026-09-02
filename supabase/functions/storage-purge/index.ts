import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const targets: Record<string, string[]> = {
  "docs-uploads": [
    "27a33ae2-29bf-41d1-a68a-7da216bc4bd6/1772606906685-cvd7av.pdf",
    "27a33ae2-29bf-41d1-a68a-7da216bc4bd6/1772607108985-bc5ec3.pdf",
    "27a33ae2-29bf-41d1-a68a-7da216bc4bd6/1772607781763-xbjmg2.pdf",
    "27a33ae2-29bf-41d1-a68a-7da216bc4bd6/1772608421214-46wr8s.pdf",
  ],
  "slide-presentations": [
    "user-1/1771686311730-7twx2e.pptx",
    "user-1/1771687238956-8ts9h7.pptx",
    "user-1/1771687515176-x0ffjs.pptx",
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