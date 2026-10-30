import { afterEach, describe, expect, it, vi } from "vitest";
import { stillPath, VISITOR_HEADER } from "@emberwalk/shared";
import { browserDeps } from "../../src/deps.ts";
import { SAMPLES } from "../../src/samples.ts";
import { SENT_WALKS_KEY } from "../../src/sent-walks.ts";
import { PENDING_ABORTS_KEY } from "../../src/uploader.ts";
import "./fakes.ts";
import { LIVE_WALK, liveBody, liveFindingId } from "./result-fakes.ts";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("browserDeps", () => {
  it("sends a walk by starting it at this site's POST /api/walks, as this phone's visitor", async () => {
    const seen: Request[] = [];
    vi.stubGlobal("fetch", async (request: Request) => {
      seen.push(request);
      return Response.json({ error: { code: "walk_limit_reached", message: "Limit." } }, { status: 429 });
    });
    const deps = browserDeps();
    const takes = await deps.takes();
    const take = await takes.create("video/mp4", 1);
    await takes.append(take.id, new Blob(["0123456789"]));

    expect(await deps.send(await takes.finish(take.id, 1000, "stopped"), () => undefined)).toEqual({ code: "walk_limit_reached" });
    expect(seen.map((r) => `${r.method} ${r.url}`)).toEqual([`POST ${window.location.origin}/api/walks`]);
    expect(await seen[0]?.json()).toMatchObject({ visitorId: deps.prefs.visitorId(), jurisdiction: "ca", synthetic: false });
    expect((await takes.get(take.id)).upload).toBeNull();
  });

  it("loads a walk that is not a sample from this site's results route, and its stills, as this phone's visitor", async () => {
    const seen: Request[] = [];
    vi.stubGlobal("fetch", async (request: Request) => {
      seen.push(request);
      if (request.url.endsWith("/results")) return Response.json(liveBody());
      return new Response(new Blob(["jpeg"], { type: "image/jpeg" }));
    });
    const deps = browserDeps();
    const found = await deps.results(LIVE_WALK);
    expect(found).toMatchObject({ id: LIVE_WALK, coverage: "not_checked" });
    const still = found!.findings[0]!.proof.still;
    expect(still).toBe(`${window.location.origin}${stillPath(LIVE_WALK, liveFindingId(1))}`);
    expect(await (await deps.stills(still))?.text()).toBe("jpeg");
    expect(seen.map((r) => `${r.method} ${r.url}`)).toEqual([`GET ${window.location.origin}/api/walks/${LIVE_WALK}/results`, `GET ${still}`]);
    expect(seen.map((r) => r.headers.get(VISITOR_HEADER))).toEqual([deps.prefs.visitorId(), deps.prefs.visitorId()]);
  });

  it("opens a bundled sample as checked without asking the API", async () => {
    const fetched = vi.fn();
    vi.stubGlobal("fetch", fetched);
    const found = await browserDeps().results(SAMPLES[0]!.id);
    expect(found).toMatchObject({ id: SAMPLES[0]!.id, coverage: "checked", notChecked: [] });
    expect(fetched).not.toHaveBeenCalled();
  });

  it("keeps the id of an upload it could not stop with no signal, and stops it when signal returns, when the app opens again and before the next send", async () => {
    localStorage.removeItem(PENDING_ABORTS_KEY);
    let signal = false;
    const seen: string[] = [];
    vi.stubGlobal("fetch", async (request: Request) => {
      if (!signal) throw new TypeError("Failed to fetch");
      const { pathname } = new URL(request.url);
      if (pathname !== "/api/uploads/abort") {
        seen.push(pathname);
        return Response.json({ error: { code: "walk_limit_reached", message: "Limit." } }, { status: 429 });
      }
      const { uploadId } = (await request.json()) as { uploadId: string };
      seen.push(`abort ${uploadId}`);
      return Response.json({ walkId: "w" });
    });
    const deps = browserDeps();
    await deps.abortUpload("u-online");
    await deps.abortUpload("u-reopen");
    await deps.abortUpload("u-send");
    expect(JSON.parse(localStorage.getItem(PENDING_ABORTS_KEY) ?? "null")).toEqual(["u-online", "u-reopen", "u-send"]);

    signal = true;
    window.dispatchEvent(new Event("online"));
    await vi.waitFor(() => expect(seen).toContain("abort u-send"));
    expect(new Set(seen)).toEqual(new Set(["abort u-online", "abort u-reopen", "abort u-send"]));
    expect(localStorage.getItem(PENDING_ABORTS_KEY)).toBeNull();

    signal = false;
    await deps.abortUpload("u-reopen");
    signal = true;
    seen.length = 0;
    browserDeps();
    await vi.waitFor(() => expect(seen).toEqual(["abort u-reopen"]));

    signal = false;
    await deps.abortUpload("u-send");
    signal = true;
    seen.length = 0;
    const takes = await deps.takes();
    const take = await takes.create("video/mp4", 1);
    await takes.append(take.id, new Blob(["0123456789"]));
    await deps.send(await takes.finish(take.id, 1000, "stopped"), () => undefined);
    expect(seen).toEqual(["abort u-send", "/api/walks"]);
    expect(localStorage.getItem(PENDING_ABORTS_KEY)).toBeNull();
  });

  it("keeps the id of an upload the send itself stops, when that stop cannot reach the server, so it is stopped later", async () => {
    localStorage.removeItem(PENDING_ABORTS_KEY);
    vi.stubGlobal("fetch", async (request: Request) => {
      const { pathname } = new URL(request.url);
      if (pathname === "/api/uploads/abort") throw new TypeError("Failed to fetch");
      if (pathname === "/api/uploads/part") return Response.json({ error: { code: "upload_expired", message: "Expired." } }, { status: 410 });
      return Response.json({ error: { code: "walk_not_uploading", message: "Not uploading." } }, { status: 409 });
    });
    const deps = browserDeps();
    const takes = await deps.takes();
    const take = await takes.create("video/mp4", 1);
    await takes.append(take.id, new Blob(["0123456789"]));
    await takes.saveUpload(take.id, { walkId: "w", uploadId: "u-expired", partBytes: 10, partCount: 1, parts: [] });
    await deps.send(await takes.finish(take.id, 1000, "stopped"), () => undefined);
    expect(JSON.parse(localStorage.getItem(PENDING_ABORTS_KEY) ?? "null")).toEqual(["u-expired"]);
    localStorage.removeItem(PENDING_ABORTS_KEY);
  });

  it("keeps the walks sent and still being checked in this phone's storage, so a reopened app finds them", () => {
    localStorage.removeItem(SENT_WALKS_KEY);
    const walk = { walkId: "w-1", opens: "w-1", takeId: "t-1", createdAt: 1000 };
    browserDeps().sentWalks.add(walk);
    expect(browserDeps().sentWalks.all()).toEqual([walk]);
    expect(JSON.parse(localStorage.getItem(SENT_WALKS_KEY) ?? "null")).toEqual([walk]);
    localStorage.removeItem(SENT_WALKS_KEY);
  });
});
