import { useEffect, useState } from "react";
import { useDeps } from "./deps.ts";
import { isLiveStill } from "./live-api.ts";

export const useLoadedStill = (still: string): { shown: string | null; failed: boolean } => {
  const { stills } = useDeps();
  const live = isLiveStill(still);
  const [shown, setShown] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!live) return;
    let left = false;
    let made: string | null = null;
    setShown(null);
    setFailed(false);
    void stills(still).then((blob) => {
      if (left) return;
      if (blob === null) return setFailed(true);
      made = URL.createObjectURL(blob);
      setShown(made);
    });
    return () => {
      left = true;
      if (made !== null) URL.revokeObjectURL(made);
    };
  }, [still, live, stills]);

  return live ? { shown, failed } : { shown: still, failed: false };
};

export const useStill = (still: string): string | null => useLoadedStill(still).shown;
