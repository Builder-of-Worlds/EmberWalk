export type LightMeter = { read(): number | null; stop(): void };

export type LightEnv = (stream: MediaStream) => LightMeter | null;

export const LIGHT_SIZE = { width: 16, height: 9 } as const;

const HAS_PICTURE = 2;

export const meanLight = (rgba: ArrayLike<number>): number | null => {
  const pixels = Math.floor(rgba.length / 4);
  if (pixels === 0) return null;
  let sum = 0;
  for (let i = 0; i < pixels * 4; i += 4) sum += 0.299 * rgba[i]! + 0.587 * rgba[i + 1]! + 0.114 * rgba[i + 2]!;
  return Math.round(sum / pixels);
};

export const browserLight =
  (doc: Pick<Document, "createElement">): LightEnv =>
  (stream) => {
    const canvas = doc.createElement("canvas");
    canvas.width = LIGHT_SIZE.width;
    canvas.height = LIGHT_SIZE.height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (context === null) return null;
    const video = doc.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.srcObject = stream;
    void video.play().catch(() => undefined);
    return {
      read: () => {
        if (video.readyState < HAS_PICTURE) return null;
        try {
          context.drawImage(video, 0, 0, LIGHT_SIZE.width, LIGHT_SIZE.height);
          return meanLight(context.getImageData(0, 0, LIGHT_SIZE.width, LIGHT_SIZE.height).data);
        } catch {
          return null;
        }
      },
      stop: () => {
        video.srcObject = null;
      },
    };
  };
