import { useEffect, useState } from "react";
import type { MouseEvent } from "react";
import { copy } from "./copy.ts";
import { DepsContext } from "./deps.ts";
import type { Deps } from "./deps.ts";
import { approveIdsIn, checkoutReturnIn, findingIdsIn, fixIdIn, inspectionIdIn, invitePropertyIdIn, mapIdIn, planReturnIn, propertyIdIn, recheckIdsIn, recordPartIn, reportIdIn, resultsIdIn, ROUTES, routeFor, signInTokenIn, takeIdIn, tenantInviteCodeIn, walkIdIn } from "./router.ts";
import type { Language, WalkPart } from "@emberwalk/shared";
import { setLanguage } from "./language.ts";
import { LanguageChoice, LanguageSwitch } from "./screens/LanguageSwitch.tsx";
import type { ApproveIds, FindingIds, PlanReturn, Route } from "./router.ts";
import { JUDGE, judgeWords } from "./judge.ts";
import { Portal } from "./screens/Portal.tsx";
import { About } from "./screens/About.tsx";
import { Approve } from "./screens/Approve.tsx";
import { CrewSignup } from "./screens/CrewSignup.tsx";
import { Finding } from "./screens/Finding.tsx";
import { GetItFixed } from "./screens/GetItFixed.tsx";
import { History } from "./screens/History.tsx";
import { Inspection } from "./screens/Inspection.tsx";
import { Home } from "./screens/Home.tsx";
import { Homes } from "./screens/Homes.tsx";
import { Invite } from "./screens/Invite.tsx";
import { MapScreen } from "./screens/MapScreen.tsx";
import { Plan } from "./screens/Plan.tsx";
import { Property } from "./screens/Property.tsx";
import { Settings } from "./screens/Settings.tsx";
import { showsTabs, Tabs, Top } from "./screens/Shell.tsx";
import { SignIn } from "./screens/SignIn.tsx";
import { Walks } from "./screens/Walks.tsx";
import { TenantInvite } from "./screens/TenantInvite.tsx";
import { JudgeWalk } from "./screens/JudgeWalk.tsx";
import { How } from "./screens/How.tsx";
import { Recheck } from "./screens/Recheck.tsx";
import { Record } from "./screens/Record.tsx";
import { Report } from "./screens/Report.tsx";
import { Results } from "./screens/Results.tsx";
import { CheckingWalk, Send } from "./screens/Send.tsx";

type ScreenProps = {
  takeId: string | null;
  resultsId: string | null;
  mapId: string | null;
  findingIds: FindingIds | null;
  part: WalkPart | null;
  walkId: string | null;
  fixId: string | null;
  approveIds: ApproveIds | null;
  inspectionId: string | null;
  recheckIds: FindingIds | null;
  reportId: string | null;
  signInToken: string | null;
  propertyId: string | null;
  inviteCode: string | null;
  planReturn: PlanReturn | null;
};

const SCREENS: Record<Route, (props: ScreenProps) => React.JSX.Element | null> = {
  home: JUDGE ? Portal : Home,
  how: How,
  about: About,
  record: JUDGE ? JudgeWalk : Record,
  send: JUDGE ? Portal : Send,
  results: Results,
  map: MapScreen,
  finding: Finding,
  checking: CheckingWalk,
  fix: GetItFixed,
  approve: Approve,
  inspection: Inspection,
  history: History,
  recheck: Recheck,
  report: Report,
  crews: CrewSignup,
  signIn: SignIn,
  homes: Homes,
  property: Property,
  invite: Invite,
  tenantInvite: TenantInvite,
  plan: Plan,
  walks: Walks,
  settings: Settings,
};

const useHash = (): [string, (hash: string) => void] => {
  const [hash, setHash] = useState(() => {
    const back = checkoutReturnIn(window.location.search);
    if (back !== null && window.location.hash === "") window.history.replaceState(null, "", `${window.location.pathname}${back}`);
    return window.location.hash;
  });
  useEffect(() => {
    const update = () => setHash(window.location.hash);
    window.addEventListener("hashchange", update);
    return () => window.removeEventListener("hashchange", update);
  }, []);
  return [hash, setHash];
};

const followLink = (event: MouseEvent<HTMLElement>, go: (hash: string) => void) => {
  if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  const link = (event.target as Element).closest<HTMLAnchorElement>("a[href^='#/']");
  if (link !== null && link.target === "") go(link.getAttribute("href") ?? "");
};

const useOnline = (): boolean => {
  const [online, setOnline] = useState(() => navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);
  return online;
};

const useLanguage = (deps: Deps): [Language, (chosen: Language) => void] => {
  const [chosen, setChosen] = useState<Language>(() => {
    const kept = deps.prefs.language();
    setLanguage(kept);
    return kept;
  });
  useEffect(() => {
    document.documentElement.lang = chosen;
  }, [chosen]);
  return [
    chosen,
    (next) => {
      deps.prefs.setLanguage(next);
      setLanguage(next);
      setChosen(next);
    },
  ];
};

export const App = ({ deps }: { deps: Deps }) => {
  const [chosen, choose] = useLanguage(deps);
  const [hash, go] = useHash();
  const route = routeFor(hash);
  const online = useOnline();
  const Screen = SCREENS[route];
  useEffect(() => {
    void deps.sync.flush();
  }, [deps, hash]);
  return (
    <DepsContext.Provider value={deps}>
      <LanguageChoice.Provider value={{ chosen, choose }}>
      <div className="app" data-route={route} onClick={(event) => followLink(event, go)}>
        {online ? null : (
          <p className="banner" role="status">
            {copy.app.offline}
          </p>
        )}
        {JUDGE && route !== "home" && route !== "record" ? (
          <a className="sample-strip" href={ROUTES.home}>
            {judgeWords.label}
          </a>
        ) : null}
        {JUDGE && route === "home" ? (
          <LanguageSwitch chosen={chosen} choose={choose} />
        ) : (
          <Top>
            <LanguageSwitch chosen={chosen} choose={choose} />
          </Top>
        )}
        <Screen
          key={hash}
          takeId={takeIdIn(hash)}
          resultsId={resultsIdIn(hash)}
          mapId={mapIdIn(hash)}
          findingIds={findingIdsIn(hash)}
          part={recordPartIn(hash)}
          walkId={walkIdIn(hash)}
          fixId={fixIdIn(hash)}
          approveIds={approveIdsIn(hash)}
          inspectionId={inspectionIdIn(hash)}
          recheckIds={recheckIdsIn(hash)}
          reportId={reportIdIn(hash)}
          signInToken={signInTokenIn(hash)}
          propertyId={propertyIdIn(hash) ?? invitePropertyIdIn(hash)}
          inviteCode={tenantInviteCodeIn(hash)}
          planReturn={planReturnIn(hash)}
        />
        {!JUDGE && showsTabs(route) ? <Tabs route={route} /> : null}
      </div>
      </LanguageChoice.Provider>
    </DepsContext.Provider>
  );
};
