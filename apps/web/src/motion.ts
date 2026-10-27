export type Bearing = { headingDegrees: number; tiltDegrees: number };

export type MotionEnv = {
  requestPermission: (() => Promise<string>) | undefined;
  listen(onBearing: (bearing: Bearing) => void): () => void;
};

export type Motion = { listen: MotionEnv["listen"] } | null;

export const CORNERS = 4;

type Orientation = { alpha: number | null; beta: number | null; webkitCompassHeading?: number };

export const bearingFrom = (event: Orientation): Bearing | null => {
  const heading = event.webkitCompassHeading ?? (event.alpha === null ? null : 360 - event.alpha);
  if (heading === null || !Number.isFinite(heading)) return null;
  const beta = event.beta;
  if (beta === null || !(beta >= -180 && beta <= 180)) return null;
  const below = 90 - beta;
  return {
    headingDegrees: ((heading % 360) + 360) % 360,
    tiltDegrees: below > 180 ? below - 360 : below,
  };
};

export const askMotion = async (env: MotionEnv | null): Promise<Motion> => {
  if (env === null) return null;
  if (env.requestPermission === undefined) return { listen: env.listen };
  try {
    return (await env.requestPermission()) === "granted" ? { listen: env.listen } : null;
  } catch {
    return null;
  }
};

export const turnBetween = (from: number, to: number): number => {
  const step = (((to - from) % 360) + 540) % 360 - 180;
  return step === -180 ? 180 : step;
};

export const cornersFor = (netTurnDegrees: number): number =>
  Math.min(CORNERS, Math.floor(Math.abs(netTurnDegrees) / (360 / CORNERS)));

type OrientationWindow = Pick<Window, "addEventListener" | "removeEventListener"> & {
  DeviceOrientationEvent?: unknown;
};

export const browserMotion = (win: OrientationWindow): MotionEnv | null => {
  const Orientation = win.DeviceOrientationEvent as { requestPermission?: () => Promise<string> } | undefined;
  if (Orientation === undefined) return null;
  return {
    requestPermission: Orientation.requestPermission?.bind(Orientation),
    listen: (onBearing) => {
      const handle = (event: Event) => {
        const bearing = bearingFrom(event as unknown as Orientation);
        if (bearing !== null) onBearing(bearing);
      };
      win.addEventListener("deviceorientation", handle);
      return () => win.removeEventListener("deviceorientation", handle);
    },
  };
};
