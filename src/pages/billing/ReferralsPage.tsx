/** @doc Referral program — invite 5 friends, get Pro free. No points system. */
import {
  useState,
  useEffect,
  useCallback,
  createContext,
  useContext,
} from "react";
import { Outlet, useNavigate, useLocation } from "react-router-dom";
import { toast } from "sonner";
import { translateExactText, useUserLang } from "@/lib/authI18n";

import { supabase } from "@/integrations/supabase/client";
import AppSidebar from "@/components/layout/AppSidebar";
import { useSidebarCollapsed } from "@/hooks/useSidebarCollapsed";
import MobilePushShell from "@/components/layout/MobilePushShell";
import MobileSidebarButton from "@/components/shared/MobileSidebarButton";
import { safeCopyText } from "@/lib/safeClipboard";
import {
  useReferralMilestone,
  type UseReferralMilestone,
} from "@/hooks/useReferralMilestone";


function useIsDesktop() {
  const [isDesktop, setIsDesktop] = useState<boolean>(
    () => typeof window !== "undefined" && window.matchMedia("(min-width: 1024px)").matches,
  );
  useEffect(() => {
    const mql = window.matchMedia("(min-width: 1024px)");
    const on = () => setIsDesktop(mql.matches);
    mql.addEventListener("change", on);
    on();
    return () => mql.removeEventListener("change", on);
  }, []);
  return isDesktop;
}

export const WHATSAPP_PHONE = "201098821812";
export const PROMOTER_MESSAGE =
  "Hello, I want to join the Megsy AI promotion / referral system. Please send me the details.";
export const MIN_PAYOUT = 10;

/* Neutral, quiet palette — no gradients, no neon. */
export const PAGE_BG = "hsl(var(--background))";
export const SURFACE = "hsl(var(--foreground) / 0.035)";
export const SURFACE_2 = "hsl(var(--foreground) / 0.06)";
export const BORDER = "hsl(var(--foreground) / 0.10)";
export const TEXT = "hsl(var(--foreground))";
export const MUTED = "hsl(var(--foreground) / 0.6)";
export const INK = "hsl(var(--background))";
export const YELLOW = "hsl(var(--foreground))";
export const PINK = "hsl(var(--foreground) / 0.6)";
export const MINT = "hsl(var(--foreground) / 0.6)";
export const LAVENDER = "hsl(var(--foreground) / 0.6)";
export const PEACH = "hsl(var(--foreground) / 0.6)";
export const BLUE = "hsl(var(--foreground) / 0.6)";
export const GOLD = "#C9A24C";
export const GOLD_SOFT = "#F6E7B7";

export interface Referral {
  id: string;
  status: string;
  created_at: string;
}
export interface Earning {
  id: string;
  amount: number;
  source_action: string;
  created_at: string;
}
export interface Withdrawal {
  id: string;
  amount: number;
  status: string;
  method: string;
  created_at: string;
}
export interface RewardTask {
  id: string;
  task_key: string;
  title: string;
  description: string | null;
  reward_credits: number;
  action_type: string;
  action_url: string | null;
  target_count: number;
  icon: string | null;
}
export interface UserTask {
  task_id: string;
  progress: number;
  completed_at: string | null;
  awarded_credits: number;
}

export const fmtDate = (d: string) =>
  new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric" });

export const statusTone = (s: string) => {
  if (s === "approved" || s === "paid" || s === "active")
    return "bg-emerald-500/10 text-emerald-400 ring-emerald-500/20";
  if (s === "rejected") return "bg-rose-500/10 text-rose-400 ring-rose-500/20";
  return "bg-amber-500/10 text-amber-400 ring-amber-500/20";
};

export const statusLabel = (s: string) =>
  (
    ({
      approved: "Approved",
      pending: "Pending",
      rejected: "Rejected",
      paid: "Paid",
      active: "Active",
    }) as Record<string, string>
  )[s] ?? s;

export const EmptyState = ({ title, hint }: { title: string; hint: string }) => (
  <div className="flex flex-col items-center justify-center py-14 text-center">
    <p className="text-[15px] font-medium text-foreground">{title}</p>
    <p className="mt-1 max-w-[280px] text-[13px] leading-relaxed text-foreground/55">{hint}</p>
  </div>
);

/* ── Shared primitives ─────────────────────────────────────────── */

export const Card = ({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) => (
  <div
    className={`rounded-2xl border border-foreground/10 bg-foreground/[0.03] ${className}`}
  >
    {children}
  </div>
);

export const PrimaryButton = ({
  children,
  onClick,
  disabled,
  className = "",
}: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  className?: string;
}) => (
  <button
    type="button"
    onClick={onClick}
    disabled={disabled}
    className={`inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-primary px-5 text-[14px] font-semibold text-primary-foreground transition hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-40 ${className}`}
  >
    {children}
  </button>
);

export const GhostButton = ({
  children,
  onClick,
  disabled,
  className = "",
  "aria-label": ariaLabel,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  className?: string;
  "aria-label"?: string;
}) => (
  <button
    type="button"
    onClick={onClick}
    disabled={disabled}
    aria-label={ariaLabel}
    className={`inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-foreground/15 bg-foreground/[0.04] px-5 text-[14px] font-medium text-foreground transition hover:bg-foreground/[0.08] disabled:cursor-not-allowed disabled:opacity-40 ${className}`}
  >
    {children}
  </button>
);

/* ── Context ───────────────────────────────────────────────────── */

export interface ReferralsContextValue {
  userId: string | null;
  code: string;
  link: string;
  refs: Referral[];
  earns: Earning[];
  wds: Withdrawal[];
  tasks: RewardTask[];
  userTasks: UserTask[];
  totalEarned: number;
  committed: number;
  available: number;
  signups: number;
  canWithdraw: boolean;
  justCopied: boolean;
  claimTask: (t: RewardTask) => void;
  copyLink: () => Promise<void>;
  shareLink: () => Promise<void>;
  openPromoter: () => void;
  openQr: () => void;
  reload: () => void;
  milestone: UseReferralMilestone;
}

const REFERRALS_FALLBACK: ReferralsContextValue = {
  userId: null,
  code: "",
  link: "",
  refs: [],
  earns: [],
  wds: [],
  tasks: [],
  userTasks: [],
  totalEarned: 0,
  committed: 0,
  available: 0,
  signups: 0,
  canWithdraw: false,
  justCopied: false,
  claimTask: () => {},
  copyLink: async () => {},
  shareLink: async () => {},
  openPromoter: () => {},
  openQr: () => {},
  reload: () => {},
  milestone: {
    state: null,
    loading: true,
    failed: false,
    claiming: false,
    isPartner: false,
    referrals: 0,
    target: 5,
    remaining: 5,
    tasks: [],
    tasksComplete: false,
    canClaim: false,
    completeTask: async () => false,
    claim: async () => ({ ok: false, granted: false }),
    reload: async () => {},
  },
};

const ReferralsCtx = createContext<ReferralsContextValue | null>(null);
export const useReferrals = () => useContext(ReferralsCtx) ?? REFERRALS_FALLBACK;

const ReferralsPage = () => {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const onRewards = pathname.endsWith("/rewards");
  const lang = useUserLang();
  const milestone = useReferralMilestone();
  const [userId, setUserId] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [refs, setRefs] = useState<Referral[]>([]);
  const [earns, setEarns] = useState<Earning[]>([]);
  const [wds, setWds] = useState<Withdrawal[]>([]);
  const [tasks, setTasks] = useState<RewardTask[]>([]);
  const [userTasks, setUserTasks] = useState<UserTask[]>([]);
  const [justCopied, setJustCopied] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const isDesktop = useIsDesktop();
  const [sidebarCollapsed] = useSidebarCollapsed();
  const sidebarWidth = sidebarCollapsed ? 60 : 320;

  const loadData = useCallback(async () => {
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;
      setUserId(user.id);

      const { data: codes } = await supabase
        .from("referral_codes")
        .select("code")
        .eq("user_id", user.id)
        .limit(1);
      let row = codes?.[0] as { code: string } | undefined;
      if (!row) {
        const newCode = `MEGSY-${user.id.substring(0, 6).toUpperCase()}`;
        await supabase
          .from("referral_codes")
          .insert({ user_id: user.id, code: newCode, referral_mode: "cash" });
        row = { code: newCode };
      }
      setCode(row.code);

      const [r, e, w, tk, ut] = await Promise.all([
        supabase
          .from("referrals")
          .select("*")
          .eq("referrer_id", user.id)
          .order("created_at", { ascending: false }),
        supabase
          .from("referral_earnings")
          .select("*")
          .eq("referrer_id", user.id)
          .order("created_at", { ascending: false }),
        supabase
          .from("withdrawal_requests")
          .select("*")
          .eq("user_id", user.id)
          .order("created_at", { ascending: false }),
        supabase.from("reward_tasks").select("*").eq("active", true).order("sort_order"),
        supabase
          .from("user_reward_tasks")
          .select("task_id, progress, completed_at, awarded_credits")
          .eq("user_id", user.id),
      ]);
      setRefs(r.data ?? []);
      setEarns(e.data ?? []);
      setWds(w.data ?? []);
      setTasks((tk.data as RewardTask[]) ?? []);
      setUserTasks((ut.data as UserTask[]) ?? []);
    } catch {
      // A failed lookup must never blank the page — the invite UI still works.
    }
  }, []);


  useEffect(() => {
    loadData();
  }, [loadData]);

  const claimTask = async (task: RewardTask) => {
    if (!userId) return;
    const existing = userTasks.find((u) => u.task_id === task.id);
    if (existing?.completed_at) return;

    if (task.action_type === "invite_friends") {
      const progress = refs.length;
      if (progress < task.target_count) {
        toast.error(`Invite ${task.target_count - progress} more friends first`);
        return;
      }
    } else if (task.action_url) {
      window.open(task.action_url, "_blank", "noopener,noreferrer");
    }

    // Credit grants must be verified and awarded atomically by a privileged
    // backend flow; never trust a browser-written completion row or amount.
    toast.info("This reward is awaiting secure verification");
  };

  const link = code ? `${window.location.origin}/ref/${code}` : "";
  const totalEarned = earns.reduce((s, x) => s + Number(x.amount), 0);
  const committed = wds
    .filter((w) => w.status !== "rejected")
    .reduce((s, x) => s + Number(x.amount), 0);
  const available = totalEarned - committed;
  const signups = refs.length;
  const canWithdraw = available >= MIN_PAYOUT;

  const copyLink = async () => {
    if (!link) return;
    await safeCopyText(link);
    setJustCopied(true);
    setTimeout(() => setJustCopied(false), 1600);
    toast.success(translateExactText("Invite link copied", lang));
  };

  const shareLink = async () => {
    if (!link) return;
    const shareText = `Join Megsy AI with my invite link:\n${link}`;
    if (navigator.share) {
      try {
        await navigator.share({ title: "Megsy AI", text: shareText, url: link });
        return;
      } catch {
        /* fallthrough */
      }
    }
    await safeCopyText(shareText);
    toast.success(translateExactText("Invite message copied", lang));
  };

  const openPromoter = () => {
    const url = `https://wa.me/${WHATSAPP_PHONE}?text=${encodeURIComponent(PROMOTER_MESSAGE)}`;
    window.open(url, "_blank", "noopener,noreferrer");
  };

  const ctx: ReferralsContextValue = {
    userId,
    code,
    link,
    refs,
    earns,
    wds,
    tasks,
    userTasks,
    totalEarned,
    committed,
    available,
    signups,
    canWithdraw,
    justCopied,
    claimTask,
    copyLink,
    shareLink,
    openPromoter,
    openQr: () => {},
    reload: loadData,
    milestone,
  };

  const content = (
    <div className={`mx-auto flex w-full max-w-[620px] flex-col px-5 ${onRewards ? "pb-10" : "pb-6"} ${onRewards ? "pt-3" : "pt-14"} md:pt-7`}>
      {onRewards || isDesktop ? null : (
        <MobileSidebarButton edge onClick={() => setSidebarOpen(true)} />
      )}

      <div className="flex flex-1 flex-col">
        <Outlet />
      </div>
    </div>
  );

  const claimPro = async () => {
    if (!milestone.canClaim || milestone.claiming || milestone.isPartner) {
      if (milestone.remaining > 0)
        toast.error(translateExactText("Invite 5 friends first", lang));
      else if (!milestone.tasksComplete)
        toast.error(translateExactText("Finish all required steps first", lang));
      return;
    }
    try {
      const result = await milestone.claim();
      if (result.granted) toast.success(translateExactText("Pro activated", lang));
      else toast.error(translateExactText("We couldn't activate Pro yet", lang));
    } catch {
      toast.error(translateExactText("We couldn't activate Pro yet", lang));
    }
  };

  /**
   * Pinned actions — share the invite or claim Pro after five verified joins.
   *
   * This is `sticky` inside the scroll container, not `fixed` to the viewport:
   * a fixed bar is centred on the whole window, so on desktop it drifted out
   * of the content column and slid under the sidebar, and its full-width
   * backdrop strip did not line up with the bordered button box.
   */
  const actionBar = (
    <div
      className="sticky bottom-0 z-30 border-t border-border bg-background/95 backdrop-blur"
      style={{ paddingBottom: "max(env(safe-area-inset-bottom), 14px)" }}
    >
      <div className="mx-auto w-full max-w-[620px] px-5 pt-3">
        <div className="flex flex-col gap-2.5">
          <button
            type="button"
            onClick={shareLink}
            disabled={!link}
            className="inline-flex h-[52px] w-full items-center justify-center rounded-[16px] bg-foreground px-5 text-[15px] font-semibold text-background transition hover:opacity-90 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-40"
          >
            {translateExactText("Invite friends", lang)}
          </button>
          <button
            type="button"
            onClick={claimPro}
            disabled={milestone.loading || milestone.failed || milestone.claiming || milestone.isPartner}
            className="inline-flex h-[52px] w-full items-center justify-center rounded-[16px] border border-border bg-background px-5 text-[15px] font-medium text-foreground transition hover:bg-foreground/[0.05] active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-40"
          >
            {milestone.isPartner
              ? translateExactText("Pro is active", lang)
              : milestone.claiming
                ? translateExactText("Activating Pro…", lang)
                : translateExactText("Get Pro", lang)}
          </button>
        </div>
      </div>
    </div>
  );





  return (
    <ReferralsCtx.Provider value={ctx}>
      {isDesktop ? (
        <div className="flex h-[100dvh] w-full overflow-hidden bg-background text-foreground">
          <aside
            style={{ width: sidebarWidth, minWidth: sidebarWidth, flexBasis: sidebarWidth }}
            className="relative z-40 hidden shrink-0 overflow-hidden transition-[width,min-width,flex-basis] duration-300 md:flex"
          >
            <AppSidebar open inline onClose={() => {}} onNewChat={() => navigate("/")} />
          </aside>
          <main className="relative min-w-0 flex-1 overflow-y-auto bg-background">
            {content}
            {onRewards ? null : actionBar}
          </main>
        </div>
      ) : (
        <MobilePushShell
          open={sidebarOpen}
          onOpenChange={setSidebarOpen}
          onNewChat={() => navigate("/")}
          currentMode="chat"
        >
          <div className="min-h-[100dvh] bg-background text-foreground">
            {content}
            {onRewards ? null : actionBar}
          </div>
        </MobilePushShell>
      )}


    </ReferralsCtx.Provider>
  );
};

export default ReferralsPage;
