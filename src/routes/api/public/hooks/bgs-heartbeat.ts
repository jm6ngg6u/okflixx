import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { createHash } from "crypto";

// Global in-worker sample bucket: cap heartbeat writes at 800/min so a viral
// spike cannot flood the events table. Extra beats are silently accepted.
const bucket: { count: number; resetAt: number } = { count: 0, resetAt: 0 };
const perIp = new Map<string, number>(); // ip_hash -> last accept ts (ms)

const Payload = z.object({
  status: z.enum([
    "idle","loading","playing","paused","waiting","stalled",
    "blocked","error","retrying","out_of_schedule",
  ]),
  muted: z.boolean(),
  needsGesture: z.boolean(),
  silent: z.boolean(),
  retries: z.number().int().min(0).max(1000),
  lastError: z.string().max(240).nullable().optional(),
  sessionHash: z.string().max(64).optional(),
});

function hashIp(ip: string) {
  return createHash("sha256").update(ip).digest("hex").slice(0, 32);
}

async function handle(request: Request) {
  try {
    const cl = Number(request.headers.get("content-length") || "0");
    if (cl > 1024) return new Response("payload too large", { status: 413 });
    const raw = await request.text();
    if (raw.length > 1024) return new Response("payload too large", { status: 413 });

    const parsed = Payload.safeParse(JSON.parse(raw));
    if (!parsed.success) return new Response("bad payload", { status: 400 });

    const now = Date.now();
    // Global sample cap.
    if (now > bucket.resetAt) { bucket.resetAt = now + 60_000; bucket.count = 0; }
    if (bucket.count >= 800) return new Response("ok", { status: 202 });

    // Per-IP throttle: max 1 accepted heartbeat / 8s.
    const xff = request.headers.get("x-forwarded-for") || request.headers.get("cf-connecting-ip") || "0.0.0.0";
    const ip = xff.split(",")[0]!.trim();
    const iph = hashIp(ip);
    const last = perIp.get(iph) ?? 0;
    if (now - last < 8_000) return new Response("ok", { status: 202 });
    perIp.set(iph, now);
    // Trim map opportunistically.
    if (perIp.size > 5000) {
      const cutoff = now - 60_000;
      for (const [k, v] of perIp) if (v < cutoff) perIp.delete(k);
    }
    bucket.count++;

    const p = parsed.data;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin.from("background_song_events").insert({
      event_type: "heartbeat",
      session_hash: p.sessionHash ?? null,
      status: p.status,
      muted: p.muted,
      needs_gesture: p.needsGesture,
      silent: p.silent,
      error: p.lastError ?? null,
      ip_hash: iph,
    });
    return new Response("ok", { status: 200 });
  } catch {
    return new Response("ok", { status: 202 });
  }
}

export const Route = createFileRoute("/api/public/hooks/bgs-heartbeat")({
  server: {
    handlers: {
      POST: async ({ request }) => handle(request),
    },
  },
});
