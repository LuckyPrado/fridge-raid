import { AnimatePresence, motion } from "framer-motion";

import type { AgentId } from "../../types";

interface Member {
  id: AgentId;
  name: string;
  sprite: string;
  idle: string;
}

const MEMBERS: readonly Member[] = [
  { id: "chef", name: "Chef", sprite: "🧑‍🍳", idle: "Show me what is dying in there." },
  { id: "nutritionist", name: "Nutritionist", sprite: "🧑‍⚕️", idle: "I will be checking the numbers." },
  { id: "bargain_hunter", name: "Bargain Hunter", sprite: "🕵️", idle: "We buy only what we must." },
];

interface PartyProps {
  bubbles: Partial<Record<AgentId, string>>;
  speaker: AgentId | null;
  isRaiding: boolean;
}

export function Party({ bubbles, speaker, isRaiding }: PartyProps) {
  return (
    <ul className="party" aria-label="Your party">
      {MEMBERS.map((member) => {
        const line = bubbles[member.id] ?? member.idle;
        const isSpeaking = speaker === member.id;
        const isWaiting = isRaiding && speaker !== null && !isSpeaking;
        return (
          <li
            key={member.id}
            className={`member member--${member.id}${isSpeaking ? " member--speaking" : ""}${isWaiting ? " member--waiting" : ""}`}
          >
            <motion.span
              className="member__sprite"
              aria-hidden="true"
              animate={isSpeaking ? { y: [0, -8, 0] } : { y: 0 }}
              transition={{ duration: 0.4 }}
            >
              {member.sprite}
            </motion.span>
            <div className="member__body">
              <p className="member__name">{member.name}</p>
              <AnimatePresence mode="wait" initial={false}>
                <motion.p
                  key={line}
                  className="member__bubble"
                  aria-live={isSpeaking ? "polite" : "off"}
                  initial={{ opacity: 0, scale: 0.94, y: 6 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.18 }}
                >
                  {line}
                </motion.p>
              </AnimatePresence>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
