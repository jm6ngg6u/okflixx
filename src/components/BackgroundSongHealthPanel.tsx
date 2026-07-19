import { useSyncExternalStore, useEffect, useState } from "react";
import {
  getBgsHealth,
  subscribeBgsHealth,
  type BgsStatus,
} from "@/lib/background-song-health";
import { Activity, X, ChevronDown, ChevronUp } from "lucide-react";

const STORAGE_KEY = "okflix.bgs.health.show";

const statusColor: Record<BgsStatus, string> = {
  idle: "text-white/50",
  loading: "text-sky-300",
  playing: "text-emerald-400",
  paused: "text-amber-300",
  waiting: "text-amber-300",
  stalled: "text-orange-400",
  blocked: "text-white/40",
  error: "text-[#ff2a3a]",
  retrying: "text-fuchsia-300",
  out_of_schedule: "text-white/40",
};

function fmtTime(s: number) {
  if (!Number.isFinite(s) || s <= 0) return "00:00";
  const m = Math.floor(s / 60);
  const r = Math.floor(s % 60);
  return `${m.toString().padStart(2, "0")}:${r.toString().padStart(2, "0")}`;
}

export function BackgroundSongHealthPanel() {
  const [visible, setVisible] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const health = useSyncExternalStore(subscribeBgsHealth, getBgsHealth, getBgsHealth);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const check = () => {
      const q = new URLSearchParams(window.location.search);
      const flag =
        q.get("bgs-health") === "1" ||
        window.localStorage.getItem(STORAGE_KEY) === "1" ||
        window.location.pathname.startsWith("/admin");
      setVisible(flag);
    };
    check();
    window.addEventListener("popstate", check);
    return () => window.removeEventListener("popstate", check);
  }, []);

  if (!visible) return null;

  const pct =
    health.duration > 0
      ? Math.min(100, Math.max(0, (health.currentTime / health.duration) * 100))
      : 0;

  return (
    <div className="fixed z-50 bottom-5 left-5 w-[280px] font-mono text-[11px] text-white/80 select-none">
      <div className="rounded-lg border border-white/10 bg-black/80 backdrop-blur shadow-[0_0_24px_rgba(255,42,58,0.15)]">
        <div className="flex items-center gap-2 px-3 py-2 border-b border-white/10">
          <Activity className={`w-3.5 h-3.5 ${statusColor[health.status]}`} />
          <span className="uppercase tracking-widest text-[10px] text-white/60">
            Playback Health
          </span>
          <span
            className={`ml-auto uppercase tracking-widest text-[10px] ${statusColor[health.status]}`}
          >
            {health.status.replace(/_/g, " ")}
          </span>
          <button
            className="text-white/40 hover:text-white/80 transition"
            onClick={() => setCollapsed((c) => !c)}
            aria-label={collapsed ? "Expand health panel" : "Collapse health panel"}
          >
            {collapsed ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
          </button>
          <button
            className="text-white/40 hover:text-white/80 transition"
            onClick={() => {
              setVisible(false);
              if (typeof window !== "undefined")
                window.localStorage.setItem(STORAGE_KEY, "0");
            }}
            aria-label="Hide health panel"
          >
            <X className="w-3 h-3" />
          </button>
        </div>
        {!collapsed && (
          <div className="px-3 py-2 space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-white/50">Time</span>
              <span className="tabular-nums">
                {fmtTime(health.currentTime)} / {fmtTime(health.duration)}
              </span>
            </div>
            <div className="h-1 w-full bg-white/10 rounded overflow-hidden">
              <div
                className="h-full bg-[#ff2a3a] transition-all duration-300"
                style={{ width: `${pct}%` }}
              />
            </div>
            <div className="flex items-center justify-between">
              <span className="text-white/50">Stable URL</span>
              <span className={health.stableUrlActive ? "text-emerald-400" : "text-white/40"}>
                {health.stableUrlActive ? "active" : "inactive"}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-white/50">Active source</span>
              <span>#{health.activeIndex}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-white/50">Muted / Gesture</span>
              <span>
                {health.muted ? "muted" : "audible"} · {health.needsGesture ? "tap" : "auto"}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-white/50">Analyser</span>
              <span className={health.silent ? "text-orange-400" : "text-emerald-400"}>
                {health.silent ? "silent" : "signal"}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-white/50">Retries</span>
              <span className="tabular-nums">{health.retries}</span>
            </div>
            <div className="pt-1 mt-1 border-t border-white/10">
              <div className="text-white/50">Last error</div>
              <div
                className={`mt-0.5 break-words leading-snug ${health.lastError ? "text-[#ff2a3a]" : "text-white/40"}`}
              >
                {health.lastError ?? "None"}
              </div>
              {health.lastErrorAt && (
                <div className="text-white/40 mt-0.5">
                  {new Date(health.lastErrorAt).toLocaleTimeString()}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
