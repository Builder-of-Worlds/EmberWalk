import type { PropertyEntry } from "@emberwalk/shared";

export const PORTFOLIO_ID = "4d3c2b1a-0f9e-4d8c-8b7a-6f5e4d3c2b1a";

export const id = (n: number): string => `1f2e3d4c-5b6a-4978-8a9b-${String(n).padStart(12, "0")}`;

export const doneWalk = (n: number, over: Partial<PropertyEntry["walks"][number]> = {}): PropertyEntry["walks"][number] => ({
  walkId: id(100 + n),
  walkedOn: `2026-10-${String(10 + n).padStart(2, "0")}`,
  createdAt: `2026-10-${String(10 + n).padStart(2, "0")}T09:00:00.000Z`,
  state: { name: "done" },
  synthetic: false,
  byTenant: false,
  openItems: 0,
  requiredNowOpen: 0,
  doneMarks: [],
  open: [],
  ...over,
});

export const entry = (n: number, label: string, status: PropertyEntry["status"], walks: PropertyEntry["walks"] = []): PropertyEntry => ({
  id: id(n),
  portfolioId: PORTFOLIO_ID,
  label,
  synthetic: false,
  createdAt: "2026-10-01T09:00:00.000Z",
  status,
  walks,
});

export const needsWork = (): PropertyEntry =>
  entry(1, "Cedar Lane Rental", "needs_work", [
    doneWalk(5, {
      byTenant: true,
      openItems: 2,
      requiredNowOpen: 1,
      open: [
        { findingId: id(201), concept: "dry_brush", requiredNow: true },
        { findingId: id(202), concept: "wooden_fence", requiredNow: false },
      ],
      doneMarks: [{ findingId: id(203), concept: "wood_pile", doneOn: "2026-10-20", markedAt: "2026-10-20T12:00:00.000Z" }],
    }),
  ]);

export const ready = (): PropertyEntry => entry(2, "Manzanita Court", "ready", [doneWalk(3)]);

export const notWalked = (): PropertyEntry => entry(3, "Oak Road Units", "not_walked");
