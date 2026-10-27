import { badRequest } from "./errors.ts";
import { limits } from "./limits.ts";

export type ClipRequest = {
  input: string;
  output: string;
  start: number;
  end: number | null;
  fps: number;
  maxHeight: number | null;
};

export type AudioRequest = {
  input: string;
  output: string;
  start: number;
  end: number | null;
};

export type StillsRequest = {
  input: string;
  stills: { time: number; output: string }[];
};

export type ProbeRequest = { input: string };

type Body = Record<string, unknown>;

const asBody = (raw: unknown): Body => {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw badRequest("invalid_body", "The request body must be a JSON object.");
  }
  return raw as Body;
};

const allowKeys = (body: Body, keys: string[]): void => {
  for (const key of Object.keys(body)) {
    if (!keys.includes(key)) {
      throw badRequest("unknown_field", `The field "${key}" is not accepted.`);
    }
  }
};

const url = (value: unknown, field: string): string => {
  if (typeof value !== "string" || value.length === 0 || value.length > 4096) {
    throw badRequest("invalid_url", `"${field}" must be a URL.`);
  }
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw badRequest("invalid_url", `"${field}" must be a URL.`);
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw badRequest("invalid_url", `"${field}" must be an http or https URL.`);
  }
  return value;
};

const seconds = (value: unknown, field: string): number => {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > limits.maxSeconds) {
    throw badRequest("invalid_time", `"${field}" must be a number of seconds from 0 to ${limits.maxSeconds}.`);
  }
  return value;
};

const range = (body: Body): { start: number; end: number | null } => {
  const start = body.start === undefined ? 0 : seconds(body.start, "start");
  const end = body.end === undefined ? null : seconds(body.end, "end");
  if (end !== null && end <= start) {
    throw badRequest("invalid_range", '"end" must be greater than "start".');
  }
  return { start, end };
};

export const parseProbe = (raw: unknown): ProbeRequest => {
  const body = asBody(raw);
  allowKeys(body, ["input"]);
  return { input: url(body.input, "input") };
};

export const parseClip = (raw: unknown): ClipRequest => {
  const body = asBody(raw);
  allowKeys(body, ["input", "output", "start", "end", "fps", "maxHeight"]);
  const fps = body.fps === undefined ? limits.defaultFps : body.fps;
  if (typeof fps !== "number" || !Number.isFinite(fps) || fps <= 0) {
    throw badRequest("invalid_fps", '"fps" must be a number above 0.');
  }
  if (fps > limits.maxFps) {
    throw badRequest("fps_too_high", `"fps" cannot be above ${limits.maxFps}.`);
  }
  let maxHeight: number | null = null;
  if (body.maxHeight !== undefined) {
    const h = body.maxHeight;
    if (typeof h !== "number" || !Number.isInteger(h) || h < 16 || h > limits.maxHeight) {
      throw badRequest("invalid_height", `"maxHeight" must be a whole number from 16 to ${limits.maxHeight}.`);
    }
    maxHeight = h;
  }
  return {
    input: url(body.input, "input"),
    output: url(body.output, "output"),
    ...range(body),
    fps,
    maxHeight,
  };
};

export const parseAudio = (raw: unknown): AudioRequest => {
  const body = asBody(raw);
  allowKeys(body, ["input", "output", "start", "end"]);
  return { input: url(body.input, "input"), output: url(body.output, "output"), ...range(body) };
};

export const parseStills = (raw: unknown): StillsRequest => {
  const body = asBody(raw);
  allowKeys(body, ["input", "stills"]);
  const list = body.stills;
  if (!Array.isArray(list) || list.length === 0) {
    throw badRequest("invalid_stills", '"stills" must be a list with at least one entry.');
  }
  if (list.length > limits.maxStills) {
    throw badRequest("too_many_stills", `At most ${limits.maxStills} stills per request.`);
  }
  const stills = list.map((entry, i) => {
    const item = asBody(entry);
    allowKeys(item, ["time", "output"]);
    return { time: seconds(item.time, `stills[${i}].time`), output: url(item.output, `stills[${i}].output`) };
  });
  return { input: url(body.input, "input"), stills };
};
