import { createFileRoute, Link } from "@tanstack/react-router";

export const Route = createFileRoute("/bg-preview/particles")({
  component: ParticlesPreview,
  head: () => ({ meta: [{ title: "Preview · Neural Particle Network" }] }),
});

function ParticlesPreview() {
  return (
    <div className="relative min-h-screen w-full overflow-hidden bg-black text-white">
      <div className="fixed inset-0 z-0">
        <div className="absolute inset-0 opacity-40" style={{ animation: "pulse 8s ease-in-out infinite" }}>
          <svg width="100%" height="100%">
            <pattern id="net" x="0" y="0" width="400" height="400" patternUnits="userSpaceOnUse">
              <path d="M 50 50 L 200 150 L 350 50 M 200 150 L 200 350 M 50 350 L 200 150 L 350 350" fill="none" stroke="#E50914" strokeWidth="0.5" strokeDasharray="2 4" />
              <circle cx="50" cy="50" r="1.5" fill="#E50914" />
              <circle cx="200" cy="150" r="2" fill="#fff" />
              <circle cx="350" cy="50" r="1.5" fill="#E50914" />
              <circle cx="200" cy="350" r="1.5" fill="#E50914" />
              <circle cx="50" cy="350" r="1.5" fill="#E50914" />
              <circle cx="350" cy="350" r="1.5" fill="#E50914" />
            </pattern>
            <rect width="100%" height="100%" fill="url(#net)" />
          </svg>
        </div>
        <div className="absolute inset-0 scale-150 opacity-20" style={{ animation: "spin 120s linear infinite" }}>
          <svg width="100%" height="100%">
            <pattern id="nodes" x="0" y="0" width="300" height="300" patternUnits="userSpaceOnUse">
              <circle cx="100" cy="100" r="1" fill="#fff" />
              <circle cx="250" cy="200" r="1" fill="#E50914" />
              <circle cx="50" cy="250" r="1" fill="#fff" />
            </pattern>
            <rect width="100%" height="100%" fill="url(#nodes)" />
          </svg>
        </div>
        <div className="absolute -left-[10%] -top-[10%] h-[50%] w-[50%] rounded-full bg-[#E50914] opacity-10 blur-[150px]" />
        <div className="absolute -bottom-[10%] -right-[10%] h-[50%] w-[50%] rounded-full bg-[#E50914] opacity-10 blur-[150px]" />
      </div>
      <div className="relative z-10">
        <nav className="mx-auto flex max-w-7xl items-center justify-between px-8 py-6">
          <div className="text-3xl font-black tracking-tighter text-[#E50914]">NETFLIX</div>
          <Link to="/" className="rounded-sm bg-[#E50914] px-4 py-1.5 text-sm font-bold text-white">Back</Link>
        </nav>
        <main className="flex min-h-[85vh] flex-col items-center justify-center px-6 text-center">
          <p className="mb-4 text-xs uppercase tracking-[0.3em] text-white/50">Preview · Neural Particle Network</p>
          <h1 className="mb-6 max-w-3xl text-5xl font-black leading-tight tracking-tight md:text-7xl">Unlimited movies, TV shows, and more.</h1>
          <p className="mb-10 text-xl text-white/90 md:text-2xl">Scroll down — network stays uniform.</p>
        </main>
        <section className="flex h-screen items-center justify-center"><div className="text-white/40">↓ keep scrolling ↓</div></section>
        <section className="flex h-screen items-center justify-center"><div className="text-white/40">no red ball, no origin</div></section>
      </div>
    </div>
  );
}
