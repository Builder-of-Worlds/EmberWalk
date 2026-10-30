import { describe, expect, it } from "vitest";
import type { FixedApi, MarkRequest } from "../../src/fixed-api.ts";
import { localDay, PENDING_KEY, storageMarkSync } from "../../src/mark-sync.ts";
import { memoryStorage } from "./fakes.ts";

type Post = FixedApi["mark"];

const recording = (answer: (findingId: string, mark: MarkRequest) => Awaited<ReturnType<Post>>) => {
  const posted: [string, MarkRequest][] = [];
  const post: Post = async (findingId, mark) => {
    posted.push([findingId, mark]);
    return answer(findingId, mark);
  };
  return { posted, post };
};

const SAVED = { value: { saved: true } } as const;
const OFFLINE = { code: "offline", message: "" } as const;

describe("localDay", () => {
  it("is the phone's own calendar day as YYYY-MM-DD", () => {
    expect(localDay(new Date(2026, 9, 29, 23, 30).getTime())).toBe("2026-10-29");
    expect(localDay(new Date(2026, 0, 5, 0, 5).getTime())).toBe("2026-01-05");
  });
});

describe("the mark queue", () => {
  it("posts a mark at once and holds nothing back when the server saves it", async () => {
    const { posted, post } = recording(() => SAVED);
    const sync = storageMarkSync(() => memoryStorage(), post);
    expect(await sync.mark("f1", { status: "done", doneOn: "2026-10-28" })).toBe("saved");
    expect(posted).toEqual([["f1", { status: "done", doneOn: "2026-10-28" }]]);
    expect(sync.waiting()).toBe(0);
  });

  it("keeps a mark that could not be posted, on the phone, and posts it on the next flush", async () => {
    const storage = memoryStorage();
    let online = false;
    const { posted, post } = recording(() => (online ? SAVED : OFFLINE));
    expect(await storageMarkSync(() => storage, post).mark("f1", { status: "needs_fixing" })).toBe("waiting");
    const reopened = storageMarkSync(() => storage, post);
    expect(reopened.waiting()).toBe(1);
    online = true;
    await reopened.flush();
    expect(reopened.waiting()).toBe(0);
    expect(posted.at(-1)).toEqual(["f1", { status: "needs_fixing" }]);
    expect(JSON.parse(storage.getItem(PENDING_KEY) ?? "null")).toEqual([]);
  });

  it("keeps every mark in the order it was made, even several for one finding, so the record shows each step", async () => {
    let online = false;
    const { posted, post } = recording(() => (online ? SAVED : OFFLINE));
    const sync = storageMarkSync(() => memoryStorage(), post);
    await sync.mark("f1", { status: "fix_planned", note: "Saturday." });
    await sync.mark("f2", { status: "done", doneOn: "2026-10-27" });
    await sync.mark("f1", { status: "done", doneOn: "2026-10-28" });
    expect(sync.waiting()).toBe(3);
    posted.length = 0;
    online = true;
    await sync.flush();
    expect(posted).toEqual([
      ["f1", { status: "fix_planned", note: "Saturday." }],
      ["f2", { status: "done", doneOn: "2026-10-27" }],
      ["f1", { status: "done", doneOn: "2026-10-28" }],
    ]);
    expect(sync.waiting()).toBe(0);
  });

  it("stops at the first mark that cannot be posted, so none is posted out of order", async () => {
    const { posted, post } = recording(() => OFFLINE);
    const sync = storageMarkSync(() => memoryStorage(), post);
    await sync.mark("f1", { status: "needs_fixing" });
    await sync.mark("f2", { status: "needs_fixing" });
    expect(new Set(posted.map(([id]) => id))).toEqual(new Set(["f1"]));
    expect(sync.waiting()).toBe(2);
  });

  it("keeps a mark through a server error", async () => {
    const { post } = recording(() => ({ code: "server_error", message: "" }));
    const sync = storageMarkSync(() => memoryStorage(), post);
    expect(await sync.mark("a", { status: "needs_fixing" })).toBe("waiting");
    expect(sync.waiting()).toBe(1);
    expect(sync.refused("a")).toBe(false);
  });

  it.each(["invalid_request", "not_found", "unknown_walk", "body_too_large", "conflict"] as const)(
    "drops a mark the server refuses for good with %s, says it was refused, and lets later marks through",
    async (code) => {
      const answers: Record<string, Awaited<ReturnType<Post>>> = { b: { code, message: "" } };
      const { posted, post } = recording((id) => answers[id] ?? SAVED);
      const sync = storageMarkSync(() => memoryStorage(), post);
      expect(await sync.mark("b", { status: "needs_fixing" })).toBe("refused");
      expect(sync.waiting()).toBe(0);
      expect(sync.refused("b")).toBe(true);
      expect(await sync.mark("c", { status: "done", doneOn: "2026-10-28" })).toBe("saved");
      expect(posted.map(([id]) => id)).toEqual(["b", "c"]);
    },
  );

  it("does not let a refused mark hold back the marks queued behind it, and forgets the refusal when the finding is marked again and saved", async () => {
    let online = false;
    let refusing = true;
    const { posted, post } = recording((id) => (!online ? OFFLINE : id === "b" && refusing ? { code: "conflict", message: "" } : SAVED));
    const sync = storageMarkSync(() => memoryStorage(), post);
    await sync.mark("b", { status: "needs_fixing" });
    await sync.mark("c", { status: "needs_fixing" });
    posted.length = 0;
    online = true;
    await sync.flush();
    expect(posted.map(([id]) => id)).toEqual(["b", "c"]);
    expect(sync.refused("b")).toBe(true);
    expect(sync.refused("c")).toBe(false);
    refusing = false;
    const again = sync.mark("b", { status: "done", doneOn: "2026-10-28" });
    expect(sync.refused("b")).toBe(false);
    expect(await again).toBe("saved");
    expect(sync.refused("b")).toBe(false);
  });

  it("posts a mark made while an earlier post is still on its way", async () => {
    const waiting: (() => void)[] = [];
    const posted: string[] = [];
    const post: Post = (findingId) =>
      new Promise((resolve) => {
        posted.push(findingId);
        waiting.push(() => resolve(SAVED));
      });
    const sync = storageMarkSync(() => memoryStorage(), post);
    const first = sync.mark("f1", { status: "needs_fixing" });
    const second = sync.mark("f2", { status: "needs_fixing" });
    while (posted.length < 2) {
      waiting.shift()?.();
      await new Promise((r) => setTimeout(r, 0));
    }
    waiting.shift()?.();
    expect(await first).toBe("saved");
    expect(await second).toBe("saved");
    expect(posted).toEqual(["f1", "f2"]);
  });

  it("reads a damaged queue as empty and lives in memory when storage is refused", async () => {
    const storage = memoryStorage();
    storage.setItem(PENDING_KEY, "not json");
    expect(storageMarkSync(() => storage, async () => SAVED).waiting()).toBe(0);
    storage.setItem(PENDING_KEY, JSON.stringify([["f1", { status: "lost" }], ["f2", { status: "done", doneOn: "2026-10-28" }], 5]));
    expect(storageMarkSync(() => storage, async () => SAVED).waiting()).toBe(1);
    const refused = storageMarkSync(
      () => {
        throw new Error("insecure");
      },
      async () => OFFLINE,
    );
    expect(await refused.mark("f1", { status: "needs_fixing" })).toBe("waiting");
    expect(refused.waiting()).toBe(1);
  });
});
