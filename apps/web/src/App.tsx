import { useEffect, useState } from "react";
import type { MouseEvent } from "react";
import { copy } from "./copy.ts";
import { DepsContext } from "./deps.ts";
import type { Deps } from "./deps.ts";
import { approveIdsIn, findingIdsIn, fixIdIn, inspectionIdIn, recordPartIn, resultsIdIn, routeFor, takeIdIn, walkIdIn } from "./router.ts";
import type { WalkPart } from "@emberwalk/shared";
import { draftWordsShown } from "./draft-words.ts";
import type { ApproveIds, FindingIds, Route } from "./router.ts";
import { JUDGE } from "./judge.ts";
import { Approve } from "./screens/Approve.tsx";
import { Finding } from "./screens/Finding.tsx";
import { GetItFixed } from "./screens/GetItFixed.tsx";
import { History } from "./screens/History.tsx";
import { Inspection } from "./screens/Inspection.tsx";
import { Home } from "./screens/Home.tsx";
import { JudgeWalk } from "./screens/JudgeWalk.tsx";
import { How } from "./screens/How.tsx";
import { Record } from "./screens/Record.tsx";
import { Results } from "./screens/Results.tsx";
import { CheckingWalk, Send } from "./screens/Send.tsx";

type ScreenProps = {
  takeId: string | null;
  resultsId: string | null;
  findingIds: FindingIds | null;
  part: WalkPart | null;
  walkId: string | null;
  fixId: string | null;
  approveIds: ApproveIds | null;
  inspectionId: string | null;
};

const SCREENS: Record<Route, (props: ScreenProps) => React.JSX.Element | null> = {
  home: Home,
  how: How,
  record: JUDGE ? JudgeWalk : Record,
  send: Send,
  results: Results,
  finding: Finding,
  checking: CheckingWalk,
  fix: GetItFixed,
  approve: Approve,
  inspection: Inspection,
  history: History,
};

const useHash = (): [string, (hash: string) => void] => {
  const [hash, setHash] = useState(() => window.location.hash);
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

export const App = ({ deps }: { deps: Deps }) => {
  const [hash, go] = useHash();
  const route = routeFor(hash);
  const online = useOnline();
  const Screen = SCREENS[route];
  useEffect(() => {
    void deps.sync.flush();
  }, [deps, hash]);
  return (
    <DepsContext.Provider value={deps}>
      <div className="app" data-route={route} onClick={(event) => followLink(event, go)}>
        {online ? null : (
          <p className="banner" role="status">
            {copy.app.offline}
          </p>
        )}
        <Screen
          key={hash}
          takeId={takeIdIn(hash)}
          resultsId={resultsIdIn(hash)}
          findingIds={findingIdsIn(hash)}
          part={recordPartIn(hash, draftWordsShown())}
          walkId={walkIdIn(hash)}
          fixId={fixIdIn(hash)}
          approveIds={approveIdsIn(hash)}
          inspectionId={inspectionIdIn(hash)}
        />
      </div>
    </DepsContext.Provider>
  );
};
