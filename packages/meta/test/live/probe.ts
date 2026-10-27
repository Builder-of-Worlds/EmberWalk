import type { MetaClient } from "../../src/client.ts";
import { type PhraseConcept, SAM_PHRASES } from "../../src/phrases.ts";
import { PRICE_NANO_USD, samVideoFramesBilled, toNano } from "../../src/prices.ts";
import { type SamFrame, samVideoCall, type SamVideo } from "../../src/sam.ts";
import { type SpendLedger, utcDay } from "../../src/stores.ts";
import { type Hazard, matchHazard, type Motion } from "./env.ts";

export class ProbeStopLine extends Error {
  constructor(readonly spentUsd: number, readonly stopLineUsd: number) {
    super(`probe stopped: spent ${spentUsd} USD and the next call would pass the ${stopLineUsd} USD stop line`);
  }
}

export type Score = { window: number; hits: number; elsewhere: number; found: boolean };
export type ProbeRow = Score & { hazard: string; phrase: string; costUsd: number; cached: boolean; fingerprint: string };

export const isFound = (hits: number, window: number): boolean => window > 0 && hits >= Math.ceil(window / 2);

export function scoreFrames(hazard: Hazard, frames: SamFrame[], m: Motion, fps: number): Score {
  const r = matchHazard(hazard, frames, m, fps);
  return { window: r.window.length, hits: r.hits.length, elsewhere: r.elsewhere.length, found: isFound(r.hits.length, r.window.length) };
}

export function scoreRecorded(hazard: Hazard, raw: unknown, m: Motion, fps: number): Score {
  const call = samVideoCall({ video: { fileId: "recorded" }, concept: hazard.concept, frames: 1, content: "synthetic" });
  return scoreFrames(hazard, call.read(raw).frames, m, fps);
}

export const conceptOf = (hazard: Hazard): PhraseConcept | null => {
  const id = hazard.concept.replace(/ /g, "_");
  return Object.hasOwn(SAM_PHRASES, id) ? (id as PhraseConcept) : null;
};

export type ProbeOptions = {
  client: MetaClient;
  ledger: SpendLedger;
  video: SamVideo;
  frames: number;
  fps: number;
  stopLineUsd: number;
  hazards: Hazard[];
  motion: Motion;
  now?: () => Date;
};

export async function assertRoomFor(o: { ledger: SpendLedger; stopLineUsd: number; now?: () => Date }, nextNano: number): Promise<void> {
  const spentUsd = await o.ledger.spentUsd(utcDay((o.now ?? (() => new Date()))().toISOString()));
  if (toNano(spentUsd) + nextNano > toNano(o.stopLineUsd)) throw new ProbeStopLine(spentUsd, o.stopLineUsd);
}

const assertRoom = (o: ProbeOptions): Promise<void> => assertRoomFor(o, samVideoFramesBilled(o.frames) * PRICE_NANO_USD.samVideoFrame);

export async function runProbe(o: ProbeOptions): Promise<ProbeRow[]> {
  const rows: ProbeRow[] = [];
  for (const hazard of o.hazards) {
    const concept = conceptOf(hazard);
    if (concept === null) continue;
    for (const phrase of SAM_PHRASES[concept].candidates) {
      await assertRoom(o);
      const a = await o.client.call(samVideoCall({ video: o.video, concept: phrase, frames: o.frames, content: "synthetic" }));
      rows.push({ hazard: hazard.id, phrase, ...scoreFrames(hazard, a.value.frames, o.motion, o.fps), costUsd: a.costUsd, cached: a.cached, fingerprint: a.fingerprint });
    }
  }
  return rows;
}
