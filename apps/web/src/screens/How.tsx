import { copy } from "../copy.ts";
import { useDeps } from "../deps.ts";
import { WALK_START } from "../router.ts";

export const HOW_LINES: readonly string[] = [
  copy.how.walk,
  copy.how.asks,
  copy.how.camera,
  copy.how.microphone,
  copy.how.motion,
  copy.how.location,
];

export const How = () => {
  const { prefs } = useDeps();
  const go = () => {
    prefs.markIntroSeen();
    window.location.hash = WALK_START;
  };
  return (
    <main className="screen">
      <h1>{copy.how.title}</h1>
      <ul className="lines">
        {HOW_LINES.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
      <button className="button primary" type="button" onClick={go}>
        {copy.how.continue}
      </button>
    </main>
  );
};
