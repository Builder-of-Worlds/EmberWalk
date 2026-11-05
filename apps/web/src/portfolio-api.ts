import { CreateInviteResponse, InviteLookup, PropertyEntry, PropertyList } from "@emberwalk/shared";
import type { CreateInviteResponse as MadeInvite, InviteLookup as Lookup, PropertyEntry as Entry } from "@emberwalk/shared";
import { z } from "zod";
import { type Asked, call, OFFLINE, type Parser, request } from "./account-api.ts";
import type { Fetch } from "./api.ts";

const Homes = PropertyList.transform((list) => list.properties);

const Marked = z.looseObject({});

export type PortfolioApi = {
  homes(): Promise<Asked<Entry[]>>;
  add(label: string): Promise<Asked<Entry>>;
  one(id: string): Promise<Asked<Entry>>;
  invite(id: string): Promise<Asked<MadeInvite>>;
  lookup(code: string): Promise<Asked<Lookup>>;
  markDone(findingId: string, doneOn: string): Promise<Asked<unknown>>;
};

const offline = async () => ({ code: OFFLINE });

export const noPortfolio: PortfolioApi = { homes: offline, add: offline, one: offline, invite: offline, lookup: offline, markDone: offline };

export const portfolioApi = (base: string, send: Fetch, visitorId: () => string): PortfolioApi => ({
  homes: () => call(send, request(base, visitorId, "GET", "/api/properties"), Homes as Parser<Entry[]>),
  add: (label) => call(send, request(base, visitorId, "POST", "/api/properties", { label }), PropertyEntry as Parser<Entry>),
  one: (id) => call(send, request(base, visitorId, "GET", `/api/properties/${encodeURIComponent(id)}`), PropertyEntry as Parser<Entry>),
  invite: (id) => call(send, request(base, visitorId, "POST", `/api/properties/${encodeURIComponent(id)}/invites`), CreateInviteResponse as Parser<MadeInvite>),
  lookup: (code) => call(send, request(base, visitorId, "GET", `/api/invites/${encodeURIComponent(code)}`), InviteLookup as Parser<Lookup>),
  markDone: (findingId, doneOn) => call(send, request(base, visitorId, "POST", `/api/findings/${encodeURIComponent(findingId)}/status`, { status: "done", doneOn }), Marked as Parser<unknown>),
});
