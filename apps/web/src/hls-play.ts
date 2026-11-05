import { JUDGE_MEDIA } from "./judge.ts";

type HlsPlayer = { loadSource(url: string): void; attachMedia(video: HTMLVideoElement): void; on(event: string, run: (event: string, data: { fatal: boolean }) => void): void; destroy(): void };
type HlsClass = new (config: { enableWorker: boolean; startPosition: number }) => HlsPlayer;

declare global {
  interface Window {
    Hls?: HlsClass;
  }
}

let loading: Promise<HlsClass> | null = null;

const library = (): Promise<HlsClass> => {
  loading ??= new Promise((done, failed) => {
    const script = document.createElement("script");
    script.src = new URL(JUDGE_MEDIA.hls, document.baseURI).href;
    script.onload = () => (window.Hls === undefined ? failed(new Error("no player")) : done(window.Hls));
    script.onerror = () => failed(new Error("no player"));
    document.head.append(script);
  });
  return loading;
};

export const playHls = async (video: HTMLVideoElement, url: string, at: number, failed: () => void): Promise<() => void> => {
  if (video.canPlayType("application/vnd.apple.mpegurl") !== "") {
    video.addEventListener("loadedmetadata", () => { video.currentTime = at; }, { once: true });
    video.addEventListener("error", failed, { once: true });
    video.src = url;
    return () => video.removeEventListener("error", failed);
  }
  try {
    const Hls = await library();
    const player = new Hls({ enableWorker: false, startPosition: at });
    player.on("hlsError", (_event, data) => {
      if (data.fatal) failed();
    });
    player.loadSource(url);
    player.attachMedia(video);
    return () => player.destroy();
  } catch {
    failed();
    return () => undefined;
  }
};
