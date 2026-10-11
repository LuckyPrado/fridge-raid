import { useMemo } from "react";

import type { Kitchen } from "../hooks/useKitchen";
import { capitalize, money, packLabel, plural, spriteForName } from "../lib/food";
import { dishesUsing, isDeal, savingPercent } from "../lib/plan";
import type { Go } from "../nav";
import { PixelEmoji } from "../pixel/PixelEmoji";
import { PixelSprite } from "../pixel/PixelSprite";
import { buildTownMap, MAP_HEIGHT, MAP_WIDTH, STORE_POSITION } from "../pixel/townMap";
import type { StoreInfo } from "../types";
import { AgentBubble, Button, Chip, Icon, ScreenHeader } from "../ui/kit";

const DEALS_SHOWN = 4;
const SEARCH_RADIUS_MI = 2;

type ShopProps = {
  kitchen: Kitchen;
  go: Go;
};

interface Offer {
  name: string;
  detail: string;
  price: number;
  listPrice: number;
  isInPlan: boolean;
}

function TownMap({ store }: { store: StoreInfo }) {
  const map = useMemo(() => buildTownMap(), []);
  const left = ((STORE_POSITION.x + STORE_POSITION.width / 2) / MAP_WIDTH) * 100;
  const top = (STORE_POSITION.y / MAP_HEIGHT) * 100;
  return (
    <div className="town px-box">
      <PixelSprite sprite={map} scale={1} className="town-map" label={`Map of ${store.neighborhood || "your area"}`} />
      <span className="town-pin" style={{ left: `${left}%`, top: `${top}%` }}>
        <Icon name="basket" scale={1} />
        {`${store.name} · ${store.distance_mi} mi`}
      </span>
      <span className="town-badge">Sample area</span>
    </div>
  );
}

function shortDish(name: string): string {
  return name.split(" ").slice(-2).join(" ").toLowerCase();
}

export function Shop({ kitchen, go }: ShopProps) {
  const { saved, stores } = kitchen;
  const plan = saved.plan;
  const store = plan?.store ?? stores[0]?.store;

  if (!store) {
    return (
      <div className="screen">
        <ScreenHeader eyebrow="Your shopper · deal hunt" title="Good finds, close by" />
        <AgentBubble agent="bargain_hunter">No stores are loaded yet. Check that the server is running.</AgentBubble>
      </div>
    );
  }

  const cart = plan?.cart ?? [];
  const planOffers: Offer[] = [...cart]
    .sort((a, b) => Number(isDeal(b)) - Number(isDeal(a)))
    .map((line) => {
      const users = dishesUsing(line, plan?.dishes ?? []).map(shortDish);
      return {
        name: line.name,
        detail: `${packLabel(line.packs, line.pack_size, line.unit, line.name)}${users.length > 0 ? ` · for ${users.slice(0, 2).join(" & ")}` : ""}`,
        price: line.cost,
        listPrice: line.list_cost,
        isInPlan: true,
      };
    });
  const storeOffers: Offer[] = (stores.find((entry) => entry.store.id === store.id)?.deals ?? []).map((deal) => ({
    name: deal.name,
    detail: packLabel(1, deal.pack_size, deal.unit, deal.name),
    price: deal.price,
    listPrice: deal.list_price,
    isInPlan: false,
  }));
  const offers = (planOffers.length > 0 ? planOffers : storeOffers).slice(0, DEALS_SHOWN);
  const dealCount = cart.filter(isDeal).length;

  let line = `${store.name} has ${plural(storeOffers.length, "weekly deal")}. Scan your fridge and I will match them to your meals.`;
  if (plan && cart.length === 0) {
    line = "Good news: your planned dinners need nothing from the store this week.";
  } else if (plan) {
    line = `One stop, more savings! I matched ${plural(dealCount, "deal")} at ${store.name} to the meals in your plan.`;
  }

  return (
    <div className="screen">
      <ScreenHeader eyebrow="Your shopper · deal hunt" title="Good finds, close by" />
      <AgentBubble agent="bargain_hunter">{line}</AgentBubble>

      <div className="place">
        <span><Icon name="pin" scale={1.5} />{store.neighborhood || "Your area"}</span>
        <Chip tone="paper">{`Within ${SEARCH_RADIUS_MI} mi`}</Chip>
      </div>
      <TownMap store={store} />

      <div className="store-head">
        <h2>{store.name}</h2>
        <span>{`${store.distance_mi} mi · ${store.walk_min} min walk`}</span>
      </div>
      <p className="fineprint">Fictional store · sample weekly offers</p>

      <ul className="offers">
        {offers.map((offer) => (
          <li key={offer.name} className="offer px-box">
            <span className="tile tile-lg"><PixelEmoji emoji={spriteForName(offer.name)} size={48} /></span>
            <span className="offer-text">
              <strong>{capitalize(offer.name)}</strong>
              <small>{offer.detail}</small>
              <span className="offer-price">
                <b>{money(offer.price)}</b>
                {offer.listPrice > offer.price && (
                  <>
                    <s>{`was ${money(offer.listPrice)}`}</s>
                    <em>{`Save ${savingPercent(offer.price, offer.listPrice)}%`}</em>
                  </>
                )}
              </span>
            </span>
            {offer.isInPlan && <span className="offer-check"><Icon name="check" scale={1.5} /></span>}
          </li>
        ))}
      </ul>

      {plan ? (
        <Button size="lg" icon="basket" isBlock onClick={() => go({ name: "plan" })}>
          {`View my ${money(plan.total_cost)} shopping plan`}
        </Button>
      ) : (
        <Button size="lg" icon="scan" isBlock onClick={() => go({ name: "scan" })}>Scan my fridge</Button>
      )}
      <p className="fineprint">Concept prices and locations. No live deals or stock. Check prices in store.</p>
    </div>
  );
}
