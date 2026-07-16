// Background song management for the public site.
//
// Public surface:
//   getBackgroundSong       — read config + signed URL for the current track
//   logBackgroundSongEvent  — record an anonymous impression/autoplay/unmute
//
// Admin surface:
//   getBackgroundSongAdmin  — full detail (settings, size, preview URL)
//   listBackgroundSongHistory / restoreBackgroundSong / deleteBackgroundSongVersion
//   setBackgroundSongEnabled / setBackgroundSongReactive
//   setBackgroundSongSchedule / setBackgroundSongIntensity
//   setBackgroundSongSensitivity / setBackgroundSongTrackTitle
//   getBackgroundSongAnalytics
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const BUCKET = "site-audio";
const SETTING_KEYS = [
  "background_song_enabled",
  "background_song_path",
  "background_song_name",
  "background_song_updated_at",
  "background_song_reactive",
  "background_song_schedule_enabled",
  "background_song_schedule_start",
  "background_song_schedule_end",
  "background_song_intensity",
  "background_song_sensitivity",
  "background_song_track_title",
] as const;

function nowIso() { return new Date().toISOString(); }
function toFloat(v: string | undefined, fallback: number) {
  const n = Number.parseFloat(v ?? "");
  return Number.isFinite(n) ? n : fallback;
}
async function requireAdmin(context: any) {
  const { supabase, userId } = context;
  const { data: isAdmin } = await supabase.rpc("has_role", { _user_id: userId, _role: "admin" });
  if (!isAdmin) throw new Error("Forbidden");
  return { userId: userId as string };
}
async function loadSettings() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await supabaseAdmin
    .from("app_settings")
    .select("key,value")
    .in("key", SETTING_KEYS as unknown as string[]);
  const map: Record<string, string> = {};
  for (const r of data ?? []) map[r.key] = r.value ?? "";
  return { map, supabaseAdmin };
}

// ============================================================================
// PUBLIC
// ============================================================================

/** Public: current song config + signed URL (when enabled). */
export const getBackgroundSong = createServerFn({ method: "GET" }).handler(async () => {
  const { map, supabaseAdmin } = await loadSettings();

  const enabled = map.background_song_enabled === "true";
  const reactive = map.background_song_reactive !== "false"; // default ON
  const scheduleEnabled = map.background_song_schedule_enabled === "true";
  const scheduleStart = map.background_song_schedule_start || "00:00";
  const scheduleEnd = map.background_song_schedule_end || "23:59";
  const intensity = Math.max(0, Math.min(3, toFloat(map.background_song_intensity, 1)));
  const sensitivity = Math.max(0, Math.min(3, toFloat(map.background_song_sensitivity, 1)));
  const trackTitle = map.background_song_track_title || "";
  const path = map.background_song_path || "";
  const name = map.background_song_name || path;
  const updatedAt = map.background_song_updated_at || "";

  let url: string | null = null;
  if (enabled && path) {
    const { data: signed } = await supabaseAdmin.storage.from(BUCKET).createSignedUrl(path, 60 * 60 * 6);
    url = signed?.signedUrl ?? null;
  }
  return {
    enabled,
    reactive,
    url,
    name,
    path,
    updatedAt,
    scheduleEnabled,
    scheduleStart,
    scheduleEnd,
    intensity,
    sensitivity,
    trackTitle,
  };
});

/** Public: log an anonymous playback event. Rate-limited server-side. */
export const logBackgroundSongEvent = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z.object({
      event: z.enum(["impression", "autoplay", "unmute", "tap_play", "out_of_schedule", "silence_detected"]),
      sessionHash: z.string().max(64).optional(),
    }).parse(d)
  )
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin.from("background_song_events").insert({
      event_type: data.event,
      session_hash: data.sessionHash ?? null,
    });
    return { ok: true };
  });

// ============================================================================
// ADMIN — read
// ============================================================================

export const getBackgroundSongAdmin = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requireAdmin(context);
    const { map, supabaseAdmin } = await loadSettings();

    const path = map.background_song_path || "";
    let sizeBytes = 0;
    let signedUrl: string | null = null;
    if (path) {
      const { data: signed } = await supabaseAdmin.storage.from(BUCKET).createSignedUrl(path, 60 * 60);
      signedUrl = signed?.signedUrl ?? null;
      const { data: list } = await supabaseAdmin.storage.from(BUCKET).list("", { limit: 100 });
      const match = list?.find((o) => o.name === path);
      sizeBytes = (match?.metadata as any)?.size ?? 0;
    }

    return {
      enabled: map.background_song_enabled === "true",
      reactive: map.background_song_reactive !== "false",
      path,
      name: map.background_song_name || path,
      updatedAt: map.background_song_updated_at || "",
      sizeBytes,
      previewUrl: signedUrl,
      scheduleEnabled: map.background_song_schedule_enabled === "true",
      scheduleStart: map.background_song_schedule_start || "00:00",
      scheduleEnd: map.background_song_schedule_end || "23:59",
      intensity: Math.max(0, Math.min(3, toFloat(map.background_song_intensity, 1))),
      sensitivity: Math.max(0, Math.min(3, toFloat(map.background_song_sensitivity, 1))),
      trackTitle: map.background_song_track_title || "",
    };
  });

/** Admin: version history of uploaded tracks. */
export const listBackgroundSongHistory = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requireAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: rows } = await supabaseAdmin
      .from("background_song_history")
      .select("id, path, name, size_bytes, uploaded_by, uploaded_at, is_current")
      .order("uploaded_at", { ascending: false })
      .limit(50);

    // Resolve uploader labels (email or shortened id).
    const ids = Array.from(new Set((rows ?? []).map((r) => r.uploaded_by).filter(Boolean))) as string[];
    const labels = new Map<string, string>();
    if (ids.length) {
      const { data: profiles } = await supabaseAdmin
        .from("admin_profiles")
        .select("user_id, display_name")
        .in("user_id", ids);
      for (const p of profiles ?? []) labels.set(p.user_id as string, p.display_name || "");
    }

    return (rows ?? []).map((r) => ({
      id: r.id as string,
      path: r.path as string,
      name: r.name as string,
      sizeBytes: Number(r.size_bytes ?? 0),
      uploadedBy: (r.uploaded_by as string | null) ?? null,
      uploaderLabel: r.uploaded_by ? labels.get(r.uploaded_by as string) || "admin" : "system",
      uploadedAt: r.uploaded_at as string,
      isCurrent: !!r.is_current,
    }));
  });

/** Admin: rolling analytics window. */
export const getBackgroundSongAnalytics = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requireAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const since24 = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const since7d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

    const { data: rows } = await supabaseAdmin
      .from("background_song_events")
      .select("event_type, created_at")
      .gte("created_at", since7d)
      .limit(10000);

    const events = rows ?? [];
    const bucket = { impression: 0, autoplay: 0, unmute: 0, tap_play: 0, out_of_schedule: 0, silence_detected: 0 } as Record<string, number>;
    const bucket24 = { ...bucket };
    for (const e of events) {
      const t = e.event_type as string;
      if (t in bucket) {
        bucket[t]++;
        if ((e.created_at as string) >= since24) bucket24[t]++;
      }
    }
    return { total7d: bucket, total24h: bucket24, sampleSize: events.length };
  });

// ============================================================================
// ADMIN — writers
// ============================================================================

export const setBackgroundSongEnabled = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ enabled: z.boolean() }).parse(d))
  .handler(async ({ context, data }) => {
    const { userId } = await requireAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin.from("app_settings").upsert({
      key: "background_song_enabled", value: data.enabled ? "true" : "false",
      updated_at: nowIso(), updated_by: userId,
    });
    await supabaseAdmin.from("admin_activity_log").insert({
      admin_id: userId, action: "background_song.toggle", details: { enabled: data.enabled },
    });
    return { ok: true, enabled: data.enabled };
  });

export const setBackgroundSongReactive = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ reactive: z.boolean() }).parse(d))
  .handler(async ({ context, data }) => {
    const { userId } = await requireAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin.from("app_settings").upsert({
      key: "background_song_reactive", value: data.reactive ? "true" : "false",
      updated_at: nowIso(), updated_by: userId,
    });
    await supabaseAdmin.from("admin_activity_log").insert({
      admin_id: userId, action: "background_song.reactive_toggle", details: { reactive: data.reactive },
    });
    return { ok: true, reactive: data.reactive };
  });

const HHMM = z.string().regex(/^\d{2}:\d{2}$/);
export const setBackgroundSongSchedule = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({
    enabled: z.boolean(),
    start: HHMM,
    end: HHMM,
  }).parse(d))
  .handler(async ({ context, data }) => {
    const { userId } = await requireAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const ts = nowIso();
    await supabaseAdmin.from("app_settings").upsert([
      { key: "background_song_schedule_enabled", value: data.enabled ? "true" : "false", updated_at: ts, updated_by: userId },
      { key: "background_song_schedule_start", value: data.start, updated_at: ts, updated_by: userId },
      { key: "background_song_schedule_end", value: data.end, updated_at: ts, updated_by: userId },
    ]);
    await supabaseAdmin.from("admin_activity_log").insert({
      admin_id: userId, action: "background_song.schedule",
      details: { enabled: data.enabled, start: data.start, end: data.end },
    });
    return { ok: true, ...data };
  });

export const setBackgroundSongIntensity = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ intensity: z.number().min(0).max(3) }).parse(d))
  .handler(async ({ context, data }) => {
    const { userId } = await requireAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin.from("app_settings").upsert({
      key: "background_song_intensity", value: data.intensity.toFixed(2),
      updated_at: nowIso(), updated_by: userId,
    });
    return { ok: true, intensity: data.intensity };
  });

export const setBackgroundSongSensitivity = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ sensitivity: z.number().min(0).max(3) }).parse(d))
  .handler(async ({ context, data }) => {
    const { userId } = await requireAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin.from("app_settings").upsert({
      key: "background_song_sensitivity", value: data.sensitivity.toFixed(2),
      updated_at: nowIso(), updated_by: userId,
    });
    return { ok: true, sensitivity: data.sensitivity };
  });

export const setBackgroundSongTrackTitle = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ title: z.string().max(120) }).parse(d))
  .handler(async ({ context, data }) => {
    const { userId } = await requireAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin.from("app_settings").upsert({
      key: "background_song_track_title", value: data.title,
      updated_at: nowIso(), updated_by: userId,
    });
    return { ok: true, title: data.title };
  });

// ============================================================================
// ADMIN — history / removal / restore
// ============================================================================

export const removeBackgroundSong = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { userId } = await requireAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: cur } = await supabaseAdmin
      .from("app_settings").select("value").eq("key", "background_song_path").maybeSingle();
    const path = cur?.value;
    // Note: we do NOT delete storage objects here — history keeps them so admins
    // can restore. Explicit deletes go through deleteBackgroundSongVersion.
    await supabaseAdmin.from("background_song_history").update({ is_current: false }).eq("is_current", true);

    const ts = nowIso();
    await supabaseAdmin.from("app_settings").upsert([
      { key: "background_song_path", value: "", updated_at: ts, updated_by: userId },
      { key: "background_song_name", value: "", updated_at: ts, updated_by: userId },
      { key: "background_song_enabled", value: "false", updated_at: ts, updated_by: userId },
      { key: "background_song_updated_at", value: ts, updated_at: ts, updated_by: userId },
    ]);
    await supabaseAdmin.from("admin_activity_log").insert({
      admin_id: userId, action: "background_song.remove", details: { path },
    });
    return { ok: true };
  });

export const restoreBackgroundSong = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    const { userId } = await requireAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: row, error } = await supabaseAdmin
      .from("background_song_history")
      .select("id, path, name")
      .eq("id", data.id).maybeSingle();
    if (error || !row) throw new Error("Version not found");

    // Verify storage object still exists.
    const { data: list } = await supabaseAdmin.storage.from(BUCKET).list("", { limit: 200 });
    if (!list?.find((o) => o.name === row.path)) throw new Error("File missing from storage");

    await supabaseAdmin.from("background_song_history").update({ is_current: false }).eq("is_current", true);
    await supabaseAdmin.from("background_song_history").update({ is_current: true }).eq("id", row.id);

    const ts = nowIso();
    await supabaseAdmin.from("app_settings").upsert([
      { key: "background_song_path", value: row.path, updated_at: ts, updated_by: userId },
      { key: "background_song_name", value: row.name, updated_at: ts, updated_by: userId },
      { key: "background_song_enabled", value: "true", updated_at: ts, updated_by: userId },
      { key: "background_song_updated_at", value: ts, updated_at: ts, updated_by: userId },
    ]);
    await supabaseAdmin.from("admin_activity_log").insert({
      admin_id: userId, action: "background_song.restore", details: { id: row.id, path: row.path, name: row.name },
    });
    return { ok: true, name: row.name };
  });

export const deleteBackgroundSongVersion = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    const { userId } = await requireAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: row } = await supabaseAdmin
      .from("background_song_history")
      .select("id, path, is_current").eq("id", data.id).maybeSingle();
    if (!row) throw new Error("Version not found");
    if (row.is_current) throw new Error("Cannot delete the currently active track. Restore or upload another first.");
    await supabaseAdmin.storage.from(BUCKET).remove([row.path as string]);
    await supabaseAdmin.from("background_song_history").delete().eq("id", row.id);
    await supabaseAdmin.from("admin_activity_log").insert({
      admin_id: userId, action: "background_song.delete_version", details: { id: row.id, path: row.path },
    });
    return { ok: true };
  });
