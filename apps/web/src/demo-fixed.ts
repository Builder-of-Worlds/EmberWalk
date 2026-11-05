import type { Trade } from "@emberwalk/shared";
import type { FindingMarks } from "./finding-marks.ts";
import type { FixedApi, FixedAnswer, Job, JobsView, Message } from "./fixed-api.ts";
import type { LoadResults } from "./samples.ts";
import type { ResultFinding, WalkResults } from "./results.ts";

export const DEMO_ADDRESS = "demo-inbox@samples.emberwalk.app";

const SYNTHETIC_LABEL = "Synthetic sample house";
const KEY = "emberwalk.demoFixed";
const PREFIX = "demo-";

const TRADES: Partial<Record<ResultFinding["concept"], Trade>> = {
  wood_pile: "debris_hauling",
  lumber_pile: "debris_hauling",
  tree: "tree_service",
  shrub: "tree_service",
  tree_branch_over_roof: "tree_service",
  roof_debris: "roofing_gutters",
  wooden_fence: "fencing",
};

const CALFIRE_LINKS = [
  { label: "CAL FIRE Defensible Space", url: "https://www.fire.ca.gov/dspace" },
  { label: "CAL FIRE Request An Inspection form", url: "https://survey123.arcgis.com/share/a15c7706b4114e20b39d2a26294338ed" },
];

export type DemoDeps = { results: LoadResults; samples: readonly WalkResults[]; marks: Pick<FindingMarks, "statusOf">; now: () => Date; storage: Pick<Storage, "getItem" | "setItem"> };

type Saved = Record<string, JobsView>;

const nope = <T>(code: "not_found" | "conflict" | "not_ready", message = ""): FixedAnswer<T> => ({ code, message });

export const demoFixed = (deps: DemoDeps): FixedApi => {
  const read = (): Saved => {
    try {
      return JSON.parse(deps.storage.getItem(KEY) ?? "{}") as Saved;
    } catch {
      return {};
    }
  };
  const keep = (walkId: string, view: JobsView): { value: JobsView } => {
    deps.storage.setItem(KEY, JSON.stringify({ ...read(), [walkId]: view }));
    return { value: view };
  };
  const withJob = (jobId: string): { walkId: string; view: JobsView; job: Job } | null => {
    for (const [walkId, view] of Object.entries(read())) {
      const job = view.jobs.find((j) => j.id === jobId);
      if (job !== undefined) return { walkId, view, job };
    }
    return null;
  };
  const withMessage = (messageId: string): { walkId: string; view: JobsView; job: Job; message: Message } | null => {
    for (const [walkId, view] of Object.entries(read())) {
      for (const job of view.jobs) {
        const message = job.messages.find((m) => m.id === messageId);
        if (message !== undefined) return { walkId, view, job, message };
      }
    }
    return null;
  };
  const stamp = () => deps.now().toISOString();

  const plan: FixedApi["plan"] = async (walkId) => {
    const results = await deps.results(walkId);
    if (results === null) return nope("not_found");
    const held = read()[walkId];
    if (held !== undefined) return { value: held };
    const trades = new Map<Trade, ResultFinding[]>();
    for (const f of results.findings) {
      const trade = TRADES[f.concept] ?? "brush_clearing";
      trades.set(trade, [...(trades.get(trade) ?? []), f]);
    }
    const jobs: Job[] = [...trades].map(([trade, findings]) => ({
      id: `${PREFIX}job-${trade}`,
      trade,
      status: "planning",
      findingIds: findings.map((f) => f.id),
      crews: [1, 2, 3].map((n) => ({
        id: `${PREFIX}crew-${trade}-${n}`,
        name: `Sample Crew ${n}`,
        className: null,
        licenseNumber: null,
        licenseStatus: null,
        listedOn: null,
        checkLicenseUrl: null,
        distanceMiles: null,
        approximate: false,
        phone: null,
        email: DEMO_ADDRESS,
        sample: true,
      })),
      messages: [],
      followUps: [],
    }));
    return keep(walkId, { walkId, jobs, yourself: [] });
  };

  const draft: FixedApi["draft"] = async (jobId) => {
    const hit = withJob(jobId);
    const results = hit === null ? null : await deps.results(hit.walkId);
    if (hit === null || results === null) return nope("not_found");
    const findings = results.findings.filter((f) => hit.job.findingIds.includes(f.id));
    hit.job.messages = hit.job.crews.map((crew) => ({
      id: `${PREFIX}message-${crew.id}`,
      crewId: crew.id,
      channel: "email",
      status: "draft",
      subject: `Quote request (${SYNTHETIC_LABEL})`,
      body: [`${SYNTHETIC_LABEL}.`, "", `Hello ${crew.name},`, "", "Could you quote this work?", ...findings.map((f, i) => `${i + 1}. ${f.instruction}`), "", "Thank you."].join("\n"),
      createdAt: stamp(),
      approvedAt: null,
      sentAt: null,
      outbox: null,
      photos: findings.map((f) => ({ findingId: f.id, url: f.proof.still })),
      replies: [],
    }));
    hit.job.status = "waiting_on_homeowner";
    return keep(hit.walkId, hit.view);
  };

  const inspection: FixedApi["inspection"] = async (walkId) => {
    const results = await deps.results(walkId);
    if (results === null) return nope("not_found");
    const required = results.findings.filter((f) => f.label === "required_now");
    if (required.length === 0) return nope("conflict");
    if (required.some((f) => deps.marks.statusOf(walkId, f.id).kind !== "done")) return nope("not_ready");
    return {
      value: {
        subject: `Defensible space inspection request (${SYNTHETIC_LABEL})`,
        body: [`${SYNTHETIC_LABEL}.`, "", "Hello,", "", "I have finished the Required Now defensible space work at my house and would like to ask for a defensible space inspection.", "", "What I fixed:", ...required.map((f, i) => `${i + 1}. ${f.instruction}`), "", "Thank you."].join("\n"),
        links: CALFIRE_LINKS,
        contact: null,
        messageId: null,
        sent: false,
        replies: [],
      },
    };
  };

  return {
    plan,
    jobs: async (walkId) => {
      const view = read()[walkId];
      return view === undefined ? nope("not_found") : { value: view };
    },
    draft,
    addEmail: async () => nope("conflict"),
    textDraft: async () => nope("conflict"),
    addCrew: async (jobId, crew) => {
      const hit = withJob(jobId);
      if (hit === null || hit.job.messages.length > 0) return nope("conflict");
      hit.job.crews = [...hit.job.crews.slice(0, 2), { ...hit.job.crews[2]!, id: `${PREFIX}crew-named-${jobId}`, name: crew.name }];
      return keep(hit.walkId, hit.view);
    },
    approve: async (messageId) => {
      const hit = withMessage(messageId);
      if (hit === null) return nope("not_found");
      hit.message.status = "sent";
      hit.message.approvedAt = stamp();
      hit.message.sentAt = stamp();
      if (!hit.job.messages.some((m) => m.status === "draft")) hit.job.status = "waiting_on_crew";
      keep(hit.walkId, hit.view);
      return { value: { status: "sent" } };
    },
    sentByPhone: async () => nope("conflict"),
    logReply: async (messageId, text) => {
      const hit = withMessage(messageId);
      if (hit === null) return nope("not_found");
      hit.message.status = "replied";
      hit.message.replies.push({ id: `${PREFIX}reply-${hit.message.replies.length + 1}`, via: "homeowner", receivedAt: stamp(), text, reading: null });
      return keep(hit.walkId, hit.view);
    },
    followUps: async (walkId) => {
      const view = read()[walkId];
      return view === undefined ? nope("not_found") : { value: view };
    },
    inspection,
    inspectionApprove: async () => nope("conflict"),
    crewSignup: async () => nope("conflict"),
    history: async () => ({
      value: {
        walks: deps.samples.flatMap((sample) => {
          const marks = sample.findings.flatMap((f) => {
            const status = deps.marks.statusOf(sample.id, f.id);
            if (status.kind === "needs_fixing") return [];
            return [{ id: `${PREFIX}mark-${f.id}`, findingId: f.id, concept: f.concept, status: status.kind, note: status.note === "" ? null : status.note, doneOn: status.doneOn ?? status.plannedOn ?? null, markedAt: stamp() }];
          });
          return marks.length === 0 ? [] : [{ walkId: sample.id, walkedOn: sample.walkedOn, synthetic: true, state: "done", marks }];
        }),
      },
    }),
    mark: async () => ({ value: { saved: true } }),
  };
};

export const withDemo = (real: FixedApi, demo: FixedApi, results: LoadResults): FixedApi => {
  const synthetic = async (walkId: string): Promise<boolean> => (await results(walkId).catch(() => null))?.synthetic === true;
  const isDemoId = (id: string): boolean => id.startsWith(PREFIX);
  return {
    ...real,
    plan: async (walkId, zip) => ((await synthetic(walkId)) ? demo.plan(walkId, zip) : real.plan(walkId, zip)),
    jobs: async (walkId) => ((await synthetic(walkId)) ? demo.jobs(walkId) : real.jobs(walkId)),
    followUps: async (walkId) => ((await synthetic(walkId)) ? demo.followUps(walkId) : real.followUps(walkId)),
    inspection: async (walkId) => ((await synthetic(walkId)) ? demo.inspection(walkId) : real.inspection(walkId)),
    history: async () => {
      const [own, sample] = await Promise.all([real.history(), demo.history()]);
      const walks = sample.code === undefined ? sample.value.walks : [];
      if (own.code !== undefined || walks.length === 0) return own;
      return { value: { walks: [...own.value.walks, ...walks] } };
    },
    draft: (jobId) => (isDemoId(jobId) ? demo.draft(jobId) : real.draft(jobId)),
    addEmail: (jobId, crewId, email) => (isDemoId(jobId) ? demo.addEmail(jobId, crewId, email) : real.addEmail(jobId, crewId, email)),
    textDraft: (jobId, crewId) => (isDemoId(jobId) ? demo.textDraft(jobId, crewId) : real.textDraft(jobId, crewId)),
    addCrew: (jobId, crew) => (isDemoId(jobId) ? demo.addCrew(jobId, crew) : real.addCrew(jobId, crew)),
    approve: (messageId) => (isDemoId(messageId) ? demo.approve(messageId) : real.approve(messageId)),
    sentByPhone: (messageId) => (isDemoId(messageId) ? demo.sentByPhone(messageId) : real.sentByPhone(messageId)),
    logReply: (messageId, text) => (isDemoId(messageId) ? demo.logReply(messageId, text) : real.logReply(messageId, text)),
  };
};
