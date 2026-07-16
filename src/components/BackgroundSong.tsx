import { useEffect, useMemo, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { getBackgroundSong, logBackgroundSongEvent } from "@/lib/background-song.functions";
import {
  attachAudio,
  setReactiveEnabled,
  resumeAudio,
  setIntensity,
  setSensitivity,
  onSilenceChange,
} from "@/lib/audio-reactive";
import { Volume2, VolumeX, Music4, Play } from "lucide-react";
import { toast } from "sonner";

/**
 * Plays the site background song on loop and coordinates the audio-reactive
 * live background. Handles:
 *
 *  - Autoplay policy (starts unmuted; falls back to muted-autoplay + gesture)
 *  - Admin-set schedule window (start/end HH:MM, local time)
 *  - Volume preference persisted per-visitor to localStorage
 *  - Reduced-motion → forces STATIC animation even if reactive is ON
 *  - CORS / silence detection → warns and falls back to STATIC
 *  - Anonymous analytics: impression, autoplay, unmute, tap_play,
 *    out_of_schedule, silence_detected
 */
const VOLUME_KEY = "emberlord.bgs.volume";
const SESSION_KEY = "emberlord.bgs.session";
const IMPRESSION_KEY = "emberlord.bgs.impressed";

function parseHHMM(v: string) {
  const [h, m] = v.split(":").map((n) => Number.parseInt(n, 10));
  if (!Number.isFinite(h) || !Number.isFinite(m)) return 0;
  return h * 60 + m;
}
function currentMinuteOfDay() {
  const d = new Date();
  return d.getHours() * 60 + d.getMinutes();
}
function isInWindow(start: string, end: string) {
  const s = parseHHMM(start);
  const e = parseHHMM(end);
  const cur = currentMinuteOfDay();
  if (s === e) return true;
  if (s < e) return cur >= s && cur < e;
  return cur >= s || cur < e; // wraps midnight
}
function ensureSessionHash() {
  if (typeof window === "undefined") return "";
  let sh = window.localStorage.getItem(SESSION_KEY);
  if (!sh) {
    sh = Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
    window.localStorage.setItem(SESSION_KEY, sh);
  }
  return sh;
}

export function BackgroundSong() {
  const fetchSong = useServerFn(getBackgroundSong);
  const logEvent = useServerFn(logBackgroundSongEvent);

  const q = useQuery({
    queryKey: ["background-song-public"],
    queryFn: () => fetchSong(),
    staleTime: 10 * 1000,
    refetchInterval: 15 * 1000, // stable same-origin URL lets admin changes apply quickly without playback churn
    refetchOnWindowFocus: false,
  });

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [muted, setMuted] = useState(false);
  const [needsGesture, setNeedsGesture] = useState(false);
  const [volume, setVolumeState] = useState<number>(() => {
    if (typeof window === "undefined") return 0.55;
    const raw = Number.parseFloat(window.localStorage.getItem(VOLUME_KEY) ?? "");
    return Number.isFinite(raw) ? Math.min(1, Math.max(0, raw)) : 0.55;
  });
  // Stable audio src: only changes when the *track* (path) changes, NOT when
  // the query refetches a new signed URL for the same track. Otherwise the
  // <audio> element reloads every 20s and playback aborts mid-song.
  const [stableUrl, setStableUrl] = useState<string | null>(null);
  const lastTrackKeyRef = useRef<string>("");
  const loopResettingRef = useRef(false);
  const lastProgressRef = useRef({ time: 0, at: 0 });
  useEffect(() => {
    const path = q.data?.path ?? "";
    const updatedAt = q.data?.updatedAt ?? "";
    const url = q.data?.url ?? null;
    const trackKey = path ? `${path}|${updatedAt}` : "";
    if (trackKey && trackKey !== lastTrackKeyRef.current) {
      lastTrackKeyRef.current = trackKey;
      setStableUrl(url);
    } else if (!trackKey && lastTrackKeyRef.current) {
      lastTrackKeyRef.current = "";
      setStableUrl(null);
    } else if (trackKey && !stableUrl && url) {
      setStableUrl(url);
    }
  }, [q.data?.path, q.data?.updatedAt, q.data?.url, stableUrl]);
  const [showVolume, setShowVolume] = useState(false);
  const [nowMinute, setNowMinute] = useState(currentMinuteOfDay());
  const [prefersReducedMotion, setPRM] = useState(false);
  const [analyserSilent, setAnalyserSilent] = useState(false);

  const fired = useRef<{ impression: boolean; autoplay: boolean; unmute: boolean; tap: boolean; silence: boolean; oos: boolean }>({
    impression: false, autoplay: false, unmute: false, tap: false, silence: false, oos: false,
  });

  const sendEvent = (event: "impression" | "autoplay" | "unmute" | "tap_play" | "out_of_schedule" | "silence_detected") => {
    void logEvent({ data: { event, sessionHash: ensureSessionHash() } }).catch(() => {});
  };

  // Tick the "current minute" every 30s so the schedule flips automatically.
  useEffect(() => {
    const id = window.setInterval(() => setNowMinute(currentMinuteOfDay()), 30_000);
    return () => window.clearInterval(id);
  }, []);

  // Watch prefers-reduced-motion.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setPRM(mq.matches);
    const h = (e: MediaQueryListEvent) => setPRM(e.matches);
    mq.addEventListener?.("change", h);
    return () => mq.removeEventListener?.("change", h);
  }, []);

  // Silence-detected subscription — warn once + force STATIC.
  useEffect(() => {
    const off = onSilenceChange((v) => {
      setAnalyserSilent(v);
      if (v && !fired.current.silence) {
        fired.current.silence = true;
        sendEvent("silence_detected");
        toast.warning("Audio analyser blocked", {
          description: "Analyser returned silence for 3s — reactive background switched to STATIC. Check CORS or unmute the song.",
        });
        setReactiveEnabled(false);
      }
    });
    return off;
  }, []);

  const inWindow = useMemo(() => {
    void nowMinute; // recompute on tick
    if (!q.data?.scheduleEnabled) return true;
    return isInWindow(q.data.scheduleStart, q.data.scheduleEnd);
  }, [q.data?.scheduleEnabled, q.data?.scheduleStart, q.data?.scheduleEnd, nowMinute]);

  // Push intensity/sensitivity to the singleton whenever they change.
  useEffect(() => {
    if (q.data) {
      setIntensity(q.data.intensity ?? 1);
      setSensitivity(q.data.sensitivity ?? 1);
    }
  }, [q.data?.intensity, q.data?.sensitivity]);

  // Fire an impression once per browser session when the song is live+in window.
  useEffect(() => {
    if (!q.data?.enabled || !q.data.url) return;
    if (typeof window === "undefined") return;
    if (fired.current.impression) return;
    if (window.sessionStorage.getItem(IMPRESSION_KEY) === "1") { fired.current.impression = true; return; }
    fired.current.impression = true;
    window.sessionStorage.setItem(IMPRESSION_KEY, "1");
    sendEvent("impression");
  }, [q.data?.enabled, q.data?.url]);

  // Fire an out_of_schedule event once when the schedule blocks playback.
  useEffect(() => {
    if (q.data?.enabled && q.data.url && q.data.scheduleEnabled && !inWindow && !fired.current.oos) {
      fired.current.oos = true;
      sendEvent("out_of_schedule");
    }
  }, [q.data?.enabled, q.data?.url, q.data?.scheduleEnabled, inWindow]);

  // Play / attach / react to config changes.
  useEffect(() => {
    const el = audioRef.current;
    if (!el || !q.data?.enabled || !stableUrl) {
      setReactiveEnabled(false);
      return;
    }
    // Schedule: outside window → pause silently, don't attach reactive.
    if (q.data.scheduleEnabled && !inWindow) {
      try { el.pause(); } catch { /* ignore */ }
      setReactiveEnabled(false);
      return;
    }

    el.volume = volume;
    attachAudio(el);
    // Reduced motion / silence → keep reactive OFF regardless of admin flag.
    const wantReactive = !!q.data.reactive && !prefersReducedMotion && !analyserSilent;
    setReactiveEnabled(wantReactive);

    const tryPlay = async () => {
      try {
        el.muted = false;
        await el.play();
        setMuted(false);
        setNeedsGesture(false);
        if (!fired.current.autoplay) { fired.current.autoplay = true; sendEvent("autoplay"); }
      } catch {
        try {
          el.muted = true;
          await el.play();
          setMuted(true);
          setNeedsGesture(true);
        } catch {
          setNeedsGesture(true);
        }
      }
    };
    tryPlay();

    const onFirstGesture = async () => {
      resumeAudio();
      if (!el.paused && !el.muted) return;
      try {
        el.muted = false;
        await el.play();
        setMuted(false);
        setNeedsGesture(false);
        if (!fired.current.tap) { fired.current.tap = true; sendEvent("tap_play"); }
        if (!fired.current.unmute) { fired.current.unmute = true; sendEvent("unmute"); }
        window.removeEventListener("pointerdown", onFirstGesture);
        window.removeEventListener("keydown", onFirstGesture);
      } catch { /* ignore */ }
    };
    window.addEventListener("pointerdown", onFirstGesture);
    window.addEventListener("keydown", onFirstGesture);
    return () => {
      window.removeEventListener("pointerdown", onFirstGesture);
      window.removeEventListener("keydown", onFirstGesture);
    };
  }, [q.data?.enabled, stableUrl, q.data?.reactive, q.data?.scheduleEnabled, inWindow, prefersReducedMotion, analyserSilent, volume]);

  // Playback watchdog: if the browser stalls/pauses unexpectedly, resume without
  // changing src. This protects long tracks from network range hiccups and keeps
  // the 59s loop running continuously.
  useEffect(() => {
    if (!q.data?.enabled || !stableUrl || (q.data.scheduleEnabled && !inWindow)) return;
    const id = window.setInterval(() => {
      const el = audioRef.current;
      if (!el) return;
      if (el.paused && !needsGesture) {
        void el.play().catch(() => setNeedsGesture(true));
        return;
      }
      const now = performance.now();
      const prev = lastProgressRef.current;
      if (!el.paused && !el.seeking && el.readyState >= 2) {
        if (Math.abs(el.currentTime - prev.time) < 0.01 && now - prev.at > 3500) {
          const d = el.duration;
          if (Number.isFinite(d) && d - el.currentTime <= 0.5) {
            restartLoop(el);
          } else {
            try { el.currentTime = Math.min(el.currentTime + 0.05, Math.max(0, (d || el.currentTime + 1) - 0.5)); } catch { /* ignore */ }
            void el.play().catch(() => setNeedsGesture(true));
          }
          lastProgressRef.current = { time: el.currentTime, at: now };
        } else if (Math.abs(el.currentTime - prev.time) >= 0.01) {
          lastProgressRef.current = { time: el.currentTime, at: now };
        }
      }
    }, 1500);
    return () => window.clearInterval(id);
  }, [q.data?.enabled, q.data?.scheduleEnabled, stableUrl, inWindow, needsGesture]);

  // Apply live volume changes without restarting playback.
  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    el.volume = volume;
    if (typeof window !== "undefined") window.localStorage.setItem(VOLUME_KEY, volume.toFixed(2));
  }, [volume]);

  if (!q.data?.enabled || !stableUrl) return null;
  const blocked = q.data.scheduleEnabled && !inWindow;

  const toggle = () => {
    const el = audioRef.current;
    if (!el) return;
    resumeAudio();
    if (el.paused) {
      el.muted = false;
      el.play().catch(() => {});
      setMuted(false);
      attachAudio(el);
      if (!fired.current.unmute) { fired.current.unmute = true; sendEvent("unmute"); }
    } else {
      const next = !el.muted;
      el.muted = next;
      setMuted(next);
      if (!next && !fired.current.unmute) { fired.current.unmute = true; sendEvent("unmute"); }
    }
    setNeedsGesture(false);
  };

  const trackLabel = q.data.trackTitle?.trim() || q.data.name?.replace(/\.[a-z0-9]+$/i, "") || "Background";

  const restartLoop = (el: HTMLAudioElement) => {
    if (loopResettingRef.current) return;
    loopResettingRef.current = true;
    try {
      el.currentTime = 0.001;
      if (!el.paused) void el.play().catch(() => {});
    } catch { /* ignore */ }
    window.setTimeout(() => { loopResettingRef.current = false; }, 350);
  };

  return (
    <>
      <audio
        ref={audioRef}
        src={stableUrl ?? undefined}
        preload="auto"
        playsInline
        crossOrigin="anonymous"
        onTimeUpdate={(e) => {
          // Seamless loop: pre-empt native `loop` gap by seeking to 0 just
          // before the media ends. Native `loop` re-decodes and can produce
          // a brief silence at wrap; a manual seek keeps playback continuous.
          const el = e.currentTarget;
          const d = el.duration;
          if (Number.isFinite(d) && d > 0 && d - el.currentTime <= 0.035) {
            restartLoop(el);
          }
        }}
        onEnded={(e) => {
          // Safety net if the timeupdate pre-empt misses (tab throttled, etc.)
          restartLoop(e.currentTarget);
        }}
        onPlaying={(e) => { lastProgressRef.current = { time: e.currentTarget.currentTime, at: performance.now() }; }}
        onStalled={(e) => { if (!needsGesture) void e.currentTarget.play().catch(() => setNeedsGesture(true)); }}
        onWaiting={(e) => { if (!needsGesture) void e.currentTarget.play().catch(() => setNeedsGesture(true)); }}
      />
      <div
        className="fixed z-40 bottom-5 right-5 select-none"
        onMouseEnter={() => setShowVolume(true)}
        onMouseLeave={() => setShowVolume(false)}
      >
        <div className="flex items-center gap-2 rounded-full border border-white/10 bg-black/70 backdrop-blur px-3 py-2 text-xs font-mono uppercase tracking-widest text-white/80 shadow-[0_0_24px_rgba(255,42,58,0.15)]">
          <button
            onClick={toggle}
            aria-label={blocked ? "Song is outside its scheduled hours" : muted ? "Unmute background music" : "Mute background music"}
            disabled={blocked}
            className={`flex items-center gap-2 hover:text-white transition ${needsGesture && !blocked ? "animate-pulse text-[#ff2a3a]" : ""} ${blocked ? "opacity-60 cursor-not-allowed" : "cursor-pointer"}`}
          >
            {blocked ? (
              <VolumeX className="w-3.5 h-3.5" />
            ) : needsGesture ? (
              <Play className="w-3.5 h-3.5 text-[#ff2a3a]" />
            ) : muted ? (
              <VolumeX className="w-3.5 h-3.5" />
            ) : (
              <Volume2 className="w-3.5 h-3.5 text-[#ff2a3a]" />
            )}
            <Music4 className="w-3 h-3 opacity-50" />
            <span className="max-w-[180px] truncate normal-case tracking-normal font-medium text-white/85">
              {blocked ? "Sleeping" : needsGesture ? "Tap to play" : muted ? "Tap to unmute" : trackLabel}
            </span>
          </button>
          {!blocked && !needsGesture && (
            <div
              className={`flex items-center gap-2 overflow-hidden transition-all ${showVolume ? "w-28 opacity-100 ml-1" : "w-0 opacity-0"}`}
              aria-hidden={!showVolume}
            >
              <input
                type="range"
                min={0}
                max={1}
                step={0.02}
                value={volume}
                onChange={(e) => setVolumeState(Number.parseFloat(e.target.value))}
                className="w-24 accent-[#ff2a3a] cursor-pointer"
                aria-label="Background music volume"
              />
              <span className="text-[10px] text-white/50 w-6 text-right">{Math.round(volume * 100)}</span>
            </div>
          )}
        </div>
        {blocked && (
          <div className="mt-2 text-right text-[10px] font-mono uppercase tracking-widest text-white/45">
            Plays {q.data.scheduleStart}–{q.data.scheduleEnd}
          </div>
        )}
      </div>
    </>
  );
}
