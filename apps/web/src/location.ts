export const JURISDICTIONS = ["ca", "ca_sra", "ca_vhfhsz"] as const;

export type Jurisdiction = (typeof JURISDICTIONS)[number];

export const isJurisdiction = (value: unknown): value is Jurisdiction =>
  typeof value === "string" && (JURISDICTIONS as readonly string[]).includes(value);

export type Spot = { latitude: number; longitude: number };

export type LocationRefusal = "denied" | "unavailable" | "unsupported";

export type Locate = () => Promise<Spot | { refusal: LocationRefusal }>;

export const LOCATE_TIMEOUT_MS = 15_000;

const PERMISSION_DENIED = 1;

export const browserLocate =
  (geolocation: Pick<Geolocation, "getCurrentPosition"> | undefined): Locate =>
  () =>
    new Promise((resolve) => {
      if (geolocation === undefined) return resolve({ refusal: "unsupported" });
      geolocation.getCurrentPosition(
        (position) => resolve({ latitude: position.coords.latitude, longitude: position.coords.longitude }),
        (error) => resolve({ refusal: error.code === PERMISSION_DENIED ? "denied" : "unavailable" }),
        { enableHighAccuracy: false, timeout: LOCATE_TIMEOUT_MS, maximumAge: 600_000 },
      );
    });

export const CALIFORNIA: readonly (readonly [number, number])[] = [
  [-124.4, 42.0],
  [-120.0, 42.0],
  [-120.0, 39.0],
  [-114.63, 35.0],
  [-114.13, 34.27],
  [-114.43, 34.08],
  [-114.72, 32.72],
  [-117.12, 32.53],
  [-117.5, 32.5],
  [-119.0, 32.8],
  [-120.7, 33.8],
  [-121.0, 34.5],
  [-122.2, 36.3],
  [-123.2, 37.6],
  [-124.0, 39.5],
  [-124.6, 40.3],
];

export const inside = (spot: Spot, polygon: readonly (readonly [number, number])[]): boolean => {
  let crossings = 0;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const [xi, yi] = polygon[i] as readonly [number, number];
    const [xj, yj] = polygon[j] as readonly [number, number];
    if (yi > spot.latitude !== yj > spot.latitude) {
      const x = xj + ((spot.latitude - yj) * (xi - xj)) / (yi - yj);
      if (spot.longitude < x) crossings += 1;
    }
  }
  return crossings % 2 === 1;
};

export const jurisdictionFor = (spot: Spot): Jurisdiction | null => (inside(spot, CALIFORNIA) ? "ca" : null);
