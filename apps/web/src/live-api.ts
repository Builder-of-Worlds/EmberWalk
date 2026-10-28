import type { WalkResultsResponse } from "@emberwalk/shared";
import { getter } from "./api.ts";
import type { Fetch, WalkApi } from "./api.ts";
import type { WalkResults } from "./results.ts";

export type Stills = (url: string) => Promise<Blob | null>;

type Load = (id: string) => Promise<WalkResults | null>;

const NOT_YET = new Set(["unknown_walk", "walk_not_done"]);

const LIVE_STILL = /^\/api\/walks\/[0-9a-f-]{36}\/stills\/[0-9a-f-]{36}$/;

export const toWalkResults = (body: WalkResultsResponse, base: string): WalkResults => ({
  id: body.walkId,
  walkedOn: body.walkedOn,
  synthetic: body.synthetic,
  coverage: body.coverage,
  gaps: body.gaps,
  findings: body.findings.map((f) => ({ ...f, proof: { ...f.proof, still: new URL(f.proof.still, base).href } })),
  notChecked: body.notChecked,
});

export const apiResults =
  (walks: Pick<WalkApi, "results">, base: string): Load =>
  async (id) => {
    const answer = await walks.results(id);
    if (answer.code === undefined) return toWalkResults(answer.value, base);
    if (NOT_YET.has(answer.code)) return null;
    throw new Error(`the results of walk ${id} could not be loaded: ${answer.code}`);
  };

export const samplesThenApi =
  (samples: Load, api: Load): Load =>
  async (id) => {
    const sample = await samples(id);
    return sample === null ? api(id) : { ...sample, coverage: "checked", notChecked: [] };
  };

export const isLiveStill = (url: string): boolean => LIVE_STILL.test(new URL(url, "https://phone.invalid").pathname);

export const apiStills = (send: Fetch, visitorId: () => string): Stills => {
  const get = getter(visitorId);
  return async (url) => {
    try {
      const response = await send(get(url));
      const blob = await response.blob();
      return response.ok && blob.type === "image/jpeg" ? blob : null;
    } catch {
      return null;
    }
  };
};
