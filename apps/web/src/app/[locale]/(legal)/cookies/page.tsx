import { env } from "@/lib/env";
import { Cookie, ShieldCheck, Mail } from "lucide-react";

export const metadata = {
  title: "Politique relative aux cookies | GigaPDF",
  description: "Politique GigaPDF relative aux cookies — uniquement strictement nécessaires.",
};

export default function CookiesPage() {
  return (
    <div className="max-w-none">
      <div className="mb-12 not-prose">
        <div className="inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/5 px-4 py-1.5 text-sm mb-6">
          <Cookie className="h-4 w-4 text-primary" />
          <span className="font-mono text-primary">cookies-policy</span>
        </div>
        <h1 className="text-4xl md:text-5xl font-bold tracking-tight mb-4">Politique relative aux cookies</h1>
        <p className="text-muted-foreground font-mono text-sm">
          <span className="text-terminal-green">$</span> last_updated: 2026-04-26
        </p>
      </div>

      <section className="mb-12">
        <p className="text-muted-foreground leading-relaxed text-lg">
          GigaPDF utilise un nombre minimal de cookies, tous strictement nécessaires
          au fonctionnement du service. <strong>Aucun cookie de tracking, publicité
          ou analytics tiers</strong> n'est déposé.
        </p>
      </section>

      <section className="mb-12">
        <h2 className="text-2xl font-bold mb-4">Cookies utilisés</h2>
        <div className="overflow-x-auto rounded-xl border border-border bg-card/50 not-prose">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="px-4 py-3 text-left font-mono text-terminal-cyan">Nom</th>
                <th className="px-4 py-3 text-left font-mono text-terminal-cyan">Finalité</th>
                <th className="px-4 py-3 text-left font-mono text-terminal-cyan">Durée</th>
                <th className="px-4 py-3 text-left font-mono text-terminal-cyan">Type</th>
              </tr>
            </thead>
            <tbody className="font-mono text-xs">
              <tr className="border-t border-border">
                <td className="px-4 py-3"><code>better-auth.session_token</code></td>
                <td className="px-4 py-3">Session authentifiée</td>
                <td className="px-4 py-3">7 jours</td>
                <td className="px-4 py-3">Strictement nécessaire (httpOnly + Secure)</td>
              </tr>
              <tr className="border-t border-border">
                <td className="px-4 py-3"><code>better-auth.csrf_token</code></td>
                <td className="px-4 py-3">Protection CSRF</td>
                <td className="px-4 py-3">Session</td>
                <td className="px-4 py-3">Strictement nécessaire</td>
              </tr>
              <tr className="border-t border-border">
                <td className="px-4 py-3"><code>NEXT_LOCALE</code></td>
                <td className="px-4 py-3">Préférence de langue</td>
                <td className="px-4 py-3">1 an</td>
                <td className="px-4 py-3">Strictement nécessaire (UX)</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section className="mb-12">
        <div className="flex items-center gap-3 mb-4 not-prose">
          <div className="w-10 h-10 rounded-lg bg-accent/10 flex items-center justify-center">
            <ShieldCheck className="h-5 w-5 text-accent" />
          </div>
          <h2 className="text-2xl font-bold m-0">Pas de bannière de consentement ?</h2>
        </div>
        <p className="text-muted-foreground leading-relaxed">
          Conformément aux directives CNIL (lignes directrices et recommandations
          du 17 septembre 2020), les cookies strictement nécessaires ne requièrent
          pas de consentement préalable. Aucune bannière n'est donc affichée.
        </p>
        <p className="text-muted-foreground leading-relaxed mt-4">
          Si vous activez une intégration tierce (par exemple, l'intégration PDF
          embed sur un site externe), des cookies tiers peuvent s'ajouter dans le
          cadre de cette intégration ; ils sont alors régis par la politique du
          site qui héberge l'intégration.
        </p>
      </section>

      <section className="mb-12">
        <h2 className="text-2xl font-bold mb-4">Comment désactiver les cookies</h2>
        <p className="text-muted-foreground leading-relaxed">
          Vous pouvez configurer votre navigateur pour bloquer tous les cookies.
          <strong> Note importante</strong> : le service ne fonctionnera plus si
          vous le faites (impossible de rester connecté ; les préférences seront
          perdues à chaque rechargement).
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
          Pour toute question relative à cette politique :{" "}
          <a href={`mailto:${env.NEXT_PUBLIC_LEGAL_CONTACT_EMAIL}`} className="text-primary hover:underline">
            {env.NEXT_PUBLIC_LEGAL_CONTACT_EMAIL}
          </a>.
        </p>
      </section>
    </div>
  );
}
