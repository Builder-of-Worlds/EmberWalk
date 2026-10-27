import { applyWording, clipsForWalk, detectionsForClip, findingsForWalk, getWalk, tagsForWalk } from "@emberwalk/db";
import { explain, type ExplainFinding, MAX_FRAMES } from "@emberwalk/explain";
import { CaJurisdiction, evaluate, observe, rank } from "@emberwalk/rules";
import { Language, type Track } from "@emberwalk/shared";
import type { Deps } from "./deps.ts";
import { clipStart } from "./prepare.ts";

export type Explained = { explained: number; saved: number; refused: string | null };

const sameIds = (a: string[], b: string[]): boolean => a.length === b.length && [...a].sort().join() === [...b].sort().join();

export const explainWalk = async (deps: Deps, walkId: string): Promise<Explained> => {
  const walk = await getWalk(deps.db, walkId);
  if (walk === null) throw new Error(`walk ${walkId} is missing`);
  const saved = (await findingsForWalk(deps.db, walkId)).filter((f) => f.source === "found");
  if (saved.length === 0) return { explained: 0, saved: 0, refused: null };
  const jurisdiction = CaJurisdiction.parse(walk.jurisdiction);

  const [clips, tags] = await Promise.all([clipsForWalk(deps.db, walkId), tagsForWalk(deps.db, walkId)]);
  const tracks: Track[] = [];
  for (const clip of clips) tracks.push(...(await detectionsForClip(deps.db, clip.id)).tracks);
  const startByClip = Object.fromEntries(clips.map((c) => [c.id, clipStart(tags, c.kind)]));
  const kept = new Map(observe({ clips, tracks, tags, startByClip }).kept.map((k) => [k.observation.id, k]));

  const findings: ExplainFinding[] = rank(evaluate([...kept.values()].map((k) => k.observation), jurisdiction)).flatMap((r) => {
    const { observation, trackIds } = kept.get(r.observationId)!;
    const match = saved.find((f) => f.concept === r.concept && sameIds(f.trackIds, trackIds));
    return match === undefined ? [] : [{ ...r, findingId: match.id, observation }];
  });
  if (findings.length === 0) return { explained: 0, saved: 0, refused: null };

  const stills = [...new Set(saved.filter((f) => findings.some((e) => e.findingId === f.id)).map((f) => f.proofFrame.still))];
  const frames = await Promise.all(stills.slice(0, MAX_FRAMES).map((key) => deps.signer.get(key)));
  const answer = await explain(deps.meta(), {
    walkId,
    jurisdiction,
    language: Language.parse(walk.language),
    content: walk.synthetic ? "synthetic" : "real",
    findings,
    turns: [],
    frames,
  });
  const wording = answer.results.map((r) => ({
    findingId: r.findingId,
    instruction: r.instruction,
    plantState: r.plantState,
    spacing: r.spacing,
    veto: r.verdict === "veto" ? r.reason : null,
  }));
  return { explained: findings.length, saved: await applyWording(deps.db, walkId, wording), refused: answer.refused };
};
