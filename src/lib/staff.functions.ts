// Staff & role management admin server fns.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

export const listStaff = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context as any;
    const { data: isAdmin } = await supabase.rpc("has_role", { _user_id: userId, _role: "admin" });
    if (!isAdmin) throw new Error("Forbidden");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: roles } = await supabaseAdmin
      .from("user_roles")
      .select("user_id, role, created_at")
      .order("created_at", { ascending: false });

    const { data: profiles } = await supabaseAdmin
      .from("admin_profiles")
      .select("user_id, username, display_name, avatar_url");
    const profileMap = new Map((profiles ?? []).map((p) => [p.user_id, p]));

    // Look up auth emails via admin API
    const users: Array<{
      user_id: string;
      role: string;
      email: string | null;
      display_name: string | null;
      created_at: string;
    }> = [];
    for (const r of roles ?? []) {
      const p = profileMap.get(r.user_id);
      let email: string | null = null;
      try {
        const { data: u } = await supabaseAdmin.auth.admin.getUserById(r.user_id);
        email = u?.user?.email ?? null;
      } catch {
        /* ignore */
      }
      users.push({
        user_id: r.user_id,
        role: r.role,
        email,
        display_name: p?.display_name ?? p?.username ?? null,
        created_at: r.created_at,
      });
    }

    const { data: invites } = await supabaseAdmin
      .from("staff_invites")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(50);

    return { staff: users, invites: invites ?? [] };
  });

export const inviteStaff = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ email: z.string().email(), role: z.enum(["admin", "moderator"]) }).parse(d),
  )
  .handler(async ({ context, data }) => {
    const { supabase, userId, claims } = context as any;
    const { data: isAdmin } = await supabase.rpc("has_role", { _user_id: userId, _role: "admin" });
    if (!isAdmin) throw new Error("Forbidden");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin
      .from("staff_invites")
      .insert({ email: data.email.toLowerCase(), role: data.role, invited_by: userId });
    await supabaseAdmin.from("admin_activity_log").insert({
      admin_id: userId,
      actor_label: claims?.email ?? userId,
      action: "staff.invite",
      target: data.email,
      details: { role: data.role, actor_email: claims?.email ?? null, target_email: data.email.toLowerCase() },
    });
    return { ok: true };
  });

export const revokeRole = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ user_id: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    const { supabase, userId, claims } = context as any;
    const { data: isAdmin } = await supabase.rpc("has_role", { _user_id: userId, _role: "admin" });
    if (!isAdmin) throw new Error("Forbidden");
    if (data.user_id === userId) throw new Error("Cannot revoke your own admin role.");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const [{ data: targetUser }, { data: targetRoles }] = await Promise.all([
      supabaseAdmin.auth.admin.getUserById(data.user_id),
      supabaseAdmin.from("user_roles").select("role").eq("user_id", data.user_id),
    ]);
    const targetEmail = targetUser?.user?.email ?? null;
    await supabaseAdmin.from("user_roles").delete().eq("user_id", data.user_id);
    await supabaseAdmin.from("admin_activity_log").insert({
      admin_id: userId,
      actor_label: claims?.email ?? userId,
      action: "staff.revoke",
      target: targetEmail ?? data.user_id,
      details: {
        actor_email: claims?.email ?? null,
        target_email: targetEmail,
        target_user_id: data.user_id,
        roles: (targetRoles ?? []).map((roleRow) => roleRow.role),
      },
    });
    return { ok: true };
  });
