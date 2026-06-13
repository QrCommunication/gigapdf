/**
 * Invariants des données SEO programmatique (tools + solutions).
 *
 * Protège contre les régressions éditoriales : longueurs méta dépassées,
 * liens internes cassés (slugs related inexistants), contenu trop maigre
 * (thin content) et phrases dupliquées entre intros (gabarit déguisé).
 */

import { describe, expect, it } from "vitest";
import { SOLUTIONS } from "../solutions-data";
import { TOOLS } from "../tools-data";

const TOOL_SLUGS = new Set(TOOLS.map((tool) => tool.slug));
const SOLUTION_SLUGS = new Set(SOLUTIONS.map((solution) => solution.slug));

function wordCount(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

describe("tools-data", () => {
  it("contient les 20 outils attendus, sans doublon de slug", () => {
    expect(TOOLS).toHaveLength(20);
    expect(TOOL_SLUGS.size).toBe(20);
  });

  it.each(TOOLS.map((tool) => [tool.slug, tool] as const))(
    "%s respecte les contraintes éditoriales",
    (_slug, tool) => {
      expect(tool.metaTitle.length).toBeLessThanOrEqual(60);
      expect(tool.metaDescription.length).toBeLessThanOrEqual(155);
      expect(tool.intro.length).toBeGreaterThanOrEqual(2);
      expect(tool.intro.length).toBeLessThanOrEqual(3);
      expect(tool.howTo.steps.length).toBeGreaterThanOrEqual(4);
      expect(tool.howTo.steps.length).toBeLessThanOrEqual(6);
      expect(tool.faq.length).toBeGreaterThanOrEqual(4);
      expect(tool.faq.length).toBeLessThanOrEqual(6);
      expect(tool.useCases).toHaveLength(3);

      // ≥ 400 mots utiles par page
      const words = wordCount(
        [
          ...tool.intro,
          ...tool.howTo.steps,
          ...tool.capabilities,
          ...tool.faq.flatMap((item) => [item.question, item.answer]),
          ...tool.useCases,
        ].join(" "),
      );
      expect(words).toBeGreaterThanOrEqual(400);

      // Maillage interne : tous les slugs référencés existent
      for (const related of tool.relatedTools) {
        expect(TOOL_SLUGS.has(related), `relatedTool inconnu: ${related}`).toBe(true);
        expect(related).not.toBe(tool.slug);
      }
      for (const related of tool.relatedSolutions) {
        expect(SOLUTION_SLUGS.has(related), `relatedSolution inconnue: ${related}`).toBe(
          true,
        );
      }
      expect(tool.relatedTools.length).toBeGreaterThanOrEqual(3);
      expect(tool.relatedSolutions.length).toBeGreaterThanOrEqual(2);
    },
  );

  it("aucune phrase d'intro n'est partagée entre deux outils (anti-gabarit)", () => {
    const seen = new Map<string, string>();
    const duplicates: string[] = [];

    for (const tool of TOOLS) {
      for (const paragraph of tool.intro) {
        for (const raw of paragraph.split(/(?<=[.!?])\s+/)) {
          const sentence = raw.trim();
          if (sentence.length < 40) continue;
          const owner = seen.get(sentence);
          if (owner && owner !== tool.slug) {
            duplicates.push(`[${owner} & ${tool.slug}] ${sentence.slice(0, 80)}`);
          }
          seen.set(sentence, tool.slug);
        }
      }
    }

    expect(duplicates).toEqual([]);
  });
});

describe("solutions-data", () => {
  it("contient les 10 solutions attendues, sans doublon de slug", () => {
    expect(SOLUTIONS).toHaveLength(10);
    expect(SOLUTION_SLUGS.size).toBe(10);
  });

  it.each(SOLUTIONS.map((solution) => [solution.slug, solution] as const))(
    "%s respecte les contraintes éditoriales",
    (_slug, solution) => {
      expect(solution.metaTitle.length).toBeLessThanOrEqual(60);
      expect(solution.metaDescription.length).toBeLessThanOrEqual(155);
      expect(solution.intro.length).toBeGreaterThanOrEqual(2);
      expect(solution.intro.length).toBeLessThanOrEqual(3);
      expect(solution.workflows.length).toBeGreaterThanOrEqual(3);
      expect(solution.workflows.length).toBeLessThanOrEqual(4);
      expect(solution.faq.length).toBeGreaterThanOrEqual(4);

      const words = wordCount(
        [
          ...solution.intro,
          ...solution.workflows.flatMap((workflow) => [
            workflow.title,
            workflow.description,
          ]),
          ...solution.capabilities,
          ...solution.faq.flatMap((item) => [item.question, item.answer]),
        ].join(" "),
      );
      expect(words).toBeGreaterThanOrEqual(400);

      for (const related of solution.relatedTools) {
        expect(TOOL_SLUGS.has(related), `relatedTool inconnu: ${related}`).toBe(true);
      }
      expect(solution.relatedTools.length).toBeGreaterThanOrEqual(3);
    },
  );

  it("aucune phrase d'intro n'est partagée entre deux solutions (anti-gabarit)", () => {
    const seen = new Map<string, string>();
    const duplicates: string[] = [];

    for (const solution of SOLUTIONS) {
      for (const paragraph of solution.intro) {
        for (const raw of paragraph.split(/(?<=[.!?])\s+/)) {
          const sentence = raw.trim();
          if (sentence.length < 40) continue;
          const owner = seen.get(sentence);
          if (owner && owner !== solution.slug) {
            duplicates.push(`[${owner} & ${solution.slug}] ${sentence.slice(0, 80)}`);
          }
          seen.set(sentence, solution.slug);
        }
      }
    }

    expect(duplicates).toEqual([]);
  });
});
