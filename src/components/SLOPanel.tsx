import { useEffect, useState } from "react";
import { Target, Settings2 } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const SLO_KEY = "emberlord.dashboard.slo";
const DEFAULT_SLO = { targetPct: 85 }; // configurable per-admin

function loadSLO(): { targetPct: number } {
  if (typeof window === "undefined") return DEFAULT_SLO;
  try {
    const raw = localStorage.getItem(SLO_KEY);
    if (!raw) return DEFAULT_SLO;
    return { ...DEFAULT_SLO, ...JSON.parse(raw) };
  } catch { return DEFAULT_SLO; }
}
function saveSLO(v: { targetPct: number }) {
  try { localStorage.setItem(SLO_KEY, JSON.stringify(v)); } catch { /* noop */ }
}

/**
 * SLO / error-budget panel.
 * ------------------------------------------------------------------
 * Given a target success rate (e.g. 85%), the "error budget" for the
 * current window is (1 - target) * total attempts. Current failures are
 * counted against that budget.
 *   - budgetRemaining  = allowedFails - actualFails
 *   - burnPct          = actualFails / allowedFails * 100
 *   - state            = healthy | burning | breached
 * Also projects when the budget will run out at current failure rate.
 */
export function SLOPanel({
  successCount, totalCount, windowHours,
}: {
  successCount: number;
  totalCount: number;
  windowHours: number;
}) {
  const [slo, setSLO] = useState(() => loadSLO());
  useEffect(() => { saveSLO(slo); }, [slo]);

  const target = slo.targetPct / 100;
  const currentRate = totalCount ? successCount / totalCount : 1;
  const failCount = Math.max(0, totalCount - successCount);
  const allowedFails = Math.max(0, target < 1 ? totalCount * (1 - target) : 0);
  const budgetRemaining = allowedFails - failCount;
  const burnPct = allowedFails > 0 ? (failCount / allowedFails) * 100 : failCount > 0 ? 100 : 0;

  let state: "healthy" | "burning" | "breached";
  if (currentRate >= target) state = "healthy";
  else if (burnPct < 200) state = "burning";
  else state = "breached";

  const stateStyle = {
    healthy:  { label: "Healthy",  color: "#22c55e", tone: "text-emerald-400", ring: "slo-ring-good" },
    burning:  { label: "Burning",  color: "#f59e0b", tone: "text-amber-400",   ring: "slo-ring-warn" },
    breached: { label: "Breached", color: "#ff2a3a", tone: "text-[#ff8a90]",   ring: "slo-ring-bad"  },
  }[state];

  // Ring: percentage of budget consumed, capped at 100
  const consumedPct = Math.min(100, Math.max(0, burnPct));
  const R = 34;
  const CIRC = 2 * Math.PI * R;
  const dash = (consumedPct / 100) * CIRC;

  // Time to budget exhaustion at current failure rate (linear projection)
  const failsPerHour = failCount / Math.max(0.01, windowHours);
  const hoursToBreach =
    state === "breached" ? 0
    : budgetRemaining > 0 && failsPerHour > 0
      ? budgetRemaining / failsPerHour
      : Infinity;

  return (
    <div className="glass p-5 relative">
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-2">
          <Target className={`w-4 h-4 ${stateStyle.tone}`} />
          <div>
            <div className="font-mono text-[10px] uppercase tracking-[0.3em] text-white/40">// Reliability</div>
            <div className="font-display text-lg">SLO — success target</div>
          </div>
        </div>
        <Popover>
          <PopoverTrigger asChild>
            <button
              title="Configure SLO target"
              className="h-7 w-7 rounded-md border border-white/10 bg-white/[0.03] hover:bg-white/[0.06] inline-flex items-center justify-center"
            >
              <Settings2 className="w-3.5 h-3.5 text-white/50" />
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-64 bg-black/95 backdrop-blur border-white/10">
            <div className="space-y-3">
              <div className="font-display text-sm">SLO target</div>
              <div>
                <Label className="text-[10px] uppercase tracking-widest text-white/50">
                  Target success rate (%)
                </Label>
                <Input
                  type="number" min={50} max={100}
                  value={slo.targetPct}
                  onChange={(e) => {
                    const v = Math.max(50, Math.min(100, Number(e.target.value) || 0));
                    setSLO({ targetPct: v });
                  }}
                  className="bg-white/5 border-white/10 font-mono h-8 mt-1 tabular-nums"
                />
                <div className="text-[10px] text-white/40 mt-1 font-mono">
                  Error budget = (100 − target) × attempts
                </div>
              </div>
            </div>
          </PopoverContent>
        </Popover>
      </div>

      <div className="grid grid-cols-[auto_1fr] gap-4 items-center">
        {/* Ring */}
        <div className="relative w-[86px] h-[86px]">
          <svg viewBox="0 0 80 80" className="w-full h-full -rotate-90">
            <circle cx="40" cy="40" r={R} fill="none" strokeWidth="6" className="slo-ring-track" />
            <circle
              cx="40" cy="40" r={R} fill="none" strokeWidth="6"
              className={stateStyle.ring}
              strokeDasharray={`${dash} ${CIRC - dash}`}
              strokeLinecap="round"
              style={{ transition: "stroke-dasharray 0.4s ease" }}
            />
          </svg>
          <div className="absolute inset-0 grid place-items-center">
            <div className="text-center">
              <div className={`font-display text-xl leading-none tabular-nums ${stateStyle.tone}`}>
                {Math.round(currentRate * 100)}%
              </div>
              <div className="text-[9px] font-mono uppercase tracking-widest text-white/40 mt-0.5">
                / {slo.targetPct}%
              </div>
            </div>
          </div>
        </div>

        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className={`text-[10px] font-mono uppercase tracking-widest px-2 py-0.5 rounded border`}
                  style={{ borderColor: `${stateStyle.color}55`, color: stateStyle.color, background: `${stateStyle.color}10` }}>
              {stateStyle.label}
            </span>
            <span className="text-[11px] font-mono text-white/40 tabular-nums">
              burn {Math.round(burnPct)}%
            </span>
          </div>
          <div className="mt-2 text-[11px] font-ops text-white/70 tabular-nums">
            {failCount} fails · budget {Math.max(0, Math.floor(allowedFails))} · left {Math.max(0, Math.floor(budgetRemaining))}
          </div>
          <div className="mt-1 text-[11px] font-mono text-white/40 tabular-nums">
            {state === "breached"
              ? "Budget exceeded"
              : Number.isFinite(hoursToBreach)
                ? `~${hoursToBreach < 1 ? `${Math.round(hoursToBreach * 60)}m` : `${hoursToBreach.toFixed(1)}h`} until breach at current rate`
                : "No burn — budget stable"}
          </div>
          {/* Burn bar */}
          <div className="mt-3 h-1.5 rounded-full bg-white/5 overflow-hidden">
            <div
              className="h-full rounded-full transition-all"
              style={{ width: `${Math.min(100, burnPct)}%`, background: stateStyle.color }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
