import { stillPath } from "@emberwalk/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DepsContext } from "../../src/deps.ts";
import type { Proof } from "../../src/results.ts";
import { Photo } from "../../src/screens/Photo.tsx";
import { testDeps } from "./fakes.ts";
import { render, settle } from "./render.ts";
import { LIVE_WALK, liveFindingId } from "./result-fakes.ts";

const LIVE = `https://ember.test${stillPath(LIVE_WALK, liveFindingId(1))}`;

const proof = (still: string): Proof => ({ still, frame: 1, seconds: 0.5, marker: [0.1, 0.2, 0.5, 0.6] });

const show = async (still: string, stills: (url: string) => Promise<Blob | null>) => {
  const deps = testDeps({ stills });
  const view = await render(
    <DepsContext.Provider value={deps}>
      <Photo proof={proof(still)} />
    </DepsContext.Provider>,
  );
  await settle();
  return { ...view, img: () => view.host.querySelector("img") };
};

const objectUrls = () => {
  const made = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:still-1");
  const revoked = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
  return { made, revoked };
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Photo", () => {
  it("loads a live still through the phone's own fetch into an object URL", async () => {
    const { made } = objectUrls();
    const bytes = new Blob(["jpeg"], { type: "image/jpeg" });
    const stills = vi.fn(async () => bytes);
    const view = await show(LIVE, stills);
    expect(stills).toHaveBeenCalledWith(LIVE);
    expect(made).toHaveBeenCalledWith(bytes);
    expect(view.img()?.getAttribute("src")).toBe("blob:still-1");
    await view.unmount();
  });

  it("revokes the object URL when the screen leaves", async () => {
    const { revoked } = objectUrls();
    const view = await show(LIVE, async () => new Blob(["jpeg"], { type: "image/jpeg" }));
    expect(revoked).not.toHaveBeenCalled();
    await view.unmount();
    expect(revoked).toHaveBeenCalledWith("blob:still-1");
  });

  it("shows no broken image when the still cannot be fetched", async () => {
    const { made } = objectUrls();
    const view = await show(LIVE, async () => null);
    expect(view.img()).toBeNull();
    expect(made).not.toHaveBeenCalled();
    await view.unmount();
  });

  it("never makes an object URL for a still that arrives after the screen left", async () => {
    const { made } = objectUrls();
    let arrive: (blob: Blob) => void = () => undefined;
    const view = await show(LIVE, () => new Promise((resolve) => (arrive = resolve)));
    await view.unmount();
    await settle(() => arrive(new Blob(["late"], { type: "image/jpeg" })));
    expect(made).not.toHaveBeenCalled();
  });

  it("shows a bundled sample still at its own path and fetches nothing", async () => {
    const stills = vi.fn(async () => null);
    const view = await show("/assets/wood-pile-1.jpg", stills);
    expect(view.img()?.getAttribute("src")).toBe("/assets/wood-pile-1.jpg");
    expect(stills).not.toHaveBeenCalled();
    await view.unmount();
  });
});
