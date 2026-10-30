import { describe, expect, it } from "vitest";
import type { Answer, Failure } from "../../src/api.ts";
import { PENDING_ABORTS_KEY, pendingAborts } from "../../src/uploader.ts";
import { memoryStorage } from "./fakes.ts";

const kept = (storage: Storage): unknown => JSON.parse(storage.getItem(PENDING_ABORTS_KEY) ?? "[]");

describe("stopping an upload that may need to wait for signal", () => {
  it.each(["offline", "server_error", "rate_limited"] as const)("keeps the id to try again after %s", async (code) => {
    const storage = memoryStorage();
    await pendingAborts(() => storage, async () => ({ code })).abort("u-1");
    expect(kept(storage)).toEqual(["u-1"]);
  });

  it.each([
    ["an answer", { value: { walkId: "w" } }],
    ["unknown_upload", { code: "unknown_upload" }],
    ["upload_aborted", { code: "upload_aborted" }],
    ["upload_completed", { code: "upload_completed" }],
  ] as const)("forgets the id after %s", async (_name, answer) => {
    const storage = memoryStorage();
    await pendingAborts(() => storage, async () => answer as Answer<unknown>).abort("u-1");
    expect(kept(storage)).toEqual([]);
  });

  it("keeps the id when the request throws, and tries each kept id once per retry, in order", async () => {
    const storage = memoryStorage();
    const asked: string[] = [];
    let answer: Failure | null = "offline";
    const aborts = pendingAborts(
      () => storage,
      async (uploadId) => {
        asked.push(uploadId);
        if (answer === "offline") throw new TypeError("Failed to fetch");
        return { value: { walkId: "w" } };
      },
    );
    await aborts.abort("u-1");
    await aborts.abort("u-2");
    await aborts.abort("u-1");
    expect(kept(storage)).toEqual(["u-1", "u-2"]);
    answer = null;
    asked.length = 0;
    await aborts.retry();
    expect(asked).toEqual(["u-1", "u-2"]);
    expect(storage.getItem(PENDING_ABORTS_KEY)).toBeNull();
  });
});
