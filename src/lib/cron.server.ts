// Shared cron auth: the anon/publishable key in an `apikey` header.
// Public /api/public/* bypasses edge auth, so we still gate against noise here.

export function verifyCronRequest(request: Request): boolean {
  const provided =
    request.headers.get("apikey") ??
    request.headers.get("x-cron-secret") ??
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ??
    "";
  const expected = process.env.SUPABASE_PUBLISHABLE_KEY ?? "";
  if (!expected) return true; // dev fallback
  return provided === expected;
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
