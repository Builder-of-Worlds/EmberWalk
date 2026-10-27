export type PhraseConcept = "wood_pile" | "dry_brush" | "wooden_fence";

export type PhraseRow = { baseline: string; candidates: readonly string[]; winner: string | null };

export const SAM_PHRASES: Record<PhraseConcept, PhraseRow> = {
  wood_pile: { baseline: "wood pile", candidates: [], winner: "wood pile" },
  dry_brush: { baseline: "dry brush", candidates: ["dead branches", "brush pile", "dry vegetation", "dead shrub"], winner: null },
  wooden_fence: { baseline: "wooden fence", candidates: ["fence", "wood fence", "wooden fence boards", "picket fence"], winner: null },
};

export const samPhrase = (concept: PhraseConcept): string => SAM_PHRASES[concept].winner ?? SAM_PHRASES[concept].baseline;
