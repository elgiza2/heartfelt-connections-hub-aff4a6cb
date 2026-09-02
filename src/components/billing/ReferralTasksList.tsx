/** @doc Bonus tasks on the referral page (review, follow, like & repost). */
import { ExternalLink, Check } from "lucide-react";
import { translateExactText, useUserLang } from "@/lib/authI18n";
import { useReferrals, type RewardTask } from "@/pages/billing/ReferralsPage";

/** Tasks we want featured on the invite page, in display order. */
const FEATURED_KEYS = ["trustpilot_review", "X", "x_like_repost"];

export default function ReferralTasksList({ className = "" }: { className?: string }) {
  const lang = useUserLang();
  const copy = (t: string) => translateExactText(t, lang);
  const { tasks, userTasks, claimTask } = useReferrals();

  const featured = FEATURED_KEYS.map((key) => tasks.find((t) => t.task_key === key)).filter(
    Boolean,
  ) as RewardTask[];

  if (featured.length === 0) return null;

  const isDone = (task: RewardTask) =>
    Boolean(userTasks.find((u) => u.task_id === task.id)?.completed_at);

  return (
    <section className={className}>
      <h2 className="px-1 text-[13px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
        {copy("Bonus tasks")}
      </h2>
      <ul className="mt-3 flex flex-col gap-2">
        {featured.map((task) => {
          const done = isDone(task);
          return (
            <li key={task.id}>
              <button
                type="button"
                onClick={() => claimTask(task)}
                disabled={done}
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
                <span className="shrink-0 text-[12.5px] font-semibold text-muted-foreground">
                  +{task.reward_credits}
                </span>
                <span className="shrink-0 text-muted-foreground">
                  {done ? (
                    <Check className="h-4 w-4" aria-hidden="true" />
                  ) : (
                    <ExternalLink className="h-4 w-4" aria-hidden="true" />
                  )}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
