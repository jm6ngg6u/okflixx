import { Link } from "@tanstack/react-router";
import { LiveBackground } from "@/components/LiveBackground";
import { useBrand } from "@/lib/branding-context";
import logo from "@/assets/brand-logo.png";

function Wordmark() {
  const b = useBrand();
  return (<>{b.name_prefix}<span className="text-brand-accent">{b.name_suffix}</span></>);
}

type Props = {
  kicker: string;
  title: string;
  updated?: string;
  intro?: string;
  children: React.ReactNode;
};

export function LegalShell({ kicker, title, updated, intro, children }: Props) {
  return (
    <div className="min-h-screen text-white relative">
      <LiveBackground />
      <nav className="relative z-20 flex items-center justify-between px-6 md:px-12 py-5 max-w-7xl mx-auto">
        <Link to="/" className="flex items-center gap-2" data-wave-origin>
          <img src={logo} alt="OKFLIX" className="h-8 w-8 object-contain" width={32} height={32} />
          <span className="font-display brand-wordmark-nav tracking-tight wordmark-pulse"><Wordmark /></span>
        </Link>
        <div className="hidden md:flex items-center gap-6 text-sm text-white/70 font-medium">
          <Link to="/" className="hover:text-white transition">Home</Link>
          <Link to="/help" className="hover:text-white transition">Help</Link>
          <Link to="/" hash="activate" className="btn-red text-sm">Activate →</Link>
        </div>
        <Link to="/" hash="activate" className="md:hidden btn-red text-sm">Activate →</Link>
      </nav>

      <main className="relative z-10 max-w-3xl mx-auto px-6 md:px-8 pb-24 pt-8">
        <div className="mb-10">
          <div className="inline-flex items-center gap-2 rounded-full border border-[#ff2a3a]/30 bg-[#ff2a3a]/5 px-3 py-1 mb-4">
            <span className="relative flex kicker-dot">
              <span className="absolute inline-flex h-full w-full rounded-full bg-[#ff2a3a] opacity-75 animate-ping" />
              <span className="relative inline-flex rounded-full kicker-dot bg-[#ff2a3a]" />
            </span>
            <span className="font-mono text-[10px] md:text-xs uppercase tracking-[0.3em] text-[#ff2a3a]">{kicker}</span>
          </div>
          <h1 className="font-display section-title-fluid text-white">{title}</h1>
          {updated && <div className="font-mono text-xs text-white/40 mt-2 uppercase tracking-widest">{updated}</div>}
          {intro && <p className="text-white/70 mt-6 text-base md:text-lg leading-relaxed">{intro}</p>}
        </div>

        <div className="space-y-10 rounded-2xl border border-white/10 bg-black/40 backdrop-blur p-6 md:p-10">
          {children}
        </div>

        <div className="mt-10 flex flex-wrap gap-3">
          <Link to="/" className="btn-ghost text-sm">← Back to home</Link>
          <Link to="/" hash="activate" className="btn-red text-sm">Activate my TV →</Link>
        </div>
      </main>
    </div>
  );
}
