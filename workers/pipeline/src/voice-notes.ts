import { clipsForWalk, detectionsForClip, findingsForWalk, getWalk, setVoiceNotes, tagsForWalk, type VoiceNote } from "@emberwalk/db";
import { type ContentKind, sparkJsonCall, type Turn } from "@emberwalk/meta";
import type { Clip, Finding, Tag, Track } from "@emberwalk/shared";
import { z } from "zod";
import type { Deps } from "./deps.ts";
import { clipStart } from "./prepare.ts";
import { retrying } from "./tracks.ts";
import { readTurns } from "./transcribe.ts";

export const NEAR_SECONDS = 5;
export const MAX_NOTE = 2000;

export type Span = { findingId: string; rank: number; start: number; end: number };

const gap = (t: Turn, s: Span): number => Math.max(0, s.start - t.end, t.start - s.end);
const overlap = (t: Turn, s: Span): number => Math.min(t.end, s.end) - Math.max(t.start, s.start);

const nearestFirst = (t: Turn) => (a: Span, b: Span): number =>
  gap(t, a) - gap(t, b) || (gap(t, a) === 0 ? overlap(t, b) - overlap(t, a) : 0) || a.rank - b.rank;

export const cutAtWord = (text: string, max = MAX_NOTE): string => {
  if (text.length <= max) return text;
  const space = text.slice(0, max + 1).lastIndexOf(" ");
  return (space > 0 ? text.slice(0, space) : text.slice(0, max)).trimEnd();
};

export function matchTurns(turns: Turn[], spans: Span[]): VoiceNote[] {
  const held = new Map<string, Turn[]>();
  for (const t of turns) {
    const best = spans.filter((s) => gap(t, s) <= NEAR_SECONDS).sort(nearestFirst(t))[0];
    if (best !== undefined) held.set(best.findingId, [...(held.get(best.findingId) ?? []), t]);
  }
  return [...spans]
    .sort((a, b) => a.rank - b.rank)
    .flatMap((s) => {
      const mine = held.get(s.findingId);
      if (mine === undefined) return [];
      return [{ findingId: s.findingId, text: cutAtWord([...mine].sort((a, b) => a.start - b.start).map((t) => t.text).join(" ")) }];
    });
}

export function findingSpans(findings: Finding[], tracks: Track[], clips: Clip[], tags: Tag[]): Span[] {
  const clipById = new Map(clips.map((c) => [c.id, c]));
  return findings.flatMap((f) => {
    const times = tracks
      .filter((t) => f.trackIds.includes(t.id))
      .flatMap((t) => {
        const clip = clipById.get(t.clipId);
        if (clip === undefined) return [];
        const start = clipStart(tags, clip.kind);
        return t.frames.map((frame) => start + frame.frame / clip.fps);
      });
    return times.length === 0 ? [] : [{ findingId: f.id, rank: f.rank, start: Math.min(...times), end: Math.max(...times) }];
  });
}

export const CLEAN_PHRASE = "Clean the punctuation and grammar of these notes.";

export const CLEAN_INSTRUCTIONS = [
  "Each note is what a homeowner said aloud about one thing in their yard.",
  "Fix punctuation, capital letters, spelling and grammar so each note reads well.",
  "Keep the person's meaning and their words in their order. Add nothing.",
  'Drop nothing except filler sounds such as "um" and "uh".',
  'Reply with JSON only, no other text: {"notes": [{"id": the note id, "text": the cleaned note}]}, one entry per note.',
].join("\n");

const Cleaned = z.strictObject({ notes: z.array(z.strictObject({ id: z.string(), text: z.string() })) });

const wordCount = (s: string): number => s.split(/\s+/).filter((w) => w !== "").length;

const keepCleaned = (raw: string, cleaned: string | undefined): string => {
  const text = cleaned?.trim() ?? "";
  return text === "" || text.length > MAX_NOTE || wordCount(text) * 2 < wordCount(raw) ? raw : text;
};

export async function cleanNotes(deps: Deps, walkId: string, notes: VoiceNote[], content: ContentKind): Promise<VoiceNote[]> {
  if (notes.length === 0) return [];
  const listed = notes.map((n, i) => ({ id: String(i + 1), text: n.text }));
  const chars = notes.reduce((sum, n) => sum + n.text.length, 0);
  const call = sparkJsonCall(
    {
      instructions: CLEAN_INSTRUCTIONS,
      input: [{ type: "message", role: "user", content: [{ type: "input_text", text: CLEAN_PHRASE }, { type: "input_text", text: JSON.stringify(listed) }] }],
      content,
      inputTokenEstimate: Math.ceil(chars / 3) + 500,
      maxOutputTokens: Math.ceil(chars / 2) + 1000,
      step: "transcribe",
      walkId,
      extra: { reasoning: { effort: "minimal" } },
    },
    Cleaned,
  );
  try {
    const answer = await retrying(deps, () => deps.meta().call(call));
    const byId = new Map(answer.value.notes.map((n) => [n.id, n.text]));
    return notes.map((n, i) => ({ findingId: n.findingId, text: keepCleaned(n.text, byId.get(String(i + 1))) }));
  } catch {
    return notes;
  }
}

export const storeVoiceNotes = async (deps: Deps, walkId: string): Promise<{ notes: number }> => {
  const turns = await readTurns(deps.bucket, walkId);
  if (turns.length === 0) return { notes: 0 };
  const walk = await getWalk(deps.db, walkId);
  if (walk === null) throw new Error(`walk ${walkId} is missing`);
  const [findings, clips, tags] = await Promise.all([findingsForWalk(deps.db, walkId), clipsForWalk(deps.db, walkId), tagsForWalk(deps.db, walkId)]);
  const tracks: Track[] = [];
  for (const clip of clips) tracks.push(...(await detectionsForClip(deps.db, clip.id)).tracks);
  const raw = matchTurns(turns, findingSpans(findings, tracks, clips, tags));
  const notes = await cleanNotes(deps, walkId, raw, walk.synthetic ? "synthetic" : "real");
  return { notes: await setVoiceNotes(deps.db, walkId, notes) };
};
