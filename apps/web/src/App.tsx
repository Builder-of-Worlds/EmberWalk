import { useEffect, useState } from "react";
import { copy } from "./copy.ts";
import { DepsContext } from "./deps.ts";
import type { Deps } from "./deps.ts";
import { findingIdsIn, resultsIdIn, routeFor, takeIdIn } from "./router.ts";
import type { FindingIds, Route } from "./router.ts";
import { Finding } from "./screens/Finding.tsx";
import { Home } from "./screens/Home.tsx";
import { How } from "./screens/How.tsx";
import { Record } from "./screens/Record.tsx";
import { Results } from "./screens/Results.tsx";
import { Rules } from "./screens/Rules.tsx";
import { Send } from "./screens/Send.tsx";

type ScreenProps = { takeId: string | null; resultsId: string | null; findingIds: FindingIds | null };

const SCREENS: Record<Route, (props: ScreenProps) => React.JSX.Element | null> = {
  home: Home,
  how: How,
  rules: Rules,
  record: Record,
  send: Send,
  results: Results,
  finding: Finding,
};

const useHash = (): string => {
  const [hash, setHash] = useState(() => window.location.hash);
  useEffect(() => {
    const update = () => setHash(window.location.hash);
    window.addEventListener("hashchange", update);
    return () => window.removeEventListener("hashchange", update);
  }, []);
  return hash;
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
  const hash = useHash();
  const route = routeFor(hash);
  const online = useOnline();
  const Screen = SCREENS[route];
  return (
    <DepsContext.Provider value={deps}>
      <div className="app" data-route={route}>
        {online ? null : (
          <p className="banner" role="status">
            {copy.app.offline}
          </p>
        )}
        <Screen key={hash} takeId={takeIdIn(hash)} resultsId={resultsIdIn(hash)} findingIds={findingIdsIn(hash)} />
      </div>
    </DepsContext.Provider>
  );
};
