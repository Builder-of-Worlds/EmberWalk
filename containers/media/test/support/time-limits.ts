const ms = (name: string, fallback: number): number => {
  const raw = process.env[name];
  const value = raw === undefined ? fallback : Number(raw);
  return Number.isFinite(value) && value > 0 ? value : fallback;
};

export const timeLimits = {
  testMs: ms("MEDIA_TEST_TIMEOUT_MS", 60_000),
  setupMs: ms("MEDIA_TEST_SETUP_MS", 600_000),
  manyStillsMs: ms("MEDIA_TEST_MANY_STILLS_MS", 240_000),
  walkMs: ms("MEDIA_TEST_WALK_MS", 300_000),
  readyMs: ms("MEDIA_TEST_READY_MS", 60_000),
  imageBuildMs: ms("MEDIA_TEST_IMAGE_BUILD_MS", 600_000),
  ffmpegMs: ms("MEDIA_TEST_FFMPEG_MS", 120_000),
  pollMs: 100,
};
