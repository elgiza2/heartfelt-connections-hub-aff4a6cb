import { useLocation, type Location } from "react-router-dom";
import { useEffect, type ReactNode } from "react";
import { isCacheablePath, scheduleSnapshotSave } from "@/lib/pageSnapshot";

/**
 * PageTransition — wraps route content and captures a page snapshot for the
 * "instant open" cache.
 *
 * It deliberately does NOT re-key or animate the route container. Re-keying
 * unmounted and rebuilt the whole page on every section change, and the
 * container-level fade replayed on top of it — together they read as a full
 * browser refresh on every navigation. Navigation is now a plain swap; pages
 * keep their own local animations.
 */
const PageTransition = ({
  children,
  location: locationProp,
}: {
  children: ReactNode;
  location?: Location;
}) => {
  const routerLocation = useLocation();
  const location = locationProp ?? routerLocation;

  useEffect(() => {
    const path = location.pathname;
    if (!isCacheablePath(path)) return;
    const capture = () => {
      try {
        const root = document.getElementById("root");
        if (!root || root.getAttribute("data-snapshot-preview") === "true") return;
        const html = root.innerHTML;
        if (html) scheduleSnapshotSave(path, html);
      } catch {}
    };
    const ric = (window as unknown as {
      requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
      cancelIdleCallback?: (id: number) => void;
    }).requestIdleCallback;
    if (typeof ric === "function") {
      const id = ric(capture, { timeout: 1800 });
      return () => {
        (window as unknown as { cancelIdleCallback?: (id: number) => void }).cancelIdleCallback?.(id);
      };
    }
    const id = window.setTimeout(capture, 900);
    return () => window.clearTimeout(id);
  }, [location.pathname]);

  return <>{children}</>;
};

export default PageTransition;
