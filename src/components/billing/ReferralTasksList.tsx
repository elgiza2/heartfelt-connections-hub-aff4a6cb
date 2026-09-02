/**
 * @doc Required steps on the referral page. All of them must be finished —
 * together with five verified invites — before free Pro can be claimed.
 * No credits are involved: these are unlock conditions, not paid rewards.
 */
import { useState } from "react";
import { ExternalLink, Check, ChevronDown } from "lucide-react";
import { toast } from "sonner";
import { translateExactText, useUserLang } from "@/lib/authI18n";
import { useReferrals } from "@/pages/billing/ReferralsPage";

export default function ReferralTasksList({ className = "" }: { className?: string }) {
  const lang = useUserLang();
  const copy = (t: string) => translateExactText(t, lang);
  const { milestone } = useReferrals();
  const [busy, setBusy] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  const tasks = milestone.tasks;
  if (tasks.length === 0) return null;

  const run = async (key: string, url: string | null) => {
    if (url) window.open(url, "_blank", "noopener,noreferrer");
    setBusy(key);
    try {
      const ok = await milestone.completeTask(key);
      if (!ok) toast.error(copy("We couldn't save this step yet"));
    } finally {
      setBusy(null);
    }
  };

  const doneCount = tasks.filter((t) => t.done).length;

  return (
    <section className={className}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center justify-center gap-2 rounded-full border border-border bg-foreground/[0.03] px-4 py-2.5 text-[13.5px] font-medium text-foreground transition hover:bg-foreground/[0.07]"
      >
        <span>{copy("Required steps")}</span>
        <span className="tabular-nums text-muted-foreground" dir="ltr">
          {doneCount}/{tasks.length}
        </span>
        <ChevronDown
          className={`h-4 w-4 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`}
          aria-hidden="true"
        />
      </button>

      {!open ? null : (
      <>
      <p className="mt-3 px-1 text-[12.5px] leading-relaxed text-muted-foreground">
        {copy("Finish all steps below to unlock your free Pro subscription.")}
      </p>


      <ul className="mt-3 flex flex-col gap-2">
        {tasks.map((task) => (
          <li key={task.key}>
            <button
              type="button"
              onClick={() => run(task.key, task.url)}
              disabled={task.done || busy === task.key}
              className="flex w-full items-center gap-3 rounded-[18px] border border-border bg-foreground/[0.03] px-4 py-3.5 text-left transition hover:bg-foreground/[0.06] active:scale-[0.995] disabled:cursor-default disabled:opacity-60"
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[15px] font-medium text-foreground">
                  {copy(task.title)}
                </span>
                {task.description ? (
                  <span className="mt-0.5 block truncate text-[12.5px] text-muted-foreground">
                    {copy(task.description)}
                  </span>
                ) : null}
              </span>
              <span className="shrink-0 text-muted-foreground">
                {task.done ? (
                  <Check className="h-4 w-4" aria-hidden="true" />
                ) : (
                  <ExternalLink className="h-4 w-4" aria-hidden="true" />
                )}
              </span>
            </button>
          </li>
        ))}
      </ul>
      </>
      )}
    </section>

  );
}
