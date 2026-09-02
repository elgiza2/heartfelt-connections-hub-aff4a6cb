/**
 * @doc Referral milestone state — five verified invites unlock free Pro, and
 * once Pro is granted the program switches to the 20% revenue-share tier.
 *
 * All numbers come from the server (`my_referral_milestone`); the browser only
 * renders them. Claiming goes through `claim_referral_milestone`, which grants
 * the subscription server-side — the client never writes a plan.
 */
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export const MILESTONE_TARGET = 5;
export const REVENUE_SHARE_PERCENT = 20;

export interface ReferralMilestone {
  ok: boolean;
  referrals: number;
  target: number;
  remaining: number;
  granted: boolean;
  plan: string;
  expires_at: string | null;
}

export interface UseReferralMilestone {
  state: ReferralMilestone | null;
  loading: boolean;
  failed: boolean;
  claiming: boolean;
  /** True once the user is on the 20% revenue-share program. */
  isPartner: boolean;
  referrals: number;
  target: number;
  remaining: number;
  /** Ask the server to grant Pro. Resolves to the granted flag. */
  claim: () => Promise<{ ok: boolean; granted: boolean; error?: string }>;
  reload: () => Promise<void>;
}

export function useReferralMilestone(): UseReferralMilestone {
  const [state, setState] = useState<ReferralMilestone | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [claiming, setClaiming] = useState(false);

  const reload = useCallback(async () => {
    const { data, error } = await (supabase as any).rpc("my_referral_milestone");
    if (error || !data?.ok) {
      setFailed(true);
      setLoading(false);
      return;
    }
    setFailed(false);
    setState(data as ReferralMilestone);
    setLoading(false);
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const claim = useCallback(async () => {
    setClaiming(true);
    try {
      const { data, error } = await (supabase as any).rpc("claim_referral_milestone");
      if (error || !data?.ok) {
        return { ok: false, granted: false, error: error?.message || data?.error };
      }
      await reload();
      const granted = Boolean(data.granted) || data.reason === "already_granted";
      return { ok: true, granted };
    } finally {
      setClaiming(false);
    }
  }, [reload]);

  const target = state?.target || MILESTONE_TARGET;
  const referrals = state?.referrals ?? 0;

  return {
    state,
    loading,
    failed,
    claiming,
    isPartner: Boolean(state?.granted),
    referrals,
    target,
    remaining: Math.max(0, target - referrals),
    claim,
    reload,
  };
}

export default useReferralMilestone;
