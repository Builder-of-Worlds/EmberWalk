import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { boot, SW_URL } from "../../src/boot.tsx";
import { copy } from "../../src/copy.ts";
import { testDeps } from "./fakes.ts";
import "./render.ts";

afterEach(() => {
  document.body.replaceChildren();
});

const withRoot = () => {
  const host = document.createElement("div");
  host.id = "root";
  document.body.append(host);
  return host;
};

describe("boot", () => {
  it("refuses to start when the page has no #root", () => {
    expect(() => boot(document, undefined, true, testDeps())).toThrow(/#root/);
  });

  it("mounts the app into #root", async () => {
    const host = withRoot();
    let root: ReturnType<typeof boot> | undefined;
    await act(async () => {
      root = boot(document, undefined, false, testDeps());
    });
    expect(host.querySelector("h1")?.textContent).toBe(copy.home.title);
    await act(async () => root?.unmount());
  });

  it("registers the service worker in a production build", async () => {
    withRoot();
    const register = vi.fn(async () => undefined);
    let root: ReturnType<typeof boot> | undefined;
    await act(async () => {
      root = boot(document, { register }, true, testDeps());
    });
    expect(register).toHaveBeenCalledWith(SW_URL);
    await act(async () => root?.unmount());
  });

  it("registers the worker next to the page, so a copy in a folder never reaches for /sw.js", async () => {
    withRoot();
    const register = vi.fn(async (_url: string) => undefined);
    let root: ReturnType<typeof boot> | undefined;
    await act(async () => {
      root = boot(document, { register }, true, testDeps());
    });
    const url = register.mock.calls[0]?.[0] ?? "";
    expect(url.startsWith("/")).toBe(false);
    expect(new URL(url, "https://emberwalk.test/judge/").pathname).toBe("/judge/sw.js");
    expect(new URL(url, "https://emberwalk.test/").pathname).toBe("/sw.js");
    await act(async () => root?.unmount());
  });

  it("does not register it in development, nor where the browser has no service workers", async () => {
    withRoot();
    const register = vi.fn(async () => undefined);
    let root: ReturnType<typeof boot> | undefined;
    await act(async () => {
      root = boot(document, { register }, false, testDeps());
    });
    await act(async () => root?.unmount());
    await act(async () => {
      root = boot(document, undefined, true, testDeps());
    });
    expect(register).not.toHaveBeenCalled();
    await act(async () => root?.unmount());
  });
});
