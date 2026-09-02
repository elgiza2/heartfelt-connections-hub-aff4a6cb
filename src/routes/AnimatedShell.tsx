import { Outlet } from "react-router-dom";

/**
 * Shared hub shell for the auth / billing / integrations sections.
 *
 * It used to cross-fade child routes with `AnimatePresence mode="wait"`, which
 * fully unmounted the old panel and left an empty frame for ~240ms before the
 * next one mounted — visually identical to a page refresh. The panel now swaps
 * instantly; individual pages keep their own entrance animations.
 */
export const AnimatedShell = ({ className }: { className?: string }) => (
  <div className={className ?? "min-h-dvh bg-background text-foreground"}>
    <Outlet />
  </div>
);

export default AnimatedShell;
