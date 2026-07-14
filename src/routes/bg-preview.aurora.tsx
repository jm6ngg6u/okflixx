import { createFileRoute, Link } from "@tanstack/react-router";

export const Route = createFileRoute("/bg-preview/aurora")({
  component: AuroraPreview,
  head: () => ({ meta: [{ title: "Preview · Aurora Ribbon Gradient" }] }),
});

function AuroraPreview() {
  return (
    <div className="relative min-h-screen w-full overflow-hidden text-white">
      <style>{`
        @keyframes flow { 0%{transform:translateX(-50%) translateY(10%) rotate(-5deg);} 50%{transform:translateX(-30%) translateY(-10%) rotate(5deg);} 100%{transform:translateX(-50%) translateY(10%) rotate(-5deg);} }
        @keyframes flow-delayed { 0%{transform:translateX(-40%) translateY(-10%) rotate(5deg);} 50%{transform:translateX(-60%) translateY(10%) rotate(-5deg);} 100%{transform:translateX(-40%) translateY(-10%) rotate(5deg);} }
      `}</style>
      <div className="fixed inset-0 z-0 overflow-hidden bg-black">
        <div className="absolute -left-1/4 -top-1/4 h-[60%] w-[150%] opacity-30 blur-[100px]" style={{ background: "linear-gradient(to right, transparent, #E50914, transparent)", animation: "flow 20s ease-in-out infinite" }} />
        <div className="absolute -right-1/4 top-1/4 h-[50%] w-[150%] opacity-20 blur-[120px]" style={{ background: "linear-gradient(to right, transparent, #E50914, transparent)", animation: "flow-delayed 25s ease-in-out infinite" }} />
        <div className="absolute bottom-0 left-0 h-[40%] w-[200%] opacity-25 blur-[100px]" style={{ background: "linear-gradient(to right, transparent, #E50914 40%, rgba(255,255,255,0.1), transparent)", animation: "flow 20s ease-in-out infinite" }} />
      </div>
      <div className="relative z-10">
        <nav className="mx-auto flex max-w-7xl items-center justify-between px-8 py-6">
          <div className="text-3xl font-black tracking-tighter text-[#E50914]">NETFLIX</div>
          <Link to="/" className="rounded-sm bg-[#E50914] px-4 py-1.5 text-sm font-bold text-white">Back</Link>
        </nav>
        <main className="flex min-h-[85vh] flex-col items-center justify-center px-6 text-center">
          <p className="mb-4 text-xs uppercase tracking-[0.3em] text-white/50">Preview · Aurora Ribbon Gradient</p>
          <h1 className="mb-6 max-w-3xl text-5xl font-black leading-tight tracking-tight md:text-7xl">Unlimited movies, TV shows, and more.</h1>
          <p className="mb-10 text-xl text-white/90 md:text-2xl">Scroll down — ribbons keep flowing.</p>
        </main>
        <section className="flex h-screen items-center justify-center"><div className="text-white/40">↓ keep scrolling ↓</div></section>
        <section className="flex h-screen items-center justify-center"><div className="text-white/40">no origin point, no red ball</div></section>
      </div>
    </div>
  );
}
