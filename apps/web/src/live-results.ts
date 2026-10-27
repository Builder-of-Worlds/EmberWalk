import type { WalkResultsResponse } from "@emberwalk/shared";
import { useEffect, useState } from "react";
import { getter } from "./api.ts";
import type { Fetch, WalkApi } from "./api.ts";
import { useDeps } from "./deps.ts";
import type { WalkResults } from "./results.ts";
import type { LoadResults } from "./samples.ts";

export type Stills = (url: string) => Promise<Blob | null>;

const NOT_YET = new Set(["unknown_walk", "walk_not_done"]);

const LIVE_STILL = /^\/api\/walks\/[0-9a-f-]{36}\/stills\/[0-9a-f-]{36}$/;

export const toWalkResults = (body: WalkResultsResponse, base: string): WalkResults => ({
  id: body.walkId,
  walkedOn: body.walkedOn,
  synthetic: body.synthetic,
  coverage: body.coverage,
  gaps: [],
  findings: body.findings.map((f) => ({ ...f, proof: { ...f.proof, still: new URL(f.proof.still, base).href } })),
  notChecked: body.notChecked,
});

export const apiResults =
  (walks: Pick<WalkApi, "results">, base: string): LoadResults =>
  async (id) => {
    const answer = await walks.results(id);
    if (answer.code === undefined) return toWalkResults(answer.value, base);
    if (NOT_YET.has(answer.code)) return null;
    throw new Error(`the results of walk ${id} could not be loaded: ${answer.code}`);
  };

export const samplesThenApi =
  (samples: LoadResults, api: LoadResults): LoadResults =>
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

export const useStill = (still: string): string | null => {
  const { stills } = useDeps();
  const live = isLiveStill(still);
  const [shown, setShown] = useState<string | null>(null);

  useEffect(() => {
    if (!live) return;
    let left = false;
    let made: string | null = null;
    setShown(null);
    void stills(still).then((blob) => {
      if (left || blob === null) return;
      made = URL.createObjectURL(blob);
      setShown(made);
    });
    return () => {
      left = true;
      if (made !== null) URL.revokeObjectURL(made);
    };
  }, [still, live, stills]);

  return live ? shown : still;
};
