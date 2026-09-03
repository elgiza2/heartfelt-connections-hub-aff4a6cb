/**
 * Unified cloud agent engine.
 *
 * Two real browser-agent providers behind one call:
 *   1. Browser Use Cloud  (api.browser-use.com/api/v2)  — primary
 *   2. Hyperbrowser        (app.hyperbrowser.ai/api)     — fallback
 *
 * They bring their own LLMs, so the app needs no separate chat-model provider
 * for these turns: the agent browses, reasons and returns a finished answer.
 */

const BU_BASE = Deno.env.get("BROWSER_USE_API_BASE") || "https://api.browser-use.com/api/v2";
const HB_BASE = "https://app.hyperbrowser.ai/api";

export type AgentProgress = (step: { title: string; url?: string | null }) => void;

export interface CloudAgentResult {
  provider: "browser-use" | "hyperbrowser";
  text: string;
  steps: { title: string; url?: string | null }[];
  liveUrl?: string | null;
}

interface Admin {
  from: (table: string) => any;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Browser Use key: DB pool first (rotatable), then the function secret. */
async function buKey(admin: Admin | null): Promise<string | null> {
  if (admin) {
    const { data } = await admin
      .from("provider_api_keys")
      .select("api_key")
      .eq("provider", "c")
      .eq("status", "active")
      .order("last_used_at", { ascending: true, nullsFirst: true })
      .limit(1)
      .maybeSingle();
    const key = (data as { api_key?: string } | null)?.api_key?.trim();
    if (key && key.length > 12) return key;
  }
  return Deno.env.get("BROWSER_USE_API_KEY")?.trim() || null;
}

async function hbKeys(admin: Admin | null): Promise<string[]> {
  const out: string[] = [];
  const env = Deno.env.get("HYPERBROWSER_API_KEY")?.trim();
  if (env) out.push(env);
  if (admin) {
    const { data } = await admin
      .from("api_keys")
      .select("api_key")
      .eq("service", "hyperbrowser")
      .eq("is_active", true)
      .order("last_used_at", { ascending: true, nullsFirst: true })
      .limit(5);
    for (const row of (data ?? []) as { api_key?: string }[]) {
      const key = row.api_key?.trim();
      if (key && !out.includes(key)) out.push(key);
    }
  }
  return out;
}

/* ------------------------------- Browser Use ------------------------------ */

async function runBrowserUse(
  key: string,
  task: string,
  budgetMs: number,
  onStep?: AgentProgress,
): Promise<CloudAgentResult | null> {
  const headers = { "X-Browser-Use-API-Key": key, "Content-Type": "application/json" };
  const created = await fetch(`${BU_BASE}/tasks`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      task: task.slice(0, 50_000),
      llm: Deno.env.get("BROWSER_USE_LLM") || undefined,
      maxSteps: 60,
      vision: "auto",
    }),
  });
  if (!created.ok) {
    console.error("browser-use create failed", created.status, (await created.text().catch(() => "")).slice(0, 300));
    return null;
  }
  const info = await created.json().catch(() => null) as { id?: string; task_id?: string } | null;
  const id = info?.id || info?.task_id;
  if (!id) return null;

  const deadline = Date.now() + budgetMs;
  let seen = 0;
  let liveUrl: string | null = null;
  const steps: { title: string; url?: string | null }[] = [];

  while (Date.now() < deadline) {
    await sleep(3_000);
    const resp = await fetch(`${BU_BASE}/tasks/${id}`, { headers });
    if (!resp.ok) continue;
    const task = await resp.json().catch(() => null) as any;
    if (!task) continue;

    if (!liveUrl && task.sessionId) {
      const s = await fetch(`${BU_BASE}/sessions/${task.sessionId}`, { headers });
      if (s.ok) liveUrl = ((await s.json().catch(() => null)) as any)?.liveUrl ?? null;
    }

    const list = Array.isArray(task.steps) ? task.steps : [];
    for (const step of list.slice(seen)) {
      const entry = {
        title: String(step?.nextGoal || step?.evaluationPreviousGoal || "working…").slice(0, 200),
        url: step?.url ?? null,
      };
      steps.push(entry);
      onStep?.(entry);
    }
    seen = list.length;

    if (task.status === "finished") {
      return { provider: "browser-use", text: String(task.output ?? "").trim(), steps, liveUrl };
    }
    if (task.status === "failed" || task.status === "stopped") {
      console.error("browser-use task ended", task.status, task.error);
      return null;
    }
  }

  // Out of budget: stop the remote task so it does not keep burning credits.
  void fetch(`${BU_BASE}/tasks/${id}/stop`, { method: "POST", headers }).catch(() => {});
  return steps.length ? { provider: "browser-use", text: "", steps, liveUrl } : null;
}

/* ------------------------------ Hyperbrowser ----------------------------- */

async function runHyperbrowser(
  key: string,
  task: string,
  budgetMs: number,
  onStep?: AgentProgress,
): Promise<CloudAgentResult | null> {
  const headers = { "x-api-key": key, "Content-Type": "application/json" };
  const created = await fetch(`${HB_BASE}/task/browser-use`, {
    method: "POST",
    headers,
    body: JSON.stringify({ task: task.slice(0, 30_000), maxSteps: 40, useVision: false }),
  });
  if (!created.ok) {
    console.error("hyperbrowser create failed", created.status, (await created.text().catch(() => "")).slice(0, 300));
    return null;
  }
  const jobId = ((await created.json().catch(() => null)) as any)?.jobId;
  if (!jobId) return null;

  const deadline = Date.now() + budgetMs;
  const steps: { title: string; url?: string | null }[] = [];
  while (Date.now() < deadline) {
    await sleep(3_000);
    const resp = await fetch(`${HB_BASE}/task/browser-use/${jobId}`, { headers });
    if (!resp.ok) continue;
    const job = await resp.json().catch(() => null) as any;
    const status = job?.status;
    if (status === "completed") {
      const text = String(job?.data?.finalResult ?? job?.data?.output ?? "").trim();
      return { provider: "hyperbrowser", text, steps };
    }
    if (status === "failed" || status === "stopped") {
      console.error("hyperbrowser job ended", status, job?.error);
      return null;
    }
    const entry = { title: `browsing… (${status ?? "running"})` };
    onStep?.(entry);
  }
  return null;
}

/* --------------------------------- Public -------------------------------- */

/**
 * Runs one goal on the cloud agents: Browser Use first, Hyperbrowser as the
 * fallback. Returns null only when both providers are unavailable.
 */
export async function runCloudAgent(
  admin: Admin | null,
  goal: string,
  options: { budgetMs?: number; onStep?: AgentProgress } = {},
): Promise<CloudAgentResult | null> {
  const budgetMs = Math.min(Math.max(options.budgetMs ?? 180_000, 20_000), 900_000);
  const key = await buKey(admin);
  if (key) {
    const result = await runBrowserUse(key, goal, budgetMs, options.onStep);
    if (result?.text) return result;
    if (result) return result;
  }
  for (const hb of await hbKeys(admin)) {
    const result = await runHyperbrowser(hb, goal, budgetMs, options.onStep);
    if (result) return result;
  }
  return null;
}
