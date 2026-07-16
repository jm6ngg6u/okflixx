import { useMemo } from "react";
import { AlertTriangle, TrendingUp } from "lucide-react";

type Bucket = { t: number; total: number; success: number };

/**
 * Rolling anomaly detection on failure rate.
 *
 * Computes the failure rate per bucket from the aggregate series and compares
 * the most recent bucket to a trailing baseline (mean + stddev of the prior
 * N buckets). If the latest z-score exceeds ~2 AND the bucket has enough
 * samples, we surface an anomaly banner — this is adaptive and quieter than
 * a fixed threshold: it only fires when the *pattern* changes.
 */
export function AnomalyBanner({ series }: { series: Bucket[] }) {
  const anomaly = useMemo(() => {
    if (!series || series.length < 5) return null;
    const withFail = series
      .filter((b) => b.total >= 5)
      .map((b) => ({ ...b, failRate: (b.total - b.success) / b.total }));
    if (withFail.length < 4) return null;

    const latest = withFail[withFail.length - 1];
    const baseline = withFail.slice(0, -1);
    const mean = baseline.reduce((a, b) => a + b.failRate, 0) / baseline.length;
    const variance =
      baseline.reduce((a, b) => a + (b.failRate - mean) ** 2, 0) / baseline.length;
    const std = Math.sqrt(variance);
    // Guard against std=0 (constant baseline). Require ≥15pp absolute jump too
    // so a flat 0% baseline going to 1 failure doesn't fire.
    const absoluteJump = latest.failRate - mean;
    if (std < 0.02 && absoluteJump < 0.15) return null;
    const z = std > 0 ? absoluteJump / std : absoluteJump > 0.15 ? 3 : 0;
    if (z < 2) return null;

    return {
      latestPct: Math.round(latest.failRate * 100),
      baselinePct: Math.round(mean * 100),
      z: Math.round(z * 10) / 10,
      samples: latest.total,
      when: new Date(latest.t),
    };
  }, [series]);

  if (!anomaly) return null;

  return (
    <div className="glass anomaly-pulse border p-4 flex items-start gap-3 bg-amber-500/[0.06]">
      <div className="mt-0.5 shrink-0 grid place-items-center w-8 h-8 rounded-lg bg-amber-500/15 border border-amber-500/30">
        <TrendingUp className="w-4 h-4 text-amber-400" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <div className="font-ops font-semibold text-sm text-amber-200">
            Failure-rate anomaly detected
          </div>
          <span className="font-mono text-[10px] uppercase tracking-widest text-amber-400/70 px-1.5 py-0.5 rounded border border-amber-500/30">
            z = {anomaly.z.toFixed(1)}σ
          </span>
        </div>
        <div className="text-xs text-white/70 font-mono mt-1 tabular-nums">
          Latest bucket <span className="text-amber-300">{anomaly.latestPct}%</span> failures
          {" vs baseline "}
          <span className="text-white/50">{anomaly.baselinePct}%</span>
          {" · "}
          <span className="text-white/40">
            {anomaly.samples} samples · {anomaly.when.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
          </span>
        </div>
        <div className="text-[11px] text-white/40 mt-1 font-ops">
          Rolling z-score exceeded 2σ — check cookies/proxies, worker health, or a targeted abuse burst.
        </div>
      </div>
      <AlertTriangle className="w-4 h-4 text-amber-400/60 shrink-0 mt-1" />
    </div>
  );
}
