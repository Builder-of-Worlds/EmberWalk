import { describe, expect, it } from "vitest";
import { INSTALL_SEEN_KEY, installHint, type InstallPhone } from "../../src/install.ts";

const IPHONE_SAFARI = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1";
const IPHONE_CHROME = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/131.0 Mobile/15E148 Safari/604.1";
const ANDROID = "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Mobile Safari/537.36";
const DESKTOP = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15";

const phone = (over: Partial<InstallPhone> = {}): InstallPhone => {
  const kept = new Map<string, string>();
  return {
    userAgent: IPHONE_SAFARI,
    standalone: false,
    installedView: false,
    canPrompt: false,
    seen: () => kept.get(INSTALL_SEEN_KEY) === "on",
    ...over,
  };
};

describe("the Add to Home Screen card", () => {
  it("shows the iPhone steps in Safari on an iPhone that has not added the app", () => {
    expect(installHint(phone())).toBe("ios_safari");
  });

  it("tells an iPhone in another browser to open the page in Safari first", () => {
    expect(installHint(phone({ userAgent: IPHONE_CHROME }))).toBe("ios_other");
  });

  it("shows nothing once the app runs from the Home Screen", () => {
    expect(installHint(phone({ standalone: true }))).toBeNull();
    expect(installHint(phone({ installedView: true }))).toBeNull();
  });

  it("shows nothing after Got It", () => {
    expect(installHint(phone({ seen: () => true }))).toBeNull();
  });

  it("offers the browser's own install on Android when it is ready, and nothing before", () => {
    expect(installHint(phone({ userAgent: ANDROID, canPrompt: true }))).toBe("prompt");
    expect(installHint(phone({ userAgent: ANDROID }))).toBeNull();
  });

  it("shows nothing on a computer", () => {
    expect(installHint(phone({ userAgent: DESKTOP }))).toBeNull();
  });
});
