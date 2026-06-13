import { env } from "@/lib/env";
import { Building2, Server, ShieldCheck, Mail } from "lucide-react";

export const metadata = {
  title: "Mentions légales | GigaPDF",
  description: "Mentions légales de l'éditeur du service GigaPDF, conformément à la LCEN.",
};

export default function LegalNoticePage() {
  return (
    <div className="max-w-none">
      <div className="mb-12 not-prose">
        <div className="inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/5 px-4 py-1.5 text-sm mb-6">
          <ShieldCheck className="h-4 w-4 text-primary" />
          <span className="font-mono text-primary">legal-notice</span>
        </div>
        <h1 className="text-4xl md:text-5xl font-bold tracking-tight mb-4">Mentions légales</h1>
        <p className="text-muted-foreground font-mono text-sm">
          <span className="text-terminal-green">$</span> last_updated: 2026-04-26
        </p>
      </div>

      <section className="mb-12">
        <div className="flex items-center gap-3 mb-4 not-prose">
          <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
            <Building2 className="h-5 w-5 text-primary" />
          </div>
          <h2 className="text-2xl font-bold m-0">Éditeur du site</h2>
        </div>
        <div className="rounded-xl border border-border bg-card/50 p-6 not-prose font-mono text-sm space-y-1">
          <p><span className="text-terminal-cyan">raison_sociale:</span> "{env.NEXT_PUBLIC_LEGAL_COMPANY_NAME}"</p>
          <p><span className="text-terminal-cyan">forme_juridique:</span> "{env.NEXT_PUBLIC_LEGAL_COMPANY_FORM}"</p>
          <p><span className="text-terminal-cyan">siren:</span> "{env.NEXT_PUBLIC_LEGAL_SIREN}"</p>
          {env.NEXT_PUBLIC_LEGAL_APE && (
            <p><span className="text-terminal-cyan">ape:</span> "{env.NEXT_PUBLIC_LEGAL_APE}"</p>
          )}
          <p><span className="text-terminal-cyan">siege_social:</span> "{env.NEXT_PUBLIC_LEGAL_ADDRESS}"</p>
          <p><span className="text-terminal-cyan">telephone:</span> "{env.NEXT_PUBLIC_LEGAL_PHONE}"</p>
          <p><span className="text-terminal-cyan">email:</span> <a href={`mailto:${env.NEXT_PUBLIC_LEGAL_CONTACT_EMAIL}`} className="text-primary hover:underline">"{env.NEXT_PUBLIC_LEGAL_CONTACT_EMAIL}"</a></p>
          <p><span className="text-terminal-cyan">directeur_publication:</span> "{env.NEXT_PUBLIC_LEGAL_PUBLICATION_DIRECTOR}"</p>
        </div>
      </section>

      <section className="mb-12">
        <div className="flex items-center gap-3 mb-4 not-prose">
          <div className="w-10 h-10 rounded-lg bg-accent/10 flex items-center justify-center">
            <Server className="h-5 w-5 text-accent" />
          </div>
          <h2 className="text-2xl font-bold m-0">Hébergeur</h2>
        </div>
        <div className="rounded-xl border border-border bg-card/50 p-6 not-prose font-mono text-sm space-y-1">
          <p><span className="text-terminal-cyan">nom:</span> "{env.NEXT_PUBLIC_LEGAL_HOST_NAME}"</p>
          <p><span className="text-terminal-cyan">adresse:</span> "{env.NEXT_PUBLIC_LEGAL_HOST_ADDRESS}"</p>
          {env.NEXT_PUBLIC_LEGAL_HOST_PHONE && (
            <p><span className="text-terminal-cyan">telephone:</span> "{env.NEXT_PUBLIC_LEGAL_HOST_PHONE}"</p>
          )}
        </div>
      </section>

      <section className="mb-12">
        <h2 className="text-2xl font-bold mb-4">Propriété intellectuelle</h2>
        <p className="text-muted-foreground leading-relaxed">
          Le code source de GigaPDF est distribué sous licence{" "}
          <a href="https://www.gnu.org/licenses/agpl-3.0.html" className="text-primary hover:underline" target="_blank" rel="noopener noreferrer">
            GNU AGPL-3.0-or-later
          </a>. Vous pouvez le consulter sur{" "}
          <a href="https://github.com/QrCommunication/gigapdf" className="text-primary hover:underline" target="_blank" rel="noopener noreferrer">
            github.com/QrCommunication/gigapdf
          </a>.
        </p>
        <p className="text-muted-foreground leading-relaxed mt-4">
          La marque <strong>« GigaPDF »</strong> et le logo associé sont la propriété
          exclusive de {env.NEXT_PUBLIC_LEGAL_COMPANY_NAME} {env.NEXT_PUBLIC_LEGAL_COMPANY_FORM}.
          Voir notre{" "}
          <a href="https://github.com/QrCommunication/gigapdf/blob/main/TRADEMARK.md" className="text-primary hover:underline" target="_blank" rel="noopener noreferrer">
            politique de marque
          </a>.
        </p>
      </section>

      <section className="mb-12">
        <div className="flex items-center gap-3 mb-4 not-prose">
          <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
            <Mail className="h-5 w-5 text-primary" />
          </div>
          <h2 className="text-2xl font-bold m-0">Contact</h2>
        </div>
        <p className="text-muted-foreground">
          Pour toute question concernant ces mentions légales, contactez-nous à{" "}
          <a href={`mailto:${env.NEXT_PUBLIC_LEGAL_CONTACT_EMAIL}`} className="text-primary hover:underline">
            {env.NEXT_PUBLIC_LEGAL_CONTACT_EMAIL}
          </a>.
        </p>
      </section>
    </div>
  );
}
