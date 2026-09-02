import { cn } from "@/lib/utils";

interface MobileSidebarButtonProps {
  onClick: () => void;
  className?: string;
  ariaLabel?: string;
  testId?: string;
  /**
   * Anchor the button to the inline-start edge of the viewport (same spot the
   * chat header uses) instead of letting it flow inside a centered container.
   * Keeps the toggle in an identical position on every page and in both
   * text directions.
   */
  edge?: boolean;
}

/** Unified mobile sidebar toggle button used across all pages. */
export function MobileSidebarButton({
  onClick,
  className,
  ariaLabel = "Open menu",
  testId,
  edge = false,
}: MobileSidebarButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={ariaLabel}
      data-testid={testId}
      style={{ border: "none", outline: "none", boxShadow: "none" }}
      className={cn(
        "md:hidden w-11 h-11 rounded-2xl flex items-center justify-center text-foreground bg-transparent border-0 active:scale-95 transition",
        edge &&
          "fixed z-30 start-3 top-[max(env(safe-area-inset-top),0.25rem)]",
        className,
      )}
    >

      <svg
        width="22"
        height="22"
        viewBox="0 0 24 24"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
        className="h-[22px] w-[22px]"
      >
        <rect
          x="3.25"
          y="4.5"
          width="17.5"
          height="15"
          rx="3.5"
          stroke="currentColor"
          strokeWidth="1.6"
        />
        <line x1="9.25" y1="4.5" x2="9.25" y2="19.5" stroke="currentColor" strokeWidth="1.6" />
        <line
          x1="5.5"
          y1="9"
          x2="7"
          y2="9"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
        />
        <line
          x1="5.5"
          y1="12"
          x2="7"
          y2="12"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
        />
        <line
          x1="5.5"
          y1="15"
          x2="7"
          y2="15"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
        />
      </svg>
    </button>
  );
}

export default MobileSidebarButton;
