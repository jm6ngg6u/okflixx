import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { getBackgroundSongAdmin, setBackgroundSongEnabled, removeBackgroundSong, setBackgroundSongReactive } from "@/lib/background-song.functions";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Music4, Upload, Trash2, Play, Pause, CheckCircle2, AlertCircle, Loader2, Activity } from "lucide-react";
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

type UploadStatus = "idle" | "reading" | "uploading" | "success" | "error";

function BackgroundSongPage() {
  const fetchInfo = useServerFn(getBackgroundSongAdmin);
  const doToggle = useServerFn(setBackgroundSongEnabled);
  const doRemove = useServerFn(removeBackgroundSong);
  const doReactive = useServerFn(setBackgroundSongReactive);
  const qc = useQueryClient();

  const info = useQuery({ queryKey: ["bg-song-admin"], queryFn: () => fetchInfo() });

  const previewRef = useRef<HTMLAudioElement | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const [uploadStatus, setUploadStatus] = useState<UploadStatus>("idle");
  const [uploadPct, setUploadPct] = useState(0);
  const [uploadMsg, setUploadMsg] = useState("");
  const [uploadName, setUploadName] = useState("");
  const [uploadSize, setUploadSize] = useState(0);
  const [uploadError, setUploadError] = useState("");

  const invalidateAll = () => {
    qc.invalidateQueries({ queryKey: ["bg-song-admin"] });
    qc.invalidateQueries({ queryKey: ["background-song-public"] });
  };

  const toggleMut = useMutation({
    mutationFn: (enabled: boolean) => doToggle({ data: { enabled } }),
    onSuccess: (r: any) => {
      toast.success(r.enabled ? "Background music turned ON" : "Background music turned OFF", {
        description: r.enabled ? "Playing on the public site." : "Public site will be silent.",
      });
      invalidateAll();
    },
    onError: (e: any) => toast.error(e?.message ?? "Toggle failed"),
  });

  const removeMut = useMutation({
    mutationFn: () => doRemove(),
    onSuccess: () => {
      toast.success("Song removed", { description: "Storage cleaned. Upload a new track to re-enable." });
      invalidateAll();
    },
    onError: (e: any) => toast.error(e?.message ?? "Remove failed"),
  });

  const handleUpload = async (file: File) => {
    setUploadError("");
    setUploadName(file.name);
    setUploadSize(file.size);
    setUploadPct(0);
    setUploadStatus("reading");
    setUploadMsg("Preparing file…");

    if (!file.type.startsWith("audio/") && !/\.(mp3|wav|ogg|m4a|aac|flac)$/i.test(file.name)) {
      setUploadStatus("error");
      setUploadError("File must be an audio track (mp3, wav, ogg, m4a, aac, flac).");
      toast.error("Not an audio file");
      return;
    }
    if (file.size > 15 * 1024 * 1024) {
      setUploadStatus("error");
      setUploadError("File is larger than 15 MB.");
      toast.error("File too large");
      return;
    }

    const { data: sess } = await supabase.auth.getSession();
    const token = sess?.session?.access_token;
    if (!token) {
      setUploadStatus("error");
      setUploadError("Session expired. Please sign in again.");
      return;
    }

    const form = new FormData();
    form.append("file", file);

    await new Promise<void>((resolve) => {
      const xhr = new XMLHttpRequest();
      xhr.open("POST", "/api/admin/upload-background-song");
      xhr.setRequestHeader("Authorization", `Bearer ${token}`);
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) {
          const pct = Math.round((e.loaded / e.total) * 100);
          setUploadPct(pct);
          setUploadStatus("uploading");
          setUploadMsg(pct >= 100 ? "Finalizing on server…" : `Uploading… ${pct}%`);
        }
      };
      xhr.onerror = () => {
        setUploadStatus("error");
        setUploadError("Network error during upload.");
        toast.error("Upload failed");
        resolve();
      };
      xhr.onload = () => {
        try {
          const res = JSON.parse(xhr.responseText || "{}");
          if (xhr.status >= 200 && xhr.status < 300 && res.ok) {
            setUploadStatus("success");
            setUploadPct(100);
            setUploadMsg("Upload complete · New track live on the public site.");
            toast.success("New background song uploaded", {
              description: `${res.name} · ${fmtSize(res.size)} · Playing on public site`,
            });
            invalidateAll();
          } else {
            setUploadStatus("error");
            const label =
              res.error === "file_too_large" ? "File too large (max 15 MB)"
              : res.error === "not_audio" ? "File is not audio"
              : res.error === "forbidden" ? "You are not authorized"
              : res.error === "unauthorized" ? "Session expired"
              : res.detail || res.error || `Upload failed (${xhr.status})`;
            setUploadError(label);
            toast.error("Upload failed", { description: label });
          }
        } catch {
          setUploadStatus("error");
          setUploadError("Unexpected server response.");
          toast.error("Upload failed");
        }
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

  return (
    <div className="space-y-6">
      <div className="flex items-start gap-3">
        <div className="w-11 h-11 rounded-lg bg-gradient-to-br from-[#ff2a3a]/20 to-[#b0060f]/10 border border-[#ff2a3a]/20 flex items-center justify-center">
          <Music4 className="w-5 h-5 text-[#ff2a3a]" />
        </div>
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.3em] text-[#ff2a3a] mb-1">// Audio</div>
          <h1 className="font-display text-3xl md:text-4xl leading-none">Background song</h1>
          <p className="text-sm text-white/50 mt-2 max-w-2xl">
            Plays automatically on the public site and loops forever. Toggle it off, replace it, or remove it — changes are live within seconds.
          </p>
        </div>
      </div>

      {/* Status + toggle */}
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
            <Badge variant="outline" className={d?.enabled
              ? "bg-emerald-500/15 text-emerald-300 border-emerald-500/30"
              : "bg-white/10 text-white/60 border-white/15"}>
              {d?.enabled ? "PLAYING" : "OFF"}
            </Badge>
            <Switch
              checked={!!d?.enabled}
              disabled={toggleMut.isPending || !d?.path}
              onCheckedChange={(v) => toggleMut.mutate(v)}
            />
          </div>
        </div>

        <div className="mt-5 grid sm:grid-cols-3 gap-3">
          <StatBlock label="Current track" value={d?.name || "—"} mono />
          <StatBlock label="File size" value={fmtSize(d?.sizeBytes ?? 0)} />
          <StatBlock label="Last updated" value={d?.updatedAt ? new Date(d.updatedAt).toLocaleString() : "—"} />
        </div>

        {d?.previewUrl && (
          <div className="mt-4 flex items-center gap-3 rounded-md border border-white/10 bg-white/[0.02] p-3">
            <audio ref={previewRef} src={d.previewUrl} onEnded={() => setPreviewing(false)} preload="none" />
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

      {/* Upload */}
      <div className="glass p-5">
        <div className="flex items-start gap-3 mb-4">
          <Upload className="w-4 h-4 text-[#ff2a3a] mt-1" />
          <div>
            <div className="font-display text-lg leading-tight">Upload new track</div>
            <div className="text-xs text-white/50 mt-1">Max 15 MB · mp3 / wav / ogg / m4a / aac / flac. The new file replaces the current track immediately and auto-enables playback.</div>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <input
            ref={fileRef}
            type="file"
            accept="audio/*,.mp3,.wav,.ogg,.m4a,.aac,.flac"
            className="hidden"
            onChange={onFileChange}
          />
          <Button
            className="btn-red"
            disabled={uploadStatus === "uploading" || uploadStatus === "reading"}
            onClick={() => fileRef.current?.click()}
          >
            {uploadStatus === "uploading" || uploadStatus === "reading" ? (
              <><Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> Uploading…</>
            ) : (
              <><Upload className="w-3.5 h-3.5 mr-1.5" /> Choose audio file</>
            )}
          </Button>
          {d?.path && (
            <Button
              variant="outline"
              className="border-white/15 bg-white/5 text-red-200 hover:text-red-100"
              disabled={removeMut.isPending}
              onClick={() => {
                if (confirm("Remove the current background song? The public site will go silent.")) removeMut.mutate();
              }}
            >
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
              <div className="mt-1 text-[11px] text-white/50 font-mono">
                {uploadName} · {fmtSize(uploadSize)}
              </div>
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

      {/* How it plays */}
      <div className="glass p-5">
        <div className="font-display text-lg mb-2">How it plays on the public site</div>
        <ul className="text-sm text-white/70 space-y-1.5">
          <li>◆ Starts automatically when a visitor lands on the site.</li>
          <li>◆ Loops seamlessly — the moment the song ends, it restarts.</li>
          <li>◆ If the browser blocks autoplay with sound, it begins muted and unmutes on the first click or key press.</li>
          <li>◆ Visitors always see a floating <span className="font-mono text-[11px] text-[#ff2a3a]">Sound on / Tap to unmute</span> chip to control it.</li>
          <li>◆ Turning the switch off above stops it everywhere within a few seconds (next visitor load).</li>
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
