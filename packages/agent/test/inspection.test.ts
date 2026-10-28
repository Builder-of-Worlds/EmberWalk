import { env } from "cloudflare:workers";
import { evaluate, rank } from "@emberwalk/rules";
import { Concept, type Finding } from "@emberwalk/shared";
import { beforeEach, describe, expect, it } from "vitest";
import truth from "../../../fixtures/synthetic/test-yard-2/truth.json";
import { CONCEPT_NAMES } from "../src/drafts.ts";
import { CALFIRE_LINKS, type InspectionRequest, InspectionRefused, inspectionRequest } from "../src/inspection.ts";
import { AgentOff } from "../src/loop.ts";
import { resetDb, seedWalk, uuid, WALK } from "./support.ts";

const LABEL = "Synthetic sample house";
const PROMISE = /accept|approv|guarant|discount/i;
const deps = { enabled: true, db: env.DB };

const yardTwo = (): Partial<Finding>[] => {
  expect([truth.synthetic, truth.label]).toEqual([true, LABEL]);
  const observations = truth.hazards.map((h) => ({
    id: h.id,
    concept: Concept.parse(h.concept.replaceAll(" ", "_")),
    distanceFeet: { low: h.distance_ft, high: h.distance_ft },
    contact: h.contact ? ("yes" as const) : ("no" as const),
    plantState: null,
    spacing: null,
    flags: [],
    frameShare: 1,
    confidence: 1,
  }));
  return rank(evaluate(observations, "ca")).map((f) => ({
    concept: f.concept,
    band: f.band,
    distanceFeet: observations.find((o) => o.id === f.observationId)!.distanceFeet,
    contact: observations.find((o) => o.id === f.observationId)!.contact,
    severity: f.severity,
    rank: f.rank,
    ruleIds: f.ruleIds,
    label: f.label,
    instruction: f.instruction,
    plantState: null,
  }));
};

const recommendedGrass: Partial<Finding> = {
  concept: "dry_grass",
  label: "recommended",
  ruleIds: ["ca-dry-grass-ccr-z1"],
  instruction: "Cut dry grass to 4 inches or shorter within 30 feet of the house.",
  plantState: null,
  status: "needs_fixing",
};

const doneYard = (): Partial<Finding>[] => yardTwo().map((f) => ({ ...f, status: f.label === "required_now" ? "done" : "needs_fixing" }));

const words = (r: InspectionRequest): string => [r.subject, r.body, ...r.links.map((l) => l.label)].join("\n");

const refusal = async (p: Promise<unknown>): Promise<InspectionRefused> => {
  const e = await p.catch((err: unknown) => err);
  expect(e).toBeInstanceOf(InspectionRefused);
  return e as InspectionRefused;
};

beforeEach(resetDb);

describe("inspectionRequest when every Required Now item is Done", () => {
  it("names each fixed item in rank order, carries the three CAL FIRE links and the finding ids", async () => {
    const findings = await seedWalk({ synthetic: true, findings: doneYard() });
    const required = findings.filter((f) => f.label === "required_now");
    const fence = findings.find((f) => f.concept === "wooden_fence")!;
    expect([required.map((f) => f.concept).sort(), fence.label, fence.status]).toEqual([["dry_brush", "wood_pile"], "recommended", "needs_fixing"]);
    const request = await inspectionRequest(deps, WALK);
    expect(request.walkId).toBe(WALK);
    expect(request.findingIds).toEqual(required.map((f) => f.id));
    const lines = required.map((f, i) => `${i + 1}. ${CONCEPT_NAMES[f.concept]}: ${f.instruction}`);
    expect(request.body).toContain(lines.join("\n"));
    expect(request.body).not.toContain(fence.instruction);
    expect(request.links).toEqual(CALFIRE_LINKS);
    expect(CALFIRE_LINKS.map((l) => new URL(l.url).hostname)).toEqual(["www.fire.ca.gov", "survey123.arcgis.com", "calfire-forestry.maps.arcgis.com"]);
    for (const link of CALFIRE_LINKS) expect(request.body).toContain(link.url);
    expect(request.body).toMatch(/fire department or fire protection district/);
  });

  it("labels a synthetic walk in subject and body, and a real walk in neither", async () => {
    await seedWalk({ synthetic: true, findings: doneYard() });
    const synthetic = await inspectionRequest(deps, WALK);
    expect(synthetic.subject).toContain(LABEL);
    expect(synthetic.body).toContain(LABEL);
    await resetDb();
    await seedWalk({ synthetic: false, findings: doneYard() });
    const real = await inspectionRequest(deps, WALK);
    expect(real.subject).not.toContain(LABEL);
    expect(real.body).not.toContain(LABEL);
  });

  it("leaves out a vetoed Required Now item that is not done, and is not blocked by it", async () => {
    const vetoed = woodVetoed();
    const findings = await seedWalk({ synthetic: true, findings: [{ status: "done" }, vetoed] });
    const request = await inspectionRequest(deps, WALK);
    expect(request.findingIds).toEqual([findings[0]!.id]);
    expect(request.body).not.toContain(vetoed.instruction!);
  });

  it("never promises an outcome", async () => {
    await seedWalk({ synthetic: true, findings: doneYard() });
    expect(words(await inspectionRequest(deps, WALK))).not.toMatch(PROMISE);
  });
});

const woodVetoed = (): Partial<Finding> => ({
  concept: "wood_pile",
  ruleIds: ["ca-wood-pile-uncovered-ccr-z0"],
  instruction: "Move the wood pile more than 30 feet from the house.",
  plantState: null,
  veto: { reason: "It is the neighbour's pile." },
  status: "needs_fixing",
});

describe("inspectionRequest refuses", () => {
  it("a walk that does not exist", async () => {
    const e = await refusal(inspectionRequest(deps, uuid("ab000000", 9)));
    expect(e.message).toBe(`walk ${uuid("ab000000", 9)} does not exist`);
  });

  it("a walk whose only findings are Recommended", async () => {
    await seedWalk({ synthetic: true, findings: [{ ...recommendedGrass, status: "done" }] });
    const e = await refusal(inspectionRequest(deps, WALK));
    expect(e.message).toBe(`walk ${WALK} has no Required Now item`);
  });

  it("a walk whose only Required Now item is vetoed", async () => {
    await seedWalk({ synthetic: true, findings: [woodVetoed()] });
    expect((await refusal(inspectionRequest(deps, WALK))).message).toBe(`walk ${WALK} has no Required Now item`);
  });

  it("while any Required Now item is Fix Planned or Needs Fixing, naming each", async () => {
    const yard = yardTwo()
      .filter((f) => f.label === "required_now")
      .map((f, i) => ({ ...f, status: i === 0 ? ("fix_planned" as const) : ("needs_fixing" as const) }));
    const [planned, needs] = await seedWalk({ synthetic: true, findings: yard });
    const e = await refusal(inspectionRequest(deps, WALK));
    expect(e.message).toBe(`not every Required Now item is Done: ${CONCEPT_NAMES[planned!.concept]} (Fix Planned), ${CONCEPT_NAMES[needs!.concept]} (Needs Fixing)`);
    expect(e.message).not.toMatch(PROMISE);
  });

  it("one Required Now item still Needs Fixing among done ones", async () => {
    await seedWalk({ synthetic: false, findings: [{ status: "done" }, { ...woodVetoed(), veto: null, status: "needs_fixing" }] });
    const e = await refusal(inspectionRequest(deps, WALK));
    expect(e.message).toBe("not every Required Now item is Done: Wood pile (Needs Fixing)");
  });

  it("with AgentOff before any read when the flag is off", async () => {
    const touched: string[] = [];
    const db = new Proxy({}, { get: (_, key) => touched.push(String(key)) }) as unknown as D1Database;
    await expect(inspectionRequest({ enabled: false, db }, WALK)).rejects.toThrow(AgentOff);
    expect(touched).toEqual([]);
  });
});
