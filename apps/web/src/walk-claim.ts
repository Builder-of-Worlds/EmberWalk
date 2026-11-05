const PENDING_KEY = "emberwalk.walkClaim";
const TENANT_WALKS_KEY = "emberwalk.tenantWalks";

export type WalkClaim = { inviteCode: string } | { propertyId: string };

const read = (key: string): unknown => {
  try {
    return JSON.parse(window.localStorage.getItem(key) ?? "null");
  } catch {
    return null;
  }
};

const write = (key: string, value: unknown): void => {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    return;
  }
};

export const holdClaim = (claim: WalkClaim): void => write(PENDING_KEY, claim);

export const pendingClaim = (): WalkClaim | null => {
  const held = read(PENDING_KEY) as Record<string, unknown> | null;
  if (typeof held?.inviteCode === "string") return { inviteCode: held.inviteCode };
  return typeof held?.propertyId === "string" ? { propertyId: held.propertyId } : null;
};

export const clearClaim = (): void => {
  try {
    window.localStorage.removeItem(PENDING_KEY);
  } catch {
    return;
  }
};

const tenantWalks = (): string[] => {
  const held = read(TENANT_WALKS_KEY);
  return Array.isArray(held) ? held.filter((id): id is string => typeof id === "string") : [];
};

export const rememberTenantWalk = (walkId: string): void => write(TENANT_WALKS_KEY, [...new Set([...tenantWalks(), walkId])]);

export const isTenantWalk = (walkId: string): boolean => tenantWalks().includes(walkId);
