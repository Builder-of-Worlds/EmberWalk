import { DEFAULT_LIMITS, DELETE_EVERYTHING_PATH, limitsFromConfig } from "@emberwalk/shared";
import { accessConfigOf, createAccessVerifier } from "./access-jwt.ts";
import { handleBilling, isBillingPath } from "./billing-route.ts";
import { handleDeleteEverything } from "./delete-everything.ts";
import { startWalk } from "./entitlements.ts";
import { handleCrewSearch, handleFireLinks } from "./directory-route.ts";
import { handleFaultReport } from "./fault-report.ts";
import { type GetFixedService, handleGetFixed, isFixedPath } from "./get-it-fixed-routes.ts";
import { handleJobPage, JOB_PAGE_PATH } from "./job-page.ts";
import { OPS_PATH, handleOps } from "./ops-route.ts";
import { handleRecord } from "./portfolio-record.ts";
import { handleProperties, isPortfolioPath, RECORD_PATH } from "./portfolio-route.ts";
import { createUploadApi } from "./upload-api.ts";
import type { PipelineStarter } from "./upload-api.ts";
import { handleRecheck, RECHECK_PATH } from "./recheck-route.ts";
import type { RecheckJudge } from "./recheck-route.ts";
import type { BrowserBinding } from "./browser-run.ts";
import { handleReport, REPORT_PATH } from "./report-route.ts";
import { openShared, SHARE_PATH } from "./report-share.ts";
import { r2UploadStore } from "./upload-store.ts";
import { handleSignIn, isSignInPath } from "./sign-in-route.ts";
import { sendReminders } from "./reminders.ts";
import { handleReminders, isRemindersPath } from "./reminders-route.ts";
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
  R2_DEV_HTTP?: string;
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
  RESEND_API_KEY?: string;
  POSTAL_FOOTER?: string;
  STRIPE_PORTAL_LOGIN_URL?: string;
  TURNSTILE_SECRET?: string;
  TURNSTILE_SITE_KEY?: string;
  APP_ORIGIN?: string;
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
      devHttp: env.R2_DEV_HTTP === "on",
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
    signing: ready ? { host: R2_HOST, bucketName: R2_BUCKET_NAME, accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY, devHttp: env.R2_DEV_HTTP === "on" } : null,
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
    if (isSignInPath(pathname)) {
      return handleSignIn(request, { db: env.DB, media: env.MEDIA, apiKey: env.RESEND_API_KEY, turnstileSecret: env.TURNSTILE_SECRET, turnstileSiteKey: env.TURNSTILE_SITE_KEY, appOrigin: env.APP_ORIGIN, fetch: (input, init) => fetch(input, init), now: () => new Date(), newId: () => crypto.randomUUID(), limits: limitsFromConfig(env.EMBERWALK_LIMITS) }, pathname);
    }
    if (isRemindersPath(pathname)) return handleReminders(request, { db: env.DB, appOrigin: env.APP_ORIGIN, now: () => new Date() }, pathname);
    const prices = { individual: env.STRIPE_PRICE_INDIVIDUAL, landlord: env.STRIPE_PRICE_LANDLORD, extraWalk: env.STRIPE_PRICE_EXTRA_WALK };
    if (isBillingPath(pathname)) {
      const stripe = { secretKey: env.STRIPE_SECRET_KEY, webhookSecret: env.STRIPE_WEBHOOK_SECRET, prices, automaticTax: env.STRIPE_AUTOMATIC_TAX };
      return handleBilling(request, { db: env.DB, limits: limitsFromConfig(env.EMBERWALK_LIMITS), fetch: (input, init) => fetch(input, init), now: Date.now, stripe, log: (line) => console.warn(line), mail: { apiKey: env.RESEND_API_KEY, portalLoginUrl: env.STRIPE_PORTAL_LOGIN_URL, footer: env.POSTAL_FOOTER } }, pathname);
    }
    if (pathname === DELETE_EVERYTHING_PATH)
      return handleDeleteEverything(request, { db: env.DB, bucket: env.MEDIA, limits: limitsFromConfig(env.EMBERWALK_LIMITS), now: Date.now });
    const jobPageOf = JOB_PAGE_PATH.exec(pathname);
    if (jobPageOf !== null) return handleJobPage(request, env, jobPageOf);
    if (isFixedPath(pathname)) return handleGetFixed(request, env, pathname);
    if (pathname === "/api/walks") return startWalk(request, { db: env.DB, limits: limitsFromConfig(env.EMBERWALK_LIMITS), prices, appOrigin: env.APP_ORIGIN, newId: () => crypto.randomUUID() });
    const recordOf = RECORD_PATH.exec(pathname);
    if (recordOf !== null) return handleRecord(request, env, recordOf[1] ?? "");
    if (isPortfolioPath(pathname)) return handleProperties(request, { db: env.DB, limits: limitsFromConfig(env.EMBERWALK_LIMITS), prices, appOrigin: env.APP_ORIGIN }, pathname);
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
  async scheduled(controller, env, ctx): Promise<void> {
    ctx.waitUntil(
      sendReminders({ db: env.DB, apiKey: env.RESEND_API_KEY, footer: env.POSTAL_FOOTER, appOrigin: env.APP_ORIGIN, fetch: (input, init) => fetch(input, init), now: () => new Date(controller.scheduledTime), wait: (ms) => new Promise((done) => setTimeout(done, ms)), log: (line) => console.warn(line) }).then(({ sent, failed }) => console.log(`reminders: sent ${sent}, failed ${failed}`))
        .catch((error: unknown) => console.warn(`reminders: run failed: ${error instanceof Error ? error.message : String(error)}`)),
    );
  },
} satisfies ExportedHandler<Env>;
