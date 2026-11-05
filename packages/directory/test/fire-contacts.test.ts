import { describe, expect, it } from "vitest";
import { FIRE_CONTACTS, fireContactFor } from "../src/fire-contacts.ts";

const today = (): string => new Date().toISOString().slice(0, 10);

describe("the fire department inspection contact table", () => {
  it("holds rows", () => {
    expect(FIRE_CONTACTS.length).toBeGreaterThan(0);
  });

  it("gives each row an agency, an email, a public source page and a read date no later than today", () => {
    for (const row of FIRE_CONTACTS) {
      expect(row.agency.trim()).toBe(row.agency);
      expect(row.agency.length).toBeGreaterThan(3);
      expect(row.email).toMatch(/^[a-z0-9._%+-]+@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/i);
      const source = new URL(row.source);
      expect(source.protocol).toBe("https:");
      expect(source.hostname).not.toMatch(/(^|\.)cslb\.ca\.gov$/);
      expect(row.readOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(new Date(`${row.readOn}T00:00:00Z`).toISOString().slice(0, 10)).toBe(row.readOn);
      expect(row.readOn <= today()).toBe(true);
    }
  });

  it("covers only California ZIP codes, and never one ZIP for two agencies", () => {
    const zips = FIRE_CONTACTS.flatMap((row) => row.zips);
    for (const zip of zips) {
      expect(zip).toMatch(/^\d{5}$/);
      expect(Number(zip)).toBeGreaterThanOrEqual(90000);
      expect(Number(zip)).toBeLessThanOrEqual(96199);
    }
    expect(new Set(zips).size).toBe(zips.length);
  });

  it("finds the row for each ZIP it covers, and none for a ZIP no row covers", () => {
    for (const row of FIRE_CONTACTS) for (const zip of row.zips) expect(fireContactFor(zip)).toBe(row);
    expect(fireContactFor("99999")).toBeNull();
    expect(fireContactFor("")).toBeNull();
  });
});
