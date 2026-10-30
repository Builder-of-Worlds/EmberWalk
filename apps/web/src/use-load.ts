import { useEffect, useState } from "react";
import type { FixedAnswer, FixedFailure } from "./fixed-api.ts";

export type Loaded<T> = { state: "loading" } | { state: "ready"; value: T } | { state: "failed"; code: FixedFailure; message: string };

export const useLoad = <T>(load: () => Promise<FixedAnswer<T>>, key: string) => {
  const [loaded, setLoaded] = useState<Loaded<T>>({ state: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let live = true;
    setLoaded({ state: "loading" });
    void load().then((answer) => {
      if (live) setLoaded(answer.code === undefined ? { state: "ready", value: answer.value } : { state: "failed", code: answer.code, message: answer.message });
    });
    return () => {
      live = false;
    };
  }, [key, attempt]);

  return { loaded, retry: () => setAttempt((n) => n + 1), set: (value: T) => setLoaded({ state: "ready", value }) };
};

export const useAction = () => {
  const [busy, setBusy] = useState(false);
  const [code, setCode] = useState<FixedFailure | null>(null);
  const run = async <T>(call: () => Promise<FixedAnswer<T>>): Promise<T | null> => {
    setBusy(true);
    setCode(null);
    const answer = await call();
    setBusy(false);
    if (answer.code === undefined) return answer.value;
    setCode(answer.code);
    return null;
  };
  return { busy, code, run };
};
