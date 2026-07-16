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
