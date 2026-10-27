import { afterEach, describe, expect, it, vi } from "vitest";
import { stillPath, VISITOR_HEADER } from "@emberwalk/shared";
import { browserDeps } from "../../src/deps.ts";
import { SAMPLES } from "../../src/samples.ts";
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
});
