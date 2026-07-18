import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  getBackgroundSongAdmin,
  setBackgroundSongEnabled,
  removeBackgroundSong,
  setBackgroundSongReactive,
  setBackgroundSongSchedule,
  setBackgroundSongIntensity,
  setBackgroundSongSensitivity,
  setBackgroundSongTrackTitle,
  listBackgroundSongHistory,
  restoreBackgroundSong,
  deleteBackgroundSongVersion,
  getBackgroundSongAnalytics,
  getPlaybackTelemetry,
} from "@/lib/background-song.functions";
import { isQuietHours } from "@/lib/quiet-hours";
import { setIntensity as setEngineIntensity, setSensitivity as setEngineSensitivity } from "@/lib/audio-reactive";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Slider } from "@/components/ui/slider";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Music4, Upload, Trash2, Play, Pause, CheckCircle2, AlertCircle, Loader2, Activity,
  Clock, Sliders, History as HistoryIcon, BarChart3, RotateCcw, Signal, Type, Zap,
} from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/admin/background-song")({
  head: () => ({ meta: [{ title: "Background song — Emberlord Admin" }, { name: "robots", content: "noindex" }] }),
  component: BackgroundSongPage,
});

function fmtSize(n: number) {
  if (!n) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}
function fmtDate(iso: string) {
  if (!iso) return "—";
  try { return new Date(iso).toLocaleString(); } catch { return iso; }
}

type UploadStatus = "idle" | "reading" | "uploading" | "success" | "error";

function BackgroundSongPage() {
  // ---- server fn refs -----------------------------------------------------
  const fetchInfo = useServerFn(getBackgroundSongAdmin);
  const fetchHistory = useServerFn(listBackgroundSongHistory);
  const fetchAnalytics = useServerFn(getBackgroundSongAnalytics);
  const fetchTelemetry = useServerFn(getPlaybackTelemetry);
  const doToggle = useServerFn(setBackgroundSongEnabled);
  const doRemove = useServerFn(removeBackgroundSong);
  const doReactive = useServerFn(setBackgroundSongReactive);
  const doSchedule = useServerFn(setBackgroundSongSchedule);
  const doIntensity = useServerFn(setBackgroundSongIntensity);
  const doSensitivity = useServerFn(setBackgroundSongSensitivity);
  const doTitle = useServerFn(setBackgroundSongTrackTitle);
  const doRestore = useServerFn(restoreBackgroundSong);
  const doDelete = useServerFn(deleteBackgroundSongVersion);
  const qc = useQueryClient();

  const info = useQuery({ queryKey: ["bg-song-admin"], queryFn: () => fetchInfo(), refetchInterval: 15_000 });
  const history = useQuery({ queryKey: ["bg-song-history"], queryFn: () => fetchHistory() });
  const analytics = useQuery({ queryKey: ["bg-song-analytics"], queryFn: () => fetchAnalytics(), refetchInterval: 30_000 });
  const telemetry = useQuery({
    queryKey: ["bg-song-telemetry"],
    queryFn: () => fetchTelemetry(),
    refetchInterval: 2_000,
    refetchIntervalInBackground: false,
  });

  const invalidateAll = () => {
    qc.invalidateQueries({ queryKey: ["bg-song-admin"] });
    qc.invalidateQueries({ queryKey: ["bg-song-history"] });
    qc.invalidateQueries({ queryKey: ["bg-song-analytics"] });
    qc.invalidateQueries({ queryKey: ["background-song-public"] });
  };

  // ---- mutations ----------------------------------------------------------
  const toggleMut = useMutation({
    mutationFn: (enabled: boolean) => doToggle({ data: { enabled } }),
    onSuccess: (r: any) => {
      toast.success(r.enabled ? "Background music turned ON" : "Background music turned OFF");
      invalidateAll();
    },
    onError: (e: any) => toast.error(e?.message ?? "Toggle failed"),
  });
  const removeMut = useMutation({
    mutationFn: () => doRemove(),
    onSuccess: () => { toast.success("Song removed"); invalidateAll(); },
    onError: (e: any) => toast.error(e?.message ?? "Remove failed"),
  });
  const reactiveMut = useMutation({
    mutationFn: (reactive: boolean) => doReactive({ data: { reactive } }),
    onSuccess: (r: any) => {
      toast.success(r.reactive ? "Audio-reactive background ON" : "Audio-reactive background OFF");
      invalidateAll();
    },
    onError: (e: any) => toast.error(e?.message ?? "Toggle failed"),
  });
  const scheduleMut = useMutation({
    mutationFn: (v: { enabled: boolean; start: string; end: string }) => doSchedule({ data: v }),
    onSuccess: (r: any) => {
      toast.success(r.enabled ? `Schedule saved: ${r.start}–${r.end}` : "Schedule disabled — plays 24/7");
      invalidateAll();
    },
    onError: (e: any) => toast.error(e?.message ?? "Save failed"),
  });
  const intensityMut = useMutation({
    mutationFn: (intensity: number) => doIntensity({ data: { intensity } }),
    onSuccess: () => { invalidateAll(); },
    onError: (e: any) => toast.error(e?.message ?? "Save failed"),
  });
  const sensitivityMut = useMutation({
    mutationFn: (sensitivity: number) => doSensitivity({ data: { sensitivity } }),
    onSuccess: () => { invalidateAll(); },
    onError: (e: any) => toast.error(e?.message ?? "Save failed"),
  });
  const titleMut = useMutation({
    mutationFn: (title: string) => doTitle({ data: { title } }),
    onSuccess: (r: any) => { toast.success(r.title ? "Track title saved" : "Track title cleared"); invalidateAll(); },
    onError: (e: any) => toast.error(e?.message ?? "Save failed"),
  });
  const restoreMut = useMutation({
    mutationFn: (id: string) => doRestore({ data: { id } }),
    onSuccess: (r: any) => { toast.success(`Restored ${r.name}`); invalidateAll(); },
    onError: (e: any) => toast.error(e?.message ?? "Restore failed"),
  });
  const deleteVerMut = useMutation({
    mutationFn: (id: string) => doDelete({ data: { id } }),
    onSuccess: () => { toast.success("Version deleted"); invalidateAll(); },
    onError: (e: any) => toast.error(e?.message ?? "Delete failed"),
  });

  // ---- local editable UI state (kept in sync w/ server) -------------------
  const [scheduleEnabled, setScheduleEnabled] = useState(false);
  const [scheduleStart, setScheduleStart] = useState("00:00");
  const [scheduleEnd, setScheduleEnd] = useState("23:59");
  const [intensity, setIntensity] = useState(1);
  const [sensitivity, setSensitivity] = useState(1);
  const [trackTitleDraft, setTrackTitleDraft] = useState("");

  useEffect(() => {
    if (!info.data) return;
    setScheduleEnabled(info.data.scheduleEnabled);
    setScheduleStart(info.data.scheduleStart);
    setScheduleEnd(info.data.scheduleEnd);
    setIntensity(info.data.intensity);
    setSensitivity(info.data.sensitivity);
    setTrackTitleDraft(info.data.trackTitle);
  }, [info.data]);

  // Preview audio (existing).
  const previewRef = useRef<HTMLAudioElement | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

  // Upload state.
  const [uploadStatus, setUploadStatus] = useState<UploadStatus>("idle");
  const [uploadPct, setUploadPct] = useState(0);
  const [uploadMsg, setUploadMsg] = useState("");
  const [uploadName, setUploadName] = useState("");
  const [uploadSize, setUploadSize] = useState(0);
  const [uploadError, setUploadError] = useState("");

  const handleUpload = async (file: File) => {
    setUploadError("");
    setUploadName(file.name);
    setUploadSize(file.size);
    setUploadPct(0);
    setUploadStatus("reading");
    setUploadMsg("Preparing file…");

    if (!file.type.startsWith("audio/") && !/\.(mp3|wav|ogg|m4a|aac|flac)$/i.test(file.name)) {
      setUploadStatus("error"); setUploadError("File must be audio (mp3, wav, ogg, m4a, aac, flac).");
      toast.error("Not an audio file"); return;
    }
    if (file.size > 15 * 1024 * 1024) {
      setUploadStatus("error"); setUploadError("File is larger than 15 MB.");
      toast.error("File too large"); return;
    }

    const { data: sess } = await supabase.auth.getSession();
    const token = sess?.session?.access_token;
    if (!token) { setUploadStatus("error"); setUploadError("Session expired. Please sign in again."); return; }

    const form = new FormData();
    form.append("file", file);
    await new Promise<void>((resolve) => {
      const xhr = new XMLHttpRequest();
      xhr.open("POST", "/api/admin/upload-background-song");
      xhr.setRequestHeader("Authorization", `Bearer ${token}`);
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) {
          const pct = Math.round((e.loaded / e.total) * 100);
          setUploadPct(pct); setUploadStatus("uploading");
          setUploadMsg(pct >= 100 ? "Finalizing on server…" : `Uploading… ${pct}%`);
        }
      };
      xhr.onerror = () => { setUploadStatus("error"); setUploadError("Network error during upload."); toast.error("Upload failed"); resolve(); };
      xhr.onload = () => {
        try {
          const res = JSON.parse(xhr.responseText || "{}");
          if (xhr.status >= 200 && xhr.status < 300 && res.ok) {
            setUploadStatus("success"); setUploadPct(100);
            setUploadMsg("Upload complete · New track live on the public site.");
            toast.success("New background song uploaded", { description: `${res.name} · ${fmtSize(res.size)}` });
            invalidateAll();
          } else {
            setUploadStatus("error");
            const label = res.error === "file_too_large" ? "File too large (max 15 MB)"
              : res.error === "not_audio" ? "File is not audio"
              : res.error === "forbidden" ? "You are not authorized"
              : res.error === "unauthorized" ? "Session expired"
              : res.detail || res.error || `Upload failed (${xhr.status})`;
            setUploadError(label); toast.error("Upload failed", { description: label });
          }
        } catch { setUploadStatus("error"); setUploadError("Unexpected server response."); toast.error("Upload failed"); }
        resolve();
      };
      xhr.send(form);
    });
  };

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) handleUpload(f);
    if (fileRef.current) fileRef.current.value = "";
  };

  const togglePreview = () => {
    const el = previewRef.current;
    if (!el) return;
    if (el.paused) { el.play().then(() => setPreviewing(true)).catch(() => {}); }
    else { el.pause(); setPreviewing(false); }
  };

  const d = info.data;
  const scheduleDirty = !!d && (
    d.scheduleEnabled !== scheduleEnabled ||
    d.scheduleStart !== scheduleStart ||
    d.scheduleEnd !== scheduleEnd
  );
  // Match server normalization: strip control/zero-width, collapse whitespace, trim, cap.
  const normalizeTitle = (raw: string) => raw
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001F\u007F\u200B-\u200D\uFEFF]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
  const normalizedTitleDraft = normalizeTitle(trackTitleDraft);
  const titleDirty = !!d && d.trackTitle !== normalizedTitleDraft;
  const titleCharCount = normalizedTitleDraft.length;
  const fileFallback = d?.name?.replace(/\.[a-z0-9]+$/i, "") || "Background";
  const titlePreview = normalizedTitleDraft || fileFallback;
  const saveTitle = () => {
    if (!titleDirty || titleMut.isPending) return;
    titleMut.mutate(normalizedTitleDraft);
  };

  // ---- Schedule validation + live-status helpers ------------------------
  const HHMM_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
  const startValid = HHMM_RE.test(scheduleStart);
  const endValid = HHMM_RE.test(scheduleEnd);
  const sameTimeError = scheduleEnabled && scheduleStart === scheduleEnd;
  const scheduleError = !startValid || !endValid
    ? "Times must be HH:MM (00:00–23:59)."
    : sameTimeError
      ? "Start and end cannot be identical while the schedule is on."
      : "";

  const [scheduleTick, setScheduleTick] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setScheduleTick((t) => t + 1), 30_000);
    return () => window.clearInterval(id);
  }, []);
  const scheduleLive = useMemo(() => {
    void scheduleTick;
    if (!scheduleEnabled || !startValid || !endValid || sameTimeError) {
      return { inWindow: true, nextLabel: "24/7", nextMinutes: 0 };
    }
    const parse = (v: string) => {
      const [h, m] = v.split(":").map(Number);
      return h * 60 + m;
    };
    const s = parse(scheduleStart);
    const e = parse(scheduleEnd);
    const now = new Date();
    const cur = now.getHours() * 60 + now.getMinutes();
    const inW = s < e
      ? cur >= s && cur <= e
      : cur >= s || cur <= e;
    // Minutes until next transition (start when out, end+1 when in).
    const target = inW ? (e + 1) % 1440 : s;
    let delta = target - cur;
    if (delta <= 0) delta += 1440;
    const hrs = Math.floor(delta / 60);
    const mins = delta % 60;
    const label = hrs > 0 ? `${hrs}h ${mins}m` : `${mins}m`;
    return { inWindow: inW, nextLabel: label, nextMinutes: delta };
  }, [scheduleTick, scheduleEnabled, scheduleStart, scheduleEnd, startValid, endValid, sameTimeError]);

  const applyPreset = (start: string, end: string) => {
    setScheduleEnabled(true);
    setScheduleStart(start);
    setScheduleEnd(end);
  };

  return (
    <div className="space-y-6 pb-16">
      {/* Header */}
      <div className="flex items-start gap-3">
        <div className="w-11 h-11 rounded-lg bg-gradient-to-br from-[#ff2a3a]/20 to-[#b0060f]/10 border border-[#ff2a3a]/20 flex items-center justify-center">
          <Music4 className="w-5 h-5 text-[#ff2a3a]" />
        </div>
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.3em] text-[#ff2a3a] mb-1">// Audio</div>
          <h1 className="font-display text-3xl md:text-4xl leading-none">Background song</h1>
          <p className="text-sm text-white/50 mt-2 max-w-2xl">
            Every change on this page rolls out to the public site within seconds — no reload needed.
            Toggle playback, tune the reactive engine, schedule quiet hours, roll back to older tracks, and watch live analytics.
          </p>
        </div>
      </div>

      {/* Status + master toggle */}
      <div className="glass p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-md bg-white/5 border border-white/10 flex items-center justify-center">
              <Music4 className="w-4 h-4 text-[#ff2a3a]" />
            </div>
            <div>
              <div className="font-display text-lg leading-tight">Playback status</div>
              <div className="text-xs text-white/50 mt-1">Autoplays muted when the browser blocks sound, then unmutes on the first click.</div>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <LiveHealthPill enabled={!!d?.enabled} t={telemetry.data} />
            <Switch checked={!!d?.enabled} disabled={toggleMut.isPending || !d?.path} onCheckedChange={(v) => toggleMut.mutate(v)} />
          </div>
        </div>

        <div className="mt-5 grid sm:grid-cols-3 gap-3">
          <StatBlock label="Current track" value={d?.trackTitle?.trim() || d?.name || "—"} mono />
          <StatBlock label="File size" value={fmtSize(d?.sizeBytes ?? 0)} />
          <StatBlock label="Last updated" value={fmtDate(d?.updatedAt ?? "")} />
        </div>

        <LivePlaybackTelemetry
          t={telemetry.data}
          loading={telemetry.isLoading}
          fetching={telemetry.isFetching}
          generatedAt={telemetry.data?.generatedAt ?? null}
          scheduleEnabled={!!d?.scheduleEnabled}
          quietStart={d?.scheduleStart ?? ""}
          quietEnd={d?.scheduleEnd ?? ""}
        />

        {d?.previewUrl && (
          <div className="mt-4 flex items-center gap-3 rounded-md border border-white/10 bg-white/[0.02] p-3">
            <audio ref={previewRef} src={d.previewUrl} onEnded={() => setPreviewing(false)} preload="none" crossOrigin="anonymous" />
            <Button size="sm" variant="outline" onClick={togglePreview} className="border-white/15 bg-white/5">
              {previewing ? <Pause className="w-3.5 h-3.5 mr-1.5" /> : <Play className="w-3.5 h-3.5 mr-1.5" />}
              {previewing ? "Pause preview" : "Preview"}
            </Button>
            <span className="text-[11px] text-white/40 font-mono">Admin preview only · not affecting public site.</span>
          </div>
        )}

        {!d?.path && (
          <div className="mt-4 rounded-md border border-amber-500/30 bg-amber-500/10 text-amber-200 text-xs p-3">
            No song uploaded yet. Upload one below to enable background music.
          </div>
        )}
      </div>

      {/* Audio-reactive controls */}
      <div className="glass p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-md bg-white/5 border border-white/10 flex items-center justify-center">
              <Activity className={`w-4 h-4 ${d?.reactive ? "text-[#ff2a3a]" : "text-white/40"}`} />
            </div>
            <div>
              <div className="font-display text-lg leading-tight">Audio-reactive background</div>
              <div className="text-xs text-white/50 mt-1 max-w-xl">
                Beams glow and pulse to the music via the Web Audio analyser.
                Falls back to STATIC automatically when a visitor has reduced-motion enabled or when audio analysis is blocked.
              </div>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Badge variant="outline" className={d?.reactive
              ? "bg-[#ff2a3a]/15 text-[#ff2a3a] border-[#ff2a3a]/30"
              : "bg-white/10 text-white/60 border-white/15"}>
              {d?.reactive ? "REACTIVE" : "STATIC"}
            </Badge>
            <Switch checked={!!d?.reactive} disabled={reactiveMut.isPending} onCheckedChange={(v) => reactiveMut.mutate(v)} />
          </div>
        </div>

        <div className="mt-5 grid md:grid-cols-2 gap-5">
          <SliderRow
            icon={<Zap className="w-3.5 h-3.5 text-[#ff2a3a]" />}
            title="Beam intensity"
            hint="Overall glow / brightness multiplier applied to reactive layers."
            value={intensity}
            display={`${intensity.toFixed(2)}×`}
            onChange={(v) => { setIntensity(v); setEngineIntensity(v); }}
            onCommit={(v) => intensityMut.mutate(v)}
            saving={intensityMut.isPending}
          />
          <SliderRow
            icon={<Signal className="w-3.5 h-3.5 text-[#ff2a3a]" />}
            title="Bass sensitivity"
            hint="How strongly the analyser reacts to bass and volume peaks."
            value={sensitivity}
            display={`${sensitivity.toFixed(2)}×`}
            onChange={(v) => { setSensitivity(v); setEngineSensitivity(v); }}
            onCommit={(v) => sensitivityMut.mutate(v)}
            saving={sensitivityMut.isPending}
          />
        </div>
      </div>

      {/* Schedule */}
      <div className="glass p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-md bg-white/5 border border-white/10 flex items-center justify-center">
              <Clock className={`w-4 h-4 ${scheduleEnabled ? "text-[#ff2a3a]" : "text-white/40"}`} />
            </div>
            <div>
              <div className="font-display text-lg leading-tight">Schedule window</div>
              <div className="text-xs text-white/50 mt-1 max-w-xl">
                Play only during selected hours (visitor's local time). Outside the window the chip shows "Sleeping" and no audio loads.
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap justify-end">
            {scheduleEnabled && !scheduleError && (
              <Badge variant="outline" className={scheduleLive.inWindow
                ? "bg-emerald-500/15 text-emerald-300 border-emerald-500/30 font-mono text-[10px] uppercase tracking-widest"
                : "bg-white/5 text-white/50 border-white/15 font-mono text-[10px] uppercase tracking-widest"}>
                {scheduleLive.inWindow ? "IN WINDOW" : "SLEEPING"}
              </Badge>
            )}
            <Badge variant="outline" className={scheduleEnabled
              ? "bg-[#ff2a3a]/15 text-[#ff2a3a] border-[#ff2a3a]/30 font-mono text-[10px] uppercase tracking-widest"
              : "bg-white/10 text-white/60 border-white/15 font-mono text-[10px] uppercase tracking-widest"}>
              {scheduleEnabled ? "ACTIVE" : "24/7"}
            </Badge>
            <Switch checked={scheduleEnabled} onCheckedChange={setScheduleEnabled} />
          </div>
        </div>

        {/* Presets */}
        <div className="mt-4 flex flex-wrap gap-2">
          {[
            { label: "24/7", start: "00:00", end: "23:59", off: true },
            { label: "Daytime 09–17", start: "09:00", end: "17:00" },
            { label: "Evening 18–22", start: "18:00", end: "22:00" },
            { label: "Night 22–06", start: "22:00", end: "06:00" },
          ].map((p) => {
            const active = p.off
              ? !scheduleEnabled
              : scheduleEnabled && scheduleStart === p.start && scheduleEnd === p.end;
            return (
              <button
                key={p.label}
                type="button"
                onClick={() => {
                  if (p.off) { setScheduleEnabled(false); return; }
                  applyPreset(p.start, p.end);
                }}
                className={`px-2.5 py-1 rounded-md border font-mono text-[10px] uppercase tracking-widest transition ${
                  active
                    ? "bg-[#ff2a3a]/15 text-[#ff2a3a] border-[#ff2a3a]/40"
                    : "bg-white/[0.03] text-white/60 border-white/10 hover:bg-white/[0.06] hover:text-white/80"
                }`}
              >
                {p.label}
              </button>
            );
          })}
        </div>

        <div className="mt-5 grid sm:grid-cols-3 gap-3 items-end">
          <div>
            <Label htmlFor="bg-start" className="text-[10px] font-mono uppercase tracking-widest text-white/40">Start</Label>
            <Input id="bg-start" type="time" value={scheduleStart} onChange={(e) => setScheduleStart(e.target.value)}
              disabled={!scheduleEnabled}
              className={`mt-1 bg-white/5 border-white/10 ${!startValid ? "border-[#ff2a3a]/50" : ""}`} />
          </div>
          <div>
            <Label htmlFor="bg-end" className="text-[10px] font-mono uppercase tracking-widest text-white/40">End</Label>
            <Input id="bg-end" type="time" value={scheduleEnd} onChange={(e) => setScheduleEnd(e.target.value)}
              disabled={!scheduleEnabled}
              className={`mt-1 bg-white/5 border-white/10 ${!endValid || sameTimeError ? "border-[#ff2a3a]/50" : ""}`} />
          </div>
          <Button
            className="btn-red"
            disabled={!scheduleDirty || scheduleMut.isPending || !!scheduleError}
            onClick={() => scheduleMut.mutate({ enabled: scheduleEnabled, start: scheduleStart, end: scheduleEnd })}
          >
            {scheduleMut.isPending ? <><Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> Saving…</> : "Save schedule"}
          </Button>
        </div>

        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-[11px] font-mono">
          <span className="text-white/40">Wraps midnight when end is earlier than start (e.g. 22:00 → 06:00).</span>
          {scheduleEnabled && !scheduleError && (
            <span className="text-white/60">
              {scheduleLive.inWindow ? "Ends in " : "Starts in "}
              <span className="text-[#ff2a3a]">{scheduleLive.nextLabel}</span>
            </span>
          )}
        </div>
        {scheduleError && (
          <div className="mt-2 text-[11px] font-mono text-[#ff2a3a]">{scheduleError}</div>
        )}
      </div>

      {/* Track title / preview mode */}
      <div className="glass p-5">
        <div className="flex items-start gap-3 mb-4">
          <Type className="w-4 h-4 text-[#ff2a3a] mt-1" />
          <div className="flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <div className="font-display text-lg leading-tight">Public track name</div>
              <Badge variant="outline" className={normalizedTitleDraft
                ? "bg-emerald-500/15 text-emerald-300 border-emerald-500/30 font-mono text-[10px] uppercase tracking-widest"
                : "bg-white/10 text-white/60 border-white/15 font-mono text-[10px] uppercase tracking-widest"}>
                {normalizedTitleDraft ? "CUSTOM" : "USING FILE NAME"}
              </Badge>
            </div>
            <div className="text-xs text-white/50 mt-1 max-w-xl">
              Shown in the floating chip on the public site so visitors can read what's playing. Leave blank to fall back to the file name.
            </div>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <Input
            value={trackTitleDraft}
            onChange={(e) => setTrackTitleDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); saveTitle(); }
              if (e.key === "Escape" && d) { setTrackTitleDraft(d.trackTitle); }
            }}
            placeholder={`e.g. ${fileFallback}`}
            aria-label="Public track name"
            className="flex-1 min-w-[220px] bg-white/5 border-white/10"
            maxLength={120}
          />
          <Button
            variant="outline"
            className="border-white/10 bg-white/5 hover:bg-white/10"
            disabled={!trackTitleDraft || titleMut.isPending}
            onClick={() => setTrackTitleDraft("")}
            title="Clear to use the file name"
          >
            Clear
          </Button>
          <Button className="btn-red" disabled={!titleDirty || titleMut.isPending} onClick={saveTitle}>
            {titleMut.isPending ? <><Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> Saving…</> : "Save name"}
          </Button>
        </div>

        <div className="mt-2 flex items-center justify-between text-[11px] font-mono text-white/40">
          <span>Enter to save · Esc to revert · control chars stripped, whitespace collapsed.</span>
          <span className={titleCharCount >= 110 ? "text-[#ff2a3a]" : ""}>{titleCharCount}/120</span>
        </div>

        {/* Live chip preview — mirrors the public floating chip */}
        <div className="mt-4">
          <div className="font-mono text-[10px] uppercase tracking-[0.3em] text-white/40 mb-2">// Live preview</div>
          <div className="rounded-xl border border-white/10 bg-gradient-to-br from-white/[0.03] to-transparent p-4">
            <div className="inline-flex items-center gap-2 rounded-full border border-[#ff2a3a]/30 bg-black/60 backdrop-blur px-3 py-1.5 shadow-[0_0_24px_rgba(255,42,58,0.15)]">
              <Music4 className="w-3.5 h-3.5 text-[#ff2a3a]" />
              <span className="font-mono text-[11px] tracking-wide text-white/90 truncate max-w-[280px]">
                {titlePreview}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Live diagnostics */}
      {d?.previewUrl && (
        <LiveDiagnostics
          url={d.previewUrl}
          intensity={intensity}
          sensitivity={sensitivity}
        />
      )}

      {/* Upload */}
      <div className="glass p-5">
        <div className="flex items-start gap-3 mb-4">
          <Upload className="w-4 h-4 text-[#ff2a3a] mt-1" />
          <div>
            <div className="font-display text-lg leading-tight">Upload new track</div>
            <div className="text-xs text-white/50 mt-1">Max 15 MB · mp3 / wav / ogg / m4a / aac / flac. The new file replaces the current track and is added to version history.</div>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <input ref={fileRef} type="file" accept="audio/*,.mp3,.wav,.ogg,.m4a,.aac,.flac" className="hidden" onChange={onFileChange} />
          <Button className="btn-red" disabled={uploadStatus === "uploading" || uploadStatus === "reading"}
            onClick={() => fileRef.current?.click()}>
            {uploadStatus === "uploading" || uploadStatus === "reading" ? (
              <><Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> Uploading…</>
            ) : (
              <><Upload className="w-3.5 h-3.5 mr-1.5" /> Choose audio file</>
            )}
          </Button>
          {d?.path && (
            <Button variant="outline" className="border-white/15 bg-white/5 text-red-200 hover:text-red-100"
              disabled={removeMut.isPending}
              onClick={() => { if (confirm("Remove the current background song? The public site will go silent (previous versions kept in history).")) removeMut.mutate(); }}>
              {removeMut.isPending ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5 mr-1.5" />}
              Remove current song
            </Button>
          )}
        </div>

        {uploadStatus !== "idle" && (
          <div className={`mt-4 rounded-md border p-3 ${
            uploadStatus === "success" ? "border-emerald-500/30 bg-emerald-500/10"
            : uploadStatus === "error" ? "border-red-500/30 bg-red-500/10"
            : "border-white/10 bg-white/[0.02]"
          }`}>
            <div className="flex items-center gap-2 text-sm">
              {uploadStatus === "success" && <CheckCircle2 className="w-4 h-4 text-emerald-300" />}
              {uploadStatus === "error" && <AlertCircle className="w-4 h-4 text-red-300" />}
              {(uploadStatus === "uploading" || uploadStatus === "reading") && <Loader2 className="w-4 h-4 animate-spin text-[#ff2a3a]" />}
              <span className={
                uploadStatus === "success" ? "text-emerald-200"
                : uploadStatus === "error" ? "text-red-200"
                : "text-white/80"
              }>
                {uploadStatus === "error" ? uploadError || "Upload failed" : uploadMsg}
              </span>
            </div>
            {uploadName && (
              <div className="mt-1 text-[11px] text-white/50 font-mono">{uploadName} · {fmtSize(uploadSize)}</div>
            )}
            {(uploadStatus === "uploading" || uploadStatus === "reading" || uploadStatus === "success") && (
              <div className="mt-2">
                <Progress value={uploadStatus === "success" ? 100 : uploadPct} className="h-1.5" />
                <div className="mt-1 text-[10px] font-mono text-white/40 uppercase tracking-widest">
                  {uploadStatus === "success" ? "100% · Complete" : `${uploadPct}%`}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Version history */}
      <div className="glass p-5">
        <div className="flex items-start gap-3 mb-4">
          <HistoryIcon className="w-4 h-4 text-[#ff2a3a] mt-1" />
          <div>
            <div className="font-display text-lg leading-tight">Version history</div>
            <div className="text-xs text-white/50 mt-1 max-w-xl">
              Every upload is kept so you can roll back or clean up. The current track is highlighted and can't be deleted directly — restore another version first.
            </div>
          </div>
        </div>
        {history.isLoading ? (
          <div className="text-xs text-white/40 font-mono">Loading history…</div>
        ) : (history.data?.length ?? 0) === 0 ? (
          <div className="text-xs text-white/40 font-mono">No previous uploads yet.</div>
        ) : (
          <div className="divide-y divide-white/5 border border-white/5 rounded-md overflow-hidden">
            {history.data!.map((row) => (
              <div key={row.id} className={`flex flex-wrap items-center gap-3 p-3 ${row.isCurrent ? "bg-[#ff2a3a]/[0.06]" : "bg-white/[0.02]"}`}>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-sm text-white/90 truncate">{row.name}</span>
                    {row.isCurrent && <Badge variant="outline" className="bg-[#ff2a3a]/15 text-[#ff2a3a] border-[#ff2a3a]/30 text-[10px]">CURRENT</Badge>}
                  </div>
                  <div className="mt-1 text-[11px] font-mono text-white/40 truncate">
                    {fmtSize(row.sizeBytes)} · {fmtDate(row.uploadedAt)} · {row.uploaderLabel}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Button size="sm" variant="outline" className="border-white/15 bg-white/5"
                    disabled={row.isCurrent || restoreMut.isPending}
                    onClick={() => restoreMut.mutate(row.id)}>
                    <RotateCcw className="w-3.5 h-3.5 mr-1.5" /> Restore
                  </Button>
                  <Button size="sm" variant="outline" className="border-white/15 bg-white/5 text-red-200 hover:text-red-100"
                    disabled={row.isCurrent || deleteVerMut.isPending}
                    onClick={() => { if (confirm(`Delete ${row.name}? This removes the file from storage permanently.`)) deleteVerMut.mutate(row.id); }}>
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Analytics */}
      <div className="glass p-5">
        <div className="flex items-start gap-3 mb-4">
          <BarChart3 className="w-4 h-4 text-[#ff2a3a] mt-1" />
          <div>
            <div className="font-display text-lg leading-tight">Analytics</div>
            <div className="text-xs text-white/50 mt-1 max-w-xl">
              Anonymous counts recorded when the song appears on a visitor's homepage. Refreshes every 30s.
            </div>
          </div>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          {[
            ["Impressions", "impression"],
            ["Autoplay unmuted", "autoplay"],
            ["Tap to play", "tap_play"],
            ["Unmute clicks", "unmute"],
            ["Out of schedule", "out_of_schedule"],
            ["Analyser silent", "silence_detected"],
          ].map(([label, key]) => (
            <AnalyticsTile key={key} label={label as string}
              v24={analytics.data?.total24h?.[key as string] ?? 0}
              v7d={analytics.data?.total7d?.[key as string] ?? 0}
            />
          ))}
        </div>
      </div>

      {/* How it plays */}
      <div className="glass p-5">
        <div className="font-display text-lg mb-2">How it plays on the public site</div>
        <ul className="text-sm text-white/70 space-y-1.5">
          <li>◆ Starts automatically when a visitor lands on the site, inside the schedule window.</li>
          <li>◆ Loops seamlessly — the moment the song ends, it restarts.</li>
          <li>◆ If the browser blocks autoplay with sound, it begins muted and unmutes on the first click or key press.</li>
          <li>◆ Visitors get a volume slider on the floating chip; their choice persists between visits.</li>
          <li>◆ Reduced-motion visitors get a STATIC background automatically — no reactive pulses.</li>
          <li>◆ If the analyser stays silent for 3s (CORS blocked, muted), reactive falls back to STATIC and a warning toast appears.</li>
        </ul>
      </div>
    </div>
  );
}

function StatBlock({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="rounded-md border border-white/10 bg-white/[0.02] p-3">
      <div className="text-[10px] uppercase tracking-widest text-white/40 font-mono">{label}</div>
      <div className={`mt-1 text-sm ${mono ? "font-mono" : ""} truncate`}>{value}</div>
    </div>
  );
}

function AnalyticsTile({ label, v24, v7d }: { label: string; v24: number; v7d: number }) {
  return (
    <div className="rounded-md border border-white/10 bg-white/[0.02] p-3">
      <div className="text-[10px] uppercase tracking-widest text-white/40 font-mono">{label}</div>
      <div className="mt-1 font-display text-2xl leading-none text-white">{v24.toLocaleString()}</div>
      <div className="mt-1 text-[10px] font-mono text-white/40">
        <span className="text-white/60">24h</span> · {v7d.toLocaleString()} <span className="text-white/40">7d</span>
      </div>
    </div>
  );
}

function SliderRow({
  icon, title, hint, value, display, onChange, onCommit, saving,
}: {
  icon: React.ReactNode; title: string; hint: string; value: number; display: string;
  onChange: (v: number) => void; onCommit: (v: number) => void; saving: boolean;
}) {
  return (
    <div className="rounded-md border border-white/10 bg-white/[0.02] p-4">
      <div className="flex items-center gap-2">
        {icon}
        <div className="font-medium text-sm">{title}</div>
        <div className="ml-auto font-mono text-xs text-[#ff2a3a]">{display}</div>
      </div>
      <div className="text-[11px] text-white/50 mt-1">{hint}</div>
      <div className="mt-3">
        <Slider
          value={[value]}
          min={0} max={3} step={0.05}
          onValueChange={(vs) => onChange(vs[0])}
          onValueCommit={(vs) => onCommit(vs[0])}
        />
        <div className="mt-1 flex justify-between text-[10px] font-mono text-white/30 uppercase tracking-widest">
          <span>Off</span><span>1×</span><span>3×</span>
        </div>
        {saving && <div className="mt-2 text-[10px] font-mono text-[#ff2a3a] flex items-center gap-1"><Loader2 className="w-3 h-3 animate-spin" /> Applying…</div>}
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------------
// Live diagnostics — self-contained analyser on an admin-only preview element
// so admins can verify the reactive engine responds to the current track.
// -----------------------------------------------------------------------------
function LiveDiagnostics({ url, intensity, sensitivity }: { url: string; intensity: number; sensitivity: number }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const dataRef = useRef<Uint8Array<ArrayBuffer> | null>(null);
  const sourceRef = useRef<MediaElementAudioSourceNode | null>(null);
  const framesRef = useRef({ frames: 0, sampleAt: 0 });

  const [playing, setPlaying] = useState(false);
  const [levels, setLevels] = useState({ bass: 0, mid: 0, treble: 0, level: 0 });
  const [fps, setFps] = useState(60);
  const [silent, setSilent] = useState<null | boolean>(null);

  const start = async () => {
    const el = audioRef.current;
    if (!el) return;
    try {
      const AC = window.AudioContext || (window as any).webkitAudioContext;
      if (!ctxRef.current) ctxRef.current = new AC();
      if (ctxRef.current.state === "suspended") await ctxRef.current.resume();
      if (!sourceRef.current) {
        sourceRef.current = ctxRef.current.createMediaElementSource(el);
        analyserRef.current = ctxRef.current.createAnalyser();
        analyserRef.current.fftSize = 512;
        analyserRef.current.smoothingTimeConstant = 0.72;
        dataRef.current = new Uint8Array(new ArrayBuffer(analyserRef.current.frequencyBinCount));
        sourceRef.current.connect(analyserRef.current);
        analyserRef.current.connect(ctxRef.current.destination);
      }

      // Ensure the media is loaded before play() so the browser doesn't abort
      // the play request with "interrupted by a new load request".
      if (el.readyState < 2) {
        await new Promise<void>((resolve, reject) => {
          const onReady = () => { cleanup(); resolve(); };
          const onError = () => { cleanup(); reject(new Error("Failed to load track")); };
          const cleanup = () => {
            el.removeEventListener("loadeddata", onReady);
            el.removeEventListener("canplay", onReady);
            el.removeEventListener("error", onError);
          };
          el.addEventListener("loadeddata", onReady, { once: true });
          el.addEventListener("canplay", onReady, { once: true });
          el.addEventListener("error", onError, { once: true });
          try { el.load(); } catch { /* noop */ }
        });
      }

      try {
        await el.play();
      } catch (err: any) {
        // Swallow benign AbortError caused by rapid load/play cycling.
        if (err?.name !== "AbortError") throw err;
      }
      setPlaying(true);
      let silenceStart = 0;
      const loop = () => {
        const analyser = analyserRef.current, data = dataRef.current;
        if (!analyser || !data) return;
        analyser.getByteFrequencyData(data);
        const bins = data.length;
        const bEnd = Math.max(1, Math.floor(bins * 0.08));
        const mEnd = Math.max(bEnd + 1, Math.floor(bins * 0.4));
        let b = 0, m = 0, t = 0;
        for (let i = 0; i < bEnd; i++) b += data[i];
        for (let i = bEnd; i < mEnd; i++) m += data[i];
        for (let i = mEnd; i < bins; i++) t += data[i];
        const s = sensitivity;
        const bass = Math.min(1, (b / (bEnd * 255)) * s);
        const mid = Math.min(1, (m / ((mEnd - bEnd) * 255)) * s);
        const treble = Math.min(1, (t / ((bins - mEnd) * 255)) * s);
        const level = Math.min(1, bass * 0.55 + mid * 0.3 + treble * 0.15);
        setLevels({ bass, mid, treble, level });

        const now = performance.now();
        const fst = framesRef.current;
        if (!fst.sampleAt) fst.sampleAt = now;
        fst.frames++;
        if (now - fst.sampleAt >= 1000) {
          setFps((fst.frames * 1000) / (now - fst.sampleAt));
          fst.frames = 0; fst.sampleAt = now;
        }

        const playing2 = !el.paused && !el.muted && el.volume > 0;
        if (playing2 && level < 0.002 && bass < 0.002) {
          if (!silenceStart) silenceStart = now;
          else if (now - silenceStart > 3000) setSilent(true);
        } else if (level > 0.01 || bass > 0.01) {
          silenceStart = 0; setSilent(false);
        }
        rafRef.current = requestAnimationFrame(loop);
      };
      rafRef.current = requestAnimationFrame(loop);
    } catch (e: any) {
      toast.error("Couldn't start diagnostics", { description: e?.message ?? "AudioContext blocked" });
    }
  };


  const stop = () => {
    const el = audioRef.current;
    if (el && !el.paused) el.pause();
    setPlaying(false);
    if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
  };

  useEffect(() => () => {
    if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    try { audioRef.current?.pause(); } catch { /* noop */ }
  }, []);

  return (
    <div className="glass p-5">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
        <div className="flex items-start gap-3">
          <Sliders className="w-4 h-4 text-[#ff2a3a] mt-1" />
          <div>
            <div className="font-display text-lg leading-tight">Live diagnostics</div>
            <div className="text-xs text-white/50 mt-1 max-w-xl">
              Runs a private analyser on your admin session so you can verify the current track drives real bass/mid/level data.
              Volume is muted to your device by default — unmute the preview element to hear it locally.
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" className="border-white/15 bg-white/5" onClick={playing ? stop : start}>
            {playing ? <><Pause className="w-3.5 h-3.5 mr-1.5" /> Stop</> : <><Play className="w-3.5 h-3.5 mr-1.5" /> Start</>}
          </Button>
        </div>
      </div>

      <audio ref={audioRef} src={url} loop preload="none" crossOrigin="anonymous" />

      <div className="grid sm:grid-cols-2 md:grid-cols-4 gap-3">
        <MeterCard label="Bass" value={levels.bass} tone="#ff2a3a" />
        <MeterCard label="Mid" value={levels.mid} tone="#ff8c9a" />
        <MeterCard label="Treble" value={levels.treble} tone="#ffffff" />
        <MeterCard label="Overall" value={levels.level} tone="#ff2a3a" strong />
      </div>

      <div className="mt-4 grid sm:grid-cols-3 gap-3 text-xs">
        <div className="rounded-md border border-white/10 bg-white/[0.02] p-3">
          <div className="font-mono uppercase tracking-widest text-white/40">Reactive FPS</div>
          <div className="font-display text-2xl mt-1">{fps.toFixed(0)}<span className="text-white/40 text-sm"> / 60</span></div>
        </div>
        <div className="rounded-md border border-white/10 bg-white/[0.02] p-3">
          <div className="font-mono uppercase tracking-widest text-white/40">Intensity applied</div>
          <div className="font-display text-2xl mt-1">{intensity.toFixed(2)}×</div>
        </div>
        <div className="rounded-md border border-white/10 bg-white/[0.02] p-3">
          <div className="font-mono uppercase tracking-widest text-white/40">Analyser state</div>
          <div className={`font-display text-lg mt-1 ${silent ? "text-amber-300" : silent === false ? "text-emerald-300" : "text-white/60"}`}>
            {silent === null ? (playing ? "Warming up…" : "Idle") : silent ? "Silent (CORS?)" : "Receiving audio"}
          </div>
        </div>
      </div>
    </div>
  );
}

function MeterCard({ label, value, tone, strong }: { label: string; value: number; tone: string; strong?: boolean }) {
  const pct = Math.round(Math.min(1, value) * 100);
  return (
    <div className="rounded-md border border-white/10 bg-white/[0.02] p-3">
      <div className="flex items-center justify-between">
        <div className="text-[10px] uppercase tracking-widest text-white/40 font-mono">{label}</div>
        <div className="text-xs font-mono" style={{ color: tone }}>{pct}%</div>
      </div>
      <div className="mt-2 h-2 rounded-full bg-white/5 overflow-hidden">
        <div
          className="h-full transition-[width] duration-75"
          style={{ width: `${pct}%`, background: tone, boxShadow: strong ? `0 0 12px ${tone}` : "none" }}
        />
      </div>
    </div>
  );
}

// ---------- Live playback health -----------------------------------------

type Telemetry = {
  active: number;
  audible: number;
  muted: number;
  gestureWait: number;
  outOfSchedule: number;
  errored: number;
  silent: number;
  audiblePct: number;
  gesturePct: number;
  errorPct: number;
  totalEvents5m: number;
  topErrors: { message: string; count: number; lastAt: string }[];
  generatedAt: string;
};

function computeMaster(enabled: boolean, t: Telemetry | undefined): {
  label: string;
  className: string;
  dot: string;
  hint: string;
} {
  if (!enabled) {
    return { label: "OFF", className: "bg-white/10 text-white/60 border-white/15", dot: "bg-white/40", hint: "Playback disabled" };
  }
  if (!t || t.active === 0) {
    return { label: "IDLE", className: "bg-white/10 text-white/60 border-white/15", dot: "bg-white/40", hint: "No live listeners" };
  }
  if (t.errorPct >= 30) {
    return { label: "DEGRADED", className: "bg-[#ff2a3a]/15 text-[#ff2a3a] border-[#ff2a3a]/30", dot: "bg-[#ff2a3a]", hint: `${t.errorPct}% error/stalled` };
  }
  if (t.audiblePct >= 50) {
    return { label: "LIVE · AUDIBLE", className: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30", dot: "bg-emerald-400", hint: `${t.audiblePct}% audible` };
  }
  if (t.audible > 0) {
    return { label: "LIVE", className: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30", dot: "bg-emerald-400", hint: `${t.audible}/${t.active} audible` };
  }
  if (t.gesturePct >= 50) {
    return { label: "AWAITING GESTURE", className: "bg-amber-500/15 text-amber-200 border-amber-500/30", dot: "bg-amber-300", hint: `${t.gesturePct}% blocked by autoplay` };
  }
  return { label: "MUTED ONLY", className: "bg-sky-500/15 text-sky-200 border-sky-500/30", dot: "bg-sky-300", hint: "Playing muted for most listeners" };
}

function LiveHealthPill({ enabled, t }: { enabled: boolean; t: Telemetry | undefined }) {
  const m = computeMaster(enabled, t);
  return (
    <div className={`inline-flex items-center gap-2 px-2.5 py-1 rounded-md border text-[11px] font-mono uppercase tracking-widest ${m.className}`}
         title={m.hint}>
      <span className={`inline-block w-1.5 h-1.5 rounded-full ${m.dot} ${enabled ? "animate-pulse" : ""}`} />
      {m.label}
    </div>
  );
}

function LivePlaybackTelemetry(props: {
  t: Telemetry | undefined;
  loading: boolean;
  fetching: boolean;
  generatedAt: string | null;
  scheduleEnabled: boolean;
  quietStart: string;
  quietEnd: string;
}) {
  const { t, loading, fetching, generatedAt, scheduleEnabled, quietStart, quietEnd } = props;
  const inQuiet = scheduleEnabled && !isQuietHours(new Date(), quietStart, quietEnd);
  // scheduleStart/End is the play window; outside it we render "out of schedule".
  return (
    <div className="mt-4 rounded-md border border-white/10 bg-white/[0.02] p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Signal className={`w-3.5 h-3.5 ${fetching ? "text-[#ff2a3a]" : "text-white/50"}`} />
          <div className="font-mono uppercase tracking-widest text-[10px] text-white/50">
            Live playback health · rolling 5 min
          </div>
        </div>
        <div className="text-[10px] font-mono text-white/40">
          {loading ? "loading…" : generatedAt ? `updated ${new Date(generatedAt).toLocaleTimeString()}` : "—"}
        </div>
      </div>

      <div className="mt-3 grid grid-cols-2 md:grid-cols-6 gap-2">
        <Tile label="Listeners" value={t?.active ?? 0} tone="text-white" />
        <Tile label="Audible" value={t?.audible ?? 0} sub={`${t?.audiblePct ?? 0}%`} tone="text-emerald-300" />
        <Tile label="Muted" value={t?.muted ?? 0} tone="text-sky-300" />
        <Tile label="Awaiting tap" value={t?.gestureWait ?? 0} sub={`${t?.gesturePct ?? 0}%`} tone="text-amber-300" />
        <Tile label="Errored" value={t?.errored ?? 0} sub={`${t?.errorPct ?? 0}%`} tone="text-[#ff2a3a]" />
        <Tile label="Out of schedule" value={t?.outOfSchedule ?? 0} tone="text-white/50" />
      </div>

      {inQuiet && (
        <div className="mt-3 text-[11px] font-mono text-amber-200/80">
          Play window active — visitors outside {quietStart}–{quietEnd} are correctly silenced.
        </div>
      )}

      {t?.topErrors?.length ? (
        <div className="mt-4">
          <div className="font-mono uppercase tracking-widest text-[10px] text-white/40 mb-1.5">Top errors</div>
          <div className="space-y-1">
            {t.topErrors.map((e) => (
              <div key={e.message} className="flex items-start gap-2 text-[11px] font-mono">
                <AlertCircle className="w-3 h-3 mt-[3px] text-[#ff2a3a] shrink-0" />
                <div className="min-w-0 flex-1 break-words text-white/70 leading-snug">{e.message}</div>
                <div className="text-white/40 tabular-nums shrink-0">×{e.count}</div>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function Tile({ label, value, sub, tone }: { label: string; value: number; sub?: string; tone: string }) {
  return (
    <div className="rounded-md border border-white/10 bg-black/30 p-2.5">
      <div className="font-mono uppercase tracking-widest text-[9px] text-white/40">{label}</div>
      <div className={`font-display text-xl leading-tight mt-0.5 tabular-nums ${tone}`}>{value}</div>
      {sub ? <div className="font-mono text-[10px] text-white/40 mt-0.5">{sub}</div> : null}
    </div>
  );
}
