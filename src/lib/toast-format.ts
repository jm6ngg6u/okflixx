// Global sonner toast formatter — enforces branded structure app-wide:
// - Capitalizes the first letter of title + description
// - Auto-splits "Title · detail · detail" strings into a title + description
// - Leaves richer callers (that already pass { description }) untouched
import { toast } from "sonner";

function cap(s: string): string {
  if (!s) return s;
  const trimmed = s.trimStart();
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
}

function format(message: unknown, opts: any) {
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
  return { message: title, opts: nextOpts };
}

const anyToast = toast as any;
const methods = ["success", "error", "info", "warning", "loading", "message"] as const;
for (const m of methods) {
  const orig = anyToast[m];
  if (typeof orig === "function" && !anyToast[`__wrapped_${m}`]) {
    anyToast[`__wrapped_${m}`] = true;
    anyToast[m] = (msg: unknown, opts?: any) => {
      const f = format(msg, opts);
      return orig(f.message, f.opts);
    };
  }
}
