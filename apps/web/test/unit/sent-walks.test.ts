import { describe, expect, it } from "vitest";
import { SENT_WALKS_KEY, storageSentWalks } from "../../src/sent-walks.ts";
import type { SentWalk } from "../../src/sent-walks.ts";
import { memoryStorage, refusingStorage } from "./fakes.ts";

const sent = (walkId: string, createdAt: number): SentWalk => ({ walkId, opens: `opens-${walkId}`, takeId: `take-${walkId}`, createdAt });

describe("walks sent and still being checked", () => {
  it("keeps each sent walk, newest first, until it is removed, across a reopen", () => {
    const storage = memoryStorage();
    const walks = storageSentWalks(() => storage);
    walks.add(sent("older", 1000));
    walks.add(sent("newer", 2000));
    expect(walks.all()).toEqual([sent("newer", 2000), sent("older", 1000)]);
    expect(storageSentWalks(() => storage).get("older")).toEqual(sent("older", 1000));
    walks.remove("newer");
    expect(storageSentWalks(() => storage).all()).toEqual([sent("older", 1000)]);
    expect(walks.get("newer")).toBeNull();
  });

  it("keeps one entry for a walk sent twice, the later one", () => {
    const storage = memoryStorage();
    const walks = storageSentWalks(() => storage);
    walks.add(sent("walk", 1000));
    walks.add({ ...sent("walk", 1000), opens: "parent" });
    expect(walks.all()).toEqual([{ ...sent("walk", 1000), opens: "parent" }]);
  });

  it("drops stored entries that are not sent walks, and reads unreadable storage as none", () => {
    const storage = memoryStorage();
    const good = sent("good", 5);
    storage.setItem(
      SENT_WALKS_KEY,
      JSON.stringify([good, { ...good, walkId: "" }, { ...good, walkId: 7 }, { ...good, opens: null }, { ...good, takeId: "" }, { ...good, createdAt: "today" }, null, "walk"]),
    );
    expect(storageSentWalks(() => storage).all()).toEqual([good]);
    for (const text of ["{", "{}", "null", `"walk"`]) {
      storage.setItem(SENT_WALKS_KEY, text);
      expect(storageSentWalks(() => storage).all(), text).toEqual([]);
    }
  });

  it("refuses nothing when the phone will not store: there is simply no entry", () => {
    const walks = storageSentWalks(refusingStorage);
    expect(() => walks.add(sent("walk", 1))).not.toThrow();
    expect(() => walks.remove("walk")).not.toThrow();
    expect(walks.all()).toEqual([]);
    expect(walks.get("walk")).toBeNull();
  });
});
