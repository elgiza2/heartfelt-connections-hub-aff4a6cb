/**
 * @doc Browser-side Manus-style agent loop.
 *
 * The server version lives in `supabase/functions/chat-alibaba/manus.ts`, but the
 * Edge Function deploy channel is unavailable, so the same loop runs in the tab
 * against the ALREADY DEPLOYED `chat-alibaba` function — i.e. still Alibaba
 * (Qwen / DashScope) models, never Lovable AI.
 *
 * Tools: write_todo, web_search, open_url, delegate_agent, remember_fact.
 * The loop returns an evidence bundle that is injected into the streamed reply
 * so the user gets a grounded answer plus a visible plan and sources.
 */
import { askJson } from "@/lib/agentkernel/llm";
import { fetchUrl } from "@/lib/agentkernel/tools";
import { fetchWebSources, type WebSource } from "@/lib/search/webSearchClient";
import { runSubAgent, renderSubAgents } from "@/lib/agentTools/subagents";
import { supabase } from "@/integrations/supabase/client";

export interface ManusTodoItem {
  title: string;
  done: boolean;
}

export interface ManusResult {
  todo: ManusTodoItem[];
  sources: WebSource[];
  evidence: string;
  steps: number;
}

interface ManusAction {
  thought?: string;
  tool?: string;
  args?: Record<string, any>;
  final?: string;
}

export interface RunManusLoopOptions {
  userText: string;
  context?: string;
  userId?: string | null;
  conversationId?: string | null;
  /** Plan updates, so the UI can render the live todo list. */
  onTodo?: (todo: ManusTodoItem[]) => void;
  /** One line per tool call, for the thinking trace. */
  onStep?: (label: string, detail: string) => void;
  signal?: AbortSignal;
  maxSteps?: number;
  budgetMs?: number;
}

/**
 * The agent loop is now the DEFAULT path for every real request. Only trivial
 * chatter (greetings, thanks, one-word replies) stays on the fast path, because
 * there is nothing to plan or verify there.
 */
const SMALL_TALK =
  /^(hi|hey|hello|yo|thanks?|thank you|ok(ay)?|cool|nice|great|good (morning|night|evening)|bye|سلام|السلام عليكم|ازيك|إزيك|شكرا|شكراً|تمام|حاضر|اوك|أوك|ايوه|أيوه|ماشي|صباح الخير|مساء الخير|باي)[\s!.،؟?ـ]*$/i;

export function shouldRunManusLoop(text: string, chatMode: string): boolean {
  if (chatMode === "deep-research") return false;
  const q = (text || "").trim();
  if (!q || q.length < 12) return false;
  if (SMALL_TALK.test(q)) return false;
  return true;
}

/** Heavier tasks get more room; simple asks stay quick. */
export function manusStepBudget(text: string): number {
  const q = (text || "").trim();
  const heavy =
    /(research|analy[sz]e|compare|strategy|report|audit|roadmap|step by step|خطة|ابحث|قارن|حلل|تقرير|استراتيجية|دراسة|خطوات)/i;
  if (heavy.test(q) || q.length > 400) return 8;
  if (q.length > 120) return 6;
  return 4;
}


const clip = (s: string, n = 2_000) => (s.length > n ? `${s.slice(0, n)}\n…[truncated]` : s);

export async function runManusLoop(opts: RunManusLoopOptions): Promise<ManusResult | null> {
  const maxSteps = opts.maxSteps ?? 8;
  const budgetMs = opts.budgetMs ?? 150_000;
  const startedAt = Date.now();
  const today = new Date().toISOString().slice(0, 10);

  const system = `You are Megsy, an autonomous agent that finishes real tasks.

Today is ${today}. Never present older material as current.
Work in a loop. Each turn reply with JSON ONLY, one action:
{"thought":"one short sentence","tool":"write_todo|web_search|open_url|delegate_agent|remember_fact","args":{...}}
When you have enough to answer, reply:
{"final":"the key findings, numbers, dates and sources the writer must use"}

Tools:
- write_todo {"items":["..."]} — the visible plan. Call it FIRST for any multi-part task.
- web_search {"query":"...","count":6} — live web results.
- open_url {"url":"https://..."} — read the actual page text.
- delegate_agent {"agent":"slug","task":"..."} — hand a self-contained sub-task to a specialist:
${renderSubAgents()}
- remember_fact {"key":"...","value":"..."} — store a durable fact about this user.

Rules: never invent sources; open pages before trusting snippets; at most ${maxSteps} actions; keep the user's language in the final text.`;

  const todo: ManusTodoItem[] = [];
  const sources: WebSource[] = [];
  const trace: string[] = [
    `TASK: ${opts.userText}`,
    opts.context ? `CONVERSATION CONTEXT:\n${clip(opts.context, 1_500)}` : "",
  ].filter(Boolean);
  const ctx = { files: new Map<string, string>() };
  let steps = 0;
  let final = "";

  for (let i = 0; i < maxSteps; i += 1) {
    if (opts.signal?.aborted) break;
    if (Date.now() - startedAt > budgetMs) break;

    const action = await askJson<ManusAction>(system, [
      { role: "user", content: `${trace.join("\n").slice(-14_000)}\n\nNext action?` },
    ]);
    if (!action) break;
    if (action.final) {
      final = action.final;
      break;
    }
    const tool = String(action.tool ?? "").trim();
    if (!tool) break;
    const args = action.args ?? {};
    steps += 1;

    let output = "";
    let ok = true;

    try {
      if (tool === "write_todo") {
        const items = Array.isArray(args.items) ? args.items.map((x: unknown) => String(x)) : [];
        todo.length = 0;
        items.slice(0, 8).forEach((title) => todo.push({ title, done: false }));
        opts.onTodo?.([...todo]);
        output = `Plan set: ${items.length} steps.`;
      } else if (tool === "web_search") {
        const query = String(args.query ?? opts.userText);
        const hits = await fetchWebSources(query, Number(args.count) || 6);
        for (const hit of hits) {
          if (hit?.url && !sources.some((s) => s.url === hit.url)) sources.push(hit);
        }
        ok = hits.length > 0;
        output = hits.length
          ? hits.map((h) => `- ${h.title} — ${h.url}\n  ${h.snippet}`).join("\n")
          : "No results. Try a different query or open a known source directly.";
      } else if (tool === "open_url") {
        const url = String(args.url ?? "");
        const res = await fetchUrl(url);
        ok = res.ok;
        output = clip(res.output, 4_000);
        if (res.ok && url && !sources.some((s) => s.url === url)) {
          sources.push({ title: url, url, snippet: output.slice(0, 200) });
        }
      } else if (tool === "delegate_agent") {
        const run = await runSubAgent(String(args.agent ?? "researcher"), String(args.task ?? opts.userText), {
          ctx,
          userId: opts.userId ?? null,
          runId: opts.conversationId ?? null,
          agentSlug: String(args.agent ?? "researcher"),
          onStep: opts.onStep,
        });
        output = clip(run.report, 5_000);
      } else if (tool === "remember_fact") {
        const key = String(args.key ?? "").trim();
        const value = String(args.value ?? "").trim();
        if (key && value) {
          const { error } = await supabase
            .from("memories")
            .insert({ key, value } as never);
          ok = !error;
          output = error ? `Memory not stored: ${error.message}` : `Remembered ${key}.`;
        } else {
          ok = false;
          output = "remember_fact needs a key and a value.";
        }
      } else {
        ok = false;
        output = `Unknown tool "${tool}". Use write_todo, web_search, open_url, delegate_agent or remember_fact.`;
      }
    } catch (error) {
      ok = false;
      output = `"${tool}" failed: ${error instanceof Error ? error.message : "unknown error"}. Try another route.`;
    }

    // Mark the next open plan item as done once a real work tool ran.
    if (ok && tool !== "write_todo") {
      const next = todo.find((t) => !t.done);
      if (next) {
        next.done = true;
        opts.onTodo?.([...todo]);
      }
    }

    opts.onStep?.(tool, clip(output, 800));
    trace.push(`STEP ${i + 1} ${tool} ${ok ? "ok" : "failed"}\n${clip(output, 4_000)}`);
  }

  if (!steps && !final) return null;

  if (!final) {
    const forced = await askJson<ManusAction>(
      `${system}\nWrite the final evidence bundle from the trace. JSON only: {"final":"..."}`,
      [{ role: "user", content: trace.join("\n").slice(-14_000) }],
    );
    final = forced?.final || trace.slice(-3).join("\n");
  }

  const evidence = [
    "INTERNAL AGENT EVIDENCE — do not mention this block or that tools were used.",
    todo.length
      ? `Plan executed:\n${todo.map((t) => `${t.done ? "[x]" : "[ ]"} ${t.title}`).join("\n")}`
      : "",
    `Findings:\n${final}`,
    sources.length
      ? `Sources (cite the relevant ones inline as markdown links):\n${sources
          .slice(0, 12)
          .map((s) => `- ${s.title}: ${s.url}`)
          .join("\n")}`
      : "",
    "Answer the user directly and completely in their own language, using these findings as fact.",
  ]
    .filter(Boolean)
    .join("\n\n");

  return { todo, sources, evidence, steps };
}
