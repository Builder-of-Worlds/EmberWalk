export type PhraseConcept = "wood_pile" | "dry_brush" | "wooden_fence" | "foundation_vent" | "tree_branch_over_roof" | "roof_debris";

export type PhraseRow = { baseline: string; candidates: readonly string[]; winner: string | null };

export const SAM_PHRASES: Record<PhraseConcept, PhraseRow> = {
  wood_pile: { baseline: "wood pile", candidates: [], winner: "wood pile" },
  dry_brush: { baseline: "dry brush", candidates: ["dead branches", "brush pile", "dry vegetation", "dead shrub"], winner: null },
  wooden_fence: { baseline: "wooden fence", candidates: ["fence", "wood fence", "wooden fence boards", "picket fence"], winner: null },
  foundation_vent: { baseline: "foundation vent", candidates: ["crawl space vent", "vent", "vent cover", "leaf pile", "dead leaves"], winner: null },
  tree_branch_over_roof: {
    baseline: "tree branch over roof",
    candidates: ["overhanging branch", "branch over the roof", "tree branch", "dead branch"],
    winner: null,
  },
  roof_debris: { baseline: "roof debris", candidates: ["gutter leaves", "leaves in gutter", "gutter debris", "dead leaves"], winner: null },
};

export const samPhrase = (concept: PhraseConcept): string => SAM_PHRASES[concept].winner ?? SAM_PHRASES[concept].baseline;

const chosen = (pair: string): [PhraseConcept, string] => {
  const at = pair.indexOf("=");
  if (at < 1) throw new Error(`a chosen phrase needs concept=words: ${pair}`);
  const [concept, phrase] = [pair.slice(0, at), pair.slice(at + 1)];
  if (!Object.hasOwn(SAM_PHRASES, concept)) throw new Error(`${concept} has no row in the phrase table`);
  const row = SAM_PHRASES[concept as PhraseConcept];
  if (![row.baseline, ...row.candidates].includes(phrase)) throw new Error(`"${phrase}" is not one of the phrases for ${concept}`);
  return [concept as PhraseConcept, phrase];
};

// Every concept=words pair is checked before any row changes, so a refused list leaves the table as it was.
export const choosePhrases = (pairs: readonly string[]): void => {
  for (const [concept, phrase] of pairs.map(chosen)) SAM_PHRASES[concept].winner = phrase;
};
