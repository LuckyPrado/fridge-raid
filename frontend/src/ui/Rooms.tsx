import { AGENT_NAMES, AGENT_SPRITES, PROPS, SPRITE_OUTLINE } from "../pixel/art";
import { PixelEmoji } from "../pixel/PixelEmoji";
import { PixelSprite } from "../pixel/PixelSprite";
import type { AgentId } from "../types";

const ROOM_SIGNS: Record<AgentId, string> = {
  nutritionist: "Gym",
  chef: "Kitchen",
  bargain_hunter: "Market",
};

const KITCHEN_SHELF = ["🧄", "🍅", "🧅"] as const;
const MARKET_TOP_SHELF = ["🍎", "🥕", "🥦", "🍋", "🍞"] as const;
const MARKET_LOW_SHELF = ["🧀", "🥚", "🍌", "🥫", "🍇"] as const;

function Gym() {
  return (
    <>
      <span className="gym-window" />
      <span className="gym-poster">Go!</span>
      <span className="gym-rack">
        <PixelSprite sprite={PROPS.dumbbell} scale={3} />
        <PixelSprite sprite={PROPS.dumbbell} scale={3} />
      </span>
      <span className="gym-mat" />
      <PixelSprite sprite={PROPS.dumbbell} scale={3} className="gym-held" />
    </>
  );
}

function Kitchen() {
  return (
    <>
      <span className="kit-window" />
      <span className="kit-shelf">
        {KITCHEN_SHELF.map((food) => (
          <PixelEmoji key={food} emoji={food} size={24} />
        ))}
      </span>
      <span className="kit-fridge"><i /><i /></span>
      <span className="kit-counter" />
      <PixelSprite sprite={PROPS.pot} scale={3} className="kit-pot" />
      <PixelSprite sprite={PROPS.plant} scale={3} className="kit-plant" />
    </>
  );
}

function Market() {
  return (
    <>
      <span className="market-awning" />
      <span className="market-shelf market-shelf-top">
        {MARKET_TOP_SHELF.map((food) => (
          <PixelEmoji key={food} emoji={food} size={24} />
        ))}
      </span>
      <span className="market-shelf market-shelf-low">
        {MARKET_LOW_SHELF.map((food) => (
          <PixelEmoji key={food} emoji={food} size={24} />
        ))}
      </span>
      <PixelSprite sprite={PROPS.cart} scale={3} className="market-cart" />
    </>
  );
}

type RoomProps = {
  agent: AgentId;
  onOpen?: () => void;
};

/** One agent at home: the Nutritionist in the gym, the Chef in the kitchen, the Shopper in the market. */
export function Room({ agent, onOpen }: RoomProps) {
  const scene = (
    <>
      {agent === "nutritionist" && <Gym />}
      {agent === "chef" && <Kitchen />}
      {agent === "bargain_hunter" && <Market />}
      <span className="room-floor" />
      <PixelSprite sprite={AGENT_SPRITES[agent]} scale={4} outline={SPRITE_OUTLINE} className="room-agent" />
      <span className="room-sign">{ROOM_SIGNS[agent]}</span>
    </>
  );
  if (!onOpen) {
    return <div className={`room room-${agent}`} aria-hidden="true">{scene}</div>;
  }
  return (
    <button type="button" className={`room room-${agent}`} aria-label={`Visit the ${AGENT_NAMES[agent]}`} onClick={onOpen}>
      {scene}
    </button>
  );
}

type TowerProps = {
  onOpen?: (agent: AgentId) => void;
};

/** The party's house, three floors tall: gym on top, kitchen in the middle, market on the ground floor. */
export function Tower({ onOpen }: TowerProps) {
  const floors: readonly AgentId[] = ["nutritionist", "chef", "bargain_hunter"];
  return (
    <div className="tower">
      {floors.map((agent) => (
        <Room key={agent} agent={agent} onOpen={onOpen ? () => onOpen(agent) : undefined} />
      ))}
    </div>
  );
}
