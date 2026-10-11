import type { RaidEvent, RaidRequest } from "../types";
import { API_BASE } from "./api";

const DATA_PREFIX = "data: ";
const FRAME_SEPARATOR = "\n\n";

/** Parse one Server-Sent Events frame into a raid event, or null if it is not one. */
export function parseFrame(frame: string): RaidEvent | null {
  const line = frame.split("\n").find((entry) => entry.startsWith(DATA_PREFIX));
  if (!line) {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(line.slice(DATA_PREFIX.length));
    if (typeof parsed === "object" && parsed !== null && typeof (parsed as { type?: unknown }).type === "string") {
      return parsed as RaidEvent;
    }
    return null;
  } catch {
    return null;
  }
}

async function failureMessage(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: string };
    return body.error ?? `The raid could not start (${response.status}).`;
  } catch {
    return `The raid could not start (${response.status}).`;
  }
}

/** Start a raid and yield its events as the server streams them. */
export async function* streamRaid(body: RaidRequest, signal: AbortSignal): AsyncGenerator<RaidEvent> {
  const response = await fetch(`${API_BASE}/api/raid`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  if (!response.ok || !response.body) {
    throw new Error(await failureMessage(response));
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");
    const frames = buffer.split(FRAME_SEPARATOR);
    buffer = frames.pop() ?? "";
    for (const frame of frames) {
      const event = parseFrame(frame);
      if (event) {
        yield event;
      }
    }
  }
}
