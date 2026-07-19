import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { getPublicContacts } from "@/lib/settings.functions";
import { Send, Instagram, Phone, Mail, Hash } from "lucide-react";
import { LegalShell } from "@/components/LegalShell";

export const Route = createFileRoute("/help")({
  head: () => ({
    meta: [
      { title: "Help Center — Emberlord" },
      { name: "description", content: "Troubleshoot activation, understand error codes, and reach Emberlord support." },
      { property: "og:title", content: "Help Center — Emberlord" },
      { property: "og:description", content: "Troubleshoot activation, understand error codes, and reach Emberlord support." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "index,follow" },
    ],
  }),
  component: HelpPage,
});

const topics = [
  {
    n: "01",
    title: "Where do I find the 8-character TV code?",
    body: "On your TV, open the Netflix app and sign out (or select 'Sign in with a code'). Netflix will show netflix.com/tv8 and an 8-character code. Type that code exactly into Emberlord.",
  },
  {
    n: "02",
    title: "My code is valid but activation failed",
    body: "Codes expire fast — usually within a few minutes. If it says 'expired code,' pull a fresh one from your TV. If it says 'wrong code,' double-check for O/0 and I/1 confusions. Everything else is on our side and we'll retry automatically.",
  },
  {
    n: "03",
    title: "How long does the session last?",
    body: "Sessions typically last several days but Netflix can invalidate any cookie at any time. If your TV signs out, come back and activate again — it's free and takes seconds.",
  },
  {
    n: "04",
    title: "Do I need to sign in?",
    body: "Only when the Login gate is enabled by the operator. When it is, we support Google Sign-In. We never see your Netflix email or password.",
  },
  {
    n: "05",
    title: "Is this legal / safe?",
    body: "Emberlord uses pooled Premium sessions donated to the community. We are not affiliated with Netflix. Your TV device and your personal data are never exposed to other users of the pool.",
  },
  {
    n: "06",
    title: "How do I report abuse or a bug?",
    body: "Use the contact channels at the bottom of the home page. For security issues, please include reproduction steps and give us 48 hours before public disclosure.",
  },
];

function HelpPage() {
  return (
    <LegalShell
      kicker="Support"
      title="Help Center"
      updated="Answers · troubleshooting · contact"
      intro="Most activation issues resolve in under a minute. Start with the topics below — if none match, reach us through the contact strip on the home page."
    >
      {topics.map((t) => (
        <section key={t.n} className="space-y-2">
          <div className="flex items-baseline gap-3">
            <span className="font-mono text-xs text-[#ff2a3a]/80 tracking-widest">Q · {t.n}</span>
            <h2 className="font-display text-lg md:text-xl text-white">{t.title}</h2>
          </div>
          <p className="text-white/70 leading-relaxed text-sm md:text-base">{t.body}</p>
        </section>
      ))}
      <section id="contact" className="pt-6 border-t border-white/10 space-y-4 scroll-mt-24">
        <div className="flex items-baseline gap-3">
          <span className="font-mono text-xs text-[#ff2a3a]/80 tracking-widest">// Contact</span>
          <h2 className="font-display text-lg md:text-xl text-white">Reach the team</h2>
        </div>
        <p className="text-white/60 text-sm">
          For activation help, abuse reports, or press inquiries — pick whichever channel is easiest. Handles are managed live by the operator.
        </p>
        <ContactList />
        <p className="text-white/60 text-sm">
          Still stuck? Head back to the <Link to="/" hash="activate" className="text-[#ff2a3a] hover:underline">activation form</Link> — our system will
          auto-retry with a fresh session.
        </p>
      </section>
    </LegalShell>
  );
}

function ContactList() {
  const fetchContacts = useServerFn(getPublicContacts);
  const q = useQuery({
    queryKey: ["public-contacts", "help"],
    queryFn: () => fetchContacts(),
    refetchInterval: 2000,
    refetchOnWindowFocus: true,
    staleTime: 0,
  });
  const channels = q.data?.channels ?? [];
  const iconFor = (kind: string) => {
    if (kind === "telegram") return Send;
    if (kind === "instagram") return Instagram;
    if (kind === "email") return Mail;
    if (kind === "discord") return Hash;
    return Phone;
  };
  const labelFor = (kind: string) => {
    if (kind === "telegram") return "Telegram";
    if (kind === "instagram") return "Instagram";
    if (kind === "whatsapp") return "WhatsApp";
    if (kind === "email") return "Email";
    if (kind === "discord") return "Discord";
    return kind;
  };
  if (q.isLoading) {
    return <div className="text-white/40 text-sm font-mono">Loading channels…</div>;
  }
  if (channels.length === 0) {
    return (
      <div className="rounded-md border border-white/10 bg-white/[0.02] p-4 text-white/50 text-sm">
        Contact channels are currently offline. Please check back shortly.
      </div>
    );
  }
  return (
    <div className="grid sm:grid-cols-2 gap-3">
      {channels.map((c) => {
        const Icon = iconFor(c.kind);
        const isMail = c.kind === "email";
        return (
          <a
            key={c.kind}
            href={c.href}
            {...(isMail ? {} : { target: "_blank", rel: "noopener noreferrer" })}
            className="group flex items-center gap-3 rounded-lg border border-white/10 bg-white/[0.03] px-4 py-3 hover:border-[#ff2a3a]/40 hover:bg-[#ff2a3a]/[0.06] transition"
          >
            <span className="w-10 h-10 rounded-md flex items-center justify-center border border-white/10 bg-white/[0.03] text-white/70 group-hover:text-[#ff2a3a] group-hover:border-[#ff2a3a]/40 transition">
              <Icon className="w-4 h-4" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-[10px] uppercase tracking-[0.28em] font-mono text-white/40">
                {c.name?.trim() ? c.name : labelFor(c.kind)}
              </div>
              <div className="text-sm text-white/90 truncate font-mono">{c.handle}</div>
            </div>
          </a>
        );
      })}
    </div>
  );
}
