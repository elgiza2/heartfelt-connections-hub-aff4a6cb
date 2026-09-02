/**
 * @doc Partner tier — shown once free Pro is unlocked: the referral program
 * automatically becomes a 20% revenue share. Text on top, artwork below,
 * theme tokens only, no decorative icons.
 */
import partnerImage from "@/assets/megsy-referral-partner.jpg";
import { translateExactText, useUserLang } from "@/lib/authI18n";
import { REVENUE_SHARE_PERCENT } from "@/hooks/useReferralMilestone";

export interface ReferralPartnerPanelProps {
  className?: string;
}

export default function ReferralPartnerPanel({ className = "" }: ReferralPartnerPanelProps) {
  const lang = useUserLang();
  const copy = (s: string) => translateExactText(s, lang);

  return (
    <div className={`flex h-full flex-col ${className}`} data-stagger>
      <header className="pt-1 text-center">
        <h1 className="text-[32px] font-semibold leading-[1.06] tracking-[-0.03em] text-foreground sm:text-[40px]">
          {`${copy("Earn")} ${REVENUE_SHARE_PERCENT}% ${copy("of every payment")}`}
        </h1>
        <p className="mx-auto mt-3 max-w-[460px] text-[14.5px] leading-relaxed text-muted-foreground">
          {copy(
            "Your Pro access is unlocked, so your invite link now earns a recurring share of everything your members pay.",
          )}
        </p>
      </header>

      <div className="mt-6 overflow-hidden rounded-[24px] border border-border">
        <img
          src={partnerImage}
          alt={copy("Megsy partner program artwork")}
          width={1200}
          height={912}
          loading="lazy"
          className="block w-full"
        />
      </div>

      <dl className="mt-6 grid grid-cols-3 gap-3 text-center">
        <div className="rounded-[16px] border border-border px-3 py-4">
          <dt className="text-[12px] text-muted-foreground">{copy("Revenue share")}</dt>
          <dd className="mt-1 text-[19px] font-semibold text-foreground" dir="ltr">
            {REVENUE_SHARE_PERCENT}%
          </dd>
        </div>
        <div className="rounded-[16px] border border-border px-3 py-4">
          <dt className="text-[12px] text-muted-foreground">{copy("Paid")}</dt>
          <dd className="mt-1 text-[19px] font-semibold text-foreground">{copy("Monthly")}</dd>
        </div>
        <div className="rounded-[16px] border border-border px-3 py-4">
          <dt className="text-[12px] text-muted-foreground">{copy("Duration")}</dt>
          <dd className="mt-1 text-[19px] font-semibold text-foreground">{copy("Recurring")}</dd>
        </div>
      </dl>
    </div>
  );
}
