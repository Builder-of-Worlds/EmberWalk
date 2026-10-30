import type { ErrorCode, WalkState, WalkStatusResponse } from "@emberwalk/shared";
import type { Answer, Failure } from "./api.ts";

export const POLL_MS = 2_000;

export const SIGNAL_RETRY_MS = 30_000;

export const HELD_RETRY_MS = 30_000;

export type WalkStatus = (walkId: string) => Promise<Answer<WalkStatusResponse>>;

export type Online = { isOnline(): boolean; onOnline(run: () => void): () => void };

export type Timer = { later(run: () => void, ms: number): () => void };

export type Watched =
  | { kind: "checking"; state: WalkState }
  | { kind: "done" }
  | { kind: "failed"; code: string | null; message: string | null }
  | { kind: "waiting" }
  | { kind: "held"; code: ErrorCode }
  | { kind: "lost" };

const ASK_AGAIN: ReadonlySet<Failure> = new Set(["server_error", "rate_limited"]);

export const watchWalk = (
  status: WalkStatus,
  walkId: string,
  clock: Timer,
  onState: (watched: Watched) => void,
  online: Online,
): (() => void) => {
  let stopped = false;
  let cancel = () => {};
  const ask = async () => {
    cancel = () => {};
    const answer = await status(walkId);
    if (stopped) return;
    const later = (ms = POLL_MS) => {
      cancel = clock.later(() => void ask(), ms);
    };
    if (answer.code === "offline") {
      onState({ kind: "waiting" });
      const again = () => {
        cancel();
        void ask();
      };
      const unlisten = online.onOnline(again);
      const untimed = online.isOnline() ? clock.later(again, SIGNAL_RETRY_MS) : () => {};
      cancel = () => {
        unlisten();
        untimed();
      };
      return;
    }
    if (answer.code !== undefined) {
      if (ASK_AGAIN.has(answer.code)) return later();
      if (answer.code === "unknown_walk") return onState({ kind: "lost" });
      onState({ kind: "held", code: answer.code });
      return later(HELD_RETRY_MS);
    }
    const { state, failure } = answer.value;
    if (state.name === "done") return onState({ kind: "done" });
    if (state.name === "failed") return onState({ kind: "failed", code: failure?.code ?? null, message: failure?.message ?? null });
    onState({ kind: "checking", state });
    later();
  };
  void ask();
  return () => {
    stopped = true;
    cancel();
  };
};
