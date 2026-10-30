import { Container, getContainer } from "@cloudflare/containers";

export const MEDIA_PORT = 8080;
export const MEDIA_INSTANCES = 3;

export class MediaContainer extends Container {
  override defaultPort = MEDIA_PORT;
  override sleepAfter = "5m";
}

export const mediaFetcher = (
  namespace: DurableObjectNamespace<MediaContainer>,
  pick: () => number = Math.random,
): Pick<Fetcher, "fetch"> => ({
  fetch: (input, init) => {
    const slot = Math.min(MEDIA_INSTANCES - 1, Math.floor(pick() * MEDIA_INSTANCES));
    return getContainer(namespace, `media-${slot}`).fetch(input, init);
  },
});
