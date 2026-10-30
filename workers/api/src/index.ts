import { DEFAULT_LIMITS } from "@emberwalk/shared";
import { handleCrewSearch, handleFireLinks } from "./directory-route.ts";
import { handleFaultReport } from "./fault-report.ts";
import { type GetFixedService, handleGetFixed, isFixedPath } from "./get-it-fixed-routes.ts";
import { createUploadApi } from "./upload-api.ts";
import type { PipelineStarter } from "./upload-api.ts";
import { r2UploadStore } from "./upload-store.ts";
import { handleCreateWalk } from "./walk-create.ts";
import { d1WalkGate } from "./walk-gate.ts";
import { handleWalkRead, READ_PATH } from "./walk-read.ts";
import { handleAddTags } from "./walk-tags.ts";

const TAGS_PATH = /^\/api\/walks\/([^/]+)\/tags$/;

export type Env = {
  MEDIA: R2Bucket;
  DB: D1Database;
  R2_HOST: string;
  R2_BUCKET_NAME: string;
  R2_ACCESS_KEY_ID?: string;
  R2_SECRET_ACCESS_KEY?: string;
  PIPELINE_SERVICE: PipelineStarter;
  GET_FIXED: GetFixedService;
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
    pipeline: env.PIPELINE_SERVICE,
    log: (line) => console.warn(line),
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
    if (pathname === "/api/faults") return handleFaultReport(request, env.DB, Date.now);
    if (pathname === "/api/crews") return handleCrewSearch(request, env.DB);
    if (pathname === "/api/fire-links") return handleFireLinks(request);
    if (isFixedPath(pathname)) return handleGetFixed(request, env, pathname);
    if (pathname === "/api/walks") return handleCreateWalk(request, env.DB, () => crypto.randomUUID());
    const tagsOf = TAGS_PATH.exec(pathname);
    if (tagsOf !== null) return handleAddTags(request, env.DB, tagsOf[1] ?? "");
    const readOf = READ_PATH.exec(pathname);
    if (readOf !== null) return handleWalkRead(request, env, readOf);
    if (pathname.startsWith("/api/uploads")) {
      const api = uploadApi(env);
      if (api === null) return errorResponse("server_error", "Uploads are not set up on this server.", 500);
      const handled = await api.handle(request);
      if (handled !== null) return handled;
    }
    return errorResponse("not_found", "No such endpoint.", 404);
  },
} satisfies ExportedHandler<Env>;
