import { d1Ledger, saveFindings } from "@emberwalk/db";
import { type Billing, type HttpRequest, type HttpResponse, MetaClient, type Transport } from "@emberwalk/meta";
import { type Finding, limitsWith } from "@emberwalk/shared";
import { env } from "cloudflare:workers";
import { r2Cache } from "../src/deps.ts";
import { freshWalkId, seedClip, seedWalk } from "./fixtures.ts";
import { idFor } from "./harness.ts";

const NOW = new Date("2026-10-29T18:00:00.000Z");

export const stillBytes = (rank: number): Uint8Array => new Uint8Array([0xff, 0xd8, 0xff, 0xe0, rank, 0xff, 0xd9]);

export const seedFindings = async (count: number, options: { synthetic?: boolean; vetoRank?: number; noStillRank?: number } = {}) => {
  const walkId = freshWalkId();
  await seedWalk(walkId, { state: "processing", synthetic: options.synthetic ?? true });
  const clip = await seedClip(walkId, Number(walkId.slice(-4)));
  const findings: Finding[] = Array.from({ length: count }, (_, i) => ({
    id: idFor(90_000 + Number(walkId.slice(-4)) * 100 + i),
    walkId,
    concept: "dry_brush",
    trackIds: [idFor(80_000 + i)],
    band: "zone_1",
    distanceFeet: { low: 6, high: 9 },
    contact: "no",
    severity: 7,
    rank: i + 1,
    proofFrame: { clipId: clip.id, frame: i, still: `stills/${walkId}/${clip.id}/${i}.jpg` },
    ruleIds: ["ca-dry-brush-ccr-z1"],
    label: "required_now",
    instruction: `Remove dry brush number ${i + 1} within 30 feet of the house.`,
    plantState: "dead",
    spacing: null,
    voiceNote: null,
    veto: i + 1 === options.vetoRank ? { reason: "it is a green lawn" } : null,
    source: "found",
    status: "needs_fixing",
  }));
  await saveFindings(env.DB, findings);
  for (const f of findings) if (f.rank !== options.noStillRank) await env.MEDIA.put(f.proofFrame.still, stillBytes(f.rank));
  return { walkId, findings };
};

export type Script = { requests: HttpRequest[]; answer: (req: HttpRequest) => HttpResponse };

export const json = (status: number, body: unknown): HttpResponse => ({ status, retryAfter: null, text: JSON.stringify(body) });

export const scripted = (answer: Script["answer"]): Script & { transport: Transport } => {
  const script: Script = { requests: [], answer };
  return {
    ...script,
    transport: async (req) => {
      script.requests.push(req);
      return script.answer(req);
    },
  };
};

export const clientOn = (transport: Transport, billing: Billing = "free_credits", capUsd = 20): MetaClient =>
  new MetaClient({
    transport,
    cache: r2Cache(env.DB, env.MEDIA, () => NOW),
    ledger: d1Ledger(env.DB),
    billing,
    limits: limitsWith({ dailySpendUsd: capUsd }),
    now: () => NOW,
  });

export const sentJson = (req: HttpRequest | undefined): Record<string, unknown> => (req !== undefined && "json" in req ? (req.json as Record<string, unknown>) : {});
