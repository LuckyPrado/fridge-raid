import { useCallback, useEffect, useRef, useState } from "react";

import { errorMessage } from "../lib/api";
import { applyEvent, beginRaid, EVENT_PACE_MS, IDLE_RAID, type RaidState } from "../lib/raid";
import { streamRaid } from "../lib/stream";
import type { RaidRequest } from "../types";

const LOST_CONNECTION = "The connection dropped before the plan was ready. Try again.";

const sleep = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));

export interface RaidControls {
  raid: RaidState;
  start: (request: RaidRequest) => Promise<void>;
  /** Jump to the result. If the live agents have not finished, the quick rule-based agents plan instead. */
  skip: () => void;
  reset: () => void;
}

/** Runs a raid: streams events from the server and plays them back at a readable pace. */
export function useRaid(): RaidControls {
  const [raid, setRaid] = useState<RaidState>(IDLE_RAID);
  const fastForward = useRef(false);
  const controller = useRef<AbortController | null>(null);

  const reset = useCallback(() => {
    controller.current?.abort();
    controller.current = null;
    setRaid(IDLE_RAID);
  }, []);

  const lastRequest = useRef<RaidRequest | null>(null);
  const hasPlan = useRef(false);

  const run = useCallback(async (request: RaidRequest, isFast: boolean) => {
    controller.current?.abort();
    const current = new AbortController();
    controller.current = current;
    fastForward.current = isFast;
    lastRequest.current = request;
    hasPlan.current = false;
    setRaid(beginRaid());
    try {
      for await (const event of streamRaid(request, current.signal)) {
        if (current.signal.aborted) {
          return;
        }
        hasPlan.current = hasPlan.current || event.type === "plan";
        setRaid((state) => applyEvent(state, event));
        if (!fastForward.current) {
          await sleep(EVENT_PACE_MS[event.type]);
        }
      }
      if (!current.signal.aborted) {
        // A stream that ends without a result, such as a dropped connection, must not leave the screen waiting.
        setRaid((state) =>
          state.phase === "raiding" ? applyEvent(state, { type: "error", text: LOST_CONNECTION }) : state,
        );
      }
    } catch (error: unknown) {
      if (!current.signal.aborted) {
        setRaid((state) => applyEvent(state, { type: "error", text: errorMessage(error) }));
      }
    }
  }, []);

  const start = useCallback((request: RaidRequest) => run(request, false), [run]);

  const skip = useCallback(() => {
    fastForward.current = true;
    const request = lastRequest.current;
    // Fast-forwarding cannot hurry a live model. Hand the plan to the instant rule-based agents instead.
    if (request && !request.offline && !hasPlan.current) {
      void run({ ...request, offline: true }, true);
    }
  }, [run]);

  useEffect(() => () => controller.current?.abort(), []);

  return { raid, start, skip, reset };
}
