/** @doc Server-reported referral milestone: five verified friends unlock limited-time Pro. */
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

interface Milestone {
  ok: boolean;
  referrals: number;
  target: number;
  remaining: number;
  granted: boolean;
  plan: string;
  expires_at: string | null;
}

const MILESTONE_TARGET = 5;

export default function MilestoneCard() {
  const [state, setState] = useState<Milestone | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      const { data, error } = await (supabase as any).rpc("my_referral_milestone");
      if (!alive) return;
      if (error || !data?.ok) {
        setFailed(true);
        return;
      }
      setState(data as Milestone);
    })();
    return () => {
      alive = false;
    };
  }, []);

  if (failed) {
    return (
      <section className="rounded-[20px] border border-border px-5 py-4">
        <p className="text-[13px] text-muted-foreground">
          Couldn't load your Pro progress. Refresh the page to try again.
        </p>
      </section>
    );
  }

  if (!state) {
    return <section className="h-[120px] animate-pulse rounded-[20px] border border-border" />;
  }

  const target = state.target || MILESTONE_TARGET;
  const done = Math.min(state.referrals, target);
  const expires = state.expires_at ? new Date(state.expires_at) : null;

  return (
    <section className="rounded-[20px] border border-border px-5 py-4">
      <div className="flex items-baseline justify-between gap-4">
        <p className="text-[14.5px] font-medium text-foreground">
          {state.granted ? "Pro is active" : "Your invitation progress"}
        </p>
        <span className="text-[13px] font-medium tabular-nums text-muted-foreground">
          {done} / {target}
        </span>
      </div>

      <p className="mt-1.5 text-[13px] leading-relaxed text-muted-foreground">
        {state.granted
          ? expires
            ? `Your free Pro access is active until ${expires.toLocaleDateString()}.`
            : "Your free Pro access is active."
          : "Verified invitations count toward your free Pro access."}
      </p>

      <div className="mt-4 grid grid-cols-5 gap-1.5" aria-hidden>
        {Array.from({ length: target }).map((_, i) => (
          <span
            key={i}
            className={`h-1.5 rounded-full ${i < done ? "bg-foreground" : "bg-foreground/12"}`}
          />
        ))}
      </div>
    </section>
  );
}
