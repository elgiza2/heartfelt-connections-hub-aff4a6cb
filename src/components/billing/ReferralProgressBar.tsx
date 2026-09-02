/**
 * @doc Referral progress bar — how many more members are needed for free Pro.
 * Pure presentation, theme tokens only, localized labels.
 */
import { translateExactText, useUserLang } from "@/lib/authI18n";

export interface ReferralProgressBarProps {
  referrals: number;
  target: number;
  granted?: boolean;
  expiresAt?: string | null;
  className?: string;
}

export default function ReferralProgressBar({
  referrals,
  target,
  granted = false,
  expiresAt,
  className = "",
}: ReferralProgressBarProps) {
  const lang = useUserLang();
  const copy = (s: string) => translateExactText(s, lang);

  const safeTarget = Math.max(1, target);
  const done = Math.min(referrals, safeTarget);
  const remaining = Math.max(0, safeTarget - referrals);
  const pct = Math.round((done / safeTarget) * 100);
  const expires = expiresAt ? new Date(expiresAt) : null;

  const headline = granted
    ? copy("Pro is active")
    : remaining === 0
      ? copy("Ready to claim your free Pro")
      : `${remaining} ${remaining === 1 ? copy("member left to unlock Pro") : copy("members left to unlock Pro")}`;

  return (
    <section className={`rounded-[18px] border border-border bg-background px-5 py-4 ${className}`}>
      <div className="flex items-baseline justify-between gap-4">
        <p className="text-[14px] font-medium text-foreground">{headline}</p>
        <span className="text-[13px] font-medium tabular-nums text-muted-foreground" dir="ltr">
          {done} / {safeTarget}
        </span>
      </div>

      <div
        className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-foreground/10"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={safeTarget}
        aria-valuenow={done}
      >
        <div
          className="h-full rounded-full bg-foreground transition-[width] duration-500 ease-out"
          style={{ width: `${pct}%` }}
        />
      </div>

      <p className="mt-2.5 text-[12.5px] leading-relaxed text-muted-foreground">
        {granted
          ? expires
            ? `${copy("Your free Pro access is active until")} ${expires.toLocaleDateString(
                lang === "ar-eg" ? "ar-EG" : "en-US",
                { year: "numeric", month: "short", day: "numeric" },
              )}`
            : copy("Your free Pro access is active.")
          : copy("Only verified members who join with your link are counted.")}
      </p>
    </section>
  );
}
