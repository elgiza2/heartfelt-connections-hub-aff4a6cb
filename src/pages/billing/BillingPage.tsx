/**
 * @doc Subscription management — clean, fully localized, theme-token only.
 * Shows credits, plan state, the referral progress bar (how many members are
 * still needed for free Pro) and the cancellation / retention flow.
 */
import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useIsMobile } from "@/hooks/use-mobile";
import { SubShell } from "@/components/settings/SubShell";
import ReferralProgressBar from "@/components/billing/ReferralProgressBar";
import { useReferralMilestone } from "@/hooks/useReferralMilestone";
import { translateExactText, useUserLang, type AuthLang } from "@/lib/authI18n";
import { SAVE_OFFER, saveOfferPrice } from "@/data/pricingData";

type Sub = {
  plan: string | null;
  status: string | null;
  current_period_end: string | null;
  amount_cents: number | null;
  currency: string | null;
};

const fmtDate = (s: string | null | undefined, lang: AuthLang) =>
  s
    ? new Date(s).toLocaleDateString(lang === "ar-eg" ? "ar-EG" : "en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      })
    : "—";

const REASONS = [
  "Too expensive",
  "Not using it enough",
  "Missing features",
  "Found an alternative",
  "Other",
];

/* ── Small presentational primitives (theme tokens only) ─────────── */

const Card = ({ children, className = "" }: { children: React.ReactNode; className?: string }) => (
  <div className={`rounded-[18px] border border-border bg-background ${className}`}>{children}</div>
);

const Row = ({
  label,
  hint,
  onClick,
  danger,
}: {
  label: string;
  hint?: string;
  onClick?: () => void;
  danger?: boolean;
}) => {
  const Tag = onClick ? "button" : "div";
  return (
    <Tag
      type={onClick ? "button" : undefined}
      onClick={onClick}
      className={`flex w-full items-center justify-between gap-4 px-5 py-4 text-start transition ${
        onClick ? "hover:bg-foreground/[0.04] active:scale-[0.995]" : ""
      }`}
    >
      <span className="min-w-0">
        <span
          className={`block text-[14.5px] font-medium ${danger ? "text-destructive" : "text-foreground"}`}
        >
          {label}
        </span>
        {hint && <span className="mt-0.5 block text-[12.5px] text-muted-foreground">{hint}</span>}
      </span>
    </Tag>
  );
};

const PrimaryButton = ({
  children,
  onClick,
  disabled,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
}) => (
  <button
    type="button"
    onClick={onClick}
    disabled={disabled}
    className="inline-flex h-[48px] flex-1 items-center justify-center rounded-[14px] bg-foreground px-5 text-[14.5px] font-semibold text-background transition hover:opacity-90 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-40"
  >
    {children}
  </button>
);

const GhostButton = ({
  children,
  onClick,
  disabled,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
}) => (
  <button
    type="button"
    onClick={onClick}
    disabled={disabled}
    className="inline-flex h-[48px] flex-1 items-center justify-center rounded-[14px] border border-border bg-background px-5 text-[14.5px] font-medium text-foreground transition hover:bg-foreground/[0.05] active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-40"
  >
    {children}
  </button>
);

const BillingPage = () => {
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const lang = useUserLang();
  const copy = (s: string) => translateExactText(s, lang);
  const milestone = useReferralMilestone();

  const [credits, setCredits] = useState(0);
  const [plan, setPlan] = useState("Free");
  const [sub, setSub] = useState<Sub | null>(null);

  const [cancelOpen, setCancelOpen] = useState(false);
  const [step, setStep] = useState<"offer" | "reason">("offer");
  const [reason, setReason] = useState("");
  const [improvement, setImprovement] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;
      const { data: profile } = await supabase
        .from("profiles")
        .select("credits, plan")
        .eq("id", user.id)
        .single();
      if (profile) {
        setCredits(Number(profile.credits) || 0);
        setPlan(profile.plan || "Free");
      }
      const { data: subData } = await supabase
        .from("subscriptions")
        .select("plan, status, current_period_end, amount_cents, currency")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (subData) setSub(subData as Sub);
    })();
  }, []);

  const isActive = sub?.status === "active" || sub?.status === "trialing";
  const priceLabel = sub?.amount_cents
    ? `${(sub.amount_cents / 100).toFixed(0)} ${sub.currency || "EGP"}`
    : null;
  const monthlyPrice = sub?.amount_cents ? Math.round(sub.amount_cents / 100) : null;
  const halfPrice = monthlyPrice ? saveOfferPrice(monthlyPrice) : null;

  const sendSupportRequest = async (subject: string, message: string, success: string) => {
    setSubmitting(true);
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("Not signed in");
      const { error } = await supabase
        .from("contact_submissions")
        .insert({ user_id: user.id, subject, message } as never);
      if (error) throw error;
      toast.success(copy(success));
      setCancelOpen(false);
      setStep("offer");
      setReason("");
      setImprovement("");
    } catch (e) {
      toast.error(copy("Could not submit request"));
    } finally {
      setSubmitting(false);
    }
  };

  const submitCancel = () => {
    if (!reason) {
      toast.error(copy("Please tell us why you're cancelling"));
      return;
    }
    void sendSupportRequest(
      "Subscription cancellation",
      `Reason: ${reason}\n\nHow we can improve:\n${improvement || "—"}`,
      "Cancellation request sent. Our team will reach out shortly.",
    );
  };

  /* ── Sections ─────────────────────────────────────────────────── */

  const creditsCard = (
    <Card className="px-5 py-5">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-[12px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
            {copy("Message credits")}
          </p>
          <p className="mt-2 flex items-baseline gap-2 text-foreground" dir="ltr">
            <span className="text-[40px] font-semibold leading-none tracking-[-0.03em]">
              {credits.toLocaleString(lang === "ar-eg" ? "ar-EG" : "en-US")}
            </span>
            <span className="text-[14px] font-medium text-muted-foreground">MC</span>
          </p>
          <p className="mt-2 text-[12.5px] text-muted-foreground">{copy("Available on your account")}</p>
        </div>
        <span className="shrink-0 rounded-full border border-border px-3 py-1 text-[11.5px] font-semibold uppercase tracking-[0.14em] text-foreground">
          {plan}
        </span>
      </div>
      <div className="mt-5 flex gap-2">
        <PrimaryButton onClick={() => navigate("/pricing")}>{copy("Top up")}</PrimaryButton>
        <GhostButton onClick={() => navigate("/settings/referrals")}>
          {copy("Earn free MC")}
        </GhostButton>
      </div>
    </Card>
  );

  const progressCard = (
    <ReferralProgressBar
      referrals={milestone.referrals}
      target={milestone.target}
      granted={milestone.isPartner}
      expiresAt={milestone.state?.expires_at ?? null}
    />
  );

  const planCard = (
    <Card className="divide-y divide-border">
      <Row
        label={copy("Status")}
        hint={
          isActive
            ? priceLabel
              ? `${copy(String(sub?.status))} · ${priceLabel}`
              : copy(String(sub?.status))
            : copy("No active subscription")
        }
      />
      {isActive && sub?.current_period_end && (
        <Row label={copy("Next renewal")} hint={fmtDate(sub.current_period_end, lang)} />
      )}
    </Card>
  );

  const manageCard = (
    <Card className="divide-y divide-border">
      <Row
        label={isActive ? copy("Change plan") : copy("Upgrade plan")}
        hint={copy("View pricing and switch plans")}
        onClick={() => navigate("/pricing")}
      />
      <Row
        label={copy("Referrals")}
        hint={copy("Invite friends and unlock bonuses")}
        onClick={() => navigate("/settings/referrals")}
      />
      {isActive && !cancelOpen && (
        <Row
          danger
          label={copy("Cancel subscription")}
          hint={copy("We'll ask a quick question")}
          onClick={() => {
            setStep("offer");
            setCancelOpen(true);
          }}
        />
      )}
    </Card>
  );

  const saveOffer = (
    <Card className="px-5 py-5">
      <p className="text-[15px] font-semibold text-foreground">{SAVE_OFFER.titleEn}</p>
      <p className="mt-1.5 text-[13px] leading-relaxed text-muted-foreground">{SAVE_OFFER.bodyEn}</p>

      {halfPrice != null && monthlyPrice != null && (
        <div className="mt-4 rounded-[14px] border border-border px-4 py-3" dir="ltr">
          <div className="flex items-baseline gap-2">
            <span className="text-[24px] font-semibold text-foreground">
              {halfPrice} {sub?.currency || "EGP"}
            </span>
            <span className="text-[13px] text-muted-foreground line-through">
              {monthlyPrice} {sub?.currency || "EGP"}
            </span>
          </div>
        </div>
      )}

      <div className="mt-4 flex gap-2">
        <PrimaryButton
          disabled={submitting}
          onClick={() =>
            void sendSupportRequest(
              "Retention offer — 50% for 2 months",
              `Customer accepted the retention offer: ${SAVE_OFFER.discountPercent}% off for ${SAVE_OFFER.months} months on plan ${sub?.plan || plan}.`,
              "Your discount request is in — we'll apply it within a few minutes.",
            )
          }
        >
          {submitting ? copy("Sending…") : SAVE_OFFER.discountCtaEn}
        </PrimaryButton>
        <GhostButton onClick={() => setStep("reason")}>{copy("No thanks, cancel")}</GhostButton>
      </div>
    </Card>
  );

  const cancelForm = (
    <Card className="px-5 py-5">
      <p className="text-[14px] font-semibold text-foreground">{copy("Why are you cancelling?")}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        {REASONS.map((r) => (
          <button
            key={r}
            type="button"
            onClick={() => setReason(r)}
            className={`rounded-full border px-3.5 py-2 text-[12.5px] font-medium transition ${
              reason === r
                ? "border-foreground bg-foreground text-background"
                : "border-border text-foreground hover:bg-foreground/[0.05]"
            }`}
          >
            {copy(r)}
          </button>
        ))}
      </div>

      <label className="mt-4 block text-[12.5px] text-muted-foreground">
        {copy("How can we improve?")}
      </label>
      <textarea
        value={improvement}
        onChange={(e) => setImprovement(e.target.value)}
        rows={3}
        className="mt-2 w-full resize-y rounded-[14px] border border-border bg-background px-3.5 py-3 text-[13.5px] text-foreground outline-none transition focus:border-foreground/40"
      />

      <div className="mt-4 flex gap-2">
        <GhostButton onClick={() => setCancelOpen(false)}>{copy("Keep plan")}</GhostButton>
        <PrimaryButton onClick={submitCancel} disabled={submitting}>
          {submitting ? copy("Sending…") : copy("Confirm cancel")}
        </PrimaryButton>
      </div>
    </Card>
  );

  const cancelFlow = SAVE_OFFER.enabled && step === "offer" ? saveOffer : cancelForm;

  const sections = (
    <div className="flex flex-col gap-5">
      {creditsCard}
      {progressCard}

      <section className="flex flex-col gap-2">
        <h2 className="px-1 text-[11.5px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
          {copy("Plan")}
        </h2>
        {planCard}
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="px-1 text-[11.5px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
          {copy("Manage")}
        </h2>
        {manageCard}
      </section>

      {isActive && cancelOpen && (
        <section className="flex flex-col gap-2">
          <h2 className="px-1 text-[11.5px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
            {step === "offer" ? copy("Wait — an offer for you") : copy("Before you go")}
          </h2>
          {cancelFlow}
        </section>
      )}
    </div>
  );

  if (isMobile) {
    return (
      <div className="min-h-[100dvh] bg-background text-foreground">
        <header
          className="sticky top-0 z-10 flex items-center gap-2 bg-background px-4 pb-3"
          style={{ paddingTop: "max(env(safe-area-inset-top), 14px)" }}
        >
          <button
            type="button"
            aria-label={copy("Back")}
            onClick={() => navigate("/settings")}
            className="flex h-10 w-10 items-center justify-center rounded-full border border-border text-foreground transition active:scale-95"
          >
            <span aria-hidden className="text-[18px] leading-none rtl:rotate-180">
              ‹
            </span>
          </button>
          <h1 className="text-[17px] font-semibold tracking-[-0.01em]">{copy("Subscription")}</h1>
        </header>
        <main className="mx-auto w-full max-w-[520px] px-4 pb-16 pt-2">{sections}</main>
      </div>
    );
  }

  return (
    <SubShell
      title={copy("Subscription")}
      subtitle={copy("Manage your plan and message credits.")}
      backTo="/settings"
    >
      {sections}
    </SubShell>
  );
};

export default BillingPage;
