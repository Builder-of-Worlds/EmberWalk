import { StrictMode } from "react";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { App } from "../../src/App.tsx";
import { shortDay } from "../../src/copy.ts";
import { reportWords } from "../../src/draft-words.ts";
import { setLanguage } from "../../src/language.ts";
import type { ReportApi, ReportApproval, ReportPage, ReportPdf, ReportShare } from "../../src/report-api.ts";
import type { WalkResults } from "../../src/results.ts";
import { reportFor, resultsFor } from "../../src/router.ts";
import { SAMPLES } from "../../src/samples.ts";
import { testDeps } from "./fakes.ts";
import { render, settle } from "./render.ts";
import { finding, walk } from "./result-fakes.ts";

const PAGE = "<!doctype html><html><body><main><h1>Defensible Space Record</h1></main></body></html>";
const SEEN_A = "a".repeat(64);
const SEEN_B = "b".repeat(64);
const READY: ReportPage = { html: PAGE, seen: SEEN_A };
const PDF = new Blob(["%PDF-1.7"], { type: "application/pdf" });
const LIVE = walk([finding("item-1")]);
const SAMPLE = walk([finding("item-1")], [], { id: SAMPLES[0]!.id });

const until = async (check: () => boolean) => {
  for (let i = 0; i < 50 && !check(); i++) await settle(() => new Promise((r) => setTimeout(r, 5)));
  if (!check()) throw new Error("condition never became true");
};

const APPROVED_AT = "2026-10-30T16:00:00.000Z";

type FakeOptions = {
  pdf?: () => Promise<ReportPdf>;
  page?: (walkId: string) => Promise<ReportPage>;
  approvedAt?: string | null;
  changed?: boolean;
  approve?: () => Promise<ReportApproval>;
  link?: string | null;
  share?: () => Promise<ReportShare>;
  makeShare?: () => Promise<ReportShare>;
  stopShare?: () => Promise<ReportShare>;
  copies?: boolean;
};

const without = (removed: readonly string[]) => (removed.length > 0 ? ` without ${removed.join(",")}` : "");

const LINK = "https://go.emberwalk.test/api/shared/AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-AbCde";

const fakeReport = (page: ReportPage, o: FakeOptions = {}) => {
  const asked: string[] = [];
  const saved: { pdf: Blob; name: string }[] = [];
  const copied: string[] = [];
  const sent: string[] = [];
  const state = { approvedAt: o.approvedAt === undefined ? APPROVED_AT : o.approvedAt, changed: o.changed ?? false };
  let link = o.link ?? null;
  const api: ReportApi = {
    share: async (walkId) => {
      asked.push(`share ${walkId}`);
      if (o.share !== undefined) return o.share();
      return { link };
    },
    makeShare: async (walkId, removed) => {
      asked.push(`make share ${walkId}${without(removed)}`);
      if (o.makeShare !== undefined) return o.makeShare();
      link = LINK;
      return { link };
    },
    stopShare: async (walkId) => {
      asked.push(`stop share ${walkId}`);
      if (o.stopShare !== undefined) return o.stopShare();
      link = null;
      return { link };
    },
    copy: async (text) => {
      copied.push(text);
      return o.copies ?? true;
    },
    page: async (walkId, removed) => {
      asked.push(`page ${walkId}${without(removed)}`);
      return o.page === undefined ? page : o.page(walkId);
    },
    pdf: async (walkId, removed) => {
      asked.push(`pdf ${walkId}${without(removed)}`);
      return o.pdf === undefined ? { pdf: PDF, name: "emberwalk-record-2026-10-28.pdf" } : o.pdf();
    },
    approval: async (walkId, removed) => {
      asked.push(`approval ${walkId}${without(removed)}`);
      return { ...state };
    },
    approve: async (walkId, removed, seen) => {
      asked.push(`approve ${walkId}${without(removed)}`);
      sent.push(seen);
      const answer = o.approve === undefined ? { approvedAt: APPROVED_AT, changed: false } : await o.approve();
      if (answer.code === undefined) Object.assign(state, { approvedAt: answer.approvedAt, changed: false });
      return answer.code === undefined ? { ...state } : answer;
    },
    save: (blob, name) => saved.push({ pdf: blob, name }),
  };
  const changeAfterApproval = () => Object.assign(state, { approvedAt: null, changed: true });
  return { api, asked, saved, copied, sent, changeAfterApproval };
};

const mounted: (() => Promise<void>)[] = [];

const open = async (hash: string, results: WalkResults, report: ReportApi | undefined, removed: string[] = []) => {
  for (const unmount of mounted.splice(0)) await unmount();
  window.location.hash = hash;
  const deps = testDeps({ results: async (id) => (id === results.id ? results : null), ...(report === undefined ? {} : { report }) });
  for (const id of removed) deps.marks.remove(results.id, id, 1);
  const view = await render(<App deps={deps} />);
  mounted.push(view.unmount);
  await settle(() => new Promise((r) => setTimeout(r, 20)));
  return view;
};

const entry = (host: HTMLElement) => host.querySelector<HTMLAnchorElement>("a[data-part=report]");
const download = (host: HTMLElement) => host.querySelector<HTMLButtonElement>("button[data-part=download]");
const approveButton = (host: HTMLElement) => host.querySelector<HTMLButtonElement>("button[data-part=approve]");

afterEach(async () => {
  for (const unmount of mounted.splice(0)) await unmount();
  window.location.hash = "";
});

describe("the report entry on the results screen", () => {
  it("leads to this walk's report when the report is on", async () => {
    const view = await open(resultsFor(LIVE.id), LIVE, fakeReport(READY).api);
    expect(entry(view.host)?.getAttribute("href")).toBe(reportFor(LIVE.id));
    expect(entry(view.host)?.textContent).toBe(reportWords.entry);
  });

  it("is not there while the report is not offered or the walk is a sample", async () => {
    const onResults = (host: HTMLElement) => [host.querySelector("main.results") !== null, entry(host)];
    expect(onResults((await open(resultsFor(LIVE.id), LIVE, undefined)).host)).toEqual([true, null]);
    expect(onResults((await open(resultsFor(SAMPLE.id), SAMPLE, fakeReport(READY).api)).host)).toEqual([true, null]);
  });
});

describe("the report screen", () => {
  it("shows nothing and asks for nothing while the report is not offered or the walk is a sample", async () => {
    expect((await open(reportFor(LIVE.id), LIVE, undefined)).host.querySelector("main")).toBeNull();
    const sample = fakeReport(READY);
    expect((await open(reportFor(SAMPLE.id), SAMPLE, sample.api)).host.querySelector("main")).toBeNull();
    expect(sample.asked).toEqual([]);
  });

  it("previews the server's own page in a sandboxed frame, with the way back", async () => {
    const report = fakeReport(READY);
    const view = await open(reportFor(LIVE.id), LIVE, report.api);
    await until(() => view.host.querySelector("iframe") !== null);
    const frame = view.host.querySelector("iframe")!;
    expect([frame.getAttribute("srcdoc"), frame.getAttribute("sandbox"), frame.title]).toEqual([PAGE, "", reportWords.preview]);
    expect(view.host.querySelector("h1")?.textContent).toBe(reportWords.title);
    expect(view.host.querySelector("a[data-part=back]")?.getAttribute("href")).toBe(resultsFor(LIVE.id));
    expect(report.asked).toEqual([`page ${LIVE.id}`, `approval ${LIVE.id}`, `share ${LIVE.id}`]);
  });

  it("sends the items removed with This Isn't Right with the preview and the PDF", async () => {
    const report = fakeReport(READY);
    const view = await open(reportFor(LIVE.id), LIVE, report.api, ["item-1", "item-2"]);
    await until(() => download(view.host) !== null);
    await settle(() => download(view.host)!.click());
    expect(report.asked).toEqual([`page ${LIVE.id} without item-1,item-2`, `approval ${LIVE.id} without item-1,item-2`, `share ${LIVE.id}`, `pdf ${LIVE.id} without item-1,item-2`]);
  });

  it("shows the approval step again, in its own words, when the report changed after the approval, and approves with the removed items", async () => {
    const report = fakeReport(READY, { approvedAt: null, changed: true });
    const view = await open(reportFor(LIVE.id), LIVE, report.api, ["item-1"]);
    await until(() => approveButton(view.host) !== null);
    expect([view.text().includes(reportWords.checkAgain), view.text().includes(reportWords.checkPhotos), download(view.host)]).toEqual([true, false, null]);
    await settle(() => approveButton(view.host)!.click());
    await until(() => download(view.host) !== null);
    expect(report.asked).toContain(`approve ${LIVE.id} without item-1`);
    expect(view.text()).not.toContain(reportWords.checkAgain);
  });

  it("brings the approval step back when the PDF answers that the report changed since the approval", async () => {
    const report: ReturnType<typeof fakeReport> = fakeReport(
      READY,
      {
        pdf: async () => {
          report.changeAfterApproval();
          return { code: "conflict" };
        },
      },
    );
    const view = await open(reportFor(LIVE.id), LIVE, report.api);
    await until(() => download(view.host) !== null);
    await settle(() => download(view.host)!.click());
    await until(() => approveButton(view.host) !== null);
    expect([view.text().includes(reportWords.checkAgain), download(view.host), view.host.querySelector("[data-part=share]")]).toEqual([true, null, null]);
    expect(report.asked.filter((a) => a.startsWith("page ")).length).toBe(2);
  });

  it("offers no download until the blurred photos are approved, then approves with one tap, reloads the preview and offers it", async () => {
    let shown = 0;
    const report = fakeReport(READY, { approvedAt: null, page: async () => ({ html: `${PAGE}<!-- ${(shown += 1)} -->`, seen: SEEN_A }) });
    const view = await open(reportFor(LIVE.id), LIVE, report.api);
    await until(() => approveButton(view.host) !== null);
    expect(download(view.host)).toBeNull();
    expect(view.text()).toContain(reportWords.checkPhotos);
    await settle(() => approveButton(view.host)!.click());
    await until(() => download(view.host) !== null);
    expect(approveButton(view.host)).toBeNull();
    expect(view.host.querySelector("[data-part=approved]")?.textContent).toBe("You approved the blurred photos on Oct. 30th, 2026. You can download your report now.");
    expect(view.host.querySelector("iframe")!.getAttribute("srcdoc")).toBe(`${PAGE}<!-- 2 -->`);
    expect(report.asked.filter((a) => a.startsWith("approve ") || a.startsWith("pdf "))).toEqual([`approve ${LIVE.id}`]);
  });

  it("asks again over a fresh preview when a part arrived between the preview and Approve, and approves what that preview shows", async () => {
    let shown = 0;
    let tries = 0;
    const report = fakeReport(READY, {
      approvedAt: null,
      page: async () => ({ html: `${PAGE}<!-- ${shown} -->`, seen: [SEEN_A, SEEN_B][Math.min((shown += 1) - 1, 1)]! }),
      approve: async () => ((tries += 1) === 1 ? { code: "conflict" } : { approvedAt: APPROVED_AT, changed: false }),
    });
    const view = await open(reportFor(LIVE.id), LIVE, report.api);
    await until(() => approveButton(view.host) !== null);
    expect(view.text()).toContain(reportWords.checkPhotos);
    await settle(() => approveButton(view.host)!.click());
    await until(() => shown === 2 && approveButton(view.host)?.disabled === false);
    expect([view.text().includes(reportWords.checkAgain), view.text().includes(reportWords.checkPhotos), download(view.host)]).toEqual([true, false, null]);
    await settle(() => approveButton(view.host)!.click());
    await until(() => download(view.host) !== null);
    expect(report.sent).toEqual([SEEN_A, SEEN_B]);
    expect(view.text()).not.toContain(reportWords.checkAgain);
  });

  it("says plainly when the approval is not saved, and still offers no download", async () => {
    const report = fakeReport(READY, { approvedAt: null, approve: async () => ({ code: "offline" }) });
    const view = await open(reportFor(LIVE.id), LIVE, report.api);
    await until(() => approveButton(view.host) !== null);
    await settle(() => approveButton(view.host)!.click());
    await until(() => view.text().includes("No signal right now. Tap Approve Blurred Photos again when you have signal."));
    expect(download(view.host)).toBeNull();
    expect(approveButton(view.host)!.disabled).toBe(false);
  });

  it("downloads the PDF under the server's name, saying it is being made meanwhile", async () => {
    let finish: (pdf: ReportPdf) => void = () => undefined;
    const report = fakeReport(READY, { pdf: () => new Promise((done) => (finish = done)) });
    const view = await open(reportFor(LIVE.id), LIVE, report.api);
    await until(() => download(view.host) !== null);
    await settle(() => download(view.host)!.click());
    expect(view.text()).toContain(reportWords.making);
    expect(download(view.host)!.disabled).toBe(true);
    await settle(() => finish({ pdf: PDF, name: "emberwalk-record-2026-10-28.pdf" }));
    expect(report.saved).toEqual([{ pdf: PDF, name: "emberwalk-record-2026-10-28.pdf" }]);
    expect(view.text()).not.toContain(reportWords.making);
  });

  it("says plainly when the PDF cannot be made, and keeps the preview", async () => {
    const report = fakeReport(READY, { pdf: async () => ({ code: "offline" }) });
    const view = await open(reportFor(LIVE.id), LIVE, report.api);
    await until(() => download(view.host) !== null);
    await settle(() => download(view.host)!.click());
    await until(() => view.text().includes("No signal right now. Tap Download PDF again when you have signal."));
    expect(report.saved).toEqual([]);
    expect(view.host.querySelector("iframe")).not.toBeNull();
  });

  it("leaves the waiting words when the preview or the PDF request throws", async () => {
    const thrown = fakeReport(READY, { page: () => Promise.reject(new Error("broke")) });
    let view = await open(reportFor(LIVE.id), LIVE, thrown.api);
    await until(() => view.text().includes(reportWords.failed.server_error));
    expect(view.text()).not.toContain(reportWords.loading);

    const pdfThrown = fakeReport(READY, { pdf: () => Promise.reject(new Error("broke")) });
    view = await open(reportFor(LIVE.id), LIVE, pdfThrown.api);
    await until(() => download(view.host) !== null);
    await settle(() => download(view.host)!.click());
    await until(() => view.text().includes(reportWords.pdfFailed.server_error));
    expect(view.text()).not.toContain(reportWords.making);
    expect(download(view.host)!.disabled).toBe(false);
  });

  it("keeps the latest answer when an answer to a request it already dropped arrives after it (React's strict mode asks twice)", async () => {
    let late: (page: ReportPage) => void = () => undefined;
    let calls = 0;
    const report = fakeReport(READY, { page: () => ((calls += 1) === 1 ? new Promise((done) => (late = done)) : Promise.resolve({ html: "<p>newer</p>", seen: SEEN_A })) });
    for (const unmount of mounted.splice(0)) await unmount();
    window.location.hash = reportFor(LIVE.id);
    const view = await render(
      <StrictMode>
        <App deps={testDeps({ results: async () => LIVE, report: report.api })} />
      </StrictMode>,
    );
    mounted.push(view.unmount);
    await until(() => view.host.querySelector("iframe")?.getAttribute("srcdoc") === "<p>newer</p>");
    await settle(() => late({ html: "<p>older</p>", seen: SEEN_A }));
    await settle(() => new Promise((r) => setTimeout(r, 20)));
    expect(calls).toBe(2);
    expect(view.host.querySelector("iframe")?.getAttribute("srcdoc")).toBe("<p>newer</p>");
  });

  it("names a walk that is not on this phone, and a link that opens no report, in their own words", async () => {
    let view = await open(reportFor(LIVE.id), LIVE, fakeReport({ code: "unknown_walk" }).api);
    await until(() => view.text().includes("This walk is not in your record on this phone."));
    view = await open(reportFor(LIVE.id), LIVE, fakeReport({ code: "invalid_request" }).api);
    await until(() => view.text().includes("This link does not open a report. Go back to your results to find yours."));
    expect(view.text()).not.toContain("try again");
  });

  it("says why there is no report and offers no download when the server refuses", async () => {
    const view = await open(reportFor(LIVE.id), LIVE, fakeReport({ code: "walk_not_done" }).api);
    await until(() => view.text().includes(reportWords.failed.walk_not_done));
    expect(download(view.host)).toBeNull();
    expect(view.host.querySelector("iframe")).toBeNull();
  });
});

const makeShare = (host: HTMLElement) => host.querySelector<HTMLButtonElement>("button[data-part=make-share]");
const copyShare = (host: HTMLElement) => host.querySelector<HTMLButtonElement>("button[data-part=copy-share]");
const stopShare = (host: HTMLElement) => host.querySelector<HTMLButtonElement>("button[data-part=stop-share]");
const shownLink = (host: HTMLElement) => host.querySelector<HTMLAnchorElement>("[data-part=share-link] a");

describe("the share link on the report screen", () => {
  it("offers no share link and asks for none until the blurred photos are approved", async () => {
    const report = fakeReport(READY, { approvedAt: null });
    const view = await open(reportFor(LIVE.id), LIVE, report.api);
    await until(() => approveButton(view.host) !== null);
    expect([makeShare(view.host), view.host.querySelector("[data-part=share]")]).toEqual([null, null]);
    expect(report.asked.filter((a) => a.includes("share"))).toEqual([]);
    await settle(() => approveButton(view.host)!.click());
    await until(() => makeShare(view.host) !== null);
    expect(report.asked.filter((a) => a.includes("share"))).toEqual([`share ${LIVE.id}`]);
  });

  it("makes the link with the removed items, shows it, copies it and turns it off", async () => {
    const report = fakeReport(READY);
    const view = await open(reportFor(LIVE.id), LIVE, report.api, ["item-2"]);
    await until(() => makeShare(view.host) !== null);
    const part = () => view.host.querySelector("[data-part=share]")!;
    expect(part().querySelector("h2")?.textContent).toBe(reportWords.share.title);
    expect(part().textContent).toContain(reportWords.share.lead);
    expect(makeShare(view.host)!.textContent).toBe(reportWords.share.make);
    expect(shownLink(view.host)).toBeNull();

    await settle(() => makeShare(view.host)!.click());
    await until(() => shownLink(view.host) !== null);
    expect([shownLink(view.host)!.href, shownLink(view.host)!.textContent, shownLink(view.host)!.rel]).toEqual([LINK, LINK, "noreferrer"]);
    expect(makeShare(view.host)).toBeNull();

    await settle(() => copyShare(view.host)!.click());
    await until(() => view.text().includes(reportWords.share.copied));
    expect(report.copied).toEqual([LINK]);

    await settle(() => stopShare(view.host)!.click());
    await until(() => makeShare(view.host) !== null);
    expect(shownLink(view.host)).toBeNull();
    expect(view.text()).toContain(reportWords.share.stopped);
    expect(report.asked.filter((a) => a.includes("share"))).toEqual([`share ${LIVE.id}`, `make share ${LIVE.id} without item-2`, `stop share ${LIVE.id}`]);
  });

  it("shows the link already made when the screen opens", async () => {
    const view = await open(reportFor(LIVE.id), LIVE, fakeReport(READY, { link: LINK }).api);
    await until(() => shownLink(view.host) !== null);
    expect(shownLink(view.host)!.href).toBe(LINK);
    expect(makeShare(view.host)).toBeNull();
  });

  it("says plainly when making, copying or turning off does not work, and keeps the link it had", async () => {
    let finish: (share: ReportShare) => void = () => undefined;
    const report = fakeReport(READY, { makeShare: () => new Promise((done) => (finish = done)) });
    let view = await open(reportFor(LIVE.id), LIVE, report.api);
    await until(() => makeShare(view.host) !== null);
    await settle(() => makeShare(view.host)!.click());
    expect([view.text().includes(reportWords.share.making), makeShare(view.host)!.disabled]).toEqual([true, true]);
    await settle(() => finish({ code: "offline" }));
    await until(() => view.text().includes("No signal right now. Tap Make Share Link again when you have signal."));
    expect([view.text().includes(reportWords.share.making), makeShare(view.host)!.disabled, shownLink(view.host)]).toEqual([false, false, null]);

    const kept = fakeReport(READY, { link: LINK, copies: false, stopShare: async () => ({ code: "server_error" }) });
    view = await open(reportFor(LIVE.id), LIVE, kept.api);
    await until(() => shownLink(view.host) !== null);
    await settle(() => copyShare(view.host)!.click());
    await until(() => view.text().includes(reportWords.share.copyFailed));
    await settle(() => stopShare(view.host)!.click());
    await until(() => view.text().includes(reportWords.share.stopFailed.server_error));
    expect([shownLink(view.host)?.href, stopShare(view.host)!.disabled]).toEqual([LINK, false]);

    const refused = fakeReport(READY, { makeShare: () => Promise.reject(new Error("broke")) });
    view = await open(reportFor(LIVE.id), LIVE, refused.api);
    await until(() => makeShare(view.host) !== null);
    await settle(() => makeShare(view.host)!.click());
    await until(() => view.text().includes(reportWords.share.makeFailed.server_error));
    expect(view.text()).not.toContain(reportWords.share.making);
  });

  it("keeps Turn Off Link disabled while the link is being turned off", async () => {
    let finish: (share: ReportShare) => void = () => undefined;
    const view = await open(reportFor(LIVE.id), LIVE, fakeReport(READY, { link: LINK, stopShare: () => new Promise((done) => (finish = done)) }).api);
    await until(() => stopShare(view.host) !== null);
    await settle(() => stopShare(view.host)!.click());
    expect([stopShare(view.host)!.disabled, view.text().includes(reportWords.share.stopping)]).toEqual([true, true]);
    await settle(() => finish({ link: null }));
    await until(() => view.text().includes(reportWords.share.stopped));
  });

  it("keeps Turn Off Link disabled while the link is being made again after a new approval", async () => {
    let finish: (share: ReportShare) => void = () => undefined;
    const report = fakeReport(READY, { approvedAt: null, changed: true, link: LINK, makeShare: () => new Promise((done) => (finish = done)) });
    const view = await open(reportFor(LIVE.id), LIVE, report.api);
    await until(() => approveButton(view.host) !== null);
    await settle(() => approveButton(view.host)!.click());
    await until(() => report.asked.includes(`make share ${LIVE.id}`) && stopShare(view.host) !== null);
    expect([stopShare(view.host)!.disabled, view.text().includes(reportWords.share.making)]).toEqual([true, true]);
    await settle(() => finish({ link: LINK }));
    await until(() => stopShare(view.host)?.disabled === false);
    expect(view.text()).not.toContain(reportWords.share.making);
  });

  it("lets a failed read of the link be tried again with Make Share Link, which gives back the link", async () => {
    const report = fakeReport(READY, { share: async () => ({ code: "server_error" }) });
    const view = await open(reportFor(LIVE.id), LIVE, report.api);
    await until(() => makeShare(view.host) !== null);
    expect(view.text()).toContain(reportWords.share.readFailed);
    await settle(() => makeShare(view.host)!.click());
    await until(() => shownLink(view.host) !== null);
    expect(shownLink(view.host)!.href).toBe(LINK);
    expect(view.text()).not.toContain(reportWords.share.readFailed);
  });

  it("brings the approval step back when Make Share Link answers that the report changed since the approval", async () => {
    const report: ReturnType<typeof fakeReport> = fakeReport(
      READY,
      {
        makeShare: async () => {
          report.changeAfterApproval();
          return { code: "conflict" };
        },
      },
    );
    const view = await open(reportFor(LIVE.id), LIVE, report.api);
    await until(() => makeShare(view.host) !== null);
    await settle(() => makeShare(view.host)!.click());
    await until(() => approveButton(view.host) !== null);
    expect([view.text().includes(reportWords.checkAgain), makeShare(view.host)]).toEqual([true, null]);
  });

  it("makes an existing link again after a new approval, so it opens the report just approved", async () => {
    const report = fakeReport(READY, { approvedAt: null, changed: true, link: LINK });
    const view = await open(reportFor(LIVE.id), LIVE, report.api, ["item-2"]);
    await until(() => approveButton(view.host) !== null);
    expect(report.asked.filter((a) => a.includes("share"))).toEqual([]);
    await settle(() => approveButton(view.host)!.click());
    await until(() => report.asked.includes(`make share ${LIVE.id} without item-2`));
    await until(() => shownLink(view.host) !== null);
    expect(report.asked.filter((a) => a.includes("share"))).toEqual([`share ${LIVE.id}`, `make share ${LIVE.id} without item-2`]);
  });

  it("lets Download PDF be tapped again, saying so, when saving the PDF on the phone throws", async () => {
    const report = fakeReport(READY);
    report.api.save = () => {
      throw new Error("the phone refused the file");
    };
    const view = await open(reportFor(LIVE.id), LIVE, report.api);
    await until(() => download(view.host) !== null);
    await settle(() => download(view.host)!.click());
    await until(() => view.text().includes(reportWords.pdfFailed.server_error));
    expect([view.text().includes(reportWords.making), download(view.host)!.disabled]).toEqual([false, false]);
  });

  it("does not make the link again when the screen opens on an approval already made", async () => {
    const report = fakeReport(READY, { link: LINK });
    const view = await open(reportFor(LIVE.id), LIVE, report.api);
    await until(() => shownLink(view.host) !== null);
    await settle(() => new Promise((r) => setTimeout(r, 20)));
    expect(report.asked.filter((a) => a.includes("share"))).toEqual([`share ${LIVE.id}`]);
  });
});

describe("the day the report says it was approved", () => {
  const zone = process.env.TZ;
  beforeAll(() => {
    process.env.TZ = "America/Los_Angeles";
  });
  afterAll(() => {
    setLanguage("en");
    if (zone === undefined) delete process.env.TZ;
    else process.env.TZ = zone;
  });

  for (const chosen of ["en", "es"] as const) {
    it(`is the phone's own day, not the UTC day, when the two differ (${chosen})`, async () => {
      setLanguage(chosen);
      const report = fakeReport(READY, { approvedAt: "2026-11-04T01:38:00.000Z" });
      const view = await open(reportFor(LIVE.id), LIVE, report.api);
      await until(() => view.host.querySelector("[data-part=approved]") !== null);
      expect(view.host.querySelector("[data-part=approved]")!.textContent).toBe(reportWords.approved(shortDay("2026-11-03")));
    });
  }
});
