import { isCorner, WalkPart } from "@emberwalk/shared";
import type { Part } from "@emberwalk/shared";

export const ROUTES = {
  home: "#/",
  how: "#/how",
  record: "#/record",
  send: "#/send",
  results: "#/results",
  finding: "#/finding",
  checking: "#/checking",
  fix: "#/fix",
  approve: "#/approve",
  inspection: "#/inspection",
  history: "#/history",
} as const;

export type Route = keyof typeof ROUTES;

export const WALK_START = ROUTES.record;

const BY_HASH = new Map<string, Route>(Object.entries(ROUTES).map(([route, hash]) => [hash, route as Route]));

const WITH_ID: Route[] = ["send", "results", "finding", "checking", "fix", "approve", "inspection"];

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

export const checkingFor = withId("checking");

export const takeIdIn = (hash: string): string | null => idAfter(`${ROUTES.send}/`, hash);

export const findingFor = (resultsId: string, findingId: string): string =>
  `${ROUTES.finding}/${encodeURIComponent(resultsId)}/${encodeURIComponent(findingId)}`;

export type FindingIds = { resultsId: string; findingId: string };

const pairAfter = (prefix: string, hash: string): [string, string] | null => {
  if (!hash.startsWith(prefix)) return null;
  const parts = hash.slice(prefix.length).split("/");
  if (parts.length !== 2 || parts.some((part) => part === "")) return null;
  try {
    const [first, second] = parts.map((part) => decodeURIComponent(part));
    return [first!, second!];
  } catch {
    return null;
  }
};

export const findingIdsIn = (hash: string): FindingIds | null => {
  const pair = pairAfter(`${ROUTES.finding}/`, hash);
  return pair === null ? null : { resultsId: pair[0], findingId: pair[1] };
};

export const fixFor = withId("fix");

export const inspectionFor = withId("inspection");

export const fixIdIn = (hash: string): string | null => idAfter(`${ROUTES.fix}/`, hash);

export const inspectionIdIn = (hash: string): string | null => idAfter(`${ROUTES.inspection}/`, hash);

export type ApproveIds = { walkId: string; messageId: string };

export const approveFor = (walkId: string, messageId: string): string =>
  `${ROUTES.approve}/${encodeURIComponent(walkId)}/${encodeURIComponent(messageId)}`;

export const approveIdsIn = (hash: string): ApproveIds | null => {
  const pair = pairAfter(`${ROUTES.approve}/`, hash);
  return pair === null ? null : { walkId: pair[0], messageId: pair[1] };
};

export const resultsIdIn = (hash: string): string | null => idAfter(`${ROUTES.results}/`, hash);

export const walkIdIn = (hash: string): string | null => idAfter(`${ROUTES.checking}/`, hash);

export const recordPartFor = (walkId: string, side: Part): string => `${ROUTES.record}/${encodeURIComponent(walkId)}/${side}`;

export const recordPartIn = (hash: string, corners = false): WalkPart | null => {
  const [walkId, side, ...rest] = (idAfter(`${ROUTES.record}/`, hash) ?? "").split("/");
  const part = WalkPart.safeParse({ walkId, side });
  return rest.length === 0 && part.success && (corners || !isCorner(part.data.side)) ? { walkId: part.data.walkId, side: part.data.side } : null;
};

const hasIds = (route: Route, hash: string): boolean => {
  if (route === "finding") return findingIdsIn(hash) !== null;
  if (route === "approve") return approveIdsIn(hash) !== null;
  return idAfter(`${ROUTES[route]}/`, hash) !== null;
};

export const routeFor = (hash: string): Route => {
  const routed = WITH_ID.find((route) => hasIds(route, hash));
  if (routed !== undefined) return routed;
  if (hash.startsWith(`${ROUTES.record}/`)) return "record";
  return BY_HASH.get(hash === "" || hash === "#" ? ROUTES.home : hash) ?? "home";
};
