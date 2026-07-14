import { useEffect } from "react";

/**
 * Global click ripple — pointer-driven, no lag.
 * Uses a lightweight DOM node + CSS animation, auto-cleanup.
 */
export function ClickRipple() {
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      const el = document.createElement("span");
      el.className = "click-ripple";
      el.style.left = e.clientX + "px";
      el.style.top = e.clientY + "px";
      document.body.appendChild(el);
      const t = setTimeout(() => el.remove(), 700);
      el.addEventListener("animationend", () => { clearTimeout(t); el.remove(); });
    };
    window.addEventListener("pointerdown", onDown, { passive: true });
    return () => window.removeEventListener("pointerdown", onDown);
  }, []);
  return null;
}
