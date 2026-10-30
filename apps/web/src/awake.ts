type Sentinel = { release(): Promise<void> };

export type WakeNavigator = { wakeLock?: { request(type: "screen"): Promise<Sentinel> } };

export type VisibilityDocument = Pick<Document, "visibilityState" | "addEventListener" | "removeEventListener">;

export type Awake = { hold(): () => void };

export const browserAwake = (nav: WakeNavigator, doc: VisibilityDocument): Awake => ({
  hold: () => {
    let held = true;
    let sentinel: Sentinel | null = null;
    const take = async () => {
      try {
        const got = await nav.wakeLock?.request("screen");
        if (got === undefined) return;
        if (held) sentinel = got;
        else await got.release();
      } catch {
        sentinel = null;
      }
    };
    const again = () => {
      if (held && doc.visibilityState === "visible") void take();
    };
    doc.addEventListener("visibilitychange", again);
    void take();
    return () => {
      held = false;
      doc.removeEventListener("visibilitychange", again);
      void sentinel?.release().catch(() => undefined);
      sentinel = null;
    };
  },
});
