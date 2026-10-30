import { Property, VISITOR_HEADER } from "@emberwalk/shared";
import { ask } from "./api.ts";
import type { Answer, Fetch } from "./api.ts";

export type Home = Property & { walk: { id: string; ready: boolean } | null };

export type PortfolioApi = { homes(): Promise<Answer<Home[]>> };

const readWalk = (walk: unknown): Home["walk"] | undefined => {
  if (walk === undefined || walk === null) return null;
  const { id, ready } = walk as { id?: unknown; ready?: unknown };
  return typeof id === "string" && id !== "" && typeof ready === "boolean" ? { id, ready } : undefined;
};

const readHome = (item: unknown): Home | null => {
  if (typeof item !== "object" || item === null) return null;
  const { walk, ...rest } = item as Record<string, unknown>;
  const property = Property.safeParse(rest);
  const kept = readWalk(walk);
  return property.success && kept !== undefined ? { ...property.data, walk: kept } : null;
};

const readHomes = (body: unknown): Home[] | null => {
  const properties = typeof body === "object" && body !== null ? (body as { properties?: unknown }).properties : undefined;
  if (!Array.isArray(properties)) return null;
  const homes = properties.map(readHome);
  return homes.every((home): home is Home => home !== null) ? homes : null;
};

export const noPortfolio: PortfolioApi = { homes: async () => ({ code: "offline" }) };

export const portfolioApi = (base: string, send: Fetch, visitorId: () => string): PortfolioApi => ({
  homes: () => ask(send, new Request(new URL("/api/properties", base), { headers: { [VISITOR_HEADER]: visitorId() } }), readHomes),
});
