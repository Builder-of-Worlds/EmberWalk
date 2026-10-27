import { DEFAULT_LIMITS } from "@emberwalk/shared";
import { createUploadApi } from "./upload-api.ts";
import { r2UploadStore } from "./upload-store.ts";
import { d1WalkGate } from "./walk-gate.ts";

export type Env = {
  MEDIA: R2Bucket;
  DB: D1Database;
  R2_HOST: string;
  R2_BUCKET_NAME: string;
  R2_ACCESS_KEY_ID?: string;
  R2_SECRET_ACCESS_KEY?: string;
};

const errorResponse = (code: string, message: string, status: number): Response =>
  Response.json({ error: { code, message } }, { status });

const uploadApi = (env: Env) => {
  const { R2_HOST, R2_BUCKET_NAME, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY } = env;
  if (!R2_HOST || !R2_BUCKET_NAME || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY) return null;
  return createUploadApi({
    bucket: env.MEDIA,
    store: r2UploadStore(env.MEDIA),
    walks: d1WalkGate(env.DB),
    limits: DEFAULT_LIMITS,
    signing: {
      host: R2_HOST,
      bucketName: R2_BUCKET_NAME,
      accessKeyId: R2_ACCESS_KEY_ID,
      secretAccessKey: R2_SECRET_ACCESS_KEY,
    },
    now: Date.now,
  });
};

export default {
  async fetch(request, env): Promise<Response> {
    const { pathname } = new URL(request.url);
    if (pathname === "/health") return Response.json({ status: "ok" });
    if (pathname.startsWith("/api/uploads")) {
      const api = uploadApi(env);
      if (api === null) return errorResponse("server_error", "Uploads are not set up on this server.", 500);
      const handled = await api.handle(request);
      if (handled !== null) return handled;
    }
    return errorResponse("not_found", "No such endpoint.", 404);
  },
} satisfies ExportedHandler<Env>;
