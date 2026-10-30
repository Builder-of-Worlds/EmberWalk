import { draft } from "../copy.ts";
import type { FixedFailure } from "../fixed-api.ts";

export const Problem = ({ code }: { code: FixedFailure }) => (
  <p className="problem" role="status">
    {draft.fixed.problem(code)}
  </p>
);

export const Loading = () => <p role="status">{draft.fixed.loading}</p>;

export const Failed = ({ code, retry }: { code: FixedFailure; retry: () => void }) => (
  <>
    <Problem code={code} />
    <button className="button" type="button" onClick={retry}>
      {draft.fixed.tryAgain}
    </button>
  </>
);
