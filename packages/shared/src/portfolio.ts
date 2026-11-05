import { z } from "zod";
import { Id, Text, Timestamp } from "./common.ts";
import { WalkState } from "./walk.ts";

export const Portfolio = z.strictObject({
  id: Id,
  accountId: Id,
  createdAt: Timestamp,
});

export const Property = z.strictObject({
  id: Id,
  portfolioId: Id,
  label: Text(120),
  synthetic: z.boolean(),
  createdAt: Timestamp,
});

export const InviteCode = z.string().regex(/^[A-Za-z0-9_-]{22,64}$/);

export const Invite = z
  .strictObject({
    id: Id,
    propertyId: Id,
    code: InviteCode,
    createdAt: Timestamp,
    expiresAt: Timestamp,
    usedAt: Timestamp.nullable(),
    walkId: Id.nullable(),
  })
  .refine((i) => Date.parse(i.createdAt) < Date.parse(i.expiresAt), {
    message: "an invite must expire after it is made",
    path: ["expiresAt"],
  })
  .refine((i) => i.walkId === null || i.usedAt !== null, { message: "a walk comes only from a used invite", path: ["walkId"] });

export const EMAIL_MAX = 254;

const Email = z.string().trim().toLowerCase().max(EMAIL_MAX).pipe(z.email());

export const Account = z.strictObject({ id: Id, email: z.email().max(EMAIL_MAX).refine((e) => e === e.toLowerCase(), "an email is kept in lower case"), createdAt: Timestamp });

export const Me = z.strictObject({ accountId: Id, email: Account.shape.email });

export const SignInRequest = z.strictObject({ email: Email });

export const SignInAccepted = z.strictObject({ accepted: z.literal(true) });

export const SIGN_IN_TOKEN = /^[A-Za-z0-9_-]{43}$/;

export const SIGN_IN_CODE = /^\d{6}$/;

export const SignInVerifyRequest = z.union([z.strictObject({ token: z.string().regex(SIGN_IN_TOKEN) }), z.strictObject({ email: Email, code: z.string().regex(SIGN_IN_CODE) })]);

export const PROPERTY_STATUSES = ["not_walked", "needs_work", "ready"] as const;
export const PropertyStatus = z.enum(PROPERTY_STATUSES);

const Day = z.iso.date();

export const DoneMark = z.strictObject({ findingId: Id, concept: Text(40), doneOn: Day, markedAt: Timestamp });

export const OpenItem = z.strictObject({ findingId: Id, concept: Text(40), requiredNow: z.boolean() });

export const PropertyWalk = z
  .strictObject({
    walkId: Id,
    walkedOn: Day,
    createdAt: Timestamp,
    state: WalkState,
    synthetic: z.boolean(),
    byTenant: z.boolean(),
    openItems: z.int().min(0),
    requiredNowOpen: z.int().min(0),
    doneMarks: z.array(DoneMark),
    open: z.array(OpenItem),
  })
  .refine((w) => w.requiredNowOpen <= w.openItems, { message: "Required Now items are a part of the open items", path: ["requiredNowOpen"] });

export type PropertyStatus = z.infer<typeof PropertyStatus>;
export type PropertyWalk = z.infer<typeof PropertyWalk>;

export const propertyStatus = (walks: readonly Pick<PropertyWalk, "state" | "requiredNowOpen">[]): PropertyStatus => {
  const latest = walks.find((w) => w.state.name === "done");
  if (latest === undefined) return "not_walked";
  return latest.requiredNowOpen === 0 ? "ready" : "needs_work";
};

export const PropertyEntry = Property.extend({ status: PropertyStatus, walks: z.array(PropertyWalk) })
  .refine((p) => p.status === propertyStatus(p.walks), { message: "the status follows the latest done walk", path: ["status"] })
  .refine((p) => p.walks.every((w, i) => i === 0 || Date.parse(p.walks[i - 1]!.createdAt) >= Date.parse(w.createdAt)), {
    message: "walks are listed newest first",
    path: ["walks"],
  });

export const PropertyList = z.strictObject({ properties: z.array(PropertyEntry) });

export const CreatePropertyRequest = z.strictObject({ label: Text(120) });

export const CreateInviteResponse = z.strictObject({ id: Id, propertyId: Id, code: InviteCode, expiresAt: Timestamp });

export const InviteRefusal = z.enum(["expired", "used", "property_removed"]);

export const InviteLookup = z.strictObject({ label: Text(120), good: z.boolean(), reason: InviteRefusal.nullable() });

export const PORTFOLIO_ERROR_CODES = [
  "invalid_request",
  "body_too_large",
  "not_found",
  "method_not_allowed",
  "unauthorized",
  "forbidden_origin",
  "rate_limited",
  "link_invalid",
  "link_expired",
  "link_used",
  "not_set_up",
  "mail_failed",
  "invite_unknown",
  "invite_expired",
  "invite_used",
  "property_removed",
  "server_error",
] as const;

export const PortfolioErrorCode = z.enum(PORTFOLIO_ERROR_CODES);

export const PortfolioError = z.strictObject({ error: z.strictObject({ code: PortfolioErrorCode, message: Text(300) }) });

export type Portfolio = z.infer<typeof Portfolio>;
export type Property = z.infer<typeof Property>;
export type Invite = z.infer<typeof Invite>;
export type InviteCode = z.infer<typeof InviteCode>;
export type Account = z.infer<typeof Account>;
export type Me = z.infer<typeof Me>;
export type SignInRequest = z.infer<typeof SignInRequest>;
export type SignInVerifyRequest = z.infer<typeof SignInVerifyRequest>;
export type DoneMark = z.infer<typeof DoneMark>;
export type OpenItem = z.infer<typeof OpenItem>;
export type InviteRefusal = z.infer<typeof InviteRefusal>;
export type PropertyEntry = z.infer<typeof PropertyEntry>;
export type PropertyList = z.infer<typeof PropertyList>;
export type CreatePropertyRequest = z.infer<typeof CreatePropertyRequest>;
export type CreateInviteResponse = z.infer<typeof CreateInviteResponse>;
export type InviteLookup = z.infer<typeof InviteLookup>;
export type PortfolioErrorCode = z.infer<typeof PortfolioErrorCode>;
