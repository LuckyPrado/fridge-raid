import { useEffect, useState } from "react";

import type { RaidControls } from "../hooks/useRaid";
import { money, plural } from "../lib/food";
import { filledSegments } from "../lib/plan";
import { waitingOn, type DishEntry, type RaidState } from "../lib/raid";
import type { Go } from "../nav";
import { AGENT_NAMES } from "../pixel/art";
import type { AgentId } from "../types";
import { AgentBubble, Button, IconButton, SectionTitle, SegBar } from "../ui/kit";

const AGENTS: readonly AgentId[] = ["chef", "nutritionist", "bargain_hunter"];
const RESCUE_SEGMENTS = 10;

const WORKING_LINES: Record<AgentId, string> = {
  chef: "Chef is dreaming up recipes",
  nutritionist: "Nutritionist is checking each dish",
  bargain_hunter: "Shopper is pricing your list at nearby stores",
};

/** Seconds since the planning started, ticking while it runs. */
function useElapsedSeconds(isRunning: boolean): number {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    if (!isRunning) {
      return;
    }
    setSeconds(0);
    const timer = window.setInterval(() => setSeconds((value) => value + 1), 1000);
    return () => window.clearInterval(timer);
  }, [isRunning]);
  return seconds;
}

const WAITING_LINES: Record<AgentId, string> = {
  chef: "Reading the stash for food to use first.",
  nutritionist: "Standing by to check every dish against your goals.",
  bargain_hunter: "Comparing prices at nearby stores.",
};

type HuddleProps = {
  raid: RaidControls;
  go: Go;
  onRetry: () => void;
};

function stampOf(entry: DishEntry, state: RaidState): { text: string; tone: string } {
  if (!entry.verdict) {
    return { text: "Checking", tone: "wait" };
  }
  if (entry.verdict.veto) {
    return { text: "Vetoed", tone: "veto" };
  }
  if (state.plan) {
    const isChosen = state.plan.dishes.some((dish) => dish.id === entry.dish.id);
    return isChosen ? { text: "In the plan", tone: "ok" } : { text: "Benched", tone: "wait" };
  }
  return { text: "Approved", tone: "ok" };
}

export function Huddle({ raid, go, onRetry }: HuddleProps) {
  const state = raid.raid;
  const saved = state.bossMax - state.bossHp;
  const isSettled = state.phase === "settled";
  const isFailed = state.phase === "failed";
  const planned = state.plan?.dishes.length ?? 0;
  const isRunning = !isSettled && !isFailed;
  const isLive = state.party === "gemini";
  const waiting = waitingOn(state);
  const active = state.speaker ?? waiting;
  const elapsed = useElapsedSeconds(isRunning);
  const title = isSettled ? "The plan is ready" : isFailed ? "The huddle broke up" : "Your party is on it";

  return (
    <div className="screen has-cta huddle">
      <header className="screen-header">
        <IconButton icon="back" label="Back to your fridge" tone="plain" onClick={() => go({ name: "fridge" })} />
        <div className="screen-header-text">
          <p className="eyebrow">{state.party === "gemini" ? "Party huddle · live Gemini" : "Party huddle · demo agents"}</p>
          <h1>{title}</h1>
        </div>
      </header>

      {isRunning && (
        <section className="working px-box" role="status">
          <span className="working-dots" aria-hidden="true"><i /><i /><i /></span>
          <div>
            <strong>{`${WORKING_LINES[waiting ?? "chef"]} · ${elapsed}s`}</strong>
            <small>
              {isLive
                ? "Live Gemini agents can take up to a minute. Skip below for an instant plan."
                : "Almost there."}
            </small>
          </div>
        </section>
      )}

      <section className="rescue px-box px-peach">
        <div className="rescue-head">
          <p>Food about to spoil</p>
          <strong>{`${money(saved)} of ${money(state.bossMax)} saved`}</strong>
        </div>
        <SegBar
          tone="carrot"
          filled={filledSegments(saved, state.bossMax, RESCUE_SEGMENTS)}
          total={RESCUE_SEGMENTS}
          label={`${money(saved)} of ${money(state.bossMax)} of expiring food saved`}
        />
      </section>

      <div className="huddle-party" aria-live="polite">
        {AGENTS.map((agent) => (
          <AgentBubble key={agent} agent={agent} isSpeaking={isRunning && active === agent}>
            {state.bubbles[agent] ?? WAITING_LINES[agent]}
            {isRunning && waiting === agent && state.speaker === null && <span className="typing" aria-hidden="true"> ...</span>}
          </AgentBubble>
        ))}
      </div>

      {state.quotes.length > 0 && (
        <>
          <SectionTitle title="Store check" aside="same list, every store" />
          <ul className="quotes">
            {state.quotes.map((quote) => (
              <li key={quote.name} className={quote.chosen ? "quote is-chosen" : "quote"}>
                <span className="pitch-text">
                  <strong>{quote.name}</strong>
                  <small>{`${quote.distance_mi} mi away · ${plural(quote.meals, "meal")}`}</small>
                </span>
                <b>{money(quote.total)}</b>
                {quote.chosen && <span className="stamp stamp-ok">Best</span>}
              </li>
            ))}
          </ul>
        </>
      )}

      {state.notes.map((note) => (
        <p className="fineprint" key={note}>{note}</p>
      ))}
      {isFailed && <p className="scan-problem scan-problem-light" role="alert">{state.error}</p>}

      {state.dishes.length > 0 && (
        <>
          <SectionTitle title="On the table" aside={plural(state.dishes.length, "pitch")} />
          <ul className="pitches">
            {state.dishes.map((entry) => {
              const stamp = stampOf(entry, state);
              return (
                <li key={entry.dish.id} className={`pitch pitch-${stamp.tone}`}>
                  <span className="pitch-text">
                    <strong>{entry.dish.name}</strong>
                    <small>
                      {entry.round > 1 ? `Take ${entry.round} · ` : ""}
                      {entry.verdict ? `${AGENT_NAMES.nutritionist} score ${entry.verdict.score}` : "Waiting for a verdict"}
                      {entry.cost ? ` · +${money(entry.cost)}` : ""}
                    </small>
                  </span>
                  <span className={`stamp stamp-${stamp.tone}`}>{stamp.text}</span>
                </li>
              );
            })}
          </ul>
        </>
      )}

      <div className="cta-bar">
        {isSettled && (
          <Button size="lg" icon="next" isBlock onClick={() => go({ name: "chef" })}>
            {planned > 0 ? `See my ${plural(planned, "recipe")}` : "See what the Chef says"}
          </Button>
        )}
        {isFailed && <Button size="lg" isBlock onClick={onRetry}>Try the huddle again</Button>}
        {isRunning && (
          <Button size="lg" tone="paper" isBlock onClick={raid.skip}>
            {isLive && !state.plan ? "Skip · make a quick plan now" : "Skip to the plan"}
          </Button>
        )}
      </div>
    </div>
  );
}
