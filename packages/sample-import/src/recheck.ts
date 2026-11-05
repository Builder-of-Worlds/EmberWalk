import { RecheckLinkResponse, RecheckResponse, VISITOR_HEADER } from "@emberwalk/shared";
import type { Fetch } from "./api.ts";
import { ImportError } from "./errors.ts";

export type ImportRecheckOptions = { origin: string; fetch: Fetch; visitorId: string; findingId: string; photo: Uint8Array; day: string };

export type ImportedRecheck = { findingId: string; result: "cleared" | "still_there" | "unsure"; checkedOn: string };

export const importRecheck = async (o: ImportRecheckOptions): Promise<ImportedRecheck> => {
  const call = (method: string, path: string, body: unknown): Promise<Response> =>
    o.fetch(new Request(new URL(path, o.origin), { method, headers: { "content-type": "application/json", [VISITOR_HEADER]: o.visitorId }, body: JSON.stringify(body) }));
  const marked = await call("POST", `/api/findings/${o.findingId}/status`, { status: "done", doneOn: o.day });
  if (!marked.ok) throw new ImportError("conflict", `Finding ${o.findingId} could not be marked done: ${marked.status}.`);
  const linked = await call("POST", "/api/rechecks", { findingId: o.findingId, bytes: o.photo.length, contentType: "image/jpeg" });
  const link = RecheckLinkResponse.safeParse(await linked.json().catch(() => null));
  if (!linked.ok || !link.success) throw new ImportError("server_error", `The recheck link was refused: ${linked.status}.`);
  const put = await o.fetch(new Request(link.data.url, { method: link.data.method, headers: link.data.headers, body: o.photo }));
  if (!put.ok) throw new ImportError("part_failed", `The after photo was refused: ${put.status}.`);
  const judged = await call("POST", `/api/rechecks/${link.data.recheckId}`, { findingId: o.findingId });
  const answer = RecheckResponse.safeParse(await judged.json().catch(() => null));
  if (!judged.ok || !answer.success) throw new ImportError("server_error", `The recheck was not answered: ${judged.status}.`);
  return { findingId: o.findingId, result: answer.data.recheck.result, checkedOn: o.day };
};
