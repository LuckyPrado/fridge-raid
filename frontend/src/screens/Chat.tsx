import { useEffect, useRef, useState, type Dispatch, type FormEvent, type SetStateAction } from "react";

import type { Kitchen } from "../hooks/useKitchen";
import type { Go } from "../nav";
import { AGENT_NAMES, AGENT_SPRITES, SPRITE_OUTLINE } from "../pixel/art";
import { PixelSprite } from "../pixel/PixelSprite";
import type { AgentId, ChatMessage } from "../types";
import { AgentBubble, Button, Chip, ScreenHeader } from "../ui/kit";

const AGENTS: readonly AgentId[] = ["chef", "nutritionist", "bargain_hunter"];
const MAX_MESSAGE_CHARS = 400;

const OPENERS: Record<AgentId, string> = {
  chef: "Tell me what you love and what you will not eat. I cook around both.",
  nutritionist: "Tell me your goals: calories, protein, or how strict I should be per meal.",
  bargain_hunter: "Tell me your weekly budget and I will make every dollar work.",
};

const SUGGESTIONS: Record<AgentId, readonly string[]> = {
  chef: ["I love tacos and pasta", "I don't eat mushrooms", "I'm vegetarian now", "Plan 3 dinners"],
  nutritionist: ["I want 120 g of protein a day", "Set my day to 2200 calories", "Keep meals under 600 calories"],
  bargain_hunter: ["Make my budget $40", "Cut my budget to $15", "What is my budget right now?"],
};

type ChatProps = {
  kitchen: Kitchen;
  go: Go;
  agent?: AgentId;
  messages: ChatMessage[];
  onMessages: Dispatch<SetStateAction<ChatMessage[]>>;
  onPlan: () => void;
};

export function Chat({ kitchen, go, agent: startAgent, messages, onMessages, onPlan }: ChatProps) {
  const [agent, setAgent] = useState<AgentId>(startAgent ?? "chef");
  const [text, setText] = useState("");
  const [isSending, setIsSending] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  const hasChanges = messages.some((message) => message.changes.length > 0);

  useEffect(() => {
    end.current?.scrollIntoView({ block: "end" });
  }, [messages.length, isSending]);

  const send = async (message: string) => {
    const clean = message.trim().slice(0, MAX_MESSAGE_CHARS);
    if (!clean || isSending) {
      return;
    }
    setText("");
    setIsSending(true);
    onMessages((current) => [...current, { id: Date.now(), from: "you", text: clean, changes: [] }]);
    const reply = await kitchen.chat(agent, clean);
    setIsSending(false);
    if (reply) {
      onMessages((current) => [...current, { id: Date.now() + 1, from: reply.agent, text: reply.reply, changes: reply.changes }]);
    }
  };

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    void send(text);
  };

  return (
    <div className="screen has-cta chat">
      <ScreenHeader eyebrow="Your party · preferences" title="Tell us what you like" onBack={() => go({ name: "home" })} />

      <div className="agent-picker" role="group" aria-label="Who to talk to">
        {AGENTS.map((entry) => (
          <button
            type="button"
            key={entry}
            className={`agent-pick agent-pick-${entry} ${entry === agent ? "is-picked" : ""}`}
            aria-pressed={entry === agent}
            onClick={() => setAgent(entry)}
          >
            <PixelSprite sprite={AGENT_SPRITES[entry]} scale={2} outline={SPRITE_OUTLINE} />
            {AGENT_NAMES[entry]}
          </button>
        ))}
      </div>

      <div className="chat-log" aria-live="polite">
        <AgentBubble agent={agent}>{OPENERS[agent]}</AgentBubble>
        {messages.map((message) =>
          message.from === "you" ? (
            <p key={message.id} className="chat-you px-box">{message.text}</p>
          ) : (
            <div key={message.id} className="chat-reply">
              <AgentBubble agent={message.from}>{message.text}</AgentBubble>
              {message.changes.length > 0 && (
                <div className="chip-row">
                  {message.changes.map((change) => (
                    <Chip key={change} tone="butter">{change}</Chip>
                  ))}
                </div>
              )}
            </div>
          ),
        )}
        {isSending && (
          <AgentBubble agent={agent} isSpeaking>
            <span className="typing">...</span>
          </AgentBubble>
        )}
        <div ref={end} />
      </div>

      {!isSending && (
        <div className="chip-row" role="group" aria-label="Things you can say">
          {SUGGESTIONS[agent].map((suggestion) => (
            <button type="button" key={suggestion} className="chip chip-paper chip-button" onClick={() => void send(suggestion)}>
              {suggestion}
            </button>
          ))}
        </div>
      )}

      {hasChanges && kitchen.inventory.length > 0 && (
        <Button tone="butter" icon="next" isBlock onClick={onPlan}>Plan again with my new preferences</Button>
      )}
      <p className="fineprint">Your party saves what you tell it. You can also edit everything by hand in Goals.</p>

      <form className="cta-bar chat-form" onSubmit={handleSubmit}>
        <label className="visually-hidden" htmlFor="chat-input">{`Message to the ${AGENT_NAMES[agent]}`}</label>
        <input
          id="chat-input"
          value={text}
          maxLength={MAX_MESSAGE_CHARS}
          placeholder={`Message the ${AGENT_NAMES[agent]}`}
          autoComplete="off"
          enterKeyHint="send"
          onChange={(event) => setText(event.target.value)}
        />
        <Button type="submit" disabled={isSending || text.trim().length === 0}>Send</Button>
      </form>
    </div>
  );
}
