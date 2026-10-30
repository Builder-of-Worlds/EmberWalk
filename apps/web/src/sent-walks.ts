export type SentWalk = { walkId: string; opens: string; takeId: string; createdAt: number };

export type SentWalks = {
  all(): SentWalk[];
  get(walkId: string): SentWalk | null;
  add(walk: SentWalk): void;
  remove(walkId: string): void;
};

export const SENT_WALKS_KEY = "emberwalk.sentWalks";

const isId = (value: unknown): value is string => typeof value === "string" && value !== "";

const sentWalkIn = (value: unknown): SentWalk | null => {
  if (typeof value !== "object" || value === null) return null;
  const { walkId, opens, takeId, createdAt } = value as Record<string, unknown>;
  return isId(walkId) && isId(opens) && isId(takeId) && typeof createdAt === "number"
    ? { walkId, opens, takeId, createdAt }
    : null;
};

export const storageSentWalks = (storage: () => Storage): SentWalks => {
  const read = (): SentWalk[] => {
    let value: unknown;
    try {
      value = JSON.parse(storage().getItem(SENT_WALKS_KEY) ?? "[]");
    } catch {
      return [];
    }
    if (!Array.isArray(value)) return [];
    return value.map(sentWalkIn).filter((walk): walk is SentWalk => walk !== null);
  };
  const write = (walks: SentWalk[]) => {
    try {
      storage().setItem(SENT_WALKS_KEY, JSON.stringify(walks));
    } catch {
      return;
    }
  };
  const without = (walkId: string) => read().filter((walk) => walk.walkId !== walkId);
  return {
    all: () => read().sort((a, b) => b.createdAt - a.createdAt),
    get: (walkId) => read().find((walk) => walk.walkId === walkId) ?? null,
    add: (walk) => write([...without(walk.walkId), walk]),
    remove: (walkId) => write(without(walkId)),
  };
};
