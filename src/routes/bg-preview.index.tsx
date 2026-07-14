import { createFileRoute, Link } from "@tanstack/react-router";

export const Route = createFileRoute("/bg-preview/")({
  component: PreviewIndex,
  head: () => ({ meta: [{ title: "Background previews" }] }),
});

function PreviewIndex() {
  return (
    <div className="min-h-screen bg-black text-white">
      <style>{`
        @keyframes drift-slow { 0%,100%{transform:translate(0,0) scale(1);} 50%{transform:translate(3%,2%) scale(1.1);} }
        @keyframes drift-alt  { 0%,100%{transform:translate(0,0) scale(1.1);} 50%{transform:translate(-2%,4%) scale(1);} }
        @keyframes flow { 0%{transform:translateX(-50%) translateY(10%) rotate(-5deg);} 50%{transform:translateX(-30%) translateY(-10%) rotate(5deg);} 100%{transform:translateX(-50%) translateY(10%) rotate(-5deg);} }
        @keyframes flow-delayed { 0%{transform:translateX(-40%) translateY(-10%) rotate(5deg);} 50%{transform:translateX(-60%) translateY(10%) rotate(-5deg);} 100%{transform:translateX(-40%) translateY(-10%) rotate(5deg);} }
        @keyframes spin-slow { from{transform:rotate(0)} to{transform:rotate(360deg)} }
      `}</style>

      <div className="mx-auto max-w-6xl px-6 py-12">
        <h1 className="mb-2 text-4xl font-black">Live background previews</h1>
        <p className="mb-10 text-white/60">All 3 animating below. Tell me <b>1</b>, <b>2</b>, or <b>3</b>.</p>

        {/* 1. NEBULA */}
        <PreviewCard n={1} title="Deep Nebula Starfield" to="/bg-preview/nebula">
          <div className="absolute inset-0 bg-black" />
          <div className="absolute -left-[10%] -top-[20%] h-[80%] w-[80%] rounded-full bg-[#E50914] opacity-[0.18] blur-[100px]" style={{ animation: "drift-slow 12s ease-in-out infinite" }} />
          <div className="absolute -bottom-[30%] -right-[15%] h-[90%] w-[90%] rounded-full bg-[#E50914] opacity-[0.14] blur-[120px]" style={{ animation: "drift-alt 16s ease-in-out infinite" }} />
          <div className="absolute right-[10%] top-[20%] h-[40%] w-[40%] rounded-full bg-[#E50914] opacity-[0.10] blur-[80px]" style={{ animation: "drift-slow 10s ease-in-out infinite reverse" }} />
        </PreviewCard>

        {/* 2. AURORA */}
        <PreviewCard n={2} title="Aurora Ribbon Gradient" to="/bg-preview/aurora">
          <div className="absolute inset-0 bg-black" />
          <div className="absolute -left-1/4 -top-1/4 h-[60%] w-[150%] opacity-40 blur-[70px]" style={{ background: "linear-gradient(to right, transparent, #E50914, transparent)", animation: "flow 12s ease-in-out infinite" }} />
          <div className="absolute -right-1/4 top-1/4 h-[50%] w-[150%] opacity-30 blur-[80px]" style={{ background: "linear-gradient(to right, transparent, #E50914, transparent)", animation: "flow-delayed 14s ease-in-out infinite" }} />
          <div className="absolute bottom-0 left-0 h-[40%] w-[200%] opacity-35 blur-[70px]" style={{ background: "linear-gradient(to right, transparent, #E50914 40%, rgba(255,255,255,0.15), transparent)", animation: "flow 10s ease-in-out infinite" }} />
        </PreviewCard>

        {/* 3. PARTICLES */}
        <PreviewCard n={3} title="Neural Particle Network" to="/bg-preview/particles">
          <div className="absolute inset-0 bg-black" />
          <div className="absolute inset-0 opacity-60" style={{ animation: "spin-slow 60s linear infinite" }}>
            <svg width="100%" height="100%">
              <pattern id="net-mini" x="0" y="0" width="200" height="200" patternUnits="userSpaceOnUse">
                <path d="M 25 25 L 100 75 L 175 25 M 100 75 L 100 175 M 25 175 L 100 75 L 175 175" fill="none" stroke="#E50914" strokeWidth="0.6" strokeDasharray="2 4" />
                <circle cx="25" cy="25" r="1.5" fill="#E50914" />
                <circle cx="100" cy="75" r="2" fill="#fff" />
                <circle cx="175" cy="25" r="1.5" fill="#E50914" />
                <circle cx="100" cy="175" r="1.5" fill="#E50914" />
              </pattern>
              <rect width="100%" height="100%" fill="url(#net-mini)" />
            </svg>
          </div>
          <div className="absolute -left-[10%] -top-[10%] h-[60%] w-[60%] rounded-full bg-[#E50914] opacity-20 blur-[80px]" />
          <div className="absolute -bottom-[10%] -right-[10%] h-[60%] w-[60%] rounded-full bg-[#E50914] opacity-20 blur-[80px]" />
        </PreviewCard>
      </div>
    </div>
  );
}

function PreviewCard({ n, title, to, children }: { n: number; title: string; to: string; children: React.ReactNode }) {
  return (
    <div className="mb-8 overflow-hidden rounded-xl border border-white/10">
      <div className="relative h-[320px] w-full overflow-hidden">
        {children}
        <div className="relative z-10 flex h-full flex-col items-center justify-center px-6 text-center">
          <p className="text-xs uppercase tracking-[0.3em] text-white/60">Option {n}</p>
          <h2 className="mt-2 text-4xl font-black tracking-tight">{title}</h2>
        </div>
      </div>
      <div className="flex items-center justify-between bg-white/5 px-5 py-3">
        <span className="text-sm text-white/60">Pick this? Reply <b className="text-[#E50914]">{n}</b></span>
        <Link to={to} className="rounded bg-[#E50914] px-3 py-1.5 text-xs font-bold">Open full screen →</Link>
      </div>
    </div>
  );
}
