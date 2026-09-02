/**
 * @doc Design preview for the 20% revenue-share referral tier.
 * Route: /testr (internal preview only — no data writes).
 */
import ReferralPartnerPanel from "@/components/billing/ReferralPartnerPanel";
import { translateExactText, useUserLang } from "@/lib/authI18n";

export default function ReferralPartnerTestPage() {
  const lang = useUserLang();
  const copy = (s: string) => translateExactText(s, lang);

  return (
    <div className="min-h-[100dvh] bg-background text-foreground">
      <div className="mx-auto w-full max-w-[620px] px-5 pb-[150px] pt-6">
        <ReferralPartnerPanel />
      </div>

      <div
        className="pointer-events-none fixed inset-x-0 bottom-0 z-30"
        style={{ paddingBottom: "max(env(safe-area-inset-bottom), 14px)" }}
      >
        <div className="h-5 bg-background" />
        <div className="pointer-events-auto mx-auto w-full max-w-[620px] border-t border-border bg-background px-5 pt-3">
          <div className="flex flex-col gap-2">
            <button
              type="button"
              className="inline-flex h-[52px] w-full items-center justify-center rounded-[16px] bg-foreground px-5 text-[15px] font-semibold text-background transition hover:opacity-90 active:scale-[0.99]"
            >
              {copy("Invite friends")}
            </button>
            <button
              type="button"
              className="inline-flex h-[52px] w-full items-center justify-center rounded-[16px] border border-border bg-background px-5 text-[15px] font-medium text-foreground transition hover:bg-foreground/[0.05] active:scale-[0.99]"
            >
              {copy("View earnings")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
