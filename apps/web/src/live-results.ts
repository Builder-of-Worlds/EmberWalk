import { useEffect, useState } from "react";
import { useDeps } from "./deps.ts";
import { isLiveStill } from "./live-api.ts";

export const useStill = (still: string): string | null => {
  const { stills } = useDeps();
  const live = isLiveStill(still);
  const [shown, setShown] = useState<string | null>(null);

  useEffect(() => {
    if (!live) return;
    let left = false;
    let made: string | null = null;
    setShown(null);
    void stills(still).then((blob) => {
      if (left || blob === null) return;
      made = URL.createObjectURL(blob);
      setShown(made);
    });
    return () => {
      left = true;
      if (made !== null) URL.revokeObjectURL(made);
    };
  }, [still, live, stills]);

  return live ? shown : still;
};
