import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { getBackgroundSong } from "@/lib/background-song.functions";
import { Volume2, VolumeX } from "lucide-react";

/**
 * Plays the site background song on loop.
 * Autoplay is attempted unmuted; if the browser blocks it we fall back to
 * muted autoplay and reveal an unmute chip so a single click enables sound.
 */
export function BackgroundSong() {
  const fetchSong = useServerFn(getBackgroundSong);
  const q = useQuery({
    queryKey: ["background-song-public"],
    queryFn: () => fetchSong(),
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [muted, setMuted] = useState(false);
  const [needsGesture, setNeedsGesture] = useState(false);

  useEffect(() => {
    const el = audioRef.current;
    if (!el || !q.data?.enabled || !q.data.url) return;
    el.volume = 0.55;
    const tryPlay = async () => {
      try {
        el.muted = false;
        await el.play();
        setMuted(false);
        setNeedsGesture(false);
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
      if (!el.paused && !el.muted) return;
      try {
        el.muted = false;
        await el.play();
        setMuted(false);
        setNeedsGesture(false);
        window.removeEventListener("pointerdown", onFirstGesture);
        window.removeEventListener("keydown", onFirstGesture);
      } catch {
        /* ignore */
      }
    };
    window.addEventListener("pointerdown", onFirstGesture);
    window.addEventListener("keydown", onFirstGesture);
    return () => {
      window.removeEventListener("pointerdown", onFirstGesture);
      window.removeEventListener("keydown", onFirstGesture);
    };
  }, [q.data?.enabled, q.data?.url]);

  if (!q.data?.enabled || !q.data.url) return null;

  const toggle = () => {
    const el = audioRef.current;
    if (!el) return;
    if (el.paused) {
      el.muted = false;
      el.play().catch(() => {});
      setMuted(false);
    } else {
      const next = !el.muted;
      el.muted = next;
      setMuted(next);
    }
    setNeedsGesture(false);
  };

  return (
    <>
      <audio ref={audioRef} src={q.data.url} loop preload="auto" playsInline autoPlay />
      <button
        onClick={toggle}
        aria-label={muted ? "Unmute background music" : "Mute background music"}
        className={`fixed z-40 bottom-5 right-5 flex items-center gap-2 rounded-full border border-white/10 bg-black/60 backdrop-blur px-4 py-2.5 text-xs font-mono uppercase tracking-widest text-white/80 hover:text-white hover:border-[#ff2a3a]/50 transition ${needsGesture ? "animate-pulse ring-1 ring-[#ff2a3a]/50" : ""}`}
      >
        {muted ? <VolumeX className="w-3.5 h-3.5" /> : <Volume2 className="w-3.5 h-3.5 text-[#ff2a3a]" />}
        <span>{muted ? "Tap to unmute" : "Sound on"}</span>
      </button>
    </>
  );
}
