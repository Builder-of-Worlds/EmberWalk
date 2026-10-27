const keyOf = (input: RequestInfo | URL): string =>
  typeof input === "string" ? input : input instanceof URL ? input.href : input.url;

export class FakeCache {
  readonly entries = new Map<string, Response>();
  constructor(private readonly fetchFn: (url: string) => Promise<Response>) {}

  async match(input: RequestInfo | URL, options: CacheQueryOptions = {}): Promise<Response | undefined> {
    const hit = this.entries.get(keyOf(input));
    const vary = (hit?.headers.get("vary") ?? "").split(",").map((h) => h.trim()).filter(Boolean);
    const differs = input instanceof Request && vary.some((h) => input.headers.has(h));
    if (differs && options.ignoreVary !== true) return undefined;
    return hit?.clone();
  }

  async addAll(urls: string[]): Promise<void> {
    const fetched = await Promise.all(urls.map(async (url) => [url, await this.fetchFn(url)] as const));
    for (const [url, response] of fetched) {
      if (!response.ok) throw new TypeError(`addAll: ${url} answered ${response.status}`);
      this.entries.set(url, response);
    }
  }
}

export class FakeCaches {
  readonly stores = new Map<string, FakeCache>();
  constructor(private readonly fetchFn: (url: string) => Promise<Response> = async (url) => new Response(`body of ${url}`)) {}

  async open(name: string): Promise<FakeCache> {
    let cache = this.stores.get(name);
    if (cache === undefined) {
      cache = new FakeCache(this.fetchFn);
      this.stores.set(name, cache);
    }
    return cache;
  }

  async keys(): Promise<string[]> {
    return [...this.stores.keys()];
  }

  async delete(name: string): Promise<boolean> {
    return this.stores.delete(name);
  }

  asStorage(): CacheStorage {
    return this as unknown as CacheStorage;
  }
}
