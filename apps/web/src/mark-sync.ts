import type { FixedApi, MarkRequest } from "./fixed-api.ts";

export type MarkOutcome = "saved" | "waiting" | "refused";

export type MarkSync = {
  mark(findingId: string, mark: MarkRequest): Promise<MarkOutcome>;
  flush(): Promise<void>;
  waiting(): number;
  refused(findingId: string): boolean;
};

type Entry = [findingId: string, mark: MarkRequest];

export const PENDING_KEY = "emberwalk.pendingMarks";

const REFUSED_FOR_GOOD = new Set(["invalid_request", "not_found", "unknown_walk", "body_too_large", "conflict"]);

export const localDay = (ms: number): string => {
  const at = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`;
};

const isMark = (value: unknown): value is MarkRequest =>
  typeof value === "object" && value !== null && ["needs_fixing", "fix_planned", "done"].includes((value as MarkRequest).status);

const readPending = (text: string | null): Entry[] => {
  const pending: Entry[] = [];
  if (text === null) return pending;
  try {
    const parsed: unknown = JSON.parse(text);
    if (Array.isArray(parsed))
      for (const item of parsed)
        if (Array.isArray(item) && typeof item[0] === "string" && isMark(item[1])) pending.push([item[0], item[1]]);
  } catch {
    return pending;
  }
  return pending;
};

export const storageMarkSync = (storage: () => Storage, post: FixedApi["mark"]): MarkSync => {
  let pending: Entry[] | null = null;
  let running: Promise<void> | null = null;
  const refusedEntries = new WeakSet<Entry>();
  const refusedIds = new Set<string>();
  const held = (): Entry[] => {
    if (pending === null) {
      let text: string | null;
      try {
        text = storage().getItem(PENDING_KEY);
      } catch {
        text = null;
      }
      pending = readPending(text);
    }
    return pending;
  };
  const save = () => {
    try {
      storage().setItem(PENDING_KEY, JSON.stringify(held()));
    } catch {
      return;
    }
  };
  const drain = async (): Promise<void> => {
    while (held().length > 0) {
      const entry = held()[0]!;
      const answer = await post(entry[0], entry[1]);
      if (answer.code !== undefined && !REFUSED_FOR_GOOD.has(answer.code)) return;
      if (answer.code === undefined) refusedIds.delete(entry[0]);
      else {
        refusedEntries.add(entry);
        refusedIds.add(entry[0]);
      }
      held().shift();
      save();
    }
  };
  const flush = (): Promise<void> => {
    running ??= drain().finally(() => {
      running = null;
    });
    return running;
  };
  return {
    mark: async (findingId, mark) => {
      const entry: Entry = [findingId, mark];
      refusedIds.delete(findingId);
      held().push(entry);
      save();
      await flush();
      return held().includes(entry) ? "waiting" : refusedEntries.has(entry) ? "refused" : "saved";
    },
    flush,
    waiting: () => held().length,
    refused: (findingId) => refusedIds.has(findingId),
  };
};
