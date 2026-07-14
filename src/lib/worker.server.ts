// Server-only client for the external Python Netflix worker.
// The worker wraps the untouched netflix_session.py + fast_checker.py
// from the original Telegram bot and exposes /check, /activate, /check-proxy.

export type WorkerCookieCheck = {
  status: "active" | "on_hold" | "free" | "invalid" | "unknown";
  is_valid: boolean;
  transient?: boolean;
  email?: string | null;
  country?: string | null;
  plan_name?: string | null;
  video_quality?: string | null;
  name?: string | null;
  member_since?: string | null;
  max_streams?: number | null;
  payment_method?: string | null;
  error?: string | null;
};

export type ActivateOutcome =
  | { status: "success"; duration_ms: number; error?: null }
  | {
      status:
        | "rate_limited"
        | "bot_detected"
        | "invalid_code"
        | "auth_expired"
        | "tv8_unavailable"
        | "expired_code"
        | "cookie_dead"
        | "free"
        | "on_hold"
        | "worker_error"
        | "other";
      duration_ms: number;
      error?: string | null;
    };

export type ProxyPayload = {
  scheme: string;
  ip: string;
  port: string;
  username?: string | null;
  password?: string | null;
};

function workerConfig() {
  let url = (process.env.NETFLIX_WORKER_URL ?? "").trim();
  const token = process.env.NETFLIX_WORKER_TOKEN ?? "";
  if (url && !/^https?:\/\//i.test(url)) url = `https://${url}`;
  return { url: url.replace(/\/+$/, ""), token };
}

async function callWorker<T>(path: string, body: unknown, timeoutMs = 45_000): Promise<T> {
  const { url, token } = workerConfig();
  if (!url) throw new Error("NETFLIX_WORKER_URL is not configured");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${url}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Worker-Token": token,
        "Accept": "application/json",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`worker ${path} returned ${res.status}: ${text.slice(0, 300)}`);
    }
    return (await res.json()) as T;
  } finally {
    clearTimeout(timeout);
  }
}

export async function checkCookieViaWorker(args: {
  cookies: { name: string; value: string; domain?: string }[];
  proxy?: ProxyPayload | null;
}): Promise<WorkerCookieCheck> {
  try {
    return await callWorker<WorkerCookieCheck>("/check", {
      cookies: args.cookies,
      proxy: args.proxy ?? null,
    });
  } catch (e: any) {
    return { status: "invalid", is_valid: false, error: String(e?.message ?? e) };
  }
}

export async function activateTVViaWorker(args: {
  code: string;
  cookies: { name: string; value: string; domain?: string }[];
  proxy?: ProxyPayload | null;
}): Promise<ActivateOutcome> {
  const t0 = Date.now();
  try {
    const res = await callWorker<ActivateOutcome>("/activate", {
      code: args.code,
      cookies: args.cookies,
      proxy: args.proxy ?? null,
    });
    return { ...res, duration_ms: res.duration_ms ?? Date.now() - t0 };
  } catch (e: any) {
    return {
      status: "worker_error",
      duration_ms: Date.now() - t0,
      error: String(e?.message ?? e),
    };
  }
}

export async function checkProxyViaWorker(args: { proxy: ProxyPayload }): Promise<{
  ok: boolean;
  latency_ms?: number | null;
  country?: string | null;
  error?: string | null;
}> {
  try {
    return await callWorker("/check-proxy", args, 15_000);
  } catch (e: any) {
    return { ok: false, error: String(e?.message ?? e) };
  }
}

// Statuses that the bot treats as "cookie is dead" and should be rotated out.
// Mirrors netflix_adapter.py — transient errors (auth_expired, tv8_unavailable,
// bot_detected, rate_limited) DO NOT kill the cookie.
export function isCookieDead(status: ActivateOutcome["status"] | WorkerCookieCheck["status"]) {
  return status === "invalid" || status === "cookie_dead";
}
