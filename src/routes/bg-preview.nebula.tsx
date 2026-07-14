import { createFileRoute, Link } from "@tanstack/react-router";

export const Route = createFileRoute("/bg-preview/nebula")({
  component: NebulaPreview,
  head: () => ({ meta: [{ title: "Preview · Deep Nebula Starfield" }] }),
});

function NebulaPreview() {
  return (
    <div className="relative min-h-screen w-full overflow-hidden text-white">
      <style>{`
        @keyframes drift-slow { 0%,100%{transform:translate(0,0) scale(1);} 50%{transform:translate(3%,2%) scale(1.1);} }
        @keyframes drift-alt  { 0%,100%{transform:translate(0,0) scale(1.1);} 50%{transform:translate(-2%,4%) scale(1);} }
        @keyframes twinkle    { 0%,100%{opacity:.3;} 50%{opacity:.8;} }
        .nebula-stars {
          background-image:
            radial-gradient(1px 1px at 20px 30px,#fff,rgba(0,0,0,0)),
            radial-gradient(1.5px 1.5px at 50px 100px,#fff,rgba(0,0,0,0)),
            radial-gradient(1px 1px at 150px 200px,#fff,rgba(0,0,0,0)),
            radial-gradient(1.5px 1.5px at 250px 50px,#fff,rgba(0,0,0,0)),
            radial-gradient(1px 1px at 300px 350px,#fff,rgba(0,0,0,0));
          background-size: 400px 400px;
        }
      `}</style>
      <div className="fixed inset-0 z-0 overflow-hidden">
        <div className="absolute inset-0 bg-black" />
        <div className="absolute -left-[10%] -top-[20%] h-[80%] w-[80%] rounded-full bg-[#E50914] opacity-[0.12] blur-[140px]" style={{ animation: "drift-slow 25s ease-in-out infinite" }} />
        <div className="absolute -bottom-[30%] -right-[15%] h-[90%] w-[90%] rounded-full bg-[#E50914] opacity-[0.08] blur-[160px]" style={{ animation: "drift-alt 35s ease-in-out infinite" }} />
        <div className="absolute right-[10%] top-[20%] h-[40%] w-[40%] rounded-full bg-[#E50914] opacity-[0.05] blur-[100px]" style={{ animation: "drift-slow 20s ease-in-out infinite reverse" }} />
        <div className="nebula-stars absolute inset-0 opacity-40" />
        <div className="nebula-stars absolute inset-0 rotate-180 scale-150 opacity-20" style={{ animation: "twinkle 5s infinite" }} />
      </div>
      <PreviewChrome title="Deep Nebula Starfield" />
    </div>
  );
}

function PreviewChrome({ title }: { title: string }) {
  return (
    <div className="relative z-10">
      <nav className="mx-auto flex max-w-7xl items-center justify-between px-8 py-6">
        <div className="text-3xl font-black tracking-tighter text-[#E50914]">NETFLIX</div>
        <Link to="/" className="rounded-sm bg-[#E50914] px-4 py-1.5 text-sm font-bold text-white">Back</Link>
      </nav>
      <main className="flex min-h-[85vh] flex-col items-center justify-center px-6 text-center">
        <p className="mb-4 text-xs uppercase tracking-[0.3em] text-white/50">Preview · {title}</p>
        <h1 className="mb-6 max-w-3xl text-5xl font-black leading-tight tracking-tight md:text-7xl">Unlimited movies, TV shows, and more.</h1>
        <p className="mb-10 text-xl text-white/90 md:text-2xl">Scroll down — background stays consistent.</p>
      </main>
      <section className="flex h-screen items-center justify-center">
        <div className="text-white/40">↓ keep scrolling ↓</div>
      </section>
      <section className="flex h-screen items-center justify-center">
        <div className="text-white/40">still uniform, no red ball</div>
      </section>
    </div>
  );
}
