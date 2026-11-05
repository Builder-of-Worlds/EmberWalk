import { copy, draft, longDate } from "../copy.ts";
import { recheckWords } from "../draft-words.ts";
import { isRechecked } from "../finding-marks.ts";
import type { FindingStatus } from "../finding-marks.ts";

export const StatusLine = ({ status, recheck }: { status: FindingStatus; recheck?: string | undefined }) => {
  if (isRechecked(status)) {
    const day = new Date(status.recheck.atMs);
    return (
      <div className="status rechecked" data-part="status" data-status="rechecked">
        <p>{copy.status.rechecked}</p>
        <p>
          <time dateTime={day.toISOString()}>{longDate(day)}</time>
        </p>
      </div>
    );
  }
  return (
    <>
      <div className={`status ${status.kind}`} data-part="status" data-status={status.kind}>
        {status.kind === "done" && status.doneOn !== undefined ? <p data-part="done-on">{draft.status.doneOn(status.doneOn)}</p> : <p>{copy.status.kind[status.kind]}</p>}
        {status.kind === "done" ? <p>{copy.status.notRechecked}</p> : null}
      </div>
      {status.kind === "done" && recheck !== undefined ? (
        <a className="button" data-part="recheck" href={recheck}>
          {recheckWords.entry}
        </a>
      ) : null}
    </>
  );
};
