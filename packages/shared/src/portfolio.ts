import { z } from "zod";
import { Id, Text, Timestamp } from "./common.ts";

export const Portfolio = z.strictObject({
  id: Id,
  managerEmail: z.email(),
  name: Text(120),
  createdAt: Timestamp,
});

export const Property = z.strictObject({
  id: Id,
  portfolioId: Id,
  label: Text(120),
  synthetic: z.boolean(),
  createdAt: Timestamp,
});

export const Invite = z
  .strictObject({
    id: Id,
    propertyId: Id,
    code: z.string().regex(/^[A-Za-z0-9_-]{22,64}$/),
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

export type Portfolio = z.infer<typeof Portfolio>;
export type Property = z.infer<typeof Property>;
export type Invite = z.infer<typeof Invite>;
