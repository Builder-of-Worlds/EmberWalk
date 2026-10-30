import { describe, expect, it } from "vitest";
import { storagePrefs, VISITOR_KEY } from "../../src/prefs.ts";
import { memoryStorage, refusingStorage } from "./fakes.ts";

const HEX_64 = /^[0-9a-f]{64}$/;

describe("visitorId", () => {
  it("makes a random id once and keeps it on the phone", () => {
    const storage = memoryStorage();
    const id = storagePrefs(() => storage).visitorId();
    expect(id).toMatch(HEX_64);
    expect(storage.getItem(VISITOR_KEY)).toBe(id);
    expect(storagePrefs(() => storage).visitorId()).toBe(id);
  });

  it("gives each phone its own id", () => {
    expect(storagePrefs(() => memoryStorage()).visitorId()).not.toBe(storagePrefs(() => memoryStorage()).visitorId());
  });

  it("replaces a stored value that is not an id", () => {
    const storage = memoryStorage();
    storage.setItem(VISITOR_KEY, "A".repeat(64));
    const id = storagePrefs(() => storage).visitorId();
    expect(id).toMatch(HEX_64);
    expect(storage.getItem(VISITOR_KEY)).toBe(id);
  });

  it("keeps one id for this visit when the phone refuses to store it", () => {
    const prefs = storagePrefs(refusingStorage);
    const id = prefs.visitorId();
    expect(id).toMatch(HEX_64);
    expect(prefs.visitorId()).toBe(id);
  });
});

describe("agreedToSend", () => {
  it("is off on a new phone, and once Send My Walk is tapped it stays on for every later visit", () => {
    const storage = memoryStorage();
    const prefs = storagePrefs(() => storage);
    expect(prefs.agreedToSend()).toBe(false);
    prefs.markAgreedToSend();
    expect(prefs.agreedToSend()).toBe(true);
    expect(storagePrefs(() => storage).agreedToSend()).toBe(true);
    expect(storagePrefs(() => memoryStorage()).agreedToSend()).toBe(false);
  });

  it("holds for this visit when the phone refuses to store it", () => {
    const prefs = storagePrefs(refusingStorage);
    prefs.markAgreedToSend();
    expect(prefs.agreedToSend()).toBe(true);
  });
});
