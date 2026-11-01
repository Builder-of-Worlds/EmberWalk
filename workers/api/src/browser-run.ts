import puppeteer from "@cloudflare/puppeteer";
import type { BrowserWorker, PDFOptions, WaitForOptions, WorkersLaunchOptions } from "@cloudflare/puppeteer";
import { PDF_OPTIONS } from "./report.ts";

export type BrowserBinding = BrowserWorker & { closeSession(sessionId: string): Promise<unknown> };

export type PdfPage = {
  setContent(html: string, options?: WaitForOptions): Promise<void>;
  createPDFStream(options?: PDFOptions): Promise<ReadableStream<Uint8Array>>;
};

export type PdfBrowser = { newPage(): Promise<PdfPage>; close(): Promise<void> };

export type Puppet = {
  acquire(endpoint: BrowserWorker, options?: WorkersLaunchOptions): Promise<{ sessionId: string }>;
  connect(endpoint: BrowserWorker, sessionId?: string): Promise<PdfBrowser>;
};

export const PUPPET: Puppet = puppeteer;

export const PDF_DEADLINE_MS = 45_000;

export const KEEP_ALIVE_MS = 30_000;

export const MAX_PDF_BYTES = 24 * 1024 * 1024;

export class BrowserRunFailed extends Error {
  constructor(detail: string) {
    super(detail);
    this.name = "BrowserRunFailed";
  }
}

type Growing = ArrayBuffer & { resize(byteLength: number): void; transferToFixedLength(): ArrayBuffer };

const Growable = ArrayBuffer as unknown as new (byteLength: number, options: { maxByteLength: number }) => Growing;

const bytesOf = async (stream: ReadableStream<Uint8Array>): Promise<Uint8Array<ArrayBuffer>> => {
  const pdf = new Growable(0, { maxByteLength: MAX_PDF_BYTES });
  const reader = stream.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    const at = pdf.byteLength;
    if (at + value.byteLength > MAX_PDF_BYTES) {
      await reader.cancel().catch(() => null);
      throw new BrowserRunFailed(`the PDF is over ${MAX_PDF_BYTES} bytes`);
    }
    pdf.resize(at + value.byteLength);
    new Uint8Array(pdf).set(value, at);
  }
  return new Uint8Array(pdf.transferToFixedLength());
};

const isPdf = (pdf: Uint8Array): boolean => pdf.length >= 5 && new TextDecoder().decode(pdf.subarray(0, 5)) === "%PDF-";

export type PrintOptions = { puppet?: Puppet; deadlineMs?: number };

export const pdfOf = async (binding: BrowserBinding, html: string, o: PrintOptions = {}): Promise<Uint8Array<ArrayBuffer>> => {
  const puppet = o.puppet ?? PUPPET;
  const deadlineMs = o.deadlineMs ?? PDF_DEADLINE_MS;
  const held: { sessionId: string | null; browser: PdfBrowser | null } = { sessionId: null, browser: null };
  let over = false;
  const close = async () => {
    const { sessionId, browser } = held;
    held.sessionId = null;
    held.browser = null;
    const closed = browser !== null && (await browser.close().then(() => true, () => false));
    if (!closed && sessionId !== null) await binding.closeSession(sessionId).catch(() => null);
  };
  const stillOn = () => {
    if (over) throw new BrowserRunFailed("the deadline passed");
  };
  const run = async (): Promise<Uint8Array<ArrayBuffer>> => {
    try {
      held.sessionId = (await puppet.acquire(binding, { keep_alive: KEEP_ALIVE_MS })).sessionId;
      stillOn();
      held.browser = await puppet.connect(binding, held.sessionId);
      stillOn();
      const page = await held.browser.newPage();
      stillOn();
      await page.setContent(html, { waitUntil: "load", timeout: deadlineMs });
      stillOn();
      const pdf = await bytesOf(await page.createPDFStream(PDF_OPTIONS));
      if (!isPdf(pdf)) throw new BrowserRunFailed("the browser did not print a PDF");
      return pdf;
    } finally {
      await close();
    }
  };
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      over = true;
      reject(new BrowserRunFailed(`no PDF within ${deadlineMs} ms`));
    }, deadlineMs);
  });
  const work = run();
  try {
    return await Promise.race([work, deadline]);
  } catch (error) {
    if (over) {
      work.catch(() => null);
      await close();
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
};
