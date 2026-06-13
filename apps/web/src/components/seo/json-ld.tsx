/**
 * Injection de données structurées JSON-LD (schema.org).
 * Server component pur : sérialise l'objet dans un <script type="application/ld+json">.
 */

interface JsonLdProps {
  data: Record<string, unknown>;
}

export function JsonLd({ data }: JsonLdProps) {
  return (
    <script
      type="application/ld+json"
      // Échappement de "<" pour éviter toute fermeture prématurée de balise.
      dangerouslySetInnerHTML={{
        __html: JSON.stringify(data).replace(/</g, "\\u003c"),
      }}
    />
  );
}
