export const ROUTES = {
  home: "#/",
  how: "#/how",
  rules: "#/rules",
  record: "#/record",
  send: "#/send",
  results: "#/results",
  finding: "#/finding",
} as const;

export type Route = keyof typeof ROUTES;

export const WALK_START = ROUTES.record;

const BY_HASH = new Map<string, Route>(Object.entries(ROUTES).map(([route, hash]) => [hash, route as Route]));

const WITH_ID: Route[] = ["send", "results", "finding"];

const idAfter = (prefix: string, hash: string): string | null => {
  if (!hash.startsWith(prefix) || hash.length === prefix.length) return null;
  try {
    return decodeURIComponent(hash.slice(prefix.length));
  } catch {
    return null;
  }
};

const withId = (route: Route) => (id: string): string => `${ROUTES[route]}/${encodeURIComponent(id)}`;

export const sendFor = withId("send");

export const resultsFor = withId("results");

export const takeIdIn = (hash: string): string | null => idAfter(`${ROUTES.send}/`, hash);

export const findingFor = (resultsId: string, findingId: string): string =>
  `${ROUTES.finding}/${encodeURIComponent(resultsId)}/${encodeURIComponent(findingId)}`;

export type FindingIds = { resultsId: string; findingId: string };

export const findingIdsIn = (hash: string): FindingIds | null => {
  const prefix = `${ROUTES.finding}/`;
  if (!hash.startsWith(prefix)) return null;
  const parts = hash.slice(prefix.length).split("/");
  if (parts.length !== 2 || parts.some((part) => part === "")) return null;
  try {
    const [resultsId, findingId] = parts.map((part) => decodeURIComponent(part));
    return { resultsId: resultsId!, findingId: findingId! };
  } catch {
    return null;
  }
};

export const resultsIdIn = (hash: string): string | null => idAfter(`${ROUTES.results}/`, hash);

const hasIds = (route: Route, hash: string): boolean =>
  route === "finding" ? findingIdsIn(hash) !== null : idAfter(`${ROUTES[route]}/`, hash) !== null;

export const routeFor = (hash: string): Route => {
  const routed = WITH_ID.find((route) => hasIds(route, hash));
  if (routed !== undefined) return routed;
  return BY_HASH.get(hash === "" || hash === "#" ? ROUTES.home : hash) ?? "home";
};
