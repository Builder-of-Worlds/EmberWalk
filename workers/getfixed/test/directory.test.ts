import { env } from "cloudflare:workers";
import type { Trade } from "@emberwalk/shared";
import { beforeEach, describe, expect, it } from "vitest";
import { directoryFor } from "../src/directory.ts";
import { resetDb, seedDirectory, ZIP } from "./harness.ts";

const CLASSES = ["C-27", "C-49", "D-49", "B", "C-13", "C-29", "C-39"];

beforeEach(async () => {
  await resetDb();
  await seedDirectory(CLASSES.map((trade, i) => ({ license: String(2000001 + i), trade, name: `${trade} Crew`, zip: ZIP, phone: `(209) 555-01${10 + i}` })));
});

describe("the license classes searched for each kind of work", () => {
  it.each<[Trade, string[]]>([
    ["tree_service", ["C-49", "D-49"]],
    ["brush_clearing", ["C-27"]],
    ["debris_hauling", ["C-27", "B"]],
    ["roofing_gutters", ["C-39"]],
    ["fencing", ["C-13"]],
    ["handyman", ["B"]],
  ])("finds %s crews among %j licenses only", async (trade, classes) => {
    let n = 0;
    const directory = directoryFor({ db: env.DB, newId: () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}` });
    const found = await directory.near(trade, ZIP, 10);
    expect(found.map((c) => c.name).sort()).toEqual(classes.map((c) => `${c} Crew`).sort());
  });
});
