import { useEffect, useState } from "react";
import { copy, draft } from "../copy.ts";
import { useDeps } from "../deps.ts";
import { STATUSES } from "../finding-marks.ts";
import type { StatusKind } from "../finding-marks.ts";
import type { MarkRequest } from "../fixed-api.ts";
import { localDay } from "../mark-sync.ts";
import type { ResultFinding, WalkResults } from "../results.ts";
import { resultsFor, ROUTES } from "../router.ts";
import { isSample } from "../samples.ts";
import type { FindingIds } from "../router.ts";
import { DetailLines, useView, ViewSwitch } from "./Detail.tsx";
import { FixPreview, SecondCheckNote } from "./FixPreview.tsx";
import { Photo } from "./Photo.tsx";
import { StatusLine } from "./Status.tsx";

type Found = { results: WalkResults; finding: ResultFinding };

export const Finding = ({ findingIds }: { findingIds: FindingIds | null }) => {
  const deps = useDeps();
  const [found, setFound] = useState<Found | null>(null);

  useEffect(() => {
    let live = true;
    void (findingIds === null ? Promise.resolve(null) : deps.results(findingIds.resultsId)).then((results) => {
      if (!live) return;
      const finding = results?.findings.find((f) => f.id === findingIds?.findingId);
      if (results && finding) setFound({ results, finding });
      else window.location.replace(results ? resultsFor(results.id) : ROUTES.home);
    });
    return () => {
      live = false;
    };
  }, [deps, findingIds]);

  return found === null ? null : <OneFinding results={found.results} finding={found.finding} />;
};

const markRequest = (kind: StatusKind, note: string, doneOn: string | undefined): MarkRequest => ({
  status: kind,
  ...(kind === "fix_planned" && note !== "" ? { note: note.slice(0, 200) } : {}),
  ...(kind === "done" && doneOn !== undefined ? { doneOn } : {}),
});

const StatusPicker = ({ results, finding }: Found) => {
  const deps = useDeps();
  const live = !isSample(results.id);
  const today = localDay(deps.clock.now());
  const [status, setStatus] = useState(() => deps.marks.statusOf(results.id, finding.id));
  const [note, setNote] = useState(status.note);
  const [askDay, setAskDay] = useState(false);
  const [day, setDay] = useState(status.doneOn ?? today);
  const [dayRefused, setDayRefused] = useState(false);
  const [saving, setSaving] = useState<"saved" | "waiting" | "refused">("saved");

  useEffect(() => {
    if (!live) return;
    let on = true;
    void deps.sync.flush().then(() => on && setSaving(deps.sync.refused(finding.id) ? "refused" : deps.sync.waiting() > 0 ? "waiting" : "saved"));
    return () => {
      on = false;
    };
  }, [deps, live, finding.id]);

  const choose = (kind: StatusKind, text = "", doneOn?: string) => {
    const before = deps.marks.statusOf(results.id, finding.id);
    deps.marks.setStatus(results.id, finding.id, kind, text, doneOn);
    const kept = deps.marks.statusOf(results.id, finding.id);
    setStatus(kept);
    const changed = kept.kind !== before.kind || kept.note !== before.note || kept.doneOn !== before.doneOn;
    if (live && changed) void deps.sync.mark(finding.id, markRequest(kind, kept.note, doneOn)).then(setSaving);
  };
  const pick = (kind: StatusKind) => {
    setAskDay(kind === "done");
    setDayRefused(false);
    if (kind !== "done") choose(kind, kind === "fix_planned" ? note : "");
  };
  return (
    <section className="status-picker">
      <StatusLine status={status} />
      <div className="statuses">
        {STATUSES.map((kind) => (
          <button
            key={kind}
            className="button toggle"
            type="button"
            aria-pressed={status.kind === kind}
            onClick={() => pick(kind)}
          >
            {copy.status.kind[kind]}
          </button>
        ))}
      </div>
      {askDay ? (
        <form
          className="note"
          onSubmit={(event) => {
            event.preventDefault();
            if (day === "") return;
            if (day > today) return setDayRefused(true);
            setDayRefused(false);
            setAskDay(false);
            choose("done", "", day);
          }}
        >
          <label htmlFor="done-day">{draft.status.doneDay}</label>
          <input id="done-day" type="date" required max={today} value={day} onChange={(e) => setDay(e.target.value)} />
          <button className="button" type="submit">
            {copy.status.save}
          </button>
        </form>
      ) : null}
      {dayRefused ? <p role="status">{draft.status.futureDay}</p> : null}
      {saving === "waiting" ? <p role="status">{draft.status.willSave}</p> : null}
      {saving === "refused" ? <p role="status">{draft.status.refused}</p> : null}
      {status.kind === "fix_planned" ? (
        <form
          className="note"
          onSubmit={(event) => {
            event.preventDefault();
            choose("fix_planned", note);
          }}
        >
          <label htmlFor="note">{copy.status.note}</label>
          <input id="note" type="text" maxLength={200} value={note} placeholder={copy.status.example} onChange={(e) => setNote(e.target.value)} />
          <button className="button" type="submit">
            {copy.status.save}
          </button>
          {status.note === "" ? null : <q>{status.note}</q>}
        </form>
      ) : null}
    </section>
  );
};

const OneFinding = ({ results, finding }: Found) => {
  const deps = useDeps();
  const [more, setMore] = useState(false);
  const [removed, setRemoved] = useState(() => deps.marks.removed(results.id).some((r) => r.findingId === finding.id));
  const remove = () => {
    deps.marks.remove(results.id, finding.id, deps.clock.now());
    setRemoved(true);
  };
  const undo = () => {
    deps.marks.restore(results.id, finding.id);
    setRemoved(false);
  };

  const [view, choose] = useView();

  return (
    <main className="screen one-finding" data-finding={finding.id} data-removed={removed} data-view={view}>
      <ViewSwitch view={view} choose={choose} />
      <Photo proof={finding.proof} />
      <p className={`label ${finding.label}`}>{copy.results.label[finding.label]}</p>
      <p className="sentence">{finding.instruction}</p>
      {view === "detailed" ? <DetailLines finding={finding} /> : null}
      <SecondCheckNote check={finding.secondCheck} />
      {removed ? null : <StatusPicker results={results} finding={finding} />}
      {removed ? (
        <div className="removed">
          <p role="status">{copy.finding.removed}</p>
          <button className="button primary" type="button" onClick={undo}>
            {copy.finding.undo}
          </button>
        </div>
      ) : null}
      <button className="button" type="button" aria-expanded={more} aria-controls="more" onClick={() => setMore(!more)}>
        {copy.finding.more}
      </button>
      {more ? (
        <section id="more" className="more">
          <h2>{copy.finding.source}</h2>
          <ul className="sources">
            {finding.sources.map((s) => (
              <li key={s.citation}>
                <a href={s.url} target="_blank" rel="noreferrer">
                  {s.citation}
                </a>
                <q>{s.words}</q>
              </li>
            ))}
          </ul>
          {finding.preview ? <FixPreview preview={finding.preview} /> : null}
          {finding.voiceNote?.trim() ? (
            <>
              <h2>{copy.finding.said}</h2>
              <p className="said">{finding.voiceNote}</p>
            </>
          ) : null}
          {removed ? null : (
            <button className="button" type="button" onClick={remove}>
              {copy.finding.notRight}
            </button>
          )}
        </section>
      ) : null}
    </main>
  );
};
