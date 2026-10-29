import { copy } from "../copy.ts";
import { STAGES } from "../progress.ts";
import type { Shown } from "../progress.ts";

type TrailProps = { shown: Shown; still: boolean };

export const Trail = ({ shown, still }: TrailProps) => {
  const line = shown.current === null ? copy.send.checked : copy.send.step(shown.from);
  const said = shown.current === null ? "done" : shown.current;
  return (
    <ol className="trail" aria-live={still ? undefined : "polite"} data-current={shown.current ?? "none"}>
      {STAGES.map((stage) => {
        const now = stage === said;
        const behind = shown.behind.includes(stage);
        return (
          <li key={stage} data-stage={stage} className={behind ? "behind" : now ? "current" : undefined} aria-hidden={now ? undefined : true}>
            <span className="mark" aria-hidden="true" />
            <span className="label">{copy.send.stages[stage]}</span>
            {now ? <p>{line}</p> : null}
            {now && shown.count !== null ? (
              <>
                <div className="bar" role="progressbar" aria-label={line} aria-valuemin={0} aria-valuemax={shown.count.total} aria-valuenow={shown.count.done}>
                  <span style={{ width: `${(100 * shown.count.done) / shown.count.total}%` }} />
                </div>
                <span className="count">{copy.send.counted(shown.count.done, shown.count.total)}</span>
              </>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
};
