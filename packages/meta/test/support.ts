import { limitsWith } from "@emberwalk/shared";
import { type Billing, MetaClient } from "../src/client.ts";
import { MemoryCache, MemoryLedger } from "../src/stores.ts";
import type { HttpRequest, HttpResponse, Transport } from "../src/transport.ts";

export type FakeTransport = Transport & { requests: HttpRequest[] };

export function fakeTransport(answer: (req: HttpRequest) => HttpResponse | Promise<HttpResponse>): FakeTransport {
  const requests: HttpRequest[] = [];
  const t = (async (req: HttpRequest) => {
    requests.push(req);
    return answer(req);
  }) as FakeTransport;
  t.requests = requests;
  return t;
}

export const ok = (body: unknown): HttpResponse => ({ status: 200, retryAfter: null, text: JSON.stringify(body) });

export const NOW = new Date("2026-10-26T18:00:00.000Z");

export function setup(o: { answer: (req: HttpRequest) => HttpResponse | Promise<HttpResponse>; billing?: Billing; capUsd?: number }) {
  const transport = fakeTransport(o.answer);
  const cache = new MemoryCache();
  const ledger = new MemoryLedger();
  let n = 0;
  const client = new MetaClient({
    transport,
    cache,
    ledger,
    billing: o.billing ?? "free_credits",
    limits: limitsWith({ dailySpendUsd: o.capUsd ?? 20 }),
    now: () => NOW,
    newId: () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`,
  });
  return { client, transport, cache, ledger };
}
