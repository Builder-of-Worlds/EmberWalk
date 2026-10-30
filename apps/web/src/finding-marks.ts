export type Removal = { findingId: string; atMs: number };

export const STATUSES = ["needs_fixing", "fix_planned", "done"] as const;
export type StatusKind = (typeof STATUSES)[number];

export type Recheck = { photo: string; atMs: number };

export type FindingStatus = { kind: StatusKind; note: string; recheck: Recheck | null; doneOn?: string };

export const NEEDS_FIXING: FindingStatus = { kind: "needs_fixing", note: "", recheck: null };

export const isRechecked = (status: FindingStatus): status is FindingStatus & { recheck: Recheck } =>
  status.kind === "done" && status.recheck !== null;

export type FindingMarks = {
  removed(resultsId: string): Removal[];
  remove(resultsId: string, findingId: string, atMs: number): void;
  restore(resultsId: string, findingId: string): void;
  statusOf(resultsId: string, findingId: string): FindingStatus;
  setStatus(resultsId: string, findingId: string, kind: StatusKind, note?: string, doneOn?: string): void;
};

type Stored = { removed: Record<string, number>; status: Record<string, FindingStatus> };

export const marksKey = (resultsId: string): string => `emberwalk.findings.${resultsId}`;

const empty = (): Stored => ({ removed: {}, status: {} });

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const DAY = /^\d{4}-\d{2}-\d{2}$/;

const isTime = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

const recheckIn = (value: unknown): Recheck | null =>
  isRecord(value) && typeof value.photo === "string" && value.photo !== "" && isTime(value.atMs)
    ? { photo: value.photo, atMs: value.atMs }
    : null;

const statusIn = (value: unknown): FindingStatus | null => {
  if (!isRecord(value) || !STATUSES.includes(value.kind as StatusKind)) return null;
  const kind = value.kind as StatusKind;
  return {
    kind,
    note: kind === "fix_planned" && typeof value.note === "string" ? value.note : "",
    recheck: kind === "done" ? recheckIn(value.recheck) : null,
    ...(kind === "done" && typeof value.doneOn === "string" && DAY.test(value.doneOn) ? { doneOn: value.doneOn } : {}),
  };
};

export const parseMarks = (text: string | null): Stored => {
  if (text === null) return empty();
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return empty();
  }
  if (!isRecord(value)) return empty();
  const stored = empty();
  if (isRecord(value.removed)) for (const [id, atMs] of Object.entries(value.removed)) if (isTime(atMs)) stored.removed[id] = atMs;
  if (isRecord(value.status))
    for (const [id, raw] of Object.entries(value.status)) {
      const status = statusIn(raw);
      if (status !== null) stored.status[id] = status;
    }
  return stored;
};

export const storageFindingMarks = (storage: () => Storage): FindingMarks => {
  const known = new Map<string, Stored>();
  const read = (resultsId: string): Stored => {
    const cached = known.get(resultsId);
    if (cached !== undefined) return cached;
    let text: string | null;
    try {
      text = storage().getItem(marksKey(resultsId));
    } catch {
      text = null;
    }
    const stored = parseMarks(text);
    known.set(resultsId, stored);
    return stored;
  };
  const write = (resultsId: string, stored: Stored) => {
    known.set(resultsId, stored);
    try {
      storage().setItem(marksKey(resultsId), JSON.stringify(stored));
    } catch {
      return;
    }
  };
  const statusOf = (resultsId: string, findingId: string): FindingStatus =>
    Object.hasOwn(read(resultsId).status, findingId) ? read(resultsId).status[findingId]! : NEEDS_FIXING;
  return {
    removed: (resultsId) =>
      Object.entries(read(resultsId).removed)
        .map(([findingId, atMs]) => ({ findingId, atMs }))
        .sort((a, b) => a.atMs - b.atMs),
    remove: (resultsId, findingId, atMs) => {
      const stored = read(resultsId);
      if (findingId in stored.removed) return;
      write(resultsId, { ...stored, removed: { ...stored.removed, [findingId]: atMs } });
    },
    restore: (resultsId, findingId) => {
      const stored = read(resultsId);
      if (!(findingId in stored.removed)) return;
      const removed = Object.fromEntries(Object.entries(stored.removed).filter(([id]) => id !== findingId));
      write(resultsId, { ...stored, removed });
    },
    statusOf,
    setStatus: (resultsId, findingId, kind, note = "", doneOn) => {
      const current = statusOf(resultsId, findingId);
      const sameDay = doneOn === undefined || doneOn === current.doneOn;
      if (kind === "done" && current.kind === "done" && sameDay) return;
      const stored = read(resultsId);
      const status = Object.fromEntries(Object.entries(stored.status).filter(([id]) => id !== findingId));
      if (kind === "done" && current.kind === "done") status[findingId] = { ...current, doneOn: doneOn as string };
      else if (kind !== "needs_fixing")
        status[findingId] = {
          kind,
          note: kind === "fix_planned" ? note.trim() : "",
          recheck: null,
          ...(kind === "done" && doneOn !== undefined ? { doneOn } : {}),
        };
      write(resultsId, { ...stored, status });
    },
  };
};
