import type { Stills } from "./live-api.ts";

export const KEPT_STILLS = 40;

const SHELF = "emberwalk-stills";

const HOST = "https://phone.invalid";

export type Shelf = Pick<Cache, "match" | "put" | "keys" | "delete">;

export type OpenShelf = () => Promise<Shelf | null>;

export const browserShelf: OpenShelf = async () => {
  try {
    return typeof caches === "undefined" ? null : await caches.open(SHELF);
  } catch {
    return null;
  }
};

const keyOf = (url: string): string => `${HOST}${new URL(url, HOST).pathname}`;

const keep = async (shelf: Shelf, url: string, blob: Blob): Promise<void> => {
  await shelf.put(keyOf(url), new Response(blob, { headers: { "content-type": blob.type } }));
  const held = await shelf.keys();
  for (const old of held.slice(0, Math.max(0, held.length - KEPT_STILLS))) await shelf.delete(old);
};

export const keptStills =
  (inner: Stills, open: OpenShelf): Stills =>
  async (url) => {
    const blob = await inner(url);
    try {
      const shelf = await open();
      if (blob !== null) {
        if (shelf !== null) await keep(shelf, url, blob);
        return blob;
      }
      const kept = await shelf?.match(keyOf(url));
      return kept === undefined ? null : await kept.blob();
    } catch {
      return blob;
    }
  };
