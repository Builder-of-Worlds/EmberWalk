import { beforeEach, describe, expect, it } from "vitest";
import { handle } from "../src/handler";
import { finishEmailEs, welcomeMessage, welcomeMessageEs } from "../src/email-copy";
import { clearSignups, deps, fakeMailer, fakeVerify, signupRequest, testEnv, validBody } from "./helpers";

const SENTENCE = "EmberWalk launches Nov. 4th, 2026. We'll email you when it does.";
const UNSUBSCRIBE = "https://emberwalk.app/unsubscribe?t=x.y";

function bodyFor(env: object): string {
  return welcomeMessage("a@example.com", UNSUBSCRIBE, env).body;
}

async function sentBody(flag: string | undefined): Promise<string> {
  const env = testEnv();
  delete (env as { LAUNCH_DATE_SHOWN?: string }).LAUNCH_DATE_SHOWN;
  if (flag !== undefined) Object.assign(env, { LAUNCH_DATE_SHOWN: flag });
  const mailer = fakeMailer();
  const response = await handle(signupRequest(validBody), env, deps(fakeVerify("pass"), mailer));
  expect(response.status).toBe(200);
  expect(mailer.sent).toHaveLength(1);
  return mailer.sent[0].body;
}

beforeEach(async () => {
  await clearSignups(testEnv().DB);
});

describe("welcome email launch date flag", () => {
  it.each([
    ["off", { LAUNCH_DATE_SHOWN: "off" }],
    ["missing", {}],
    ["misspelled", { LAUNCH_DATE_SHOWN: "On" }],
    ["yes", { LAUNCH_DATE_SHOWN: "yes" }],
    ["empty", { LAUNCH_DATE_SHOWN: "" }],
  ])("holds no date while the flag is %s", (_name, env) => {
    const body = bodyFor(env);
    expect(body).not.toMatch(/Nov(\.|ember)?\s*4/i);
    expect(body).not.toContain("2026");
    expect(body).not.toMatch(/launches\s+(on\s+)?[a-z]*\.?\s*\d/i);
    expect(body).toContain("You're on the list for EmberWalk");
    expect(body).toContain("hello@emberwalk.app");
  });

  it("promises a launch email without a date while the flag is off", () => {
    expect(bodyFor({})).toContain("We'll email you when EmberWalk launches.");
  });

  it("gives the date sentence back word for word when the flag is on", () => {
    const body = bodyFor({ LAUNCH_DATE_SHOWN: "on" });
    expect(body).toContain(SENTENCE);
    expect(body).toContain("You're on the list for EmberWalk");
    expect(body).toContain("hello@emberwalk.app");
  });

  it("sends no date from a real signup while the flag is missing or off", async () => {
    for (const flag of [undefined, "off"]) {
      await clearSignups(testEnv().DB);
      const body = await sentBody(flag);
      expect(body).not.toContain("2026");
      expect(body).not.toMatch(/launches\s+(on\s+)?[a-z]*\.?\s*\d/i);
    }
  });

  it("sends the date from a real signup while the flag is on", async () => {
    expect(await sentBody("on")).toContain(SENTENCE);
  });
});

describe("the Spanish welcome email", () => {
  const spanishFor = (env: object) => welcomeMessageEs("a@example.com", UNSUBSCRIBE, env);

  it("follows the same launch date flag as the English", () => {
    for (const env of [{}, { LAUNCH_DATE_SHOWN: "off" }, { LAUNCH_DATE_SHOWN: "On" }]) {
      const body = spanishFor(env).body;
      expect(body).not.toContain("2026");
      expect(body).not.toMatch(/noviembre/i);
    }
    expect(spanishFor({ LAUNCH_DATE_SHOWN: "on" }).body).toContain("4 de noviembre de 2026");
  });

  it.each([{}, { LAUNCH_DATE_SHOWN: "on" }])("has a Spanish line for every English line, in the same place", (env) => {
    const english = welcomeMessage("a@example.com", UNSUBSCRIBE, env).body.split("\n");
    const spanish = spanishFor(env).body.split("\n");
    expect(spanish).toHaveLength(english.length);
    english.forEach((line, n) => expect(spanish[n] === "", line).toBe(line === ""));
    expect(spanish[0]).not.toBe(english[0]);
  });

  it("ends with the same unsubscribe link and the postal address, and refuses to send without the address", () => {
    const message = spanishFor({});
    const finished = finishEmailEs(message, "1 Main St, Sacramento, CA");
    expect(finished).toContain(`: ${UNSUBSCRIBE}`);
    expect(finished.endsWith("1 Main St, Sacramento, CA")).toBe(true);
    expect(() => finishEmailEs(message, "  ")).toThrow("no postal address");
  });
});
