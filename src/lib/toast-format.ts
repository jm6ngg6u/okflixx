// Global sonner toast formatter — enforces branded structure app-wide:
// - Capitalizes the first letter of title + description
// - Auto-splits "Title · detail · detail" strings into a title + description
// - Sensible default durations per variant
// - Dedups identical (variant,title,description) toasts fired within 2s
// - Leaves richer callers (that already pass { description }) untouched
import { toast } from "sonner";

function cap(s: string): string {
  if (!s) return s;
  const trimmed = s.trimStart();
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
}

const DEFAULT_DURATION: Record<string, number> = {
  success: 4500,
  info: 5000,
  warning: 6000,
  error: 8000,
  loading: 30_000,
  message: 5000,
};

function format(variant: string, message: unknown, opts: any) {
  if (typeof message !== "string") return { message, opts };
  let title = message;
  let description: unknown = opts?.description;
  if (!description && title.includes(" · ")) {
    const parts = title.split(" · ");
    title = parts[0];
    description = parts.slice(1).join(" · ");
  }
  title = cap(title);
  if (typeof description === "string") description = cap(description);
  const nextOpts = { ...(opts ?? {}) };
  if (description !== undefined) nextOpts.description = description;
  if (nextOpts.duration == null && DEFAULT_DURATION[variant]) {
    nextOpts.duration = DEFAULT_DURATION[variant];
  }
  return { message: title, opts: nextOpts };
}

// 2s dedup — prevents realtime bursts from stacking the same toast.
const recent = new Map<string, number>();
function shouldDedup(variant: string, title: string, desc: unknown): boolean {
  const key = `${variant}::${title}::${typeof desc === "string" ? desc : ""}`;
  const now = Date.now();
  for (const [k, t] of recent) if (now - t > 2000) recent.delete(k);
  if (recent.has(key)) return true;
  recent.set(key, now);
  return false;
}

const anyToast = toast as any;
const methods = ["success", "error", "info", "warning", "loading", "message"] as const;
for (const m of methods) {
  const orig = anyToast[m];
  if (typeof orig === "function" && !anyToast[`__wrapped_${m}`]) {
    anyToast[`__wrapped_${m}`] = true;
    anyToast[m] = (msg: unknown, opts?: any) => {
      const f = format(m, msg, opts);
      if (typeof f.message === "string" && shouldDedup(m, f.message, f.opts?.description)) return;
      return orig(f.message, f.opts);
    };
  }
}
