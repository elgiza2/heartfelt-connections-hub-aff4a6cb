/** @doc Unified cloud-agent answering engine.
 *
 * Runs a whole chat turn on the cloud browser agents (Browser Use Cloud, with
 * Hyperbrowser as the server-side fallback) through the deployed
 * `computer-agent` function. The agents bring their own LLM, so this path needs
 * no separate chat-model provider: it plans, browses when needed, and returns a
 * finished answer.
 *
 * Used for every service that needs a real answer — normal chat, deep research,
 * code, docs, slides briefs and long multi-hour tasks — whenever the text model
 * path is unavailable.
 */
import { createComputerTask, pollComputerTask } from "@/lib/computer/client";

export interface CloudAgentAnswer {
  text: string;
  steps: string[];
  /** Task the answer came from, so the UI can show the computer surface. */
  taskId?: string | null;
}

export interface CloudAgentOptions {
  /** Conversation the turn belongs to, so the agent keeps its memory. */
  conversationId?: string | null;
  /** Hard budget. Long tasks can legitimately run for hours. */
  budgetMs?: number;
  /** Live progress for the UI (one line per agent step). */
  onStep?: (title: string, url?: string | null) => void;
  signal?: AbortSignal;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Wraps the user's goal so the agent answers like the product's assistant and
 * only opens a browser when fresh facts are actually needed.
 */
export function buildAgentGoal(userText: string, context?: string): string {
  return [
    "You are Megsy, an autonomous assistant. Complete the task end to end.",
    "Answer in the exact same language and dialect as the user.",
    "Browse the web only when the task needs fresh or external facts; otherwise answer directly and fast.",
    "Return the final, polished answer only — no step logs, no internal notes. Cite links when you used the web.",
    context ? `Context:\n${context}` : "",
    `Task:\n${userText}`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

export async function runCloudAgentAnswer(
  userText: string,
  options: CloudAgentOptions = {},
): Promise<CloudAgentAnswer | null> {
  const goal = buildAgentGoal(userText);
  const created = await createComputerTask({
    prompt: goal,
    conversation_id: options.conversationId ?? null,
  }).catch(() => null);
  if (!created?.task_id || created.status === "failed") return null;

  const deadline = Date.now() + Math.min(Math.max(options.budgetMs ?? 240_000, 20_000), 6 * 60 * 60_000);
  let seenSteps = 0;
  const steps: string[] = [];

  while (Date.now() < deadline) {
    if (options.signal?.aborted) return steps.length ? { text: "", steps } : null;
    await sleep(2_500);
    const snapshot = await pollComputerTask(created.task_id).catch(() => null);
    if (!snapshot?.task) continue;

    for (const event of (snapshot.events ?? []).slice(seenSteps)) {
      steps.push(event.title);
      options.onStep?.(event.title, event.url);
    }
    seenSteps = (snapshot.events ?? []).length;

    if (snapshot.task.status === "done") {
      return { text: (snapshot.task.result_text ?? "").trim(), steps };
    }
    if (snapshot.task.status === "failed") return null;
  }
  return null;
}
