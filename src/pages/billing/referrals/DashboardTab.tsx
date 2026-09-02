/** @doc Referral overview — invite copy, artwork and live progress toward Pro. */
import { useUserLang, translateExactText } from "@/lib/authI18n";
import heroImage from "@/assets/megsy-referral-hero.jpg";
import ReferralProgressBar from "@/components/billing/ReferralProgressBar";
import ReferralPartnerPanel from "@/components/billing/ReferralPartnerPanel";
import ReferralTasksList from "@/components/billing/ReferralTasksList";
import { useReferrals } from "@/pages/billing/ReferralsPage";

export default function DashboardTab() {
  const lang = useUserLang();
  const copy = (text: string) => translateExactText(text, lang);
  const { milestone } = useReferrals();

  if (milestone.isPartner) return <ReferralPartnerPanel />;

  return (
    <div className="flex h-full flex-col" data-stagger>
      <header className="pt-1 text-center">
        <h1 className="text-[34px] font-semibold leading-[1.05] tracking-[-0.03em] text-foreground sm:text-[42px]">
          {copy("Invite 5 friends, get Pro free")}
        </h1>
        <p className="mx-auto mt-3 max-w-[460px] text-[14.5px] leading-relaxed text-muted-foreground">
          {copy(
            "Every friend who joins Megsy AI with your link brings you closer to free Pro access for a limited time.",
          )}
        </p>
      </header>

      <div className="mt-6 overflow-hidden rounded-[24px] border border-border">
        <img
          src={heroImage}
          alt={copy("Megsy Pro invitation artwork")}
          width={1280}
          height={960}
          className="block w-full"
        />
      </div>

      <ReferralProgressBar
        className="mt-5"
        referrals={milestone.referrals}
        target={milestone.target}
        granted={milestone.isPartner}
        expiresAt={milestone.state?.expires_at ?? null}
      />

      <ReferralTasksList className="mt-7" />
    </div>
  );
}
