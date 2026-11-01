import { DEFAULT_LIMITS, DELETE_EVERYTHING_PATH, limitsFromConfig } from "@emberwalk/shared";
import { accessConfigOf, createAccessVerifier } from "./access-jwt.ts";
import { handleBilling, isBillingPath } from "./billing-route.ts";
import { handleDeleteEverything } from "./delete-everything.ts";
import { startWalk } from "./entitlements.ts";
import { handleCrewSearch, handleFireLinks } from "./directory-route.ts";
import { handleFaultReport } from "./fault-report.ts";
import { type GetFixedService, handleGetFixed, isFixedPath } from "./get-it-fixed-routes.ts";
import { OPS_PATH, handleOps } from "./ops-route.ts";
import { createUploadApi } from "./upload-api.ts";
import type { PipelineStarter } from "./upload-api.ts";
import { handleRecheck, RECHECK_PATH } from "./recheck-route.ts";
import type { RecheckJudge } from "./recheck-route.ts";
import type { BrowserBinding } from "./browser-run.ts";
import { handleReport, REPORT_PATH } from "./report-route.ts";
import { openShared, SHARE_PATH } from "./report-share.ts";
import { r2UploadStore } from "./upload-store.ts";
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
  ACCESS_TEAM_DOMAIN?: string;
  ACCESS_AUD?: string;
  PIPELINE_SERVICE: PipelineStarter & RecheckJudge;
  GET_FIXED: GetFixedService;
  BROWSER?: BrowserBinding;
  REPORT?: string;
  EMBERWALK_LIMITS?: string;
  STRIPE_SECRET_KEY?: string;
  STRIPE_WEBHOOK_SECRET?: string;
  STRIPE_PRICE_INDIVIDUAL?: string;
  STRIPE_PRICE_LANDLORD?: string;
  STRIPE_PRICE_EXTRA_WALK?: string;
  STRIPE_AUTOMATIC_TAX?: string;
};

const errorResponse = (code: string, message: string, status: number): Response =>
  Response.json({ error: { code, message } }, { status });

const accessVerifier = createAccessVerifier({ fetch: (url) => fetch(url), now: Date.now });

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

const recheckDeps = (env: Env) => {
  const { R2_HOST, R2_BUCKET_NAME, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY } = env;
  const ready = R2_HOST && R2_BUCKET_NAME && R2_ACCESS_KEY_ID && R2_SECRET_ACCESS_KEY;
  return {
    db: env.DB,
    bucket: env.MEDIA,
    limits: DEFAULT_LIMITS,
    signing: ready ? { host: R2_HOST, bucketName: R2_BUCKET_NAME, accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY } : null,
    judge: env.PIPELINE_SERVICE,
    now: Date.now,
    newId: () => crypto.randomUUID(),
  };
};

export default {
  async fetch(request, env): Promise<Response> {
    const { pathname } = new URL(request.url);
    if (pathname === "/health") return Response.json({ status: "ok" });
    if (pathname === OPS_PATH) {
      return handleOps(request, { db: env.DB, limits: DEFAULT_LIMITS, now: Date.now, verifier: accessVerifier, config: accessConfigOf(env) });
    }
    if (pathname === "/api/faults") return handleFaultReport(request, env.DB, Date.now);
    if (pathname === "/api/crews") return handleCrewSearch(request, env.DB);
    if (pathname === "/api/fire-links") return handleFireLinks(request);
    const prices = { individual: env.STRIPE_PRICE_INDIVIDUAL, landlord: env.STRIPE_PRICE_LANDLORD, extraWalk: env.STRIPE_PRICE_EXTRA_WALK };
    if (isBillingPath(pathname)) {
      const stripe = { secretKey: env.STRIPE_SECRET_KEY, webhookSecret: env.STRIPE_WEBHOOK_SECRET, prices, automaticTax: env.STRIPE_AUTOMATIC_TAX };
      return handleBilling(request, { db: env.DB, limits: limitsFromConfig(env.EMBERWALK_LIMITS), fetch: (input, init) => fetch(input, init), now: Date.now, stripe, log: (line) => console.warn(line) }, pathname);
    }
    if (pathname === DELETE_EVERYTHING_PATH)
      return handleDeleteEverything(request, { db: env.DB, bucket: env.MEDIA, limits: limitsFromConfig(env.EMBERWALK_LIMITS), now: Date.now });
    if (isFixedPath(pathname)) return handleGetFixed(request, env, pathname);
    if (pathname === "/api/walks") return startWalk(request, { db: env.DB, limits: limitsFromConfig(env.EMBERWALK_LIMITS), prices, newId: () => crypto.randomUUID() });
    const tagsOf = TAGS_PATH.exec(pathname);
    if (tagsOf !== null) return handleAddTags(request, env.DB, tagsOf[1] ?? "");
    const recheckOf = RECHECK_PATH.exec(pathname);
    if (recheckOf !== null) return handleRecheck(request, recheckDeps(env), recheckOf[1]);
    const reportOf = REPORT_PATH.exec(pathname);
    if (reportOf !== null) return handleReport(request, env, reportOf);
    const sharedOf = SHARE_PATH.exec(pathname);
    if (sharedOf !== null) return openShared(request, env, sharedOf[1] ?? "");
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
