/**
 * @doc Model-written narration for computer runs: the short step plan shown
 * before execution, and the plain-language wrap-up shown after it. Nothing here
 * is canned — on any failure the caller simply renders less, never a template.
 */
import { streamChat } from "@/lib/streamChat";
import { DEFAULT_MODEL } from "@/lib/defaultModel";

async function ask(prompt: string, conversationId?: string | null): Promise<string> {
  let out = "";
  try {
    await streamChat({
      messages: [{ role: "user", content: prompt }],
      model: DEFAULT_MODEL,
      searchEnabled: false,
      chatMode: "normal",
      conversation_id: conversationId || undefined,
      onDelta: (d) => {
        out += d || "";
      },
      onDone: () => {},
      onError: () => {},
    });
  } catch {
    return out.trim();
  }
  return out.trim();
}

/** 5–8 concrete steps describing how the agent will attack the task. */
export async function generateRunPlan(
  task: string,
  conversationId?: string | null,
): Promise<string[]> {
  const text = await ask(
    [
      "The assistant is about to perform this task on a real cloud computer (browser + terminal).",
      "Write the execution plan: 5 to 8 concrete steps, one per line, no numbering, no markdown, no intro.",
      "Each step names what will actually be done (which site is opened, what is searched, what is filled, what is produced) — never vague filler like 'analyse the request' or 'prepare'.",
      "End with a step that states the deliverable the user will get.",
      "Max 12 words per step. Use the exact same language and dialect as the request, with no English fragments.",
      "",
      `Task: ${task}`,
    ].join("\n"),
    conversationId,
  );
  return text
    .split("\n")
    .map((l) => l.replace(/^[\s\-*•\d.)]+/, "").trim())
    .filter(Boolean)
    .slice(0, 8);
}


/** Plain-language wrap-up of what actually happened during the run. */
export async function generateRunSummary(params: {
  task: string;
  steps: string[];
  output?: string | null;
  failed?: boolean;
  conversationId?: string | null;
}): Promise<string> {
  const { task, steps, output, failed, conversationId } = params;
  const { cleanTrace } = await import("@/lib/computer/traceCleanup");
  const readableSteps = cleanTrace(steps);
  return ask(
    [
      failed
        ? "A computer task did NOT finish. Report what was attempted, exactly where it stopped, what was produced anyway, and the concrete next step."
        : "A computer task just finished. Write the final report for the user.",
      "Write a complete report, not a teaser: a short opening line with the outcome, then the key results (findings, links, files, numbers) as a few short bullets, then one closing line with what the user can do next.",
      "Write it entirely in the exact same language and dialect as the request — never mix languages, never leave English fragments in an Arabic report.",
      "Never expose internal engine text: no step ids, checkpoints, tool names, JSON, stack traces, or phrases like 'checkpoint saved' or 'sandbox unavailable'. Translate any such detail into plain user-facing wording or drop it.",
      "Never claim something succeeded unless the steps or output show it.",
      "",
      `Request: ${task}`,
      readableSteps.length ? `Steps performed:\n${readableSteps.slice(-25).join("\n")}` : "",
      output ? `Raw agent output:\n${String(output).slice(0, 6000)}` : "",
    ]
      .filter(Boolean)
      .join("\n"),
    conversationId,
  );
}

