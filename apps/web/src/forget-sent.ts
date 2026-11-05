import { keepBoughtHere, keepPending } from "./billing-api.ts";
import type { FindingMarks } from "./finding-marks.ts";
import type { OpenShelf } from "./kept-stills.ts";
import type { MarkSync } from "./mark-sync.ts";
import type { Prefs } from "./prefs.ts";
import type { ResultsStore } from "./results-store.ts";
import { SAMPLES } from "./samples.ts";
import type { SentWalks } from "./sent-walks.ts";
import type { TakeStore } from "./take-store.ts";

export type ForgetSent = () => Promise<void>;

export type SentCopies = {
  prefs: Prefs;
  takes: () => Promise<TakeStore>;
  sentWalks: SentWalks;
  results: () => Promise<ResultsStore>;
  shelf: OpenShelf;
  marks: FindingMarks;
  sync: MarkSync;
};

export const forgetSent =
  (copies: SentCopies): ForgetSent =>
  async () => {
    copies.prefs.renewVisitorId();
    keepPending(null);
    keepBoughtHere(false);
    const takes = await copies.takes();
    for (const sent of copies.sentWalks.all()) {
      await takes.remove(sent.takeId);
      copies.sentWalks.remove(sent.walkId);
    }
    for (const take of await takes.all()) {
      if ((take.partOf ?? null) !== null) {
        await takes.remove(take.id);
        continue;
      }
      if (take.upload === null && (take.tags ?? null) === null) continue;
      await takes.saveUpload(take.id, null);
      await takes.saveTags(take.id, null);
    }
    await (await copies.results()).clear();
    const shelf = await copies.shelf();
    if (shelf !== null) for (const key of await shelf.keys()) await shelf.delete(key);
    copies.marks.forgetAllBut(SAMPLES.map((sample) => sample.id));
    copies.sync.forget();
  };
