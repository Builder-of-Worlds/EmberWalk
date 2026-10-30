export const HOUSE_NEAR = 12;
export const HOUSE_FAR = 88;

export const HOUSE_CORNERS = [
  [HOUSE_NEAR, HOUSE_NEAR],
  [HOUSE_FAR, HOUSE_NEAR],
  [HOUSE_FAR, HOUSE_FAR],
  [HOUSE_NEAR, HOUSE_FAR],
] as const;

export const HouseShape = () => <rect className="house" x={HOUSE_NEAR} y={HOUSE_NEAR} width={HOUSE_FAR - HOUSE_NEAR} height={HOUSE_FAR - HOUSE_NEAR} />;
