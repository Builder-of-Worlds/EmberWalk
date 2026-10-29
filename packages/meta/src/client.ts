import { CostRecord, DEFAULT_LIMITS, type Limits } from "@emberwalk/shared";
import { MetaRefused } from "./errors.ts";
import { fingerprint, type Json } from "./fingerprint.ts";
import { isStandardModel, toNano, toUsd } from "./prices.ts";
import { type AnswerCache, type SpendLedger, utcDay } from "./stores.ts";
import { type HttpRequest, okJson, type Transport } from "./transport.ts";

export type ContentKind = "synthetic" | "real";
export type Billing = "free_credits" | "paid";
export type Step = CostRecord["step"];

export type CostLine = { kind: CostRecord["units"]["kind"]; count: number; unitPriceNano: number };

export type JsonRequest = { method: "POST"; path: string; json: Json };
export type FormRequest = { method: "POST"; path: string; form: FormData };
export type CallRequest = JsonRequest | FormRequest;

export type Call<T, R extends CallRequest = JsonRequest> = {
  model: string;
  content: ContentKind;
  step: Step;
  walkId: string | null;
  request: R;
  estimateNano: number;
  cost: (raw: unknown) => CostLine[];
  read: (raw: unknown) => T;
};

export type Answer<T> = { value: T; cached: boolean; costUsd: number; fingerprint: string };

export type ClientOptions = {
  transport: Transport;
  cache: AnswerCache;
  ledger: SpendLedger;
  billing: Billing;
  limits?: Limits;
  now?: () => Date;
  newId?: () => string;
};

const lineNano = (l: CostLine): number => l.count * l.unitPriceNano;

const sha256 = async (bytes: ArrayBuffer): Promise<string> =>
  [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map((b) => b.toString(16).padStart(2, "0")).join("");

async function formParts(form: FormData): Promise<Json> {
  const parts: Json[] = [];
  for (const [name, value] of form.entries()) {
    parts.push(typeof value === "string" ? [name, value] : [name, { type: value.type, sha256: await sha256(await value.arrayBuffer()) }]);
  }
  return parts;
}

const requestFingerprint = async (r: CallRequest): Promise<string> =>
  "json" in r ? fingerprint({ path: r.path, body: r.json }) : fingerprint({ path: r.path, form: await formParts(r.form) });

export class MetaClient {
  readonly billing: Billing;
  private readonly transport: Transport;
  private readonly cache: AnswerCache;
  private readonly ledger: SpendLedger;
  private readonly capNano: number;
  private readonly now: () => Date;
  private readonly newId: () => string;
  private reservedNano = 0;

  constructor(o: ClientOptions) {
    this.transport = o.transport;
    this.cache = o.cache;
    this.ledger = o.ledger;
    this.billing = o.billing;
    this.capNano = toNano((o.limits ?? DEFAULT_LIMITS).dailySpendUsd);
    this.now = o.now ?? (() => new Date());
    this.newId = o.newId ?? (() => crypto.randomUUID());
  }

  assertMaySend(model: string, content: ContentKind): void {
    if (!isStandardModel(model)) throw new MetaRefused("non_standard_model", `${model} is not a Standard mode model`);
    if (content === "real" && this.billing !== "paid") {
      throw new MetaRefused("real_content_on_free_credits", "real content is sent only on a paid run");
    }
  }

  async reserve(estimateNano: number): Promise<() => void> {
    const spent = toNano(await this.ledger.spentUsd(utcDay(this.now().toISOString())));
    if (spent + this.reservedNano + estimateNano > this.capNano) {
      throw new MetaRefused("daily_cap_reached", `spent ${toUsd(spent)} USD today; this call could cost ${toUsd(estimateNano)} USD`);
    }
    this.reservedNano += estimateNano;
    let held = true;
    return () => {
      if (held) this.reservedNano -= estimateNano;
      held = false;
    };
  }

  async call<T>(c: Call<T, CallRequest>): Promise<Answer<T>> {
    this.assertMaySend(c.model, c.content);
    const fp = await requestFingerprint(c.request);
    const hit = await this.cache.get(fp);
    if (hit !== null) {
      const value = c.read(hit);
      await this.writeCost(c, this.safeCost(c, hit), true);
      return { value, cached: true, costUsd: 0, fingerprint: fp };
    }
    const release = await this.reserve(c.estimateNano);
    let raw: unknown;
    try {
      raw = await this.send(c.request);
    } catch (err) {
      release();
      throw err;
    }
    const lines = this.safeCost(c, raw);
    const costUsd = await this.writeCost(c, lines, false).finally(release);
    const value = c.read(raw);
    await this.cache.put(fp, c.model, raw as Json);
    return { value, cached: false, costUsd, fingerprint: fp };
  }

  async send(request: HttpRequest): Promise<unknown> {
    const res = await this.transport(request);
    try {
      return okJson(res);
    } catch (err) {
      if (err instanceof SyntaxError) throw new MetaRefused("invalid_answer", "the answer is not JSON");
      throw err;
    }
  }

  private safeCost(c: Call<unknown, CallRequest>, raw: unknown): CostLine[] {
    try {
      return c.cost(raw);
    } catch {
      return [{ kind: "frames", count: 1, unitPriceNano: c.estimateNano }];
    }
  }

  private async writeCost(c: Call<unknown, CallRequest>, lines: CostLine[], cached: boolean): Promise<number> {
    const at = this.now().toISOString();
    let nano = 0;
    for (const line of lines) {
      const total = cached ? 0 : lineNano(line);
      nano += total;
      await this.ledger.record(
        CostRecord.parse({
          id: this.newId(),
          at,
          model: c.model,
          step: c.step,
          walkId: c.walkId,
          units: { kind: line.kind, count: line.count },
          unitPriceUsd: toUsd(line.unitPriceNano),
          totalUsd: toUsd(total),
          cached,
        }),
      );
    }
    return toUsd(nano);
  }
}
