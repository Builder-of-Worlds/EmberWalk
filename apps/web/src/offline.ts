export type Precache = { version: string; files: string[] };

export const CACHE_PREFIX = "emberwalk-app-";

export const cacheNameFor = (version: string): string => `${CACHE_PREFIX}${version}`;

export const shellUrls = (precache: Precache, scope: string): string[] =>
  ["./", ...precache.files].map((file) => new URL(file, scope).href);

export const install = async (caches: CacheStorage, precache: Precache, scope: string): Promise<void> => {
  const cache = await caches.open(cacheNameFor(precache.version));
  await cache.addAll(shellUrls(precache, scope));
};

export const removeOldCaches = async (caches: CacheStorage, version: string): Promise<string[]> => {
  const keep = cacheNameFor(version);
  const old = (await caches.keys()).filter((name) => name.startsWith(CACHE_PREFIX) && name !== keep);
  await Promise.all(old.map((name) => caches.delete(name)));
  return old;
};

export const handles = (request: Request, scope: string): boolean => {
  const url = new URL(request.url);
  return request.method === "GET" && url.origin === new URL(scope).origin && !url.pathname.startsWith("/api/");
};

export const respond = async (
  request: Request,
  caches: CacheStorage,
  version: string,
  scope: string,
  fetchFn: (request: Request) => Promise<Response>,
): Promise<Response> => {
  const cache = await caches.open(cacheNameFor(version));
  const key = request.mode === "navigate" ? new URL("./", scope).href : request;
  const hit = await cache.match(key, { ignoreVary: true });
  if (hit !== undefined) return hit;
  return fetchFn(request);
};
