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
          if (file.size <= 0) {
            return Response.json({ ok: false, error: "empty_file" }, { status: 400 });
          }
          if (file.size > MAX) {
            return Response.json({ ok: false, error: "file_too_large", max_bytes: MAX }, { status: 400 });
          }

          // Some browsers omit or misreport MIME for m4a/aac/flac. Accept either
          // an audio/* MIME OR a recognized audio extension.
          const rawName = file.name || "background.mp3";
          const extMatch = rawName.toLowerCase().match(/\.(mp3|wav|ogg|m4a|aac|flac)$/);
          const providedType = file.type || "";
          const isAudioMime = providedType.startsWith("audio/") || providedType === "application/ogg";
          if (!isAudioMime && !extMatch) {
            return Response.json({ ok: false, error: "not_audio" }, { status: 400 });
          }
          const extToMime: Record<string, string> = {
            mp3: "audio/mpeg", wav: "audio/wav", ogg: "audio/ogg",
            m4a: "audio/mp4", aac: "audio/aac", flac: "audio/flac",
          };
          const ext = extMatch ? `.${extMatch[1]}` : ".mp3";
          const type = isAudioMime ? providedType : (extToMime[ext.slice(1)] ?? "audio/mpeg");

          const origName = rawName.replace(/[^\w.\-]+/g, "_");
          const path = `bg-${Date.now()}${ext}`;

          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

          const buf = new Uint8Array(await file.arrayBuffer());
          const { error: upErr } = await supabaseAdmin.storage
            .from("site-audio")
            .upload(path, buf, { contentType: type, upsert: true });
          if (upErr) return Response.json({ ok: false, error: "upload_failed", detail: upErr.message }, { status: 500 });

          // History: keep prior file in storage so admins can restore.
          // Flip is_current off on prior rows, then insert this upload as current.
          await supabaseAdmin.from("background_song_history").update({ is_current: false }).eq("is_current", true);
          await supabaseAdmin.from("background_song_history").insert({
            path,
            name: origName,
            size_bytes: file.size,
            uploaded_by: userId,
            is_current: true,
          });

          // Preserve the admin's current playback toggle — don't silently re-enable
          // a track the admin has paused. Only default to "true" on first-ever upload.
          const { data: existingEnabled } = await supabaseAdmin
            .from("app_settings").select("value").eq("key", "background_song_enabled").maybeSingle();
          const enabledValue = existingEnabled?.value ?? "true";

          const nowIso = new Date().toISOString();
          await supabaseAdmin.from("app_settings").upsert([
            { key: "background_song_path", value: path, updated_at: nowIso, updated_by: userId },
            { key: "background_song_name", value: origName, updated_at: nowIso, updated_by: userId },
            { key: "background_song_enabled", value: enabledValue, updated_at: nowIso, updated_by: userId },
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
