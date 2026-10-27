import { handles, install, removeOldCaches, respond } from "./offline.ts";
import type { Precache } from "./offline.ts";

type ExtendableEvent = Event & { waitUntil(work: Promise<unknown>): void };
type FetchEvent = ExtendableEvent & { request: Request; respondWith(response: Promise<Response>): void };

type WorkerScope = {
  __EMBERWALK_PRECACHE?: Precache;
  caches: CacheStorage;
  registration: { scope: string };
  skipWaiting(): Promise<void>;
  clients: { claim(): Promise<void> };
  fetch(request: Request): Promise<Response>;
  addEventListener(type: "install" | "activate", listener: (event: ExtendableEvent) => void): void;
  addEventListener(type: "fetch", listener: (event: FetchEvent) => void): void;
};

const scope = globalThis as unknown as WorkerScope;
const precache = scope.__EMBERWALK_PRECACHE;
if (precache === undefined) throw new Error("the service worker was built without its precache list");

scope.addEventListener("install", (event) => {
  event.waitUntil(install(scope.caches, precache, scope.registration.scope).then(() => scope.skipWaiting()));
});

scope.addEventListener("activate", (event) => {
  event.waitUntil(removeOldCaches(scope.caches, precache.version).then(() => scope.clients.claim()));
});

scope.addEventListener("fetch", (event) => {
  if (!handles(event.request, scope.registration.scope)) return;
  event.respondWith(respond(event.request, scope.caches, precache.version, scope.registration.scope, (r) => scope.fetch(r)));
});
