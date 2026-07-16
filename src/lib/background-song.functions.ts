// Background song management for the public site.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const BUCKET = "site-audio";

/** Public: returns current background song info + signed URL (if enabled). */
export const getBackgroundSong = createServerFn({ method: "GET" }).handler(async () => {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await supabaseAdmin
    .from("app_settings")
    .select("key,value")
    .in("key", [
      "background_song_enabled",
      "background_song_path",
      "background_song_name",
      "background_song_updated_at",
      "background_song_reactive",
    ]);
  const map: Record<string, string> = {};
  for (const r of data ?? []) map[r.key] = r.value;

  const enabled = map.background_song_enabled === "true";
  const reactive = map.background_song_reactive !== "false"; // default ON
  const path = map.background_song_path || "";
  const name = map.background_song_name || path;
  const updatedAt = map.background_song_updated_at || "";

  let url: string | null = null;
  if (enabled && path) {
    const { data: signed } = await supabaseAdmin.storage
      .from(BUCKET)
      .createSignedUrl(path, 60 * 60 * 6); // 6h
    url = signed?.signedUrl ?? null;
  }
  return { enabled, reactive, url, name, path, updatedAt };
});

/** Admin: full detail including size + list of stored objects. */
export const getBackgroundSongAdmin = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context as any;
    const { data: isAdmin } = await supabase.rpc("has_role", { _user_id: userId, _role: "admin" });
    if (!isAdmin) throw new Error("Forbidden");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data } = await supabaseAdmin
      .from("app_settings")
      .select("key,value")
      .in("key", [
        "background_song_enabled",
        "background_song_path",
        "background_song_name",
        "background_song_updated_at",
        "background_song_reactive",
      ]);
    const map: Record<string, string> = {};
    for (const r of data ?? []) map[r.key] = r.value;

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
    };
  });

/** Admin: toggle on/off. */
export const setBackgroundSongEnabled = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ enabled: z.boolean() }).parse(d))
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context as any;
    const { data: isAdmin } = await supabase.rpc("has_role", { _user_id: userId, _role: "admin" });
    if (!isAdmin) throw new Error("Forbidden");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin.from("app_settings").upsert({
      key: "background_song_enabled",
      value: data.enabled ? "true" : "false",
      updated_at: new Date().toISOString(),
      updated_by: userId,
    });
    await supabaseAdmin.from("admin_activity_log").insert({
      admin_id: userId,
      action: "background_song.toggle",
      details: { enabled: data.enabled },
    });
    return { ok: true, enabled: data.enabled };
  });

/** Admin: remove the current song from storage + clear settings. */
export const removeBackgroundSong = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context as any;
    const { data: isAdmin } = await supabase.rpc("has_role", { _user_id: userId, _role: "admin" });
    if (!isAdmin) throw new Error("Forbidden");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: cur } = await supabaseAdmin
      .from("app_settings")
      .select("value")
      .eq("key", "background_song_path")
      .maybeSingle();
    const path = cur?.value;
    if (path) {
      await supabaseAdmin.storage.from(BUCKET).remove([path]);
    }
    await supabaseAdmin.from("app_settings").upsert([
      { key: "background_song_path", value: "", updated_at: new Date().toISOString(), updated_by: userId },
      { key: "background_song_name", value: "", updated_at: new Date().toISOString(), updated_by: userId },
      { key: "background_song_enabled", value: "false", updated_at: new Date().toISOString(), updated_by: userId },
      { key: "background_song_updated_at", value: new Date().toISOString(), updated_at: new Date().toISOString(), updated_by: userId },
    ]);
    await supabaseAdmin.from("admin_activity_log").insert({
      admin_id: userId,
      action: "background_song.remove",
      details: { path },
    });
    return { ok: true };
  });

/** Admin: toggle audio-reactive live background animation. */
export const setBackgroundSongReactive = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ reactive: z.boolean() }).parse(d))
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context as any;
    const { data: isAdmin } = await supabase.rpc("has_role", { _user_id: userId, _role: "admin" });
    if (!isAdmin) throw new Error("Forbidden");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin.from("app_settings").upsert({
      key: "background_song_reactive",
      value: data.reactive ? "true" : "false",
      updated_at: new Date().toISOString(),
      updated_by: userId,
    });
    await supabaseAdmin.from("admin_activity_log").insert({
      admin_id: userId,
      action: "background_song.reactive_toggle",
      details: { reactive: data.reactive },
    });
    return { ok: true, reactive: data.reactive };
  });
