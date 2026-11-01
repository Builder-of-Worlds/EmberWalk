import type { PDFOptions, WaitForOptions, WorkersLaunchOptions } from "@cloudflare/puppeteer";
import type { BrowserBinding, PdfBrowser, PdfPage, Puppet } from "../src/browser-run.ts";

export type Step = "acquire" | "connect" | "newPage" | "setContent" | "createPDFStream";

export type FakeBrowserOptions = { refuse?: Step; hang?: Step; late?: { step: Step; ms: number }; pdf?: Uint8Array; chunk?: number; closeFails?: boolean };

export type Seen = {
  acquired: number;
  launchOptions: WorkersLaunchOptions | undefined;
  connected: string[];
  html: string | null;
  contentOptions: WaitForOptions | undefined;
  pdfOptions: PDFOptions | undefined;
  browserClosed: number;
  sessionsClosed: string[];
  steps: Step[];
};

export const FAKE_PDF = "%PDF-1.7\nfake report\n%%EOF";

export const fakeBrowser = (o: FakeBrowserOptions = {}): { binding: BrowserBinding; puppet: Puppet; seen: Seen } => {
  const seen: Seen = {
    acquired: 0,
    launchOptions: undefined,
    connected: [],
    html: null,
    contentOptions: undefined,
    pdfOptions: undefined,
    browserClosed: 0,
    sessionsClosed: [],
    steps: [],
  };
  const closers: (() => void)[] = [];
  const step = async (name: Step): Promise<void> => {
    seen.steps.push(name);
    if (o.refuse === name) throw new Error(`refused ${name}`);
    if (o.hang === name) await new Promise((_, reject) => closers.push(() => reject(new Error(`closed during ${name}`))));
    if (o.late?.step === name) await new Promise((resolve) => setTimeout(resolve, o.late?.ms));
  };
  const pdf = o.pdf ?? new TextEncoder().encode(FAKE_PDF);
  const page: PdfPage = {
    setContent: async (html, options) => {
      await step("setContent");
      seen.html = html;
      seen.contentOptions = options;
    },
    createPDFStream: async (options) => {
      await step("createPDFStream");
      seen.pdfOptions = options;
      const size = o.chunk ?? pdf.length;
      let at = 0;
      return new ReadableStream<Uint8Array>({
        pull: (controller) => {
          if (at >= pdf.length) return controller.close();
          controller.enqueue(pdf.slice(at, at + size));
          at += size;
        },
      });
    },
  };
  const browser: PdfBrowser = {
    newPage: async () => {
      await step("newPage");
      return page;
    },
    close: async () => {
      seen.browserClosed += 1;
      if (o.closeFails === true) throw new Error("the browser did not close");
      for (const close of closers.splice(0)) close();
    },
  };
  const binding: BrowserBinding = {
    fetch: async () => {
      throw new Error("the fake binding is driven through the fake puppet");
    },
    closeSession: async (sessionId) => {
      seen.sessionsClosed.push(sessionId);
      for (const close of closers.splice(0)) close();
      return { status: "closed" };
    },
  };
  const puppet: Puppet = {
    acquire: async (endpoint, options) => {
      if (endpoint !== binding) throw new Error("acquired through another binding");
      seen.acquired += 1;
      seen.launchOptions = options;
      await step("acquire");
      return { sessionId: "session-1" };
    },
    connect: async (endpoint, sessionId) => {
      if (endpoint !== binding) throw new Error("connected through another binding");
      seen.connected.push(sessionId ?? "");
      await step("connect");
      return browser;
    },
  };
  return { binding, puppet, seen };
};
