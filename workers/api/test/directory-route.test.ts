import { env, exports } from "cloudflare:workers";
import { loadCrews, loadZipCentres } from "@emberwalk/directory";
import { beforeEach, describe, expect, it } from "vitest";

const LISTED = "2026-10-28";
const MILES_PER_DEGREE = 69.1;
const TREE = "D-49";

const centre = (zip: string, lat: number, lng = -121): { zip: string; lat: number; lng: number; loadedOn: string } => ({ zip, lat, lng, loadedOn: LISTED });

type Trade = "C-27" | "C-49" | "D-49" | "B" | "C-13" | "C-29" | "C-39";

const crew = (licenseNumber: string, businessName: string, zip: string, over: Record<string, string> = {}, classes?: Trade[]) => ({
  licenseNumber,
  trade: "C-27" as Trade,
  businessName,
  address: `${licenseNumber} Main St, Town, CA`,
  zip,
  phone: "(530) 555 0100",
  licenseStatus: "CLEAR",
  listedOn: LISTED,
  ...over,
  classes: classes ?? [(over["trade"] ?? "C-27") as Trade],
});

type Reply = { status: number; allow: string | null; json: Record<string, unknown> };

const get = async (query: string, method = "GET", path = "/api/crews"): Promise<Reply> => {
  const response = await exports.default.fetch(new Request(`https://api.test${path}${query}`, { method }));
  return { status: response.status, allow: response.headers.get("allow"), json: (await response.json()) as Record<string, unknown> };
};

const crews = (reply: Reply): { businessName: string; licenseNumber: string; licenseStatus: string; listedOn: string; distanceMiles: number; trade: string }[] =>
  reply.json["crews"] as never;

const errorCode = (reply: Reply): unknown => (reply.json["error"] as { code: string }).code;

beforeEach(async () => {
  await env.DB.batch([env.DB.prepare("DELETE FROM crews"), env.DB.prepare("DELETE FROM zip_centres"), env.DB.prepare("DELETE FROM crew_removals")]);
  await loadZipCentres(env.DB, [centre("95001", 39.0), centre("95002", 39.1), centre("95003", 39.5), centre("95005", 38.0)]);
  await loadCrews(env.DB, "C-27", [crew("11", "Here Landscaping", "95001"), crew("12", "Near Landscaping", "95002"), crew("13", "Mid Landscaping", "95003"), crew("14", "South Landscaping", "95005")]);
  await loadCrews(env.DB, "C-49", [crew("21", "Here Trees", "95002", { trade: "C-49", listedOn: "2026-10-30" })]);
});

describe("GET /api/crews with a location", () => {
  it("measures from the point the phone gave, closest first, with license number, status and list date", async () => {
    const reply = await get("?trade=C-27&lat=38.0&lng=-121&zip=95001&limit=3");
    expect(reply.status).toBe(200);
    expect(reply.json["origin"]).toBe("location");
    expect(crews(reply).map((c) => c.businessName)).toEqual(["South Landscaping", "Here Landscaping", "Near Landscaping"]);
    expect(crews(reply)[0]).toMatchObject({ licenseNumber: "14", licenseStatus: "CLEAR", listedOn: LISTED, trade: "C-27", distanceMiles: 0 });
    expect(crews(reply)[1]?.distanceMiles).toBeCloseTo(MILES_PER_DEGREE, 0);
  });
});

describe("GET /api/crews from a ZIP when the location is refused", () => {
  it("measures from the ZIP centre and says so", async () => {
    const reply = await get("?trade=C-27&zip=95001");
    expect(reply.status).toBe(200);
    expect(reply.json["origin"]).toBe("zip");
    expect(crews(reply).map((c) => c.businessName)).toEqual(["Here Landscaping", "Near Landscaping", "Mid Landscaping", "South Landscaping"]);
    expect(crews(reply)[0]?.distanceMiles).toBe(0);
  });

  it("returns the C-49 crews with the C-49 list date", async () => {
    const reply = await get("?trade=C-49&zip=95001");
    expect(crews(reply)).toMatchObject([{ licenseNumber: "21", trade: "C-49", listedOn: "2026-10-30" }]);
  });

  it("returns tree service crews as their own trade", async () => {
    await loadCrews(env.DB, "D-49", [crew("31", "Stump Co", "95001", { trade: "D-49" })]);
    const reply = await get(`?trade=${TREE}&zip=95001`);
    expect(crews(reply)).toMatchObject([{ licenseNumber: "31", trade: "D-49" }]);
  });

  it("searches B, C-13, C-29 and C-39, each crew with its license number, status, list date and every class its license holds", async () => {
    const classes = ["B", "C-13", "C-29", "C-39"] as const;
    for (const [i, trade] of classes.entries())
      await loadCrews(env.DB, trade, [crew(String(40 + i), `${trade} Crew`, "95001", { trade, phone: "(916) 555-0123", licenseStatus: "CLEAR", listedOn: "2026-10-29" }, ["C-27", trade])]);
    for (const [i, trade] of classes.entries()) {
      const reply = await get(`?trade=${trade}&zip=95001`);
      expect(reply.status).toBe(200);
      expect(crews(reply)).toMatchObject([
        {
          licenseNumber: String(40 + i),
          trade,
          classes: ["C-27", trade],
          licenseStatus: "CLEAR",
          listedOn: "2026-10-29",
          phoneE164: "+19165550123",
          checkLicenseUrl: `https://www.cslb.ca.gov/OnlineServices/CheckLicenseII/LicenseDetail.aspx?LicNum=${40 + i}`,
        },
      ]);
    }
    expect(crews(await get("?trade=C-39&zip=95001"))[0]).toMatchObject({ className: "Roofing Contractor" });
  });

  it("accepts a comma separated list of classes and merges them by distance", async () => {
    await loadCrews(env.DB, "D-49", [crew("31", "Stump Co", "95001", { trade: "D-49" })]);
    const reply = await get(`?trade=C-49,${TREE}&zip=95001`);
    expect(reply.status).toBe(200);
    expect(crews(reply).map((c) => [c.licenseNumber, c.trade])).toEqual([
      ["31", "D-49"],
      ["21", "C-49"],
    ]);
    expect(crews(reply)[1]?.distanceMiles).toBeCloseTo(0.1 * MILES_PER_DEGREE, 0);
    expect(crews(await get("?trade=C-49&zip=95001")).map((c) => c.licenseNumber)).toEqual(["21"]);
  });

  it("keeps a crew in a ZIP the Census file lacks, places it at its ZIP prefix average and says the place is approximate", async () => {
    await loadCrews(env.DB, "C-27", [crew("11", "Here Landscaping", "95001"), crew("12", "Near Landscaping", "95002"), crew("13", "Mid Landscaping", "95003"), crew("14", "South Landscaping", "95005"), crew("15", "Unlisted Landscaping", "95099")]);
    const reply = await get("?trade=C-27&zip=95005");
    const found = crews(reply) as unknown as { businessName: string; approximate: boolean; distanceMiles: number }[];
    expect(found.map((c) => [c.businessName, c.approximate])).toEqual([
      ["South Landscaping", false],
      ["Unlisted Landscaping", true],
      ["Here Landscaping", false],
      ["Near Landscaping", false],
      ["Mid Landscaping", false],
    ]);
    expect(found[1]?.distanceMiles).toBeCloseTo(((39.0 + 39.1 + 39.5 + 38.0) / 4 - 38.0) * MILES_PER_DEGREE, 0);
  });

  it("answers an empty list, not an error, when no crew is in range", async () => {
    await env.DB.prepare("DELETE FROM crews").run();
    const reply = await get("?trade=C-27&zip=95001");
    expect(reply.status).toBe(200);
    expect(crews(reply)).toEqual([]);
  });
});

describe("GET /api/crews refusals", () => {
  it("answers 400 for a malformed ZIP, an unknown trade or one in a list, a malformed class, a lone lat, a bad number and a bad limit", async () => {
    const bad = [
      "?trade=C-27&zip=9500",
      "?trade=C-27&zip=95001-1",
      "?trade=C-27&zip=abcde",
      "?trade=C-10&zip=95001",
      "?trade=D49&zip=95001",
      "?trade=C-49,C-10&zip=95001",
      "?trade=C-49,&zip=95001",
      "?trade=,C-49&zip=95001",
      `?trade=C-49,,${TREE}&zip=95001`,
      "?trade=c-39&zip=95001",
      "?trade=&zip=95001",
      "?zip=95001",
      "?trade=C-27&lat=38",
      "?trade=C-27&lng=-121",
      "?trade=C-27&lat=north&lng=-121",
      "?trade=C-27&lat=95&lng=-121",
      "?trade=C-27&zip=95001&limit=0",
      "?trade=C-27&zip=95001&limit=99",
      "?trade=C-27&zip=95001&limit=",
      "?trade=C-27",
    ];
    for (const query of bad) {
      const reply = await get(query);
      expect([query, reply.status, errorCode(reply)]).toEqual([query, 400, "invalid_request"]);
    }
  });

  it("answers 404 for a ZIP that is well formed but has no centre, including a ZIP outside California", async () => {
    for (const zip of ["99999", "10001"]) {
      const reply = await get(`?trade=C-27&zip=${zip}`);
      expect([zip, reply.status, errorCode(reply)]).toEqual([zip, 404, "zip_not_found"]);
    }
  });

  it("does not claim a ZIP has no crews when it only has no centre point, since crews can be listed there", async () => {
    await loadCrews(env.DB, "C-27", [crew("15", "Unlisted Landscaping", "95099")]);
    const reply = await get("?trade=C-27&zip=95099");
    expect(reply.status).toBe(404);
    const message = (reply.json["error"] as { message: string }).message;
    expect(message).toBe("That ZIP code could not be found, so crews cannot be measured from it.");
    expect(message).not.toMatch(/no crews/i);
  });

  it("answers 405 with Allow: GET for any other method", async () => {
    const reply = await get("?trade=C-27&zip=95001", "POST");
    expect(reply.status).toBe(405);
    expect(reply.allow).toBe("GET");
    expect(errorCode(reply)).toBe("method_not_allowed");
  });

  it("does not echo a hostile query back in the error", async () => {
    const reply = await get("?trade=C-27&zip=%3Cscript%3E");
    expect(JSON.stringify(reply.json)).not.toContain("script");
  });
});

describe("GET /api/fire-links", () => {
  it("lists CAL FIRE's own pages and nothing else", async () => {
    const reply = await get("", "GET", "/api/fire-links");
    expect(reply.status).toBe(200);
    const links = reply.json["links"] as { id: string; url: string }[];
    expect(links.map((l) => l.id)).toEqual(["defensible-space", "request-inspection", "local-contacts"]);
    expect(links.every((l) => l.url.startsWith("https://"))).toBe(true);
    expect((await get("", "POST", "/api/fire-links")).status).toBe(405);
  });
});
