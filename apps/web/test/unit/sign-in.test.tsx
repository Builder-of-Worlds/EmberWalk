import { afterEach, describe, expect, it, vi } from "vitest";
import { accountApi } from "../../src/account-api.ts";
import { App } from "../../src/App.tsx";
import { walkApi } from "../../src/api.ts";
import { accountLeftBehind, closePortfolio, movedWords, openPortfolio, PORTFOLIO_KEY, signInAgainNoted, signInWords as w } from "../../src/draft-words.ts";
import { apiResults } from "../../src/live-api.ts";
import { notingSignInAgain } from "../../src/noting-sign-in.ts";
import { routeFor, ROUTES } from "../../src/router.ts";
import { portfolioApi } from "../../src/portfolio-api.ts";
import { testDeps } from "./fakes.ts";
import { render, settle } from "./render.ts";

const TOKEN = "A".repeat(43);

const SITE_KEY = "site-key";

type Widget = { sitekey: string; appearance?: string; callback: (token: string) => void };

const fakeWidgets = (token: string | null = "person-token") => {
  const rendered: Widget[] = [];
  const resets: string[] = [];
  vi.stubGlobal("turnstile", {
    render: (_box: HTMLElement, options: Widget) => {
      rendered.push(options);
      if (token !== null) options.callback(token);
      return "widget-1";
    },
    reset: (id: string) => resets.push(id),
    remove: () => undefined,
  });
  return { rendered, resets };
};

const withConfig = (answer: (request: Request) => Response | Promise<Response>) => (request: Request) =>
  new URL(request.url).pathname === "/api/sign-in/config" ? Response.json({ turnstileSiteKey: SITE_KEY }) : answer(request);

const refusal = (code: string, status: number) => Response.json({ error: { code, message: "x" } }, { status });

const until = async (check: () => boolean) => {
  for (let i = 0; i < 80 && !check(); i++) await settle(() => new Promise((r) => setTimeout(r, 5)));
  return check();
};

const mount = async (hash: string, answer: (request: Request) => Response | Promise<Response>) => {
  window.location.hash = hash;
  const send = async (request: Request) => answer(request);
  return render(<App deps={testDeps({ account: accountApi("http://localhost", send, () => "v".repeat(64)), portfolio: portfolioApi("http://localhost", send, () => "v".repeat(64)) })} />);
};

const type = async (view: Awaited<ReturnType<typeof mount>>, selector: string, text: string) => {
  const input = view.host.querySelector<HTMLInputElement>(selector)!;
  await settle(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, text);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
};

const submit = async (view: Awaited<ReturnType<typeof mount>>) => {
  await settle(() => view.host.querySelector("form")!.requestSubmit());
};

afterEach(() => {
  window.location.hash = "";
  window.localStorage.clear();
  vi.unstubAllGlobals();
});

describe("asking for a link", () => {
  it("posts the email with the person check's token and says to check the mail", async () => {
    const widgets = fakeWidgets();
    const asked: unknown[] = [];
    const view = await mount(
      ROUTES.signIn,
      withConfig(async (request) => {
        asked.push([new URL(request.url).pathname, await request.json()]);
        return Response.json({ accepted: true }, { status: 202 });
      }),
    );
    expect(view.host.querySelector("h1")?.textContent).toBe(w.title);
    await until(() => widgets.rendered.length === 1);
    expect(widgets.rendered[0]?.sitekey).toBe(SITE_KEY);
    expect(widgets.rendered[0]?.appearance).toBe("interaction-only");
    await type(view, "input[type=email]", "manager@example.com");
    await submit(view);
    await until(() => view.text().includes(w.codeSent("manager@example.com")));
    expect(asked).toEqual([["/api/sign-in", { email: "manager@example.com", turnstileToken: "person-token", language: "en" }]]);
    expect(view.text()).toContain(w.codeSent("manager@example.com"));
    await view.unmount();
  });

  it.each([
    ["no key on the server", () => refusal("not_set_up", 503), w.notSetUp],
    ["the mail failing", () => refusal("mail_failed", 502), w.mailFailed],
    ["too many links", () => refusal("rate_limited", 429), w.tooMany],
    ["the check refusing", () => refusal("check_failed", 403), w.checkFailed],
    ["the check being down", () => refusal("check_unavailable", 503), w.checkFailed],
    ["a bad address", () => refusal("invalid_request", 400), w.badEmail],
    [
      "no signal",
      () => {
        throw new Error("offline");
      },
      w.noSignal,
    ],
  ])("%s shows its own line and takes a new token", async (_name, answer, line) => {
    const widgets = fakeWidgets();
    const view = await mount(ROUTES.signIn, withConfig(answer));
    await until(() => widgets.rendered.length === 1);
    await type(view, "input[type=email]", "manager@example.com");
    await submit(view);
    await until(() => view.text().includes(line));
    expect(view.text()).toContain(line);
    expect(widgets.resets).toEqual(["widget-1"]);
    await view.unmount();
  });

  it("before the check has finished, says to wait and sends nothing", async () => {
    const widgets = fakeWidgets(null);
    const asked: string[] = [];
    const view = await mount(
      ROUTES.signIn,
      withConfig((request) => {
        asked.push(new URL(request.url).pathname);
        return Response.json({ accepted: true }, { status: 202 });
      }),
    );
    await until(() => widgets.rendered.length === 1);
    await type(view, "input[type=email]", "manager@example.com");
    await submit(view);
    await until(() => view.text().includes(w.waitForCheck));
    expect(view.text()).toContain(w.waitForCheck);
    expect(asked).toEqual([]);
    await view.unmount();
  });

  it("a server with no site key says sign in is not set up", async () => {
    const widgets = fakeWidgets();
    const view = await mount(ROUTES.signIn, () => refusal("not_set_up", 503));
    await until(() => view.text().includes(w.notSetUp));
    expect(view.text()).toContain(w.notSetUp);
    expect(widgets.rendered).toHaveLength(0);
    await view.unmount();
  });
});

describe("typing the code from the mail", () => {
  const ME = { accountId: "4d3c2b1a-0f9e-4d8c-8b7a-6f5e4d3c2b1a", email: "manager@example.com" };

  const asked = async (answer: (request: Request) => Response | Promise<Response>) => {
    const widgets = fakeWidgets();
    const view = await mount(ROUTES.signIn, withConfig(answer));
    await until(() => widgets.rendered.length === 1);
    await type(view, "input[type=email]", "manager@example.com");
    await submit(view);
    await until(() => view.host.querySelector("input[autocomplete='one-time-code']") !== null);
    return view;
  };

  it("after asking, the screen takes the six digit code, posts it with the email, and signs in on this phone", async () => {
    const posted: unknown[] = [];
    const view = await asked(async (request) => {
      const { pathname } = new URL(request.url);
      if (pathname === "/api/sign-in") return Response.json({ accepted: true }, { status: 202 });
      if (pathname === "/api/sign-in/verify") {
        posted.push(await request.json());
        return Response.json(ME);
      }
      return Response.json({ properties: [] });
    });
    const box = view.host.querySelector<HTMLInputElement>("input[autocomplete='one-time-code']")!;
    expect(box.inputMode).toBe("numeric");
    await type(view, "input[autocomplete='one-time-code']", "123 456");
    await submit(view);
    await until(() => window.location.hash === ROUTES.home);
    expect(posted).toEqual([{ email: "manager@example.com", code: "123456" }]);
    expect(window.localStorage.getItem(PORTFOLIO_KEY)).toBe("on");
    await view.unmount();
  });

  it.each([
    ["a wrong code", "code_wrong", 400, w.codeWrong],
    ["too many tries", "code_tries", 429, w.codeTries],
    ["an ended code", "link_expired", 410, w.codeEnded],
  ])("%s shows its own line and keeps the code box", async (_name, code, status, line) => {
    const view = await asked((request) => (new URL(request.url).pathname === "/api/sign-in" ? Response.json({ accepted: true }, { status: 202 }) : refusal(code, status)));
    await type(view, "input[autocomplete='one-time-code']", "123456");
    await submit(view);
    await until(() => view.text().includes(line));
    expect(view.text()).toContain(line);
    expect(window.localStorage.getItem(PORTFOLIO_KEY)).toBeNull();
    await view.unmount();
  });
});

describe("landing from the link", () => {
  it("posts the token, opens the portfolio, and keeps the portfolio open on this phone", async () => {
    const asked: string[] = [];
    const view = await mount(`${ROUTES.signIn}/${TOKEN}`, async (request) => {
      const { pathname } = new URL(request.url);
      asked.push(pathname);
      if (pathname === "/api/sign-in/verify") return Response.json({ accountId: "4d3c2b1a-0f9e-4d8c-8b7a-6f5e4d3c2b1a", email: "manager@example.com" });
      return Response.json({ properties: [] });
    });
    await until(() => window.location.hash === ROUTES.home);
    expect(asked[0]).toBe("/api/sign-in/verify");
    expect(window.localStorage.getItem(PORTFOLIO_KEY)).toBe("on");
    await view.unmount();
  });

  it("works on a phone that has never had the draft switch", async () => {
    window.localStorage.clear();
    const view = await mount(`${ROUTES.signIn}/${TOKEN}`, (request) =>
      new URL(request.url).pathname === "/api/sign-in/verify" ? Response.json({ accountId: "4d3c2b1a-0f9e-4d8c-8b7a-6f5e4d3c2b1a", email: "m@example.com" }) : Response.json({ properties: [] }),
    );
    await until(() => view.host.querySelector(`a[href='${ROUTES.homes}']`) !== null);
    expect(view.host.querySelector(`a[href='${ROUTES.homes}']`)).not.toBeNull();
    await view.unmount();
  });

  it.each([
    ["expired", "link_expired", 410, w.linkExpired],
    ["used", "link_used", 409, w.linkUsed],
    ["altered", "link_invalid", 400, w.linkInvalid],
  ])("an %s link shows its own line and a way to ask again", async (_name, code, status, line) => {
    const view = await mount(`${ROUTES.signIn}/${TOKEN}`, () => refusal(code, status));
    await until(() => view.text().includes(line));
    expect(view.text()).toContain(line);
    expect(view.host.querySelector(`a[href='${ROUTES.signIn}']`)).not.toBeNull();
    expect(window.localStorage.getItem(PORTFOLIO_KEY)).toBeNull();
    await view.unmount();
  });

  it("no signal shows its own line", async () => {
    const view = await mount(`${ROUTES.signIn}/${TOKEN}`, () => {
      throw new Error("offline");
    });
    await until(() => view.text().includes(w.noSignal));
    expect(view.text()).toContain(w.noSignal);
    await view.unmount();
  });
});

describe("the account's email", () => {
  const ME = { accountId: "4d3c2b1a-0f9e-4d8c-8b7a-6f5e4d3c2b1a", email: "manager@example.com" };
  const server = (signOuts: string[] = []) => (request: Request) => {
    const { pathname } = new URL(request.url);
    if (pathname === "/api/sign-in/verify" || pathname === "/api/me") return Response.json(ME);
    if (pathname === "/api/sign-out") {
      signOuts.push(request.method);
      return new Response(null, { status: 204 });
    }
    return Response.json({ properties: [] });
  };
  const signOutButton = (view: Awaited<ReturnType<typeof mount>>) => [...view.host.querySelectorAll("button")].find((b) => b.textContent === w.signOut)!;

  it("shows on the page right after a link is opened, on a phone that never asked for it", async () => {
    window.localStorage.clear();
    const view = await mount(`${ROUTES.signIn}/${TOKEN}`, server());
    await until(() => view.text().includes(w.signedInAs(ME.email)));
    expect(view.text()).toContain(w.signedInAs(ME.email));
    await view.unmount();
  });

  it("Sign Out ends the session and goes to Sign In", async () => {
    const signOuts: string[] = [];
    const view = await mount(ROUTES.homes, server(signOuts));
    await until(() => view.text().includes(w.signedInAs(ME.email)));
    await settle(() => signOutButton(view).click());
    await until(() => window.location.hash === ROUTES.signIn);
    expect(signOuts).toEqual(["POST"]);
    expect(window.location.hash).toBe(ROUTES.signIn);
    await view.unmount();
  });

  it("with no signal, Sign Out says so and stays", async () => {
    const view = await mount(ROUTES.homes, (request) => {
      if (new URL(request.url).pathname === "/api/sign-out") throw new Error("offline");
      return server()(request);
    });
    await until(() => view.text().includes(w.signedInAs(ME.email)));
    await settle(() => signOutButton(view).click());
    await until(() => view.text().includes(w.noSignal));
    expect(view.text()).toContain(w.noSignal);
    expect(window.location.hash).toBe(ROUTES.homes);
    await view.unmount();
  });
});

describe("a homeowner signing in", () => {
  const ME = { accountId: "4d3c2b1a-0f9e-4d8c-8b7a-6f5e4d3c2b1a", email: "owner@example.com" };
  const server = (phone: unknown) => (request: Request) => {
    const { pathname } = new URL(request.url);
    if (pathname === "/api/sign-in/verify" || pathname === "/api/me") return Response.json(ME);
    if (pathname === "/api/me/phone") return Response.json(phone);
    return Response.json({ properties: [] });
  };
  const mountWith = async (hash: string, answer: (request: Request) => Response, prefs: ReturnType<typeof testDeps>["prefs"]) => {
    window.location.hash = hash;
    const send = async (request: Request) => answer(request);
    return render(<App deps={testDeps({ prefs, account: accountApi("http://localhost", send, prefs.visitorId), portfolio: portfolioApi("http://localhost", send, prefs.visitorId) })} />);
  };

  it("with no homes, lands on Home with the email, not on an empty Your Homes", async () => {
    window.localStorage.clear();
    const view = await mountWith(`${ROUTES.signIn}/${TOKEN}`, server({ linked: true }), testDeps().prefs);
    await until(() => view.text().includes(w.signedInAs(ME.email)));
    expect(window.location.hash).toBe(ROUTES.home);
    expect(view.text()).toContain(w.signedInAs(ME.email));
    await view.unmount();
  });

  it("this phone keeps its own id when the server says it is linked", async () => {
    window.localStorage.setItem(PORTFOLIO_KEY, "on");
    const prefs = testDeps().prefs;
    const before = prefs.visitorId();
    const view = await mountWith(ROUTES.home, server({ linked: true }), prefs);
    await until(() => view.text().includes(w.signedInAs(ME.email)));
    await settle(() => new Promise((r) => setTimeout(r, 10)));
    expect(prefs.visitorId()).toBe(before);
    expect(view.text()).not.toContain(w.notLinked);
    await view.unmount();
  });

  it.each([
    ["other_phone", w.notLinked],
    ["held", w.heldPhone],
  ])("a phone answered %s says its own true sentence", async (reason, line) => {
    window.localStorage.setItem(PORTFOLIO_KEY, "on");
    const view = await mountWith(ROUTES.home, server({ linked: false, reason }), testDeps().prefs);
    await until(() => view.text().includes(line));
    expect(view.text()).toContain(line);
    await view.unmount();
  });

  it.each([[null], ["busy"]])("a phone answered %s stays silent: a landlord with nothing here reads no warning", async (reason) => {
    window.localStorage.setItem(PORTFOLIO_KEY, "on");
    const view = await mountWith(ROUTES.home, server({ linked: false, reason }), testDeps().prefs);
    await until(() => view.text().includes(w.signedInAs(ME.email)));
    await settle(() => new Promise((r) => setTimeout(r, 10)));
    expect(view.text()).not.toContain(w.notLinked);
    expect(view.text()).not.toContain(w.heldPhone);
    await view.unmount();
  });

  it("Sign Out clears the phone's copies and marks it, so Delete Everything can tell the truth", async () => {
    window.localStorage.setItem(PORTFOLIO_KEY, "on");
    let forgotten = 0;
    const send = async (request: Request) => (new URL(request.url).pathname === "/api/sign-out" ? new Response(null, { status: 204 }) : server({ linked: true })(request));
    const prefs = testDeps().prefs;
    window.location.hash = ROUTES.settings;
    const view = await render(<App deps={testDeps({ prefs, forgetSent: async () => void forgotten++, account: accountApi("http://localhost", send, prefs.visitorId), portfolio: portfolioApi("http://localhost", send, prefs.visitorId) })} />);
    await until(() => view.text().includes(w.signedInAs(ME.email)));
    const button = [...view.host.querySelectorAll("button")].find((b) => b.textContent === w.signOut)!;
    await settle(() => button.click());
    await until(() => forgotten === 1);
    expect(forgotten).toBe(1);
    expect(window.localStorage.getItem(PORTFOLIO_KEY)).toBeNull();
    expect(accountLeftBehind()).toBe(true);
    await view.unmount();
  });

  for (const [path, label] of [["/api/sign-out", w.signOut], ["/api/sign-out/everywhere", w.signOutEverywhere]] as const) {
    it(`${label} while a walk is busy is refused, says so, and keeps the phone's copies`, async () => {
      window.localStorage.setItem(PORTFOLIO_KEY, "on");
      let forgotten = 0;
      const send = async (request: Request) => (new URL(request.url).pathname === path ? Response.json({ error: { code: "walk_busy", message: "busy" } }, { status: 409 }) : server({ linked: true })(request));
      const prefs = testDeps().prefs;
      window.location.hash = ROUTES.settings;
      const view = await render(<App deps={testDeps({ prefs, forgetSent: async () => void forgotten++, account: accountApi("http://localhost", send, prefs.visitorId), portfolio: portfolioApi("http://localhost", send, prefs.visitorId) })} />);
      await until(() => view.text().includes(w.signedInAs(ME.email)));
      const button = [...view.host.querySelectorAll("button")].find((b) => b.textContent === label)!;
      await settle(() => button.click());
      await until(() => view.text().includes(w.walkBusy));
      expect(view.text()).toContain(w.walkBusy);
      expect(forgotten).toBe(0);
      expect(window.localStorage.getItem(PORTFOLIO_KEY)).toBe("on");
      expect(view.text()).toContain(w.signedInAs(ME.email));
      await view.unmount();
    });
  }

  it("a walk that needs signing in again sends the phone Home, which says so and offers Sign In", async () => {
    window.localStorage.clear();
    window.sessionStorage.clear();
    const walkId = "71000000-0000-4000-8000-000000000001";
    const send = notingSignInAgain(async () => Response.json({ error: { code: "unknown_walk", message: "no" } }, { status: 401 }));
    const results = apiResults(walkApi("http://localhost", send, () => "a".repeat(64)), "http://localhost");
    expect(await results(walkId)).toBeNull();
    window.location.hash = ROUTES.home;
    const view = await render(<App deps={testDeps()} />);
    expect(view.text()).toContain(movedWords.signInAgain);
    expect(view.host.querySelector(`a[href="${ROUTES.signIn}"]`)).not.toBeNull();
    await view.unmount();
    openPortfolio();
    expect(signInAgainNoted()).toBe(false);
    closePortfolio();
    window.localStorage.clear();
  });

  it("a plain missing walk, or a 401 somewhere it does not mean that, says nothing of signing in", async () => {
    window.sessionStorage.clear();
    const send = notingSignInAgain(async () => Response.json({ error: { code: "unknown_walk", message: "no" } }, { status: 404 }));
    expect(await apiResults(walkApi("http://localhost", send, () => "a".repeat(64)), "http://localhost")("71000000-0000-4000-8000-000000000001")).toBeNull();
    expect(signInAgainNoted()).toBe(false);
  });

  it("Sign Out on Every Phone ends every session and clears this phone", async () => {
    window.localStorage.setItem(PORTFOLIO_KEY, "on");
    const paths: string[] = [];
    let forgotten = 0;
    const send = async (request: Request) => {
      paths.push(new URL(request.url).pathname);
      return new URL(request.url).pathname === "/api/sign-out/everywhere" ? new Response(null, { status: 204 }) : server({ linked: true })(request);
    };
    const prefs = testDeps().prefs;
    window.location.hash = ROUTES.settings;
    const view = await render(<App deps={testDeps({ prefs, forgetSent: async () => void forgotten++, account: accountApi("http://localhost", send, prefs.visitorId), portfolio: portfolioApi("http://localhost", send, prefs.visitorId) })} />);
    await until(() => view.text().includes(w.signedInAs(ME.email)));
    const button = [...view.host.querySelectorAll("button")].find((b) => b.textContent === w.signOutEverywhere)!;
    await settle(() => button.click());
    await until(() => forgotten === 1);
    expect(paths).toContain("/api/sign-out/everywhere");
    await view.unmount();
  });

  it("asks for the mail in this phone's language", async () => {
    window.localStorage.clear();
    const widgets = fakeWidgets();
    const bodies: unknown[] = [];
    const prefs = testDeps().prefs;
    prefs.setLanguage("es");
    const view = await mountWith(ROUTES.signIn, withConfig(async (request) => {
      bodies.push(await request.json());
      return Response.json({ accepted: true }, { status: 202 });
    }) as never, prefs);
    await until(() => widgets.rendered.length === 1);
    await type(view as never, "input[type=email]", "m@example.com");
    await submit(view as never);
    await until(() => bodies.length === 1);
    expect(bodies[0]).toMatchObject({ language: "es" });
    await view.unmount();
  });

  it("Home never asks for sign in before a walk: the walk button comes first", async () => {
    window.localStorage.clear();
    const view = await mount(ROUTES.home, () => Response.json({}));
    const links = [...view.host.querySelectorAll("main a")].map((a) => a.getAttribute("href"));
    expect(links.indexOf(ROUTES.signIn)).toBeGreaterThan(0);
    expect(view.host.querySelector("a.button.primary")?.getAttribute("href")).not.toBe(ROUTES.signIn);
    await view.unmount();
  });

  it("after buying a plan, Home offers Sign In with its own line", async () => {
    window.localStorage.clear();
    window.history.replaceState(null, "", "/?checkout=done");
    const view = await mount(ROUTES.home, () => Response.json({}));
    expect(view.text()).toContain(w.afterPurchase);
    window.history.replaceState(null, "", "/");
    await view.unmount();
  });
});

describe("a landlord on a phone with no draft switch", () => {
  it("Home offers Sign In", async () => {
    window.localStorage.clear();
    const view = await mount(ROUTES.home, () => Response.json({}));
    expect(view.host.querySelector(`a[href='${ROUTES.signIn}']`)?.textContent).toBe(w.entry);
    await view.unmount();
  });

  it("a phone already signed in sees Your Homes instead of Sign In", async () => {
    window.localStorage.clear();
    window.localStorage.setItem(PORTFOLIO_KEY, "on");
    const view = await mount(ROUTES.home, () => Response.json({}));
    expect(view.host.querySelector(`a[href='${ROUTES.signIn}']`)).toBeNull();
    expect(view.host.querySelector(`a[href='${ROUTES.homes}']`)).not.toBeNull();
    await view.unmount();
  });
});

describe("signed out on a portfolio address", () => {
  it("goes to Sign In", async () => {
    const view = await mount(ROUTES.homes, () => refusal("unauthorized", 401));
    await until(() => window.location.hash === ROUTES.signIn);
    expect(window.location.hash).toBe(ROUTES.signIn);
    await view.unmount();
  });
});

describe("on a phone never signed in", () => {
  it("the portfolio addresses open their own screens, which send a signed out visitor to Sign In", () => {
    window.localStorage.clear();
    expect(routeFor(ROUTES.homes)).toBe("homes");
    expect(routeFor(ROUTES.signIn)).toBe("signIn");
    expect(routeFor(`${ROUTES.property}/x`)).toBe("property");
    expect(routeFor(`${ROUTES.signIn}/${TOKEN}`)).toBe("signIn");
    expect(routeFor(`${ROUTES.tenantInvite}/abc`)).toBe("tenantInvite");
  });
});
