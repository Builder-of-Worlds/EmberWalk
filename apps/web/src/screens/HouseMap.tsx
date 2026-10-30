import type { Band } from "@emberwalk/shared";
import { copy, unbacked } from "../copy.ts";
import { feetSaid } from "../distance.ts";
import type { Pin, ResultFinding } from "../results.ts";
import { findingFor } from "../router.ts";
import { HOUSE_FAR, HOUSE_NEAR, HouseShape } from "./HouseShape.tsx";

const RINGS: [Band, number][] = [
  ["zone_2", 44],
  ["zone_1", 26],
  ["zone_0", 6],
];

const SPAN = HOUSE_FAR - HOUSE_NEAR;

export const outward = (feet: number): number => {
  if (feet <= 5) return (feet / 5) * 6;
  if (feet <= 30) return 6 + ((feet - 5) / 25) * 20;
  return 26 + ((Math.min(feet, 100) - 30) / 70) * 18;
};

export const pinAt = ({ side, position, feet }: Pin): [x: number, y: number] => {
  const out = outward(feet);
  const along = position * SPAN;
  if (side === "front") return [HOUSE_FAR - along, HOUSE_FAR + out];
  if (side === "left") return [HOUSE_NEAR - out, HOUSE_FAR - along];
  if (side === "back") return [HOUSE_NEAR + along, HOUSE_NEAR - out];
  return [HOUSE_FAR + out, HOUSE_NEAR + along];
};

export const PIN_APART = 17;

const ALONG: Record<Pin["side"], [x: number, y: number]> = { front: [-1, 0], left: [0, -1], back: [1, 0], right: [0, 1] };
const AWAY: Record<Pin["side"], [x: number, y: number]> = { front: [0, 1], left: [-1, 0], back: [0, -1], right: [1, 0] };
const OUT_MOST = outward(100);
const ROW_WEIGHT = 5;
const CLOSER = [12, 8, 5, 3, 2];
const SAME = 1e-9;

type Move = [along: number, row: number];

const byNearest = (a: Move, b: Move) => Math.hypot(a[0], ROW_WEIGHT * a[1]) - Math.hypot(b[0], ROW_WEIGHT * b[1]) || b[0] - a[0] || b[1] - a[1];

const gridMoves = new Map<number, Move[]>();

const movesFor = (apart: number): Move[] => {
  const known = gridMoves.get(apart);
  if (known !== undefined) return known;
  const steps = Math.ceil(SPAN / (apart / 2));
  const rows = Math.ceil(OUT_MOST / apart);
  const moves: Move[] = [];
  for (let k = -steps; k <= steps; k++) {
    for (let j = -rows; j <= rows; j++) moves.push([(k * apart) / 2, j * apart]);
  }
  moves.sort(byNearest);
  gridMoves.set(apart, moves);
  return moves;
};

const floorMoves = (apart: number, to: number): Move[] => {
  const rows = Math.ceil(OUT_MOST / apart);
  const moves: Move[] = [];
  for (let j = -rows; j <= rows; j++) moves.push([to, j * apart]);
  return moves.sort(byNearest);
};

type Spot = [x: number, y: number];

export const spread = (pins: readonly Pin[]): Spot[] => {
  const lying = pins.map((_, i) => i).sort((a, b) => pins[a]!.position - pins[b]!.position || a - b);
  const spots = new Map<number, Spot>();
  const reached: { pin: Pin; along: number }[] = [];
  for (const i of lying) {
    const pin = pins[i]!;
    const origin = pinAt(pin);
    const [ax, ay] = ALONG[pin.side];
    const [nx, ny] = AWAY[pin.side];
    const along = pin.position * SPAN;
    const out = outward(pin.feet);
    const floor = Math.max(0, ...reached.filter((r) => r.pin.side === pin.side && r.pin.position < pin.position).map((r) => r.along));
    const others = [...spots.values()];
    const nearest = ([px, py]: Spot) => Math.min(Infinity, ...others.map(([ox, oy]) => Math.hypot(ox - px, oy - py)));
    const allowed = (moves: Move[]) =>
      moves.flatMap(([a, r]) => {
        const alongTo = along + a;
        const outTo = out + r;
        if (alongTo < floor - SAME || alongTo > SPAN || outTo < 0 || outTo > OUT_MOST) return [];
        const spot: Spot = [origin[0] + ax * a + nx * r, origin[1] + ay * a + ny * r];
        return [{ spot, alongTo }];
      });
    let chosen: { spot: Spot; alongTo: number } | null = null;
    let widest: { spot: Spot; alongTo: number; room: number } | null = null;
    for (const apart of [PIN_APART, ...CLOSER]) {
      const tries = [...allowed(movesFor(apart)), ...allowed(floorMoves(apart, floor - along))];
      chosen = tries.find((t) => nearest(t.spot) >= apart) ?? null;
      if (chosen !== null) break;
      for (const t of tries) {
        const room = nearest(t.spot);
        if (widest === null || room > widest.room) widest = { ...t, room };
      }
    }
    const placed = chosen ?? widest!;
    spots.set(i, placed.spot);
    reached.push({ pin, along: placed.alongTo });
  }
  return pins.map((_, i) => spots.get(i)!);
};

export const numbering = (findings: readonly ResultFinding[], pins: readonly Pin[]): Map<string, number> => {
  const numbers = new Map<string, number>();
  for (const finding of findings) {
    if (pins.some((p) => p.findingId === finding.id)) numbers.set(finding.id, numbers.size + 1);
  }
  return numbers;
};

type Props = { findings: ResultFinding[]; pins: readonly Pin[]; resultsId: string };

export const HouseMap = ({ findings, pins, resultsId }: Props) => {
  const numbers = numbering(findings, pins);
  const placed = findings.flatMap((finding) => {
    const pin = pins.find((p) => p.findingId === finding.id);
    return pin === undefined ? [] : [{ pin, finding, n: numbers.get(finding.id) }];
  });
  const spots = spread(placed.map(({ pin }) => pin));
  return (
    <figure className="house-map" data-pins={placed.length}>
      <svg viewBox="-43 -43 186 186">
        {RINGS.map(([band, r]) => (
          <rect key={band} className={`ring ${band}`} x={HOUSE_NEAR - r} y={HOUSE_NEAR - r} width={SPAN + 2 * r} height={SPAN + 2 * r} rx={r} />
        ))}
        <HouseShape />
        {placed.map(({ pin, finding, n }, i) => {
          const [x, y] = spots[i]!;
          return (
            <a
              key={finding.id}
              className="pin"
              href={findingFor(resultsId, finding.id)}
              data-finding={finding.id}
              data-side={pin.side}
              aria-label={`${n}. ${unbacked.pin.side(pin.side)} ${copy.results.distance(feetSaid(finding.distanceFeet))}`}
            >
              <circle className="hit" cx={x} cy={y} r="11" />
              <circle className="dot" cx={x} cy={y} r="8" />
              <text x={x} y={y}>
                {n}
              </text>
            </a>
          );
        })}
      </svg>
    </figure>
  );
};
