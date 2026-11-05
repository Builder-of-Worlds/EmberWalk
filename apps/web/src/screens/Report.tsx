import { useEffect, useState } from "react";
import { shortDay } from "../copy.ts";
import { useDeps } from "../deps.ts";
import { reportWords } from "../draft-words.ts";
import { localDay } from "../mark-sync.ts";
import type { ReportApi, ReportApproval, ReportCode, ReportPage, ReportPdf, ReportShare } from "../report-api.ts";
import { resultsFor } from "../router.ts";
import { JUDGE } from "../judge.ts";
import { SignInAgain } from "./SignInAgain.tsx";
import { heldSample } from "../samples.ts";

type Page = { kind: "loading" } | { kind: "ready"; html: string; seen: string } | { kind: "failed"; code: ReportCode };

type Approval = { kind: "unknown" } | { kind: "open" } | { kind: "saving" } | { kind: "approved"; at: string } | { kind: "failed"; code: ReportCode };

type Pdf = { kind: "idle" } | { kind: "making" } | { kind: "failed"; code: ReportCode };

const settled = <T,>(asked: () => Promise<T>, fallback: T): Promise<T> => {
  try {
    return asked().catch(() => fallback);
  } catch {
    return Promise.resolve(fallback);
  }
};

export const Report = ({ reportId }: { reportId: string | null }) => {
  const deps = useDeps();
  return deps.report !== undefined && reportId !== null && !heldSample(reportId) ? <ReportScreen api={deps.report} walkId={reportId} /> : null;
};

type Share = { link: string | null | undefined; busy: "make" | "stop" | null; note: string | null };

type ShareProps = { api: ReportApi; walkId: string; removed: () => string[]; relink: boolean; onChanged: () => void };

const ShareLink = ({ api, walkId, removed, relink, onChanged }: ShareProps) => {
  const words = reportWords.share;
  const [share, setShare] = useState<Share>({ link: undefined, busy: null, note: null });
  const [remake] = useState(relink);

  const run = async (busy: "make" | "stop", asked: () => Promise<ReportShare>) => {
    setShare((s) => ({ ...s, busy, note: null }));
    const answer = await settled<ReportShare>(asked, { code: "server_error" });
    if (answer.code === "conflict") return onChanged();
    const failed = busy === "make" ? words.makeFailed : words.stopFailed;
    setShare((s) =>
      answer.code !== undefined ? { ...s, busy: null, note: failed[answer.code] } : { link: answer.link, busy: null, note: busy === "stop" && answer.link === null ? words.stopped : null },
    );
  };

  useEffect(() => {
    let live = true;
    void settled<ReportShare>(() => api.share(walkId), { code: "server_error" }).then((answer) => {
      if (!live) return;
      if (answer.code !== undefined) return setShare({ link: null, busy: null, note: words.readFailed });
      setShare({ link: answer.link, busy: null, note: null });
      if (remake && answer.link !== null) void run("make", () => api.makeShare(walkId, removed()));
    });
    return () => {
      live = false;
    };
  }, [api, walkId, words]);

  const copy = async (link: string) => {
    const copied = await settled(() => api.copy(link), false);
    setShare((s) => ({ ...s, note: copied ? words.copied : words.copyFailed }));
  };

  if (share.link === undefined) return null;
  return (
    <section className="report-share" data-part="share">
      <h2>{words.title}</h2>
      <p>{words.lead}</p>
      {share.link === null ? (
        <button type="button" className="button" data-part="make-share" disabled={share.busy === "make"} onClick={() => void run("make", () => api.makeShare(walkId, removed()))}>
          {words.make}
        </button>
      ) : (
        <>
          <p className="share-link" data-part="share-link">
            <a href={share.link} rel="noreferrer" target="_blank">
              {share.link}
            </a>
          </p>
          <button type="button" className="button" data-part="copy-share" onClick={() => void copy(share.link!)}>
            {words.copy}
          </button>
          <button type="button" className="button" data-part="stop-share" disabled={share.busy !== null} onClick={() => void run("stop", () => api.stopShare(walkId))}>
            {words.stop}
          </button>
        </>
      )}
      {share.busy === "make" ? <p role="status">{words.making}</p> : null}
      {share.busy === "stop" ? <p role="status">{words.stopping}</p> : null}
      {share.note !== null ? <p role="status">{share.note}</p> : null}
    </section>
  );
};

const ReportScreen = ({ api, walkId }: { api: ReportApi; walkId: string }) => {
  const { marks } = useDeps();
  const [page, setPage] = useState<Page>({ kind: "loading" });
  const [approval, setApproval] = useState<Approval>({ kind: "unknown" });
  const [pdf, setPdf] = useState<Pdf>({ kind: "idle" });
  const [round, setRound] = useState(0);
  const [again, setAgain] = useState(false);
  const [moved, setMoved] = useState(false);
  const [relink, setRelink] = useState(false);
  const removed = () => marks.removed(walkId).map((r) => r.findingId);

  useEffect(() => {
    let live = true;
    setPage({ kind: "loading" });
    void Promise.all([
      settled<ReportPage>(() => api.page(walkId, removed()), { code: "server_error" }),
      settled<ReportApproval>(() => api.approval(walkId, removed()), { code: "server_error" }),
    ]).then(([shown, approved]) => {
      if (!live) return;
      setPage(shown.html === undefined ? { kind: "failed", code: shown.code } : { kind: "ready", html: shown.html, seen: shown.seen });
      setApproval(approved.code !== undefined ? { kind: "failed", code: approved.code } : approved.approvedAt === null ? { kind: "open" } : { kind: "approved", at: approved.approvedAt });
      if (approved.code === undefined) setAgain(approved.changed);
    });
    return () => {
      live = false;
    };
  }, [api, walkId, round]);

  const changed = () => {
    setPdf({ kind: "idle" });
    setRound((n) => n + 1);
  };

  const approve = async (seen: string) => {
    setApproval({ kind: "saving" });
    const answer = await settled<ReportApproval>(() => api.approve(walkId, removed(), seen), { code: "server_error" });
    if (answer.code === "conflict") {
      setMoved(true);
      return changed();
    }
    if (answer.code !== undefined || answer.approvedAt === null) return setApproval({ kind: "failed", code: answer.code ?? "server_error" });
    setAgain(false);
    setMoved(false);
    setRelink(true);
    setApproval({ kind: "approved", at: answer.approvedAt });
    setRound((n) => n + 1);
  };

  const download = async () => {
    setPdf({ kind: "making" });
    const answer = await settled<ReportPdf>(() => api.pdf(walkId, removed()), { code: "server_error" });
    if (answer.code === "conflict") return changed();
    if (answer.pdf === undefined) return setPdf({ kind: "failed", code: answer.code });
    try {
      api.save(answer.pdf, answer.name);
    } catch {
      return setPdf({ kind: "failed", code: "server_error" });
    }
    setPdf({ kind: "idle" });
  };

  return (
    <main className="screen report" data-phase={page.kind}>
      <h1>{reportWords.title}</h1>
      <SignInAgain />
      <p className="lead">{reportWords.lead}</p>
      {page.kind === "loading" ? <p role="status">{reportWords.loading}</p> : null}
      {page.kind === "failed" ? <p role="status">{reportWords.failed[page.code]}</p> : null}
      {page.kind === "ready" ? (
        <>
          {approval.kind === "approved" ? (
            <>
              <p data-part="approved">{reportWords.approved(shortDay(localDay(Date.parse(approval.at))))}</p>
              <button type="button" className="button primary" data-part="download" disabled={pdf.kind === "making"} onClick={() => void download()}>
                {reportWords.download}
              </button>
              {pdf.kind === "making" ? <p role="status">{reportWords.making}</p> : null}
              {pdf.kind === "failed" ? <p role="status">{reportWords.pdfFailed[pdf.code]}</p> : null}
            </>
          ) : approval.kind === "unknown" ? null : (
            <>
              <p data-part="check-photos">{again || moved ? reportWords.checkAgain : reportWords.checkPhotos}</p>
              <button type="button" className="button primary" data-part="approve" disabled={approval.kind === "saving"} onClick={() => void approve(page.seen)}>
                {reportWords.approve}
              </button>
              {approval.kind === "saving" ? <p role="status">{reportWords.approving}</p> : null}
              {approval.kind === "failed" ? <p role="status">{reportWords.approveFailed[approval.code]}</p> : null}
            </>
          )}
        </>
      ) : null}
      {!JUDGE && approval.kind === "approved" && page.kind !== "failed" ? <ShareLink api={api} walkId={walkId} removed={removed} relink={relink} onChanged={changed} /> : null}
      {page.kind === "ready" ? <iframe className="report-preview" title={reportWords.preview} sandbox="" srcDoc={page.html} /> : null}
      <a className="button" data-part="back" href={resultsFor(walkId)}>
        {reportWords.back}
      </a>
    </main>
  );
};
