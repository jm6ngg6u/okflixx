import { createFileRoute, Link } from "@tanstack/react-router";
import { LegalShell } from "@/components/LegalShell";

export const Route = createFileRoute("/privacy")({
  head: () => ({
    meta: [
      { title: "Privacy Policy — OKFLIX" },
      { name: "description", content: "How OKFLIX collects, uses, and protects your data during Netflix TV activation." },
      { property: "og:title", content: "Privacy Policy — OKFLIX" },
      { property: "og:description", content: "How OKFLIX collects, uses, and protects your data during Netflix TV activation." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "index,follow" },
    ],
  }),
  component: PrivacyPage,
});

function PrivacyPage() {
  return (
    <LegalShell
      kicker="Legal"
      title="Privacy Policy"
      updated="Effective July 2026"
      intro="This policy explains what we collect when you activate a Netflix session on your TV through OKFLIX, why we collect it, and the choices you have."
    >
      <Section n="01" title="What we collect">
        <p>We keep the activation surface small on purpose. When you enter an 8-character TV code we log the code, the outcome (success, wrong code, expired code), a truncated IP for rate-limiting, and a short-lived request identifier. We never see the shows you watch, your Netflix email, or your billing details.</p>
      </Section>
      <Section n="02" title="Why we collect it">
        <p>Data is used strictly to complete your activation, detect abuse (bots, brute-force, credential stuffing), and improve success rates across our cookie and proxy pools. Aggregated counts drive the public Live Activation Feed — no per-user data is exposed there.</p>
      </Section>
      <Section n="03" title="Retention">
        <p>Activation records auto-expire after 90 days. Failed attempts and rate-limit fingerprints are purged nightly by our scheduled cleanup job. Signed-in account data lives only as long as your account does.</p>
      </Section>
      <Section n="04" title="Third parties">
        <p>We use Google Sign-In for authentication and Netflix's public activation endpoint on your behalf. We do not sell, rent, or trade personal data. No advertising trackers run on this site.</p>
      </Section>
      <Section n="05" title="Your rights">
        <p>You can request deletion of your account and any linked activation history from your account page, or by contacting <Link to="/help" className="text-[#ff2a3a] hover:underline">Support</Link>. We respond within 7 days.</p>
      </Section>
      <Section n="06" title="Contact">
        <p>Privacy questions? Reach us through the channels listed on the <Link to="/help" className="text-[#ff2a3a] hover:underline">Help Center</Link>.</p>
      </Section>
    </LegalShell>
  );
}

function Section({ n, title, children }: { n: string; title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <div className="flex items-baseline gap-3">
        <span className="font-mono text-xs text-[#ff2a3a]/80 tracking-widest">§ {n}</span>
        <h2 className="font-display text-xl md:text-2xl text-white">{title}</h2>
      </div>
      <div className="text-white/70 leading-relaxed text-sm md:text-base">{children}</div>
    </section>
  );
}
