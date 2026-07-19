import { createFileRoute, Link } from "@tanstack/react-router";
import { LegalShell } from "@/components/LegalShell";

export const Route = createFileRoute("/terms")({
  head: () => ({
    meta: [
      { title: "Terms of Service — OKFLIX" },
      { name: "description", content: "The rules of the road for using OKFLIX's Netflix TV activation service." },
      { property: "og:title", content: "Terms of Service — OKFLIX" },
      { property: "og:description", content: "The rules of the road for using OKFLIX's Netflix TV activation service." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "index,follow" },
    ],
  }),
  component: TermsPage,
});

function TermsPage() {
  return (
    <LegalShell
      kicker="Legal"
      title="Terms of Service"
      updated="Effective July 2026"
      intro="By using OKFLIX you agree to the terms below. They exist to keep the service fast, fair, and available for everyone."
    >
      <Section n="01" title="What OKFLIX is">
        <p>OKFLIX is a free, community-supported tool that lets you sign a TV into Netflix using pooled Premium sessions. We are not affiliated with Netflix. Netflix, the Netflix logo, and related marks are trademarks of Netflix, Inc.</p>
      </Section>
      <Section n="02" title="Acceptable use">
        <p>Use the service for personal TV activation only. Don't automate requests, bypass rate limits, scrape the site, resell activations, or attempt to extract session data. Abuse triggers automatic quarantine and can result in a permanent ban.</p>
      </Section>
      <Section n="03" title="Account & authentication">
        <p>Some gates require Google Sign-In. You are responsible for keeping your account secure and for all activity performed under it. We may revoke access at any time to protect the pool.</p>
      </Section>
      <Section n="04" title="Availability">
        <p>Sessions rotate constantly and Netflix may invalidate any cookie at any time. We do not guarantee uptime, activation success, or availability of any specific region. Scheduled maintenance windows are announced in-app.</p>
      </Section>
      <Section n="05" title="No warranty · no liability">
        <p>The service is provided "as is" without warranty of any kind. To the maximum extent permitted by law, OKFLIX and its operators are not liable for indirect, incidental, or consequential damages arising from your use of the service.</p>
      </Section>
      <Section n="06" title="Changes">
        <p>We may update these terms as the product evolves. Material changes will be reflected here with a new effective date. Continued use after an update means you accept the revised terms. Questions? See the <Link to="/help" className="text-[#ff2a3a] hover:underline">Help Center</Link>.</p>
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
