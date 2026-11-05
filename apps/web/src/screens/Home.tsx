import { useEffect, useState } from "react";
import heroFront from "../../../../fixtures/synthetic/hero-look/synthetic-hero-front.jpg";
import { boughtHere } from "../billing-api.ts";
import { conceptLabel, copy, shortDay, walkDate } from "../copy.ts";
import { homeViewOf, newestWalkId } from "../dashboard.ts";
import type { HomeView } from "../dashboard.ts";
import { useDeps } from "../deps.ts";
import { dashboardWords as d, deleteEverythingWords, portfolioOpen, portfolioWords, signInWords, welcomeWords as w } from "../draft-words.ts";
import { installHint, listenForInstall, markInstallSeen, promptInstall, thisPhone } from "../install.ts";
import type { InstallHint } from "../install.ts";
import { JUDGE } from "../judge.ts";
import { checkingFor, fixFor, resultsFor, ROUTES, sendFor, WALK_START } from "../router.ts";
import { isSample, SAMPLES } from "../samples.ts";
import type { SentWalk } from "../sent-walks.ts";
import type { Take } from "../take-store.ts";
import { clearClaim } from "../walk-claim.ts";
import { BrandMark } from "./BrandMark.tsx";
import { PlanEntry } from "./Plan.tsx";
import { SignInAgain } from "./SignInAgain.tsx";
import { useSignedIn } from "./use-signed-in.ts";

const YourWalks = ({ checking, takes }: { checking: SentWalk[]; takes: Take[] }) => (
  <section className="walks panel" aria-labelledby="your-walks">
    <h2 id="your-walks">{copy.home.walks}</h2>
    <ul>
      {checking.map((walk) => (
        <li key={walk.walkId} className="checking">
          <span id={`checking-${walk.walkId}`}>{walkDate(walk.createdAt)}</span>
          <p>{copy.send.refused.walk_not_done}</p>
          <a className="button" href={checkingFor(walk.walkId)} aria-describedby={`checking-${walk.walkId}`}>
            {copy.home.progress}
          </a>
        </li>
      ))}
      {takes.map((take) => (
        <li key={take.id}>
          <span id={`walk-${take.id}`}>{walkDate(take.createdAt)}</span>
          <a className="button" href={sendFor(take.id)} aria-describedby={`walk-${take.id}`}>
            {copy.home.send}
          </a>
        </li>
      ))}
    </ul>
  </section>
);

const Install = () => {
  const [hint, setHint] = useState<InstallHint | null>(() => installHint(thisPhone()));
  useEffect(() => listenForInstall(() => setHint(installHint(thisPhone()))), []);
  if (hint === null) return null;
  const close = () => {
    markInstallSeen();
    setHint(null);
  };
  return (
    <section className="install panel" aria-labelledby="install-title" data-install={hint}>
      <h2 id="install-title">{w.installTitle}</h2>
      {hint === "prompt" ? (
        <button type="button" className="button primary" onClick={() => void promptInstall().then(close)}>
          {w.install}
        </button>
      ) : (
        <p>{hint === "ios_safari" ? w.installIos : w.installOther}</p>
      )}
      <button type="button" className="button" onClick={close}>
        {w.gotIt}
      </button>
    </section>
  );
};

const Welcome = ({ walkHref }: { walkHref: string }) => (
  <section className="welcome" aria-labelledby="welcome-title">
    <img className="welcome-photo" src={heroFront} alt="" width={1280} height={720} />
    <BrandMark />
    <h1 id="welcome-title">{copy.home.title}</h1>
    <p className="lead">{w.lead}</p>
    <a className="button primary" href={walkHref}>
      {copy.home.walk}
    </a>
    <div className="pair">
      <a className="button" href={ROUTES.signIn}>
        {signInWords.entry}
      </a>
      {SAMPLES.map((sample) => (
        <a key={sample.id} className="button" href={resultsFor(sample.id)}>
          {copy.home.sample}
        </a>
      ))}
    </div>
  </section>
);

const useHomeView = (): HomeView | null | undefined => {
  const deps = useDeps();
  const [view, setView] = useState<HomeView | null | undefined>(undefined);
  useEffect(() => {
    let live = true;
    void deps.fixed.history().then(async (answer) => {
      const id = answer.code === undefined ? newestWalkId(answer.value.walks.filter((walk) => JUDGE || !isSample(walk.walkId))) : null;
      const results = id === null ? null : await deps.results(id);
      if (!live) return;
      setView(results === null ? null : homeViewOf(results, deps.marks.removed(results.id), (findingId) => deps.marks.statusOf(results.id, findingId)));
    });
    return () => {
      live = false;
    };
  }, [deps]);
  return view;
};

const YourHome = ({ view, walkHref }: { view: HomeView | null; walkHref: string }) => (
  <section className="your-home panel" aria-labelledby="your-home">
    <h2 id="your-home">{d.yourHome}</h2>
    {view === null ? (
      <>
        <p>{d.noWalk}</p>
        <a className="button primary" href={walkHref}>
          {copy.home.walk}
        </a>
      </>
    ) : (
      <>
        <p className="when">{d.lastWalk(shortDay(view.walkedOn))}</p>
        <p className="counts">
          <span className="to-fix">{d.toFix(view.toFix)}</span>
          <span className="done">{d.done(view.done)}</span>
        </p>
        {view.first.length === 0 ? null : (
          <ol className="first-three">
            {view.first.map((finding) => (
              <li key={finding.id}>{conceptLabel(finding.concept)}</li>
            ))}
          </ol>
        )}
        <a className="button primary" href={resultsFor(view.resultsId)}>
          {d.results}
        </a>
        <a className="button" href={fixFor(view.resultsId)}>
          {d.fix}
        </a>
        <div className="next">
          <h3>{d.nextTitle}</h3>
          {view.next.kind === "after_fixes" && <p>{d.nextAfterFixes}</p>}
          {view.next.kind === "after_walk" && <p>{d.nextAfterWalk}</p>}
          <p>
            {d.nextYearly(shortDay(view.next.day.toISOString().slice(0, 10)))} {d.yearRound}
          </p>
          <a className="button" href={walkHref}>
            {d.walkAgain}
          </a>
        </div>
      </>
    )}
  </section>
);

export const Home = () => {
  const deps = useDeps();
  const [takes, setTakes] = useState<Take[]>([]);
  const [checking] = useState(() => deps.sentWalks.all());
  const open = JUDGE || portfolioOpen();
  const signedIn = useSignedIn(open && !JUDGE);
  const view = useHomeView();
  const bought = !open && (new URLSearchParams(window.location.search).get("checkout") === "done" || boughtHere());
  const walkHref = JUDGE || deps.prefs.introSeen() ? WALK_START : ROUTES.how;

  useEffect(clearClaim, []);

  useEffect(() => {
    let live = true;
    void deps
      .takes()
      .then((store) => store.all())
      .then((all) => {
        if (live) setTakes(all.filter((take) => take.bytes > 0 && !checking.some((walk) => walk.walkId === take.upload?.walkId)));
      });
    return () => {
      live = false;
    };
  }, [deps, checking]);

  const fresh = !open && view === null && checking.length + takes.length === 0 && !bought;

  return (
    <main className="screen home">
      {fresh ? (
        <Welcome walkHref={walkHref} />
      ) : (
        <>
          <h1>{signedIn.email === null ? copy.home.title : d.greeting(new Date().getHours())}</h1>
          {signedIn.email === null ? null : <p className="status-line signed-in">{signInWords.signedInAs(signedIn.email)}</p>}
        </>
      )}
      {signedIn.phoneLine === null ? null : <p role="status">{signedIn.phoneLine}</p>}
      {bought ? <p role="status">{signInWords.afterPurchase}</p> : null}
      {signedIn.email === null ? <SignInAgain /> : null}
      {JUDGE ? null : <Install />}
      {checking.length + takes.length > 0 ? <YourWalks checking={checking} takes={takes} /> : null}
      {fresh || view === undefined || (view === null && checking.length + takes.length > 0) ? null : <YourHome view={view} walkHref={walkHref} />}
      {!fresh && view === null && checking.length + takes.length > 0 ? (
        <a className="button primary" href={walkHref}>
          {copy.home.walk}
        </a>
      ) : null}
      {signedIn.line === null ? null : <p role="alert">{signedIn.line}</p>}
      <nav className="more" aria-label={copy.home.title}>
        {fresh
          ? null
          : SAMPLES.map((sample) => (
              <a key={sample.id} className="button" href={resultsFor(sample.id)}>
                {copy.home.sample}
              </a>
            ))}
        {fresh ? null : (
          <a className="button" href={ROUTES.history}>
            {copy.history.title}
          </a>
        )}
        <PlanEntry />
        {fresh ? null : (
          <a className="button" href={ROUTES.about}>
            {deleteEverythingWords.entry}
          </a>
        )}
        {open ? (
          <a className="button" href={ROUTES.homes}>
            {portfolioWords.entry}
          </a>
        ) : fresh ? null : (
          <a className="button" href={ROUTES.signIn}>
            {signInWords.entry}
          </a>
        )}
      </nav>
    </main>
  );
};
