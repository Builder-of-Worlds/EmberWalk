import { useStill } from "../live-results.ts";
import type { Proof } from "../results.ts";

const pct = (share: number) => `${share * 100}%`;

export const Photo = ({ proof }: { proof: Proof }) => {
  const [left, top, right, bottom] = proof.marker;
  const still = useStill(proof.still);
  return (
    <div className="proof" data-part="photo">
      {still === null ? null : <img src={still} alt="" />}
      <span className="marker" style={{ left: pct(left), top: pct(top), width: pct(right - left), height: pct(bottom - top) }} />
    </div>
  );
};
