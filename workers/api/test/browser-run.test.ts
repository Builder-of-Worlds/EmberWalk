import { describe, expect, it } from "vitest";
import { KEEP_ALIVE_MS, MAX_PDF_BYTES, PDF_DEADLINE_MS, pdfOf } from "../src/browser-run.ts";
import { FAKE_PDF, fakeBrowser, type Step } from "./browser-fake.ts";

const HTML = "<!doctype html><html><body><main><h1>Defensible Space Record</h1></main></body></html>";

const print = (o: Parameters<typeof fakeBrowser>[0] = {}, deadlineMs = 2_000) => {
  const fake = fakeBrowser(o);
  return { ...fake, printed: pdfOf(fake.binding, HTML, { puppet: fake.puppet, deadlineMs }) };
};

describe("printing through Browser Run with @cloudflare/puppeteer (a fake of its interface)", () => {
  it("acquires a session, connects to it, sets the page, waits for it to load, prints letter size with backgrounds and closes the browser", async () => {
    const { printed, seen } = print();
    expect(new TextDecoder().decode(await printed)).toBe(FAKE_PDF);
    expect(seen.steps).toEqual(["acquire", "connect", "newPage", "setContent", "createPDFStream"]);
    expect(seen.launchOptions).toEqual({ keep_alive: KEEP_ALIVE_MS });
    expect(seen.connected).toEqual(["session-1"]);
    expect(seen.html).toBe(HTML);
    expect(seen.contentOptions).toEqual({ waitUntil: "load", timeout: 2_000 });
    expect(seen.pdfOptions).toEqual({ format: "letter", printBackground: true, preferCSSPageSize: true });
    expect([seen.browserClosed, seen.sessionsClosed]).toEqual([1, []]);
  });

  it("keeps every byte of a PDF that arrives in pieces, bytes above 127 included", async () => {
    const pdf = new Uint8Array([...new TextEncoder().encode("%PDF-1.7\n%"), 0xe2, 0xe3, 0xcf, 0xd3, 0x80, 0xff, 0x00, 0x0a]);
    const { printed } = print({ pdf, chunk: 3 });
    expect([...(await printed)]).toEqual([...pdf]);
  });

  it("is refused when no browser is free, and connects to nothing", async () => {
    const { printed, seen } = print({ refuse: "acquire" });
    await expect(printed).rejects.toThrow("refused acquire");
    expect([seen.connected, seen.browserClosed, seen.sessionsClosed]).toEqual([[], 0, []]);
  });

  it("closes the acquired session when the connection to it fails", async () => {
    const { printed, seen } = print({ refuse: "connect" });
    await expect(printed).rejects.toThrow("refused connect");
    expect(seen.sessionsClosed).toEqual(["session-1"]);
  });

  for (const step of ["newPage", "setContent", "createPDFStream"] satisfies Step[]) {
    it(`closes the browser when ${step} fails`, async () => {
      const { printed, seen } = print({ refuse: step });
      await expect(printed).rejects.toThrow(`refused ${step}`);
      expect([seen.browserClosed, seen.sessionsClosed]).toEqual([1, []]);
    });
  }

  it("gives up at one deadline for the whole PDF, closes the browser, and never prints", async () => {
    const { printed, seen } = print({ hang: "setContent" }, 50);
    await expect(printed).rejects.toThrow("no PDF within 50 ms");
    expect(seen.browserClosed).toBe(1);
    expect(seen.steps).not.toContain("createPDFStream");
  });

  it("closes a session that is acquired only after the deadline passed", async () => {
    const { printed, seen } = print({ late: { step: "acquire", ms: 100 } }, 20);
    await expect(printed).rejects.toThrow("no PDF within 20 ms");
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(seen.sessionsClosed).toEqual(["session-1"]);
    expect(seen.connected).toEqual([]);
  });

  it("never prints a page whose content was set only after the deadline passed", async () => {
    const { printed, seen } = print({ late: { step: "setContent", ms: 100 } }, 20);
    await expect(printed).rejects.toThrow("no PDF within 20 ms");
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(seen.html).toBe(HTML);
    expect(seen.steps).not.toContain("createPDFStream");
    expect(seen.browserClosed).toBe(1);
  });

  it("allows 45 seconds for the whole PDF by default", () => {
    expect(PDF_DEADLINE_MS).toBe(45_000);
  });

  it("still closes the session when closing the browser fails, after a print and after a failed step", async () => {
    const { printed, seen } = print({ closeFails: true });
    expect(new TextDecoder().decode(await printed)).toBe(FAKE_PDF);
    expect([seen.browserClosed, seen.sessionsClosed]).toEqual([1, ["session-1"]]);
    const failed = print({ closeFails: true, refuse: "setContent" });
    await expect(failed.printed).rejects.toThrow("refused setContent");
    expect([failed.seen.browserClosed, failed.seen.sessionsClosed]).toEqual([1, ["session-1"]]);
  });

  it(`keeps a PDF of exactly ${MAX_PDF_BYTES} bytes (24 MiB) and refuses one byte more, still closing the browser`, async () => {
    expect(MAX_PDF_BYTES).toBe(24 * 1024 * 1024);
    const pdf = (size: number) => {
      const bytes = new Uint8Array(size).fill(0x20);
      bytes.set(new TextEncoder().encode("%PDF-1.7\n"));
      return bytes;
    };
    const exact = print({ pdf: pdf(MAX_PDF_BYTES), chunk: 1024 * 1024 });
    const kept = await exact.printed;
    expect([kept.byteLength, kept[MAX_PDF_BYTES - 1], new TextDecoder().decode(kept.subarray(0, 5))]).toEqual([MAX_PDF_BYTES, 0x20, "%PDF-"]);
    const over = print({ pdf: pdf(MAX_PDF_BYTES + 1), chunk: 1024 * 1024 });
    await expect(over.printed).rejects.toThrow(`the PDF is over ${MAX_PDF_BYTES} bytes`);
    expect(over.seen.browserClosed).toBe(1);
  });

  it("refuses an answer that is not a PDF, and still closes the browser", async () => {
    const { printed, seen } = print({ pdf: new TextEncoder().encode("<html>not a pdf</html>") });
    await expect(printed).rejects.toThrow("the browser did not print a PDF");
    expect(seen.browserClosed).toBe(1);
  });
});
