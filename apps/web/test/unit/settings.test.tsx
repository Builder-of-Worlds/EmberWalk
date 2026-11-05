import { afterEach, describe, expect, it } from "vitest";
import { accountApi } from "../../src/account-api.ts";
import { App } from "../../src/App.tsx";
import { settingsWords as s, shellWords, signInWords as w } from "../../src/draft-words.ts";
import { noPortfolio } from "../../src/portfolio-api.ts";
import { ROUTES } from "../../src/router.ts";
import { memoryPrefs, testDeps } from "./fakes.ts";
import { render, settle } from "./render.ts";

const ME = { accountId: "4d3c2b1a-0f9e-4d8c-8b7a-6f5e4d3c2b1a", email: "owner@example.com" };
const NEW = "new-owner@example.com";

const until = async (check: () => boolean) => {
  for (let i = 0; i < 80 && !check(); i++) await settle(() => new Promise((r) => setTimeout(r, 5)));
  if (!check()) throw new Error("condition never became true");
};

const mount = async (hash: string, answer: (request: Request) => Response | Promise<Response>) => {
  window.location.hash = hash;
  const send = async (request: Request) => answer(request);
  return render(<App deps={testDeps({ account: accountApi("http://localhost", send, () => "v".repeat(64)) })} />);
};

type View = Awaited<ReturnType<typeof mount>>;

const press = async (view: View, label: string) => {
  const button = [...view.host.querySelectorAll("button")].find((b) => b.textContent === label);
  if (button === undefined) throw new Error(`no button "${label}" in: ${view.text()}`);
  await settle(() => button.click());
};

const type = async (view: View, selector: string, text: string) => {
  const input = view.host.querySelector<HTMLInputElement>(selector)!;
  await settle(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, text);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
};

const submit = (view: View) => settle(() => view.host.querySelector<HTMLFormElement>("form.change-email")!.requestSubmit());

afterEach(() => {
  window.location.hash = "";
  window.localStorage.clear();
});

describe("Settings", () => {
  it("is a tab on the bar at the foot of every main screen, and the tab of the open screen is marked", async () => {
    const view = await mount(ROUTES.settings, () => Response.json({ error: { code: "unauthorized", message: "x" } }, { status: 401 }));
    const tabs = [...view.host.querySelectorAll(".tabs a")];
    expect(tabs.map((a) => a.textContent)).toEqual([shellWords.home, shellWords.walks, shellWords.fixes, shellWords.settings]);
    expect(tabs.filter((a) => a.getAttribute("aria-current") === "page").map((a) => a.getAttribute("href"))).toEqual([ROUTES.settings]);
    await view.unmount();
  });

  it("on Your Homes, a phone with no Homes tab marks Home", async () => {
    window.location.hash = ROUTES.homes;
    const view = await render(<App deps={testDeps({ portfolio: noPortfolio })} />);
    const tabs = [...view.host.querySelectorAll(".tabs a")];
    expect(tabs.filter((a) => a.getAttribute("aria-current") === "page").map((a) => a.getAttribute("href"))).toEqual([ROUTES.home]);
    await view.unmount();
  });

  it("signed out, offers Sign In", async () => {
    const view = await mount(ROUTES.settings, () => Response.json({ error: { code: "unauthorized", message: "x" } }, { status: 401 }));
    await until(() => view.text().includes(s.notSignedIn));
    expect(view.host.querySelector(`main a[href='${ROUTES.signIn}']`)?.textContent).toBe(w.entry);
    await view.unmount();
  });

  it("signed in, changes the email only after the code sent to the new address is typed", async () => {
    const posted: [string, unknown][] = [];
    let email = ME.email;
    const view = await mount(ROUTES.settings, async (request) => {
      const { pathname } = new URL(request.url);
      if (request.method === "POST") posted.push([pathname, await request.json().catch(() => null)]);
      if (pathname === "/api/me") return Response.json({ ...ME, email });
      if (pathname === "/api/me/email") return Response.json({ accepted: true }, { status: 202 });
      if (pathname === "/api/me/email/verify") {
        email = NEW;
        return Response.json({ ...ME, email: NEW });
      }
      return Response.json({ linked: true });
    });
    await until(() => view.text().includes(w.signedInAs(ME.email)));
    await press(view, s.changeEmail);
    await type(view, "#new-email", NEW);
    await submit(view);
    await until(() => view.text().includes(s.codeSent(NEW)));
    expect(view.text()).toContain(w.signedInAs(ME.email));
    await type(view, "#change-code", "123 456");
    await submit(view);
    await until(() => view.text().includes(s.changed(NEW)));
    expect(posted.filter(([path]) => path.startsWith("/api/me/email"))).toEqual([
      ["/api/me/email", { email: NEW, language: "en" }],
      ["/api/me/email/verify", { email: NEW, code: "123456" }],
    ]);
    await view.unmount();
  });

  it("says when another account has the new address, and keeps the old one", async () => {
    const view = await mount(ROUTES.settings, (request) => {
      const { pathname } = new URL(request.url);
      if (pathname === "/api/me") return Response.json(ME);
      if (pathname === "/api/me/email") return Response.json({ accepted: true }, { status: 202 });
      if (pathname === "/api/me/email/verify") return Response.json({ error: { code: "email_taken", message: "x" } }, { status: 409 });
      return Response.json({ linked: true });
    });
    await until(() => view.text().includes(w.signedInAs(ME.email)));
    await press(view, s.changeEmail);
    await type(view, "#new-email", NEW);
    await submit(view);
    await until(() => view.host.querySelector("#change-code") !== null);
    await type(view, "#change-code", "123456");
    await submit(view);
    await until(() => view.text().includes(s.taken));
    expect(view.text()).toContain(w.signedInAs(ME.email));
    await view.unmount();
  });
});

describe("reminder emails in Settings", () => {
  it("signed in, shows the account's switch and saves a change to the server", async () => {
    let on = true;
    const posted: unknown[] = [];
    const view = await mount(ROUTES.settings, async (request) => {
      const { pathname } = new URL(request.url);
      if (pathname === "/api/me") return Response.json(ME);
      if (pathname === "/api/me/reminders" && request.method === "POST") {
        const body = (await request.json()) as { on: boolean };
        posted.push(body);
        on = body.on;
      }
      if (pathname === "/api/me/reminders") return Response.json({ on });
      return Response.json({ linked: true });
    });
    const choice = (label: string) => [...view.host.querySelectorAll<HTMLButtonElement>(".reminders button")].find((b) => b.textContent === label);
    await until(() => choice(s.on)?.getAttribute("aria-pressed") === "true");
    await settle(() => choice(s.off)!.click());
    await until(() => choice(s.off)?.getAttribute("aria-pressed") === "true");
    expect(posted).toEqual([{ on: false }]);
    await view.unmount();
  });

  it("signed out, has no reminder switch", async () => {
    const view = await mount(ROUTES.settings, () => Response.json({ error: { code: "unauthorized", message: "x" } }, { status: 401 }));
    await until(() => view.text().includes(s.notSignedIn));
    expect(view.host.querySelector(".reminders")).toBeNull();
    await view.unmount();
  });
});

describe("reading the walk steps aloud in Settings", () => {
  it("is on until turned off, and the phone keeps the choice", async () => {
    const prefs = memoryPrefs();
    window.location.hash = ROUTES.settings;
    const view = await render(<App deps={testDeps({ prefs })} />);
    const choice = (label: string) => [...view.host.querySelectorAll(".read-aloud button")].find((b) => b.textContent === label)!;
    expect(choice(s.on).getAttribute("aria-pressed")).toBe("true");
    await settle(() => (choice(s.off) as HTMLButtonElement).click());
    expect(choice(s.off).getAttribute("aria-pressed")).toBe("true");
    expect(prefs.readsStepsAloud()).toBe(false);
    await view.unmount();
  });
});

describe("the bar at the foot", () => {
  it("is not on the camera screen", async () => {
    const view = await mount(ROUTES.record, () => Response.json({}));
    expect(view.host.querySelector(".tabs")).toBeNull();
    await view.unmount();
  });
});
