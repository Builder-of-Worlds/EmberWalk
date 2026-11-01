import { VISITOR_HEADER } from "@emberwalk/shared";
import { describe, expect, it } from "vitest";
import type { Fetch } from "../../src/api.ts";
import { offlineRechecks, recheckApi } from "../../src/recheck-api.ts";

const BASE = "https://ember.test";
const VISITOR = "c".repeat(64);
const FINDING = "00000000-0000-4000-8000-0000000a0001";
const RECHECK = "00000000-0000-4000-8000-0000000b0001";
const AT = "2026-10-30T22:00:00.000Z";
const PHOTO_URL = "https://media.test/rechecks/w/f/r?sig=1";

const link = { recheckId: RECHECK, url: PHOTO_URL, method: "PUT", headers: { "content-length": "4", "content-type": "image/jpeg" }, expiresAt: AT };
const answer = { recheck: { id: RECHECK, findingId: FINDING, photo: `rechecks/w/${FINDING}/${RECHECK}`, result: "cleared", createdAt: AT } };
const refusal = (code: string, status: number) => Response.json({ error: { code, message: "No." } }, { status });
const photo = () => new Blob(["jpeg"], { type: "image/jpeg" });

const serving = (answers: Array<() => Response | Promise<Response>>) => {
  const seen: Request[] = [];
  const send: Fetch = async (request) => {
    seen.push(request);
    const next = answers.shift();
    if (next === undefined) throw new Error(`no answer for ${request.method} ${request.url}`);
    return next();
  };
  return { seen, api: recheckApi(BASE, send, () => VISITOR) };
};

describe("the recheck client", () => {
  it("asks for a link as this visitor, puts the photo there, then asks for the answer", async () => {
    const { seen, api } = serving([() => Response.json(link), () => new Response(null, { status: 200 }), () => Response.json(answer)]);
    expect(await api.send(FINDING, photo())).toEqual(answer);
    expect(seen.map((r) => `${r.method} ${r.url}`)).toEqual([`POST ${BASE}/api/rechecks`, `PUT ${PHOTO_URL}`, `POST ${BASE}/api/rechecks/${RECHECK}`]);
    expect(seen[0]?.headers.get(VISITOR_HEADER)).toBe(VISITOR);
    expect(await seen[0]?.json()).toEqual({ findingId: FINDING, contentType: "image/jpeg", bytes: 4 });
    expect(seen[1]?.headers.get("content-type")).toBe("image/jpeg");
    expect(await seen[1]?.text()).toBe("jpeg");
    expect(seen[2]?.headers.get(VISITOR_HEADER)).toBe(VISITOR);
    expect(await seen[2]?.json()).toEqual({ findingId: FINDING });
  });

  it("answers the route's refusal code and stops there", async () => {
    for (const [code, status] of [["not_done", 409], ["too_large", 413], ["too_many_rechecks", 429], ["not_found", 404]] as const) {
      const { seen, api } = serving([() => refusal(code, status)]);
      expect(await api.send(FINDING, photo())).toEqual({ code });
      expect(seen).toHaveLength(1);
    }
    const judged = serving([() => Response.json(link), () => new Response(null), () => refusal("no_photo", 404)]);
    expect(await judged.api.send(FINDING, photo())).toEqual({ code: "no_photo" });
  });

  it("answers offline when the network fails, and a server error for a failed put or a body it cannot read", async () => {
    const thrown = serving([() => Promise.reject(new TypeError("Failed to fetch"))]);
    expect(await thrown.api.send(FINDING, photo())).toEqual({ code: "offline" });
    const putFailed = serving([() => Response.json(link), () => new Response(null, { status: 403 })]);
    expect(await putFailed.api.send(FINDING, photo())).toEqual({ code: "server_error" });
    expect(putFailed.seen).toHaveLength(2);
    const badLink = serving([() => Response.json({ url: "nope" })]);
    expect(await badLink.api.send(FINDING, photo())).toEqual({ code: "server_error" });
    const badAnswer = serving([() => Response.json(link), () => new Response(null), () => Response.json({ recheck: { result: "gone" } })]);
    expect(await badAnswer.api.send(FINDING, photo())).toEqual({ code: "server_error" });
    const oddCode = serving([() => refusal("walk_limit_reached", 429)]);
    expect(await oddCode.api.send(FINDING, photo())).toEqual({ code: "server_error" });
  });

  it("is offline by default in tests", async () => {
    expect(await offlineRechecks.send(FINDING, photo())).toEqual({ code: "offline" });
  });
});
