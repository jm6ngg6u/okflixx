import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";

// Admin-only route to upload the site's background song.
// Verifies the caller's Supabase JWT + admin role, then uploads via service role.
export const Route = createFileRoute("/api/admin/upload-background-song")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const authHeader = request.headers.get("authorization");
          if (!authHeader?.startsWith("Bearer ")) {
            return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
          }
          const token = authHeader.slice(7);
          if (token.split(".").length !== 3) {
            return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
          }

          const SUPABASE_URL = process.env.SUPABASE_URL!;
          const PUBLISHABLE = process.env.SUPABASE_PUBLISHABLE_KEY!;

          const isNew = (v: string) => v.startsWith("sb_publishable_") || v.startsWith("sb_secret_");
          const shim = (key: string): typeof fetch => (input, init) => {
            const h = new Headers(init?.headers);
            if (isNew(key) && h.get("Authorization") === `Bearer ${key}`) h.delete("Authorization");
            h.set("apikey", key);
            return fetch(input, { ...init, headers: h });
          };

          const asUser = createClient(SUPABASE_URL, PUBLISHABLE, {
            global: { fetch: shim(PUBLISHABLE), headers: { Authorization: `Bearer ${token}` } },
            auth: { persistSession: false, autoRefreshToken: false },
          });
          const { data: claimsData, error: claimsErr } = await asUser.auth.getClaims(token);
          if (claimsErr || !claimsData?.claims?.sub) {
            return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
          }
          const userId = claimsData.claims.sub;
          const { data: isAdmin } = await asUser.rpc("has_role", { _user_id: userId, _role: "admin" });
          if (!isAdmin) return Response.json({ ok: false, error: "forbidden" }, { status: 403 });

          const form = await request.formData();
          const file = form.get("file");
          if (!(file instanceof File)) {
            return Response.json({ ok: false, error: "no_file" }, { status: 400 });
          }
          const MAX = 15 * 1024 * 1024;
          if (file.size > MAX) {
            return Response.json({ ok: false, error: "file_too_large", max_bytes: MAX }, { status: 400 });
          }
          const type = file.type || "audio/mpeg";
          if (!type.startsWith("audio/")) {
            return Response.json({ ok: false, error: "not_audio" }, { status: 400 });
          }

          const origName = (file.name || "background.mp3").replace(/[^\w.\-]+/g, "_");
          const ext = origName.includes(".") ? origName.slice(origName.lastIndexOf(".")) : ".mp3";
          const path = `bg-${Date.now()}${ext}`;

          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

          // Remove previous file (best-effort)
          const { data: prev } = await supabaseAdmin
            .from("app_settings").select("value").eq("key", "background_song_path").maybeSingle();
          const prevPath = prev?.value;

          const buf = new Uint8Array(await file.arrayBuffer());
          const { error: upErr } = await supabaseAdmin.storage
            .from("site-audio")
            .upload(path, buf, { contentType: type, upsert: true });
          if (upErr) return Response.json({ ok: false, error: "upload_failed", detail: upErr.message }, { status: 500 });

          if (prevPath && prevPath !== path) {
            await supabaseAdmin.storage.from("site-audio").remove([prevPath]);
          }

          const nowIso = new Date().toISOString();
          await supabaseAdmin.from("app_settings").upsert([
            { key: "background_song_path", value: path, updated_at: nowIso, updated_by: userId },
            { key: "background_song_name", value: origName, updated_at: nowIso, updated_by: userId },
            { key: "background_song_enabled", value: "true", updated_at: nowIso, updated_by: userId },
            { key: "background_song_updated_at", value: nowIso, updated_at: nowIso, updated_by: userId },
          ]);
          await supabaseAdmin.from("admin_activity_log").insert({
            admin_id: userId,
            action: "background_song.upload",
            details: { name: origName, path, size: file.size, type },
          });

          return Response.json({ ok: true, path, name: origName, size: file.size });
        } catch (e: any) {
          return Response.json({ ok: false, error: "server_error", detail: String(e?.message ?? e) }, { status: 500 });
        }
      },
    },
  },
});
