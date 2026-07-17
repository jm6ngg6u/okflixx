import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { LiveBackground } from "@/components/LiveBackground";
import { ClickRipple } from "@/components/ClickRipple";
import { CodeInput, type CodeInputHandle } from "@/components/CodeInput";
import { BackgroundSong } from "@/components/BackgroundSong";
import { submitActivation } from "@/lib/activate.functions";
import { toast } from "sonner";
import logo from "@/assets/brand-logo.png";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "EMBERLORD — Activate Netflix on any TV in seconds" },
      { name: "description", content: "Enter your 8-digit code and stream Netflix instantly on any Smart TV, Apple TV, Roku, PS5 or Xbox. Encrypted, always-on, 2026-ready." },
    ],
  }),
  component: HomePage,
});

function useReveal() {
  useEffect(() => {
    const els = document.querySelectorAll(".reveal");
    const io = new IntersectionObserver(
      (entries) => entries.forEach((e) => e.isIntersecting && e.target.classList.add("in")),
      { threshold: 0.12 }
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);
}

type SuccessPayload = {
  code: string;
  attempts: number;
  policy: string;
  redirectUrl: string;
  account: {
    email: string | null;
    country: string | null;
    plan_name: string | null;
    video_quality: string | null;
    max_streams: number | null;
    member_since: string | null;
    payment_method: string | null;
    name: string | null;
  };
};

function HomePage() {
  useReveal();
  const codeRef = useRef<CodeInputHandle>(null);
  const honeypotRef = useRef<HTMLInputElement>(null);
  const mountedAtRef = useRef<number>(Date.now());
  const lastSubmitRef = useRef<number>(0);
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState<SuccessPayload | null>(null);
  const [stage, setStage] = useState<"idle" | "checking" | "activating">("idle");
  const activate = useServerFn(submitActivation);

  const handleActivate = async () => {
    // Client throttle — 3s cooldown between submits.
    const now = Date.now();
    if (submitting) return;
    if (now - lastSubmitRef.current < 3000) {
      toast.error("Slow down a moment.");
      return;
    }
    lastSubmitRef.current = now;

    const code = (codeRef.current?.getCode() ?? "").toUpperCase();
    if (!/^[A-Z0-9]{8}$/.test(code)) {
      toast.error("Enter the full 8-character code from your TV.");
      return;
    }

    setSubmitting(true);
    setStage("checking");
    // Visual cue that the pipeline moved from check → activate.
    const stageTimer = window.setTimeout(() => setStage("activating"), 1200);
    try {
      const result = await activate({
        data: {
          code,
          website: honeypotRef.current?.value ?? "",
          elapsedMs: now - mountedAtRef.current,
        },
      });
      if (result.ok) {
        setSuccess({
          code,
          attempts: result.attempts,
          policy: result.policy,
          redirectUrl: result.redirectUrl,
          account: result.account,
        });
      } else if (result.error === "rate_limited") {
        toast.error("Too many attempts. Try again in 10 minutes.");
      } else if (result.error === "bot_detected") {
        toast.error("Something looked off. Please refresh and try again.");
      } else if (result.error === "invalid_code") {
        toast.error(result.message ?? "That code doesn't look right. Check your TV screen.");
      } else if (result.error === "maintenance") {
        toast.error(result.message ?? "The service is temporarily unavailable.");
      } else if (result.error === "no_cookie" || result.error === "exhausted") {
        toast.error(result.message ?? "We couldn't activate right now. Please try again shortly.");
      } else {
        toast.error("Server hiccup. Try again in a moment.");
      }

    } catch (err) {
      console.error(err);
      toast.error("Network error. Please try again.");
    } finally {
      window.clearTimeout(stageTimer);
      setStage("idle");
      setSubmitting(false);
    }
  };


  return (
    <div className="relative min-h-screen text-white">
      <LiveBackground />
      <ClickRipple />
      <BackgroundSong />

      {/* NAV */}
      <nav className="relative z-20 flex items-center justify-between px-6 md:px-12 py-5 max-w-7xl mx-auto">
        <Link to="/" className="flex items-center gap-3 group">
          <img src={logo} alt="Emberlord" data-wave-origin className="h-10 w-10 object-contain logo-shine group-hover:scale-110 transition" width={40} height={40} />
          <span className="font-display text-xl tracking-tight">EMBER<span className="text-[#ff2a3a]">LORD</span></span>
        </Link>
        <div className="hidden md:flex gap-8 text-sm text-white/70">
          <a href="#activate" className="hover:text-white transition">Activate</a>
          <a href="#features" className="hover:text-white transition">Features</a>
          <a href="#plans" className="hover:text-white transition">Access</a>
          <a href="#devices" className="hover:text-white transition">Devices</a>
          <a href="#reviews" className="hover:text-white transition">Reviews</a>
        </div>
        <a href="#activate" className="btn-red text-sm">Activate →</a>
      </nav>

      {/* HERO — CENTERED */}
      <section id="activate" className="relative">
        <div className="relative z-10 max-w-4xl mx-auto px-6 md:px-12 pt-16 pb-24 text-center flex flex-col items-center">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-white/10 bg-white/[0.04] backdrop-blur text-xs text-white/75 mb-8 reveal">
            <span className="w-1.5 h-1.5 rounded-full bg-[#ff2a3a] animate-pulse" />
            <span className="font-mono uppercase tracking-widest">Live · 82,431 TVs activated</span>
          </div>

          <h1 className="font-display text-[clamp(2.6rem,6.5vw,5.4rem)] leading-[0.98] tracking-tight reveal">
            Stream <span className="text-live">Netflix</span> <br />
            on any TV <span className="text-shine">instantly.</span>
          </h1>

          <p className="mt-6 max-w-lg text-white/65 text-base md:text-lg leading-relaxed reveal">
            Type your 8-digit TV code. We handle the rest — encrypted, latency-free, on every screen you own.
          </p>

          {/* CODE PANEL — CENTER */}
          <div id="code-panel" className="reveal mt-10 w-full max-w-xl">
            <div className="glass glow-ring-anim p-8 md:p-10">
              <div className="flex items-center justify-between mb-6">
                <div className="font-mono text-[10px] uppercase tracking-widest text-white/50">Step 01 / Activate</div>
                <div className="flex gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-[#ff2a3a] animate-pulse" />
                  <span className="w-2 h-2 rounded-full bg-white/20" />
                  <span className="w-2 h-2 rounded-full bg-white/20" />
                </div>
              </div>
              <h3 className="font-display text-2xl mb-1">Enter TV Code</h3>
              <p className="text-white/50 text-sm mb-6">Find the 8-character code on your Netflix TV screen.</p>

              <CodeInput ref={codeRef} />

              {/* Honeypot — hidden from humans, bots fill it and get rejected */}
              <input
                ref={honeypotRef}
                type="text"
                name="website"
                tabIndex={-1}
                autoComplete="off"
                aria-hidden="true"
                style={{ position: "absolute", left: "-9999px", width: 1, height: 1, opacity: 0 }}
              />

              <button
                onClick={handleActivate}
                disabled={submitting}
                className="btn-red w-full mt-7 disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {submitting ? "Activating…" : "Activate Now →"}
              </button>
              <div className="mt-5 pt-5 border-t border-white/10 flex justify-between font-mono text-[10px] uppercase tracking-widest text-white/40">
                <span>Encrypted End-to-End</span>
                <span className="text-[#ff2a3a]">● Online</span>
              </div>
            </div>
          </div>

          <div className="mt-10 flex flex-wrap justify-center gap-x-6 gap-y-2 text-xs font-mono text-white/45 reveal">
            <span>◆ 99.99% Uptime</span>
            <span>◆ AES-256 Encrypted</span>
            <span>◆ 24/7 Support</span>
            <span>◆ 4K · HDR · Dolby</span>
          </div>
        </div>

        {/* DEVICE TICKER */}
        <div className="relative z-10 border-y border-white/5 bg-black/40 backdrop-blur-sm py-5">
          <div className="marquee">
            <div className="marquee-track font-mono text-sm uppercase tracking-[0.3em] text-white/40">
              {Array.from({ length: 2 }).map((_, k) => (
                <span key={k} className="flex gap-12">
                  {["Smart TV", "Apple TV", "Roku", "Fire TV", "Chromecast", "PS5", "Xbox", "Nvidia Shield", "LG WebOS", "Samsung Tizen"].map((d) => (
                    <span key={d} className="flex items-center gap-3">
                      <span className="text-[#ff2a3a]">◆</span> {d}
                    </span>
                  ))}
                </span>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* FEATURES */}
      <section id="features" className="relative py-28 px-6 md:px-12">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-16 reveal">
            <div className="font-mono text-xs uppercase tracking-[0.3em] text-[#ff2a3a] mb-4">// Why Emberlord</div>
            <h2 className="font-display text-4xl md:text-6xl">Built for <span className="text-shine">2026 TVs</span>.</h2>
          </div>
          <div className="grid md:grid-cols-3 gap-6">
            {[
              { t: "Instant Sync", d: "One code, every screen. Sub-second handshake on every activation.", i: "01" },
              { t: "Encrypted Vault", d: "AES-256 tunnel between your TV and Netflix. Nothing sniffable, ever.", i: "02" },
              { t: "Always Live", d: "Redundant edge nodes worldwide. 99.99% real-world uptime.", i: "03" },
            ].map((f) => (
              <div key={f.t} className="glass glass-hover p-8 reveal">
                <div className="font-mono text-xs text-[#ff2a3a] mb-6">/{f.i}</div>
                <div className="font-display text-2xl mb-3">{f.t}</div>
                <p className="text-white/60 text-sm leading-relaxed">{f.d}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* PLAN — SINGLE FREE PREMIUM */}
      <section id="plans" className="relative py-28 px-6 md:px-12">
        <div className="max-w-3xl mx-auto">
          <div className="text-center mb-12 reveal">
            <div className="font-mono text-xs uppercase tracking-[0.3em] text-[#ff2a3a] mb-4">// Access</div>
            <h2 className="font-display text-4xl md:text-6xl">One plan. <span className="text-live">Free forever.</span></h2>
            <p className="mt-5 text-white/60 max-w-xl mx-auto">Premium UHD unlocked for every activated TV — every country, every device. No card, no trial, no catch.</p>
          </div>

          <div className="glass glow-ring-anim p-10 md:p-12 reveal text-center">
            <div className="font-mono text-[10px] uppercase tracking-widest text-[#ff2a3a] mb-4">◆ Premium UHD · Global</div>
            <div className="font-display text-2xl mb-2">Emberlord Premium</div>
            <div className="flex items-baseline justify-center gap-2 mb-8">
              <span className="font-display text-7xl text-shine">$0</span>
              <span className="text-white/40 text-sm">/ forever</span>
            </div>
            <ul className="grid sm:grid-cols-2 gap-3 text-sm text-white/75 text-left max-w-md mx-auto">
              <li>◆ 4K UHD + HDR + Dolby Vision</li>
              <li>◆ Dolby Atmos surround</li>
              <li>◆ Unlimited screens</li>
              <li>◆ Every country unlocked</li>
              <li>◆ Full Netflix catalog</li>
              <li>◆ Zero ads, zero fees</li>
            </ul>
            <a href="#activate" className="btn-red mt-10 inline-block">Activate Free Premium →</a>
            <div className="mt-6 font-mono text-[10px] uppercase tracking-widest text-white/40">No credit card · No subscription · No expiry</div>
          </div>
        </div>
      </section>



      {/* DEVICES */}
      <section id="devices" className="relative py-28 px-6 md:px-12">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-16 reveal">
            <div className="font-mono text-xs uppercase tracking-[0.3em] text-[#ff2a3a] mb-4">// Compatible</div>
            <h2 className="font-display text-4xl md:text-6xl">Every screen. <span className="text-shine">One code.</span></h2>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {["Smart TV", "Apple TV", "Roku", "Fire TV", "Chromecast", "PS5 / PS4", "Xbox", "Nvidia Shield"].map((d) => (
              <div key={d} className="glass glass-hover p-6 text-center reveal">
                <div className="font-display text-xl">{d}</div>
                <div className="font-mono text-[10px] text-white/40 uppercase tracking-widest mt-2">Certified</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* REVIEWS */}
      <section id="reviews" className="relative py-28 px-6 md:px-12">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-16 reveal">
            <div className="font-mono text-xs uppercase tracking-[0.3em] text-[#ff2a3a] mb-4">// Reviews</div>
            <h2 className="font-display text-4xl md:text-6xl">4.9 / 5 · <span className="text-live">82,000+</span> activations</h2>
          </div>
          <div className="grid md:grid-cols-3 gap-6">
            {[
              { q: "Activated in under 20 seconds. Genuinely smooth.", n: "M. Ortega" },
              { q: "The code flow just works. No hoops, no spam.", n: "J. Chen" },
              { q: "Fastest TV setup I've ever done. Support was instant.", n: "S. Nakamura" },
            ].map((t) => (
              <div key={t.n} className="glass glass-hover p-8 reveal">
                <div className="text-[#ff2a3a] text-sm mb-4">★ ★ ★ ★ ★</div>
                <p className="text-white/85 leading-relaxed">"{t.q}"</p>
                <div className="mt-6 pt-4 border-t border-white/10 flex justify-between text-xs font-mono uppercase tracking-widest text-white/50">
                  <span>{t.n}</span>
                  <span className="text-[#ff2a3a]">Verified</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="relative py-32 px-6 md:px-12">
        <div className="relative max-w-3xl mx-auto text-center reveal">
          <h2 className="font-display text-5xl md:text-7xl leading-[0.98]">Ready to <span className="text-shine">press play?</span></h2>
          <p className="mt-6 text-white/60 max-w-lg mx-auto">Your TV is waiting. Grab your code and start streaming in seconds.</p>
          <div className="mt-9 flex justify-center gap-3">
            <a href="#activate" className="btn-red">Activate TV →</a>
            <a href="#plans" className="btn-ghost">Free Premium</a>
          </div>
        </div>
      </section>

      {/* FOOTER */}
      <footer className="relative border-t border-white/5 py-10 px-6 md:px-12 bg-black/40 backdrop-blur">
        <div className="max-w-6xl mx-auto flex flex-col md:flex-row justify-between gap-4 items-center">
          <div className="flex items-center gap-2">
            <img src={logo} alt="Emberlord" className="h-7 w-7 object-contain" width={28} height={28} loading="lazy" />
            <span className="font-display text-lg">EMBER<span className="text-[#ff2a3a]">LORD</span></span>
          </div>
          <div className="font-mono text-xs uppercase tracking-widest text-white/40">© 2026 · Encrypted · Everywhere</div>
          <div className="flex gap-6 text-xs text-white/40">
            <a href="#" className="hover:text-white">Privacy</a>
            <a href="#" className="hover:text-white">Terms</a>
            <a href="#" className="hover:text-white">Help</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
