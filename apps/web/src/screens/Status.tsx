import { copy, draft, longDate } from "../copy.ts";
import { isRechecked } from "../finding-marks.ts";
import type { FindingStatus } from "../finding-marks.ts";

export const StatusLine = ({ status }: { status: FindingStatus }) => {
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
    <div className={`status ${status.kind}`} data-part="status" data-status={status.kind}>
      <p>{copy.status.kind[status.kind]}</p>
      {status.kind === "done" && status.doneOn !== undefined ? <p data-part="done-on">{draft.status.doneOn(status.doneOn)}</p> : null}
      {status.kind === "done" ? <p>{copy.status.notRechecked}</p> : null}
    </div>
  );
};
