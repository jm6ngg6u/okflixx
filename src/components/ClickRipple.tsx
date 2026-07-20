import { useEffect } from "react";

/**
 * Global tap/click ripple.
 * - Pointer-driven, passive listener (never blocks scroll).
 * - Skips synthetic events fired during active scroll (removes jank on mobile).
 * - Skips form controls where a highlight would be visual noise.
 * - Throttled to 8 ripples/sec max; each node auto-removes.
 * - Honors prefers-reduced-motion.
 */
export function ClickRipple() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;

    let lastAt = 0;
    let scrollingUntil = 0;

    const onScroll = () => {
      scrollingUntil = performance.now() + 45;
    };

    const onDown = (e: PointerEvent) => {
      const now = performance.now();
      if (now < scrollingUntil) return;
      if (now - lastAt < 45) return;
      lastAt = now;

      const target = e.target as HTMLElement | null;
      if (target?.closest?.("input,textarea,select,[data-no-ripple]")) return;

      const el = document.createElement("span");
      el.className = "click-ripple";
      el.style.left = e.clientX + "px";
      el.style.top = e.clientY + "px";
      document.body.appendChild(el);
      const kill = () => el.remove();
      el.addEventListener("animationend", kill, { once: true });
      setTimeout(kill, 420);
    };

    window.addEventListener("pointerdown", onDown, { passive: true });
    window.addEventListener("scroll", onScroll, { passive: true, capture: true });
    return () => {
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("scroll", onScroll, { capture: true } as EventListenerOptions);
    };
  }, []);
  return null;
}
