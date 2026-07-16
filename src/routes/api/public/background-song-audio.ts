import { createFileRoute } from "@tanstack/react-router";

const BUCKET = "site-audio";

async function readCurrentTrack() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await supabaseAdmin
    .from("app_settings")
    .select("key,value")
    .in("key", ["background_song_enabled", "background_song_path", "background_song_updated_at"]);

  const map: Record<string, string> = {};
  for (const r of data ?? []) map[r.key] = r.value ?? "";
  return { supabaseAdmin, enabled: map.background_song_enabled === "true", path: map.background_song_path || "" };
}

async function streamCurrentSong(request: Request) {
  const { supabaseAdmin, enabled, path } = await readCurrentTrack();
  if (!enabled || !path) return new Response("Background song unavailable", { status: 404 });

  const { data: signed, error } = await supabaseAdmin.storage
    .from(BUCKET)
    .createSignedUrl(path, 60 * 10);
  if (error || !signed?.signedUrl) return new Response("Background song unavailable", { status: 404 });

  const upstreamHeaders = new Headers();
  const range = request.headers.get("range");
  if (range) upstreamHeaders.set("range", range);

  const upstream = await fetch(signed.signedUrl, { headers: upstreamHeaders });
  if (!upstream.ok && upstream.status !== 206) {
    return new Response("Background song unavailable", { status: upstream.status || 502 });
  }

  const headers = new Headers();
  for (const key of ["content-type", "content-length", "content-range", "accept-ranges", "etag", "last-modified"]) {
    const value = upstream.headers.get(key);
    if (value) headers.set(key, value);
  }
  headers.set("content-type", upstream.headers.get("content-type") || "audio/mpeg");
  headers.set("accept-ranges", upstream.headers.get("accept-ranges") || "bytes");
  headers.set("cache-control", "public, max-age=3600, stale-while-revalidate=86400");

  return new Response(request.method === "HEAD" ? null : upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers,
  });
}

export const Route = createFileRoute("/api/public/background-song-audio")({
  server: {
    handlers: {
      GET: async ({ request }) => streamCurrentSong(request),
      HEAD: async ({ request }) => streamCurrentSong(request),
    },
  },
});