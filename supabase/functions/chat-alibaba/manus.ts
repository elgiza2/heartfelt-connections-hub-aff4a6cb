/**
 * MEGSY primary agent — a Manus-style autonomous loop.
 *
 * This replaces the old "plan once, run parallel briefs, answer" primary agent.
 * Instead of a single planning round-trip, the lead agent now runs a real tool
 * loop: it writes a todo list, searches and reads the live web, delegates whole
 * subtasks to specialist agents, records durable memory, and only then hands a
 * compact evidence pack to the streaming answer.
 *
 * Every model call goes to Alibaba Model Studio (International) with the
 * project's own DashScope key — no AI gateway and no other provider is used.
 */

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { braveKey, braveSearch, readPage } from "./research.ts";
import { AGENTS, type AgentProfile, profileSystem } from "./router.ts";

/** Non-streaming raw chat call (returns the parsed upstream JSON body). */
export type RawCall = (
  models: string[],
  payload: Record<string, unknown>,
) => Promise<any>;

export type Frame = (frame: Record<string, unknown>) => void;

/** Lead-agent model ladder: strongest first, cheap flash last as a rescue. */
const LEAD_MODELS = ["qwen3.8-max", "qwen3.7-max", "qwen-max", "qwen-plus"];
const MAX_STEPS = 8;
/** Hard wall-clock budget for the whole loop, so a turn never hangs. */
const LOOP_BUDGET_MS = 150_000;
const SPECIALIST_IDS = Object.keys(AGENTS).filter((id) => id !== "general");

const LOOP_SYSTEM = `You are MEGSY's lead agent, running an autonomous work loop before the final answer is written.
Today is ${new Date().toISOString().slice(0, 10)}.

Your job in this loop is NOT to answer the user. Your job is to DO the work with tools and gather everything the final answer needs.

How to work:
1. Call write_todo first for anything that is more than a single fact, so the user sees the plan.
2. Use web_search + open_url whenever the answer depends on live facts, prices, news, people, products, laws or versions. Read the actual pages, do not trust snippets alone.
3. Delegate whole subtasks with delegate_agent. Specialists: ${SPECIALIST_IDS.join(", ")}.
   - coder: software, repos, debugging, infra. designer: UX/UI, design systems.
   - researcher: sourced facts. analyst: math, finance, strategy. data: SQL, metrics, spreadsheets.
   - writer: prose and copy. marketer: growth, SEO, campaigns, funnels. operator: multi-step execution.
   - reviewer: verify facts, code and numbers before delivery.
   Delegate in the SAME message when subtasks are independent — they run in parallel.
4. Use remember_fact only for durable user facts (name, business, stack, preferences), never for turn chatter.
5. Stop as soon as you have enough. Then reply with plain text notes (no tool call): the key findings, decisions and open risks the final answer must use. Never write the user-facing answer here.

Rules: never invent a tool result, never claim something ran that did not, keep every tool argument minimal, and never mention this loop, tools, agents or models to the user.`;

const TOOLS = [
  {
    type: "function",
    function: {
      name: "write_todo",
      description: "Publish or update the visible task list for this turn.",
      parameters: {
        type: "object",
        properties: {
          items: { type: "array", items: { type: "string" }, description: "3-7 short steps" },
        },
        required: ["items"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "web_search",
      description: "Search the live web and return titles, URLs and snippets.",
      parameters: {
        type: "object",
        properties: { query: { type: "string" } },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "open_url",
      description: "Fetch a URL and return its readable text.",
      parameters: {
        type: "object",
        properties: { url: { type: "string" } },
        required: ["url"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "delegate_agent",
      description: "Hand a self-contained subtask to a specialist agent and get its brief back.",
      parameters: {
        type: "object",
        properties: {
          agent: { type: "string", enum: SPECIALIST_IDS },
          goal: { type: "string", description: "Self-contained instruction, no references to other subtasks" },
        },
        required: ["agent", "goal"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "remember_fact",
      description: "Store a durable fact about this user for future turns.",
      parameters: {
        type: "object",
        properties: { key: { type: "string" }, value: { type: "string" } },
        required: ["key", "value"],
      },
    },
  },
];

type LoopMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_calls?: any[];
  tool_call_id?: string;
};

export type ManusResult = {
  /** Context block folded into the streaming answer's system prompt. */
  context: string;
  /** Todo list the lead agent published, if any. */
  todo: string[];
  /** Specialist ids that actually contributed. */
  used: string[];
  steps: number;
};

function toolLabel(name: string, args: any): string {
  switch (name) {
    case "web_search":
      return String(args?.query ?? "").slice(0, 120);
    case "open_url":
      return String(args?.url ?? "").slice(0, 160);
    case "delegate_agent":
      return `${args?.agent ?? "agent"}: ${String(args?.goal ?? "").slice(0, 100)}`;
    case "write_todo":
      return `${Array.isArray(args?.items) ? args.items.length : 0} steps`;
    default:
      return String(args?.key ?? "").slice(0, 80);
  }
}

/** One specialist run: its own persona and its own Alibaba model ladder. */
async function runSpecialist(
  raw: RawCall,
  profile: AgentProfile,
  goal: string,
  context: string,
): Promise<string> {
  const data = await raw(profile.models, {
    temperature: profile.temperature,
    max_tokens: 2600,
    messages: [
      {
        role: "system",
        content: `${profileSystem(profile)}

You are executing ONE subtask for the lead agent, not talking to the user. Deliver the finished artifact or a dense brief: facts, numbers, code, copy — no preamble, no questions, no meta commentary. Max ~500 words unless code requires more.`,
      },
      { role: "user", content: context ? `${goal}\n\nEvidence available:\n${context.slice(0, 6000)}` : goal },
    ],
  });
  const text = data?.choices?.[0]?.message?.content;
  return typeof text === "string" ? text.trim() : "";
}

/**
 * Runs the primary agent loop and returns the evidence pack for the final
 * streamed answer. Never throws: on any failure it degrades to whatever was
 * gathered so far.
 */
export async function runPrimaryAgent(opts: {
  admin: SupabaseClient;
  raw: RawCall;
  question: string;
  history: { role: string; content: unknown }[];
  send: Frame;
  userId: string | null;
  /** Set when the user forced a specialist from the UI. */
  forcedAgent?: string;
}): Promise<ManusResult> {
  const { admin, raw, question, send, userId } = opts;
  const started = Date.now();
  const evidence: string[] = [];
  const briefs: string[] = [];
  const sources: { title: string; url: string }[] = [];
  const used = new Set<string>();
  let todo: string[] = [];
  let notes = "";
  let steps = 0;

  const messages: LoopMessage[] = [
    { role: "system", content: LOOP_SYSTEM },
    {
      role: "user",
      content: `USER REQUEST:\n${question.slice(0, 8000)}${
        opts.forcedAgent ? `\n\n(The user pinned the ${opts.forcedAgent} specialist for this turn.)` : ""
      }`,
    },
  ];

  const exec = async (name: string, args: any): Promise<string> => {
    switch (name) {
      case "write_todo": {
        const items = Array.isArray(args?.items)
          ? args.items.filter((item: unknown) => typeof item === "string" && item.trim()).slice(0, 7)
          : [];
        if (items.length) {
          todo = items;
          send({ event: "todo", items });
        }
        return items.length ? `todo published (${items.length} steps)` : "no items";
      }
      case "web_search": {
        const query = String(args?.query ?? "").trim().slice(0, 300);
        if (!query) return "empty query";
        const key = await braveKey(admin);
        const results = key ? await braveSearch(key, query, 6) : [];
        if (!results.length) return "no results";
        const lines: string[] = [];
        for (const item of results.slice(0, 6)) {
          const url = (item.url ?? "").trim();
          if (!url) continue;
          const title = (item.title ?? "").trim();
          if (!sources.some((source) => source.url === url)) sources.push({ title, url });
          lines.push(`- ${title} — ${url}\n  ${(item.description ?? "").replace(/<[^>]+>/g, "").slice(0, 240)}`);
        }
        send({ sources: sources.slice(0, 12) });
        return lines.join("\n") || "no results";
      }
      case "open_url": {
        const url = String(args?.url ?? "").trim();
        if (!/^https?:\/\//i.test(url)) return "invalid url";
        const text = await readPage(url, 6000);
        if (!text) return "page unreadable";
        evidence.push(`SOURCE ${url}\n${text.slice(0, 4000)}`);
        if (!sources.some((source) => source.url === url)) sources.push({ title: url, url });
        return text.slice(0, 4000);
      }
      case "delegate_agent": {
        const id = String(args?.agent ?? "").trim().toLowerCase();
        const profile = AGENTS[id];
        const goal = String(args?.goal ?? "").trim();
        if (!profile || !goal) return "unknown specialist or empty goal";
        const brief = await runSpecialist(raw, profile, goal, evidence.join("\n\n"));
        if (!brief) return "specialist returned nothing";
        used.add(id);
        briefs.push(`### ${profile.label} — ${goal}\n${brief}`);
        return brief.slice(0, 4000);
      }
      case "remember_fact": {
        const key = String(args?.key ?? "").trim().slice(0, 120);
        const value = String(args?.value ?? "").trim().slice(0, 2000);
        if (!userId || !key || !value) return "not stored";
        await admin
          .from("agent_memory")
          .upsert({ user_id: userId, key, value }, { onConflict: "user_id,key" });
        return "stored";
      }
      default:
        return "unknown tool";
    }
  };

  try {
    for (let step = 0; step < MAX_STEPS; step += 1) {
      if (Date.now() - started > LOOP_BUDGET_MS) break;
      steps = step + 1;

      const data = await raw(LEAD_MODELS, {
        temperature: 0.25,
        max_tokens: 1400,
        parallel_tool_calls: true,
        tools: TOOLS,
        messages,
      });
      const message = data?.choices?.[0]?.message;
      if (!message) break;

      const calls = Array.isArray(message.tool_calls) ? message.tool_calls : [];
      if (!calls.length) {
        notes = typeof message.content === "string" ? message.content.trim() : "";
        break;
      }

      messages.push({
        role: "assistant",
        content: typeof message.content === "string" ? message.content : "",
        tool_calls: calls,
      });

      // Independent calls in one step run in parallel — this is what makes the
      // loop feel like a team rather than a queue.
      const outcomes = await Promise.all(calls.slice(0, 5).map(async (call: any) => {
        const name = String(call?.function?.name ?? "");
        let args: any = {};
        try {
          args = JSON.parse(call?.function?.arguments || "{}");
        } catch { /* malformed arguments degrade to empty */ }
        const callId = String(call?.id ?? `${name}-${Date.now()}-${Math.random()}`);
        const target = toolLabel(name, args);
        send({ tool_event: { type: "tool_call", name, call_id: callId, target } });
        let output = "";
        let ok = true;
        try {
          output = await exec(name, args);
        } catch (error) {
          ok = false;
          output = `error: ${error instanceof Error ? error.message : "failed"}`;
        }
        send({ tool_event: { type: "tool_result", name, call_id: callId, target, ok } });
        return { callId, output };
      }));

      for (const outcome of outcomes) {
        messages.push({
          role: "tool",
          tool_call_id: outcome.callId,
          content: outcome.output.slice(0, 6000) || "(empty)",
        });
      }
    }
  } catch (error) {
    console.error("chat-alibaba primary agent loop failed", error);
  }

  const parts: string[] = [];
  if (todo.length) {
    parts.push(`AGENT PLAN (already executed — do not re-plan, deliver the result):\n${
      todo.map((item, index) => `${index + 1}. ${item}`).join("\n")
    }`);
  }
  if (evidence.length) {
    parts.push(`LIVE EVIDENCE (write facts from this, cite as [n] using the source list):\n${
      evidence.join("\n\n").slice(0, 24_000)
    }`);
  }
  if (sources.length) {
    parts.push(`SOURCES:\n${
      sources.slice(0, 12).map((source, index) => `[${index + 1}] ${source.title || source.url} — ${source.url}`).join("\n")
    }`);
  }
  if (briefs.length) {
    parts.push(`SPECIALIST OUTPUT (merge into ONE seamless answer, never mention the specialists):\n${
      briefs.join("\n\n").slice(0, 24_000)
    }`);
  }
  if (notes) parts.push(`LEAD AGENT NOTES:\n${notes.slice(0, 6000)}`);

  return { context: parts.join("\n\n"), todo, used: [...used], steps };
}
