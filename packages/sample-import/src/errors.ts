export type ImportCode =
  | "render_unreadable"
  | "not_synthetic"
  | "not_labelled"
  | "invalid_render"
  | "invalid_motion"
  | "scene_mismatch"
  | "length_mismatch"
  | "video_missing"
  | "video_size_mismatch"
  | "video_hash_mismatch"
  | "video_unreadable"
  | "part_failed"
  | "offline"
  | "server_error"
  | (string & {});

export class ImportError extends Error {
  readonly code: ImportCode;

  constructor(code: ImportCode, message: string) {
    super(message);
    this.name = "ImportError";
    this.code = code;
  }
}
