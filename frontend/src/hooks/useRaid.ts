import { useCallback, useEffect, useRef, useState } from "react";

import { errorMessage } from "../lib/api";
import { applyEvent, beginRaid, EVENT_PACE_MS, IDLE_RAID, type RaidState } from "../lib/raid";
import { streamRaid } from "../lib/stream";
import type { RaidRequest } from "../types";

const sleep = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));

export interface RaidControls {
  raid: RaidState;
  start: (request: RaidRequest) => Promise<void>;
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

  const start = useCallback(async (request: RaidRequest) => {
    controller.current?.abort();
    const current = new AbortController();
    controller.current = current;
    fastForward.current = false;
    setRaid(beginRaid());
    try {
      for await (const event of streamRaid(request, current.signal)) {
        if (current.signal.aborted) {
          return;
        }
        setRaid((state) => applyEvent(state, event));
        if (!fastForward.current) {
          await sleep(EVENT_PACE_MS[event.type]);
        }
      }
    } catch (error: unknown) {
      if (!current.signal.aborted) {
        setRaid((state) => applyEvent(state, { type: "error", text: errorMessage(error) }));
      }
    }
  }, []);

  const skip = useCallback(() => {
    fastForward.current = true;
  }, []);

  useEffect(() => () => controller.current?.abort(), []);

  return { raid, start, skip, reset };
}
