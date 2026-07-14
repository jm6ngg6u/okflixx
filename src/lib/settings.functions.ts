// Settings: proxy_mode toggle, maintenance banner, thresholds.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

async function assertAdmin(supabase: any, userId: string) {
  const { data: isAdmin } = await supabase.rpc("has_role", { _user_id: userId, _role: "admin" });
  if (!isAdmin) throw new Error("Forbidden");
}

/** Return every setting as a plain map. Publicly readable subset only for anon,
 *  but this fn requires staff so all keys are returned. */
export const listSettings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context as any;
    const [{ data: a }, { data: m }] = await Promise.all([
      supabase.rpc("has_role", { _user_id: userId, _role: "admin" }),
      supabase.rpc("has_role", { _user_id: userId, _role: "moderator" }),
    ]);
    if (!a && !m) throw new Error("Forbidden");
    const { data, error } = await supabase.from("app_settings").select("key,value,updated_at");
    if (error) throw error;
    const map: Record<string, string> = {};
    for (const row of data ?? []) map[row.key] = row.value;
    return { settings: map, rows: data ?? [] };
  });

export const setSetting = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ key: z.string().min(1).max(64), value: z.string().max(4096) }).parse(d),
  )
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context as any;
    await assertAdmin(supabase, userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("app_settings")
      .upsert({ key: data.key, value: data.value, updated_at: new Date().toISOString(), updated_by: userId })
      .select();
    if (error) throw error;
    await supabaseAdmin.from("admin_activity_log").insert({
      admin_id: userId,
      action: "settings.update",
      target: data.key,
      details: { value: data.value },
    });
    return { ok: true };
  });

/** One-click proxy mode toggle. Returns the new value. */
export const toggleProxyMode = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context as any;
    await assertAdmin(supabase, userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: cur } = await supabaseAdmin
      .from("app_settings")
      .select("value")
      .eq("key", "proxy_mode")
      .maybeSingle();
    const next = cur?.value === "1" ? "0" : "1";
    await supabaseAdmin
      .from("app_settings")
      .upsert({ key: "proxy_mode", value: next, updated_at: new Date().toISOString(), updated_by: userId });
    await supabaseAdmin.from("admin_activity_log").insert({
      admin_id: userId,
      action: "settings.toggle_proxy_mode",
      details: { new_value: next },
    });
    return { proxy_mode: next === "1" };
  });

export const setMaintenance = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ enabled: z.boolean(), message: z.string().max(2000).optional() }).parse(d),
  )
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context as any;
    await assertAdmin(supabase, userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin
      .from("app_settings")
      .upsert({
        key: "maintenance_enabled",
        value: data.enabled ? "1" : "0",
        updated_at: new Date().toISOString(),
        updated_by: userId,
      });
    if (typeof data.message === "string") {
      await supabaseAdmin
        .from("app_settings")
        .upsert({
          key: "maintenance_message",
          value: data.message,
          updated_at: new Date().toISOString(),
          updated_by: userId,
        });
    }
    await supabaseAdmin.from("admin_activity_log").insert({
      admin_id: userId,
      action: "settings.maintenance",
      details: { enabled: data.enabled },
    });
    return { ok: true };
  });

/** Public getter for anon-safe subset (used by the landing page banner). */
export const getPublicStatus = createServerFn({ method: "GET" }).handler(async () => {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await supabaseAdmin
    .from("app_settings")
    .select("key,value")
    .in("key", ["maintenance_enabled", "maintenance_message"]);
  const map: Record<string, string> = {};
  for (const row of data ?? []) map[row.key] = row.value;
  return {
    maintenance: map.maintenance_enabled === "1",
    message: map.maintenance_message ?? "",
  };
});
