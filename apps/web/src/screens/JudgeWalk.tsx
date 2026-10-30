import { copy } from "../copy.ts";
import { JUDGE_WALK_FILE } from "../judge.ts";
import { resultsFor } from "../router.ts";
import { SAMPLES } from "../samples.ts";

const toResults = () => {
  window.location.hash = resultsFor(SAMPLES[0]!.id);
};

export const JudgeWalk = () => (
  <main className="screen judge-walk">
    <video className="preview" src={new URL(JUDGE_WALK_FILE, document.baseURI).href} autoPlay muted playsInline onEnded={toResults} onError={toResults} />
    <a className="button" href={resultsFor(SAMPLES[0]!.id)}>
      {copy.home.sample}
    </a>
  </main>
);
