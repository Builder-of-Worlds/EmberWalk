export type FeetSaid =
  | { kind: "against" }
  | { kind: "within"; high: number }
  | { kind: "about"; feet: number }
  | { kind: "range"; low: number; high: number };

export const feetSaid = ({ low, high }: { low: number; high: number }): FeetSaid => {
  if (!(Number.isFinite(low) && Number.isFinite(high) && low >= 0 && low <= high)) throw new RangeError(`a distance must run from 0 or more up to its far edge: ${low} to ${high}`);
  const near = Math.floor(low);
  const far = Math.ceil(high);
  if (far === 0) return { kind: "against" };
  if (near === 0) return { kind: "within", high: far };
  return near === far ? { kind: "about", feet: near } : { kind: "range", low: near, high: far };
};
