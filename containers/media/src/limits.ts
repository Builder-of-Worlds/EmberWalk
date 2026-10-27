const num = (name: string, fallback: number): number => {
  const raw = process.env[name];
  const value = raw === undefined ? fallback : Number(raw);
  return Number.isFinite(value) && value > 0 ? value : fallback;
};

export const limits = {
  maxFps: num("MEDIA_MAX_FPS", 4),
  defaultFps: 2,
  maxStills: num("MEDIA_MAX_STILLS", 60),
  maxBlurRegions: num("MEDIA_MAX_BLUR_REGIONS", 32),
  maxSeconds: num("MEDIA_MAX_SECONDS", 420),
  maxInputBytes: num("MEDIA_MAX_INPUT_BYTES", 2 * 1024 ** 3),
  maxBodyBytes: num("MEDIA_MAX_BODY_BYTES", 64 * 1024),
  maxHeight: num("MEDIA_MAX_HEIGHT", 2160),
  ffmpegTimeoutMs: num("MEDIA_FFMPEG_TIMEOUT_MS", 5 * 60 * 1000),
  transferTimeoutMs: num("MEDIA_TRANSFER_TIMEOUT_MS", 5 * 60 * 1000),
  maxConcurrent: num("MEDIA_MAX_CONCURRENT", 1),
};
