export type VideoSource = {
  sizeBytes: number;
  sha256(): Promise<string>;
  read(from: number, to: number): Promise<Uint8Array>;
};

export type RenderFileName = "render.json" | "motion.json";

export type RenderSource = {
  json(name: RenderFileName): Promise<unknown>;
  video(fileName: string): Promise<VideoSource | null>;
};
