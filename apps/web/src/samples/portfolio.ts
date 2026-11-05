import type { PropertyEntry } from "@emberwalk/shared";
import { OFFLINE } from "../account-api.ts";
import type { PortfolioApi } from "../portfolio-api.ts";

const PORTFOLIO = "5a000000-0000-4000-8000-000000000001";

const id = (n: number): string => `5a000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

const CREATED = "2026-09-01T17:00:00.000Z";

export const SAMPLE_HOMES: PropertyEntry[] = [
  {
    id: id(11),
    portfolioId: PORTFOLIO,
    label: "Sample: Cedar Lane Rental",
    synthetic: true,
    createdAt: CREATED,
    status: "needs_work",
    walks: [
      {
        walkId: id(21),
        walkedOn: "2026-10-24",
        createdAt: "2026-10-24T17:00:00.000Z",
        state: { name: "done" },
        synthetic: true,
        byTenant: true,
        openItems: 2,
        requiredNowOpen: 1,
        doneMarks: [{ findingId: id(31), concept: "wood_pile", doneOn: "2026-10-27", markedAt: "2026-10-27T17:00:00.000Z" }],
        open: [
          { findingId: id(32), concept: "dry_brush", requiredNow: true },
          { findingId: id(33), concept: "wooden_fence", requiredNow: false },
        ],
      },
    ],
  },
  {
    id: id(12),
    portfolioId: PORTFOLIO,
    label: "Sample: Manzanita Court",
    synthetic: true,
    createdAt: CREATED,
    status: "ready",
    walks: [
      {
        walkId: id(22),
        walkedOn: "2026-10-12",
        createdAt: "2026-10-12T17:00:00.000Z",
        state: { name: "done" },
        synthetic: true,
        byTenant: false,
        openItems: 0,
        requiredNowOpen: 0,
        doneMarks: [{ findingId: id(34), concept: "dry_grass", doneOn: "2026-10-19", markedAt: "2026-10-19T17:00:00.000Z" }],
        open: [],
      },
    ],
  },
  { id: id(13), portfolioId: PORTFOLIO, label: "Sample: Oak Road Apartments", synthetic: true, createdAt: CREATED, status: "not_walked", walks: [] },
];

const readOnly = async () => ({ code: OFFLINE });

export const samplePortfolio: PortfolioApi = {
  homes: async () => ({ value: SAMPLE_HOMES }),
  one: async (homeId) => {
    const home = SAMPLE_HOMES.find((h) => h.id === homeId);
    return home === undefined ? { code: "not_found" } : { value: home };
  },
  add: readOnly,
  invite: readOnly,
  lookup: readOnly,
  markDone: readOnly,
};
