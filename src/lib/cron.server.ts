// Shared cron auth: require a dedicated high-entropy CRON_SECRET, never the
// public anon/publishable key (which ships in the client bundle).
// The secret is stored in app_settings (admin-only) so pg_cron and the
// server route can read the same source of truth. Env CRON_SECRET is used
// as a fallback / override for local dev.
// Public /api/public/* bypasses edge auth, so this header check is the only gate.

let cachedSecret: { value: string; expires: number } | null = null;

async function loadCronSecret(): Promise<string> {
  const envSecret = process.env.CRON_SECRET;
  if (envSecret) return envSecret;
  if (cachedSecret && cachedSecret.expires > Date.now()) return cachedSecret.value;
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data } = await supabaseAdmin
      .from("app_settings")
      .select("value")
      .eq("key", "cron_secret")
      .maybeSingle();
    const v = (data?.value as string | undefined) ?? "";
    cachedSecret = { value: v, expires: Date.now() + 60_000 };
    return v;
  } catch {
    return "";
  }
}

export async function verifyCronRequest(request: Request): Promise<boolean> {
  const expected = await loadCronSecret();
  if (!expected) {
    return process.env.NODE_ENV !== "production";
  }
  const provided =
    request.headers.get("x-cron-secret") ??
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ??
    "";
  if (!provided || provided.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= expected.charCodeAt(i) ^ provided.charCodeAt(i);
  }
  return diff === 0;
}



export async function recordJobStart(job: string): Promise<string | null> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await supabaseAdmin
    .from("job_runs")
    .insert({ job })
    .select("id")
    .single();
  return (data?.id as string) ?? null;
}

/**
 * True if another run of the SAME job name is currently in flight. Different
 * job names (cookies-autocheck vs proxies-autocheck vs proxy_recheck) are
 * independent and always allowed to run in parallel — this only prevents the
 * same job from racing itself (cron tick + admin "Run now", double-click).
 * Runs older than 30 min without a finish are treated as stale and ignored so
 * a crashed worker never blocks future runs.
 */
export async function isJobRunning(job: string): Promise<boolean> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const staleCutoff = new Date(Date.now() - 30 * 60 * 1000).toISOString();
  const { data } = await supabaseAdmin
    .from("job_runs")
    .select("id, started_at")
    .eq("job", job)
    .is("finished_at", null)
    .gte("started_at", staleCutoff)
    .limit(1);
  return (data?.length ?? 0) > 0;
}

export async function recordJobFinish(
  id: string | null,
  ok: boolean,
  summary: Record<string, any>,
  error?: string,
) {
  if (!id) return;
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  await supabaseAdmin
    .from("job_runs")
    .update({
      finished_at: new Date().toISOString(),
      ok,
      summary,
      error: error ?? null,
    })
    .eq("id", id);
}

export async function recordJobProgress(id: string | null, progress: Record<string, any>) {
  if (!id) return;
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  await supabaseAdmin.from("job_runs").update({ progress }).eq("id", id);
}

/** Read the current control signal for a job. */
export async function readJobControl(id: string | null): Promise<"stop" | "cancel" | null> {
  if (!id) return null;
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await supabaseAdmin.from("job_runs").select("control").eq("id", id).maybeSingle();
  const v = (data as any)?.control;
  return v === "stop" || v === "cancel" ? v : null;
}
