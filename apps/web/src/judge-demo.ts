import type { Trade, WalkStatusResponse } from "@emberwalk/shared";
import { DEFAULT_LIMITS } from "@emberwalk/shared";
import type { Deps } from "./deps.ts";
import type { FixedApi, FixedAnswer, Job, JobsView, Message } from "./fixed-api.ts";
import type { FindingMarks } from "./finding-marks.ts";
import { JUDGE_MEDIA, judgeWords } from "./judge.ts";
import { offlineRechecks } from "./recheck-api.ts";
import type { ReportApi } from "./report-api.ts";
import type { ResultFinding, WalkResults } from "./results.ts";

const CREWS: Record<Trade, { name: string; className: string; miles: number }> = {
  tree_service: { name: "Sample Oak Tree Care", className: "Tree Service", miles: 4 },
  brush_clearing: { name: "Sample Foothill Clearing", className: "C-27 Landscaping", miles: 6 },
  debris_hauling: { name: "Sample Valley Hauling", className: "C-61 Limited Specialty", miles: 9 },
  roofing_gutters: { name: "Sample Ridge Roofing", className: "C-39 Roofing", miles: 7 },
  fencing: { name: "Sample Canyon Fence", className: "C-13 Fencing", miles: 11 },
  handyman: { name: "Sample Home Repair", className: "B General Building", miles: 5 },
};

const TRADES: [Trade, RegExp][] = [
  ["tree_service", /^(tree_branch_over_roof|shrub|tree)$/],
  ["brush_clearing", /^(dry_brush|dry_grass|shed|propane_tank|foundation_vent)$/],
  ["debris_hauling", /^wood_pile$/],
  ["roofing_gutters", /^roof_debris$/],
  ["fencing", /^wooden_fence$/],
];

const OK = <T,>(value: T): Promise<FixedAnswer<T>> => Promise.resolve({ value });

const nowIso = (): string => new Date().toISOString();

const crewOf = (trade: Trade) => ({
  id: `crew-${trade}`,
  name: CREWS[trade].name,
  className: CREWS[trade].className,
  licenseNumber: null,
  licenseStatus: null,
  listedOn: null,
  checkLicenseUrl: null,
  distanceMiles: CREWS[trade].miles,
  approximate: true,
  phone: null,
  email: `${trade.replaceAll("_", "-")}@example.invalid`,
  sample: true,
});

const itemLines = (findings: ResultFinding[]): string[] => [...new Set(findings.map((f) => `- ${f.instruction}`))];

const requestBody = (findings: ResultFinding[]): string =>
  ["Hello. I would like a quote for this work at my house:", ...itemLines(findings), "Could you tell me a price and the soonest date you can do it?"].join("\n");

const replyTo = (message: Message): Message => {
  const at = nowIso();
  return {
    ...message,
    status: "replied",
    approvedAt: at,
    sentAt: at,
    replies: [
      {
        id: `reply-${message.id}`,
        via: "email",
        receivedAt: at,
        text: "Thanks for writing. We can do this for $450, and we could come next Tuesday. Is there a gate we need to open?",
        reading: { price: "$450", date: "next Tuesday", questions: ["Is there a gate we need to open?"], declined: false, summary: "This crew can do the work next Tuesday for $450, and has one question." },
      },
    ],
  };
};

export const demoFixed = (sample: WalkResults, marks: FindingMarks): FixedApi => {
  const open = sample.findings;
  const inTrade = (trade: RegExp) => open.filter((f) => trade.test(f.concept));
  let view: JobsView = { walkId: sample.id, jobs: [], yourself: [] };
  const change = (run: (job: Job) => Job): FixedAnswer<JobsView> => {
    view = { ...view, jobs: view.jobs.map(run) };
    return { value: view };
  };
  const withMessage = (messageId: string, run: (message: Message) => Message) =>
    change((job) => {
      if (!job.messages.some((m) => m.id === messageId)) return job;
      const messages = job.messages.map((m) => (m.id === messageId ? run(m) : m));
      return { ...job, messages, status: "waiting_on_crew" };
    });
  return {
    plan: () => {
      view = {
        walkId: sample.id,
        yourself: open.filter((f) => !TRADES.some(([, t]) => t.test(f.concept))).map((f) => f.id),
        jobs: TRADES.filter(([, t]) => inTrade(t).length > 0).map(([trade, t]) => ({
          id: `job-${trade}`,
          trade,
          status: "waiting_on_homeowner",
          findingIds: inTrade(t).map((f) => f.id),
          crews: [crewOf(trade)],
          messages: [],
          followUps: [],
        })),
      };
      return OK(view);
    },
    jobs: () => OK(view),
    draft: (jobId) =>
      Promise.resolve(
        change((job) => {
          if (job.id !== jobId) return job;
          const message: Message = {
            id: `message-${job.trade}`,
            crewId: `crew-${job.trade}`,
            channel: "email",
            status: "draft",
            subject: "A quote for wildfire clearance work",
            body: requestBody(open.filter((f) => job.findingIds.includes(f.id))),
            createdAt: nowIso(),
            approvedAt: null,
            sentAt: null,
            outbox: null,
            photos: [],
            replies: [],
          };
          return { ...job, messages: [message] };
        }),
      ),
    addEmail: () => OK(view),
    textDraft: () => Promise.resolve({ code: "conflict" as const, message: "" }),
    addCrew: (jobId, crew) =>
      Promise.resolve(
        change((job) => (job.id === jobId ? { ...job, crews: [...job.crews, { ...crewOf(job.trade), id: `crew-named-${job.crews.length}`, name: crew.name, email: crew.email, phone: crew.phone }] } : job)),
      ),
    inspectionApprove: () => OK({ status: "sent" as const }),
    crewSignup: () => Promise.resolve({ code: "not_found" as const, message: "" }),
    approve: (messageId) => {
      withMessage(messageId, replyTo);
      return OK({ status: "sent" as const });
    },
    sentByPhone: () => OK({ status: "sent_by_phone" as const }),
    logReply: (messageId, text) =>
      Promise.resolve(
        withMessage(messageId, (m) => ({ ...m, status: "replied", replies: [...m.replies, { id: `reply-${m.replies.length}-${m.id}`, via: "homeowner", receivedAt: nowIso(), text, reading: null }] })),
      ),
    followUps: () => OK(view),
    inspection: () =>
      open.some((f) => f.label === "required_now" && !["done", "rechecked"].includes(marks.statusOf(sample.id, f.id).kind))
        ? Promise.resolve({ code: "not_ready" as const, message: "" })
        : OK({
        subject: "Request for a defensible space inspection",
        body: ["Hello. I have worked through this list at my house and would like to request a defensible space inspection:", ...itemLines(open.filter((f) => f.label === "required_now")), "Please tell me what date works for you."].join("\n"),
        links: [{ label: "CAL FIRE: Prepare for Wildfire", url: "https://readyforwildfire.org/prepare-for-wildfire/defensible-space/" }],
        contact: null,
        messageId: null,
        sent: false,
        replies: [],
      }),
    history: () =>
      OK({
        walks: [
          {
            walkId: sample.id,
            walkedOn: sample.walkedOn,
            synthetic: true,
            state: "done",
            marks: open.flatMap((f) => {
              const status = marks.statusOf(sample.id, f.id);
              return status.kind === "needs_fixing" ? [] : [{ id: `mark-${f.id}`, findingId: f.id, status: status.kind, note: status.note === "" ? null : status.note, doneOn: status.doneOn ?? null, markedAt: nowIso(), concept: f.concept }];
            }),
          },
        ],
      }),
    mark: () => OK({ saved: true as const }),
  };
};

const CHECK_STEPS: WalkStatusResponse["state"][] = [{ name: "queued" }, { name: "queued" }, { name: "done" }];

export const demoStatus = (): Deps["walkStatus"] => {
  const seen = new Map<string, number>();
  return async (walkId) => {
    const at = seen.get(walkId) ?? 0;
    seen.set(walkId, at + 1);
    return { value: { walkId, state: CHECK_STEPS[Math.min(at, CHECK_STEPS.length - 1)]!, failure: null } as WalkStatusResponse };
  };
};

const toDataUrl = async (url: string): Promise<string> => {
  const blob = await (await fetch(url)).blob();
  return new Promise((done, failed) => {
    const reader = new FileReader();
    reader.onload = () => done(String(reader.result));
    reader.onerror = () => failed(new Error("a still did not load"));
    reader.readAsDataURL(blob);
  });
};

export const labelled = (html: string): string =>
  html.replace(/<body[^>]*>/, (open) => `${open}<p style="margin:0 0 12px;padding:8px;background:#4a3f35;color:#efeae0;font-weight:700;text-align:center">${judgeWords.label}</p>`);

export const demoReport = (sample: WalkResults, marks: FindingMarks): ReportApi => {
  let approvedAt: string | null = null;
  const page: ReportApi["page"] = async (_walkId, removed) => {
    const { reportHtml } = await import("../../../workers/api/src/report.ts");
    const stills = new Map(await Promise.all(sample.findings.map(async (f) => [f.id, await toDataUrl(f.proof.still)] as const)));
    const statuses = new Map(sample.findings.map((f) => {
      const kind = marks.statusOf(sample.id, f.id).kind;
      return [f.id, kind === "fix_planned" || kind === "done" ? kind : "needs_fixing"] as const;
    }));
    const html = reportHtml({ results: sample as never, statuses, marks: [], rechecks: [], stills, removed: new Set(removed), approvedAt, templates: new Map(sample.findings.map((f) => [f.id, f.instruction])), personal: [] });
    return { html: labelled(html), seen: "sample" };
  };
  return {
    page,
    pdf: async () => {
      const response = await fetch(JUDGE_MEDIA.pdf).catch(() => null);
      return response?.ok ? { pdf: await response.blob(), name: "emberwalk-sample-record.pdf" } : { code: "not_found" };
    },
    approval: async () => ({ approvedAt, changed: false }),
    approve: async () => {
      approvedAt = nowIso();
      return { approvedAt, changed: false };
    },
    share: async () => ({ link: null }),
    makeShare: async () => ({ code: "not_found" }),
    stopShare: async () => ({ link: null }),
    save: (pdf, name) => {
      const link = document.createElement("a");
      link.href = URL.createObjectURL(pdf);
      link.download = name;
      link.click();
      URL.revokeObjectURL(link.href);
    },
    copy: async () => false,
  };
};

export const judgeDeps = (base: Deps, sample: WalkResults): Deps => ({
  ...base,
  fixed: demoFixed(sample, base.marks),
  walkStatus: demoStatus(),
  report: demoReport(sample, base.marks),
  limits: { ...DEFAULT_LIMITS, ...base.limits, recheckOn: true, deleteEverythingOn: true },
  erase: { everything: async () => ({ value: { walks: 0, left: 0 } }) },
  rechecks: { ...offlineRechecks, send: async (findingId) => ({ recheck: { id: `recheck-${findingId}`, findingId, photo: "sample", result: "cleared", createdAt: nowIso() } as never }) },
});
