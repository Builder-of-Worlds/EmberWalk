import { getWalk } from "@emberwalk/db";
import { MetaRefused } from "@emberwalk/meta";
import type { Clip } from "@emberwalk/shared";
import type { Deps } from "./deps.ts";
import { type Outcome, pass, refuse } from "./outcome.ts";
import { askSam, refusalOutcome } from "./segment.ts";

export const PRIVACY_PHRASES = ["person", "face", "license plate", "house number", "street sign", "mailbox"] as const;

export const BOX_PADDING = 0.02;

export const HOUSE_NUMBER_MARGIN_PX = 3;

export type Region = [number, number, number, number];

export type PhraseCheck = { phrase: string; status: "checked" } | { phrase: string; status: "not_checked"; reason: string };

export type PrivacyRecord = { phrases: PhraseCheck[]; frames: { frame: number; regions: Region[] }[] };

export const privacyKey = (walkId: string, clipId: string): string => `privacy/${walkId}/${clipId}.json`;

const clamp = (n: number): number => Math.min(1, Math.max(0, n));

type Box = { left: number; top: number; right: number; bottom: number; frameWidth: number; frameHeight: number };

const grown = (box: Box, phrase: string): Region => {
  const tight = phrase === "house number";
  const padX = tight ? HOUSE_NUMBER_MARGIN_PX / box.frameWidth : BOX_PADDING;
  const padY = tight ? HOUSE_NUMBER_MARGIN_PX / box.frameHeight : BOX_PADDING;
  return [
    clamp(box.left / box.frameWidth - padX),
    clamp(box.top / box.frameHeight - padY),
    clamp(box.right / box.frameWidth + padX),
    clamp(box.bottom / box.frameHeight + padY),
  ];
};

export const findPrivacy = async (
  deps: Deps,
  walkId: string,
  clip: Clip,
  fileId: string,
): Promise<Outcome<{ clipId: string; regions: number; notChecked: number }>> => {
  const walk = await getWalk(deps.db, walkId);
  if (walk === null) return refuse("walk_missing", "This walk no longer exists.");
  const content = walk.synthetic ? "synthetic" : "real";
  let answers;
  try {
    answers = await Promise.all(PRIVACY_PHRASES.map((phrase) => askSam(deps, walkId, clip, fileId, phrase, content)));
  } catch (error) {
    if (error instanceof MetaRefused) return refusalOutcome(error);
    throw error;
  }

  const byFrame = new Map<number, Region[]>();
  const phrases = PRIVACY_PHRASES.map((phrase, i): PhraseCheck => {
    const answer = answers[i];
    if (answer === undefined || answer.failure !== null) return { phrase, status: "not_checked", reason: answer?.failure ?? "no answer" };
    for (const { frame, objects } of answer.frames) {
      byFrame.set(frame, [...(byFrame.get(frame) ?? []), ...objects.map((o) => grown(o.box, phrase))]);
    }
    return { phrase, status: "checked" };
  });
  const frames = [...byFrame].sort(([a], [b]) => a - b).map(([frame, regions]) => ({ frame, regions }));
  await deps.bucket.put(privacyKey(walkId, clip.id), JSON.stringify({ phrases, frames } satisfies PrivacyRecord));
  return pass({
    clipId: clip.id,
    regions: frames.reduce((n, f) => n + f.regions.length, 0),
    notChecked: phrases.filter((p) => p.status === "not_checked").length,
  });
};
