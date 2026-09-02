/**
 * @doc Keeps the user-visible agent trace human.
 *
 * The kernel persists everything it does, including internal bookkeeping
 * (checkpoints, failure classes, raw tool errors, JSON state). Those lines are
 * useful in the database and useless — often alarming — in the chat. This module
 * is the single filter every user-facing surface runs its lines through.
 */

/** Internal-only bookkeeping that must never reach the chat. */
const INTERNAL_LINE =
  /(checkpoint saved|task_checkpointed|step_id|fingerprint|failure[_ ]class|sandbox unavailable|worker is not defined|unsupported tool|no code provided|could not save the file|answer:[a-z_]+|ambiguous_goal|provider_error|http \d{3}|\bnull\b\s*$|^\s*[[{].*[\]}]\s*$)/i;

/** Bare technical identifiers a model sometimes emits as a "step". */
const BARE_IDENTIFIER = /^[a-z0-9]+([_-][a-z0-9]+){1,4}$/;

export function isInternalTraceLine(line: string): boolean {
  const value = (line ?? "").trim();
  if (!value) return true;
  if (INTERNAL_LINE.test(value)) return true;
  // "web-tech-stack", "date-retrieval-method", "file_saving_reliability" …
  if (BARE_IDENTIFIER.test(value) && !value.includes(" ")) return true;
  return false;
}

/** Filters a trace to the lines a human should actually read. */
export function cleanTrace(lines: (string | null | undefined)[]): string[] {
  const out: string[] = [];
  for (const raw of lines) {
    const value = String(raw ?? "").trim();
    if (isInternalTraceLine(value)) continue;
    if (out[out.length - 1] === value) continue;
    out.push(value.length > 240 ? `${value.slice(0, 240)}…` : value);
  }
  return out;
}
