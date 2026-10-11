import { lazy, Suspense, useMemo, useState } from "react";

import type { Kitchen } from "../hooks/useKitchen";
import { capitalize, money, packLabel, plural, spriteForName } from "../lib/food";
import { dishesUsing, isDeal, savingPercent } from "../lib/plan";
import type { Go } from "../nav";
import { PixelEmoji } from "../pixel/PixelEmoji";
import { PixelSprite } from "../pixel/PixelSprite";
import { buildTownMap, MAP_HEIGHT, MAP_WIDTH, STORE_POSITION } from "../pixel/townMap";
import type { StoreDeals, StoreInfo, WeekPlan } from "../types";
import { AgentBubble, Button, Chip, Icon, IconButton, ScreenHeader, SectionTitle } from "../ui/kit";

// The street map library is large and only needed once a location is shared.
const RealMap = lazy(() => import("./RealMap").then((module) => ({ default: module.RealMap })));

const DEALS_SHOWN = 4;

type ShopProps = {
  kitchen: Kitchen;
  go: Go;
  onPlan: () => void;
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
      <PixelSprite sprite={map} scale={1} className="town-map" label="Sample neighborhood map" />
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

function planOffers(plan: WeekPlan): Offer[] {
  return [...plan.cart]
    .sort((a, b) => Number(isDeal(b)) - Number(isDeal(a)))
    .map((line) => {
      const users = dishesUsing(line, plan.dishes).map(shortDish);
      const pack = packLabel(line.packs, line.pack_size, line.unit, line.name);
      return {
        name: line.name,
        detail: users.length > 0 ? `${pack} · for ${users.slice(0, 2).join(" & ")}` : pack,
        price: line.cost,
        listPrice: line.list_cost,
        isInPlan: true,
      };
    });
}

function storeOffers(entry: StoreDeals): Offer[] {
  return entry.deals.map((deal) => ({
    name: deal.name,
    detail: packLabel(1, deal.pack_size, deal.unit, deal.name),
    price: deal.price,
    listPrice: deal.list_price,
    isInPlan: false,
  }));
}

function shopperLine(plan: WeekPlan | null, picked: StoreDeals, isPlanStore: boolean, isReal: boolean): string {
  const store = picked.store.name;
  if (plan && isPlanStore && plan.cart.length === 0) {
    return "Good news: your planned dinners need nothing from the store this week.";
  }
  if (plan && isPlanStore) {
    return `One stop, more savings! I matched ${plural(plan.cart.filter(isDeal).length, "deal")} at ${store} to the meals in your plan.`;
  }
  if (plan) {
    return `Your current plan shops somewhere else. Plan again and I will price your list at ${store} and the other stores here.`;
  }
  return isReal
    ? `${store} is ${picked.store.distance_mi} mi from you. Scan your fridge and I will price your list there.`
    : `${store} has ${plural(picked.deals.length, "weekly deal")}. Scan your fridge and I will match them to your meals.`;
}

export function Shop({ kitchen, go, onPlan }: ShopProps) {
  const { saved, stores, origin, inventory, shareLocation, clearLocation } = kitchen;
  const plan = saved.plan;
  const [pickedId, setPickedId] = useState<string | null>(null);
  const [isLocating, setIsLocating] = useState(false);
  const [locationProblem, setLocationProblem] = useState<string | null>(null);

  if (stores.length === 0) {
    return (
      <div className="screen">
        <ScreenHeader eyebrow="Your shopper · deal hunt" title="Good finds, close by" />
        <AgentBubble agent="bargain_hunter">No stores are loaded yet. Check that the server is running.</AgentBubble>
      </div>
    );
  }

  const planStore = stores.find((entry) => entry.store.id === plan?.store?.id);
  const picked = stores.find((entry) => entry.store.id === pickedId) ?? planStore ?? stores[0];
  const isPlanStore = plan !== null && picked.store.id === plan.store?.id;
  const isReal = origin !== null;
  const offers = (plan && isPlanStore && plan.cart.length > 0 ? planOffers(plan) : storeOffers(picked)).slice(0, DEALS_SHOWN);
  const needsReplan = plan !== null && !planStore && inventory.length > 0;

  const handleLocate = async () => {
    setIsLocating(true);
    setLocationProblem(null);
    const problem = await shareLocation();
    setIsLocating(false);
    setLocationProblem(problem);
    setPickedId(null);
  };

  const handleSamples = () => {
    setPickedId(null);
    setLocationProblem(null);
    void clearLocation();
  };

  return (
    <div className="screen">
      <ScreenHeader
        eyebrow="Your shopper · deal hunt"
        title="Good finds, close by"
        action={<IconButton icon="chat" label="Talk to the Shopper" onClick={() => go({ name: "chat", agent: "bargain_hunter" })} />}
      />
      <AgentBubble agent="bargain_hunter">{shopperLine(plan, picked, isPlanStore, isReal)}</AgentBubble>

      <div className="place">
        <span><Icon name="pin" scale={1.5} />{isReal ? picked.store.neighborhood || "Near you" : "Sample neighborhood"}</span>
        <Chip tone="paper">{isReal ? "Real stores" : "Sample stores"}</Chip>
      </div>

      {isReal ? (
        <Suspense fallback={<div className="real-map px-box" />}>
          <RealMap origin={origin} stores={stores.map((entry) => entry.store)} pickedId={picked.store.id} onPick={setPickedId} />
        </Suspense>
      ) : (
        <TownMap store={picked.store} />
      )}

      {locationProblem && <p className="scan-problem scan-problem-light" role="alert">{locationProblem}</p>}
      {isReal ? (
        <div className="locate-row">
          <Button tone="paper" size="sm" icon="pin" disabled={isLocating} onClick={handleLocate}>
            {isLocating ? "Finding you" : "Update my location"}
          </Button>
          <button type="button" className="text-link" onClick={handleSamples}>Use sample stores</button>
        </div>
      ) : (
        <Button tone="butter" icon="pin" isBlock disabled={isLocating} onClick={handleLocate}>
          {isLocating ? "Finding stores near you" : "Use my location"}
        </Button>
      )}

      <SectionTitle title={isReal ? "Stores near you" : "Stores"} aside={plural(stores.length, "store")} />
      <ul className="store-list">
        {stores.map((entry) => {
          const isPicked = entry.store.id === picked.store.id;
          return (
            <li key={entry.store.id}>
              <button type="button" className={`store-row ${isPicked ? "is-picked" : ""}`} aria-pressed={isPicked} onClick={() => setPickedId(entry.store.id)}>
                <span className="pitch-text">
                  <strong>{entry.store.name}</strong>
                  <small>{`${entry.store.distance_mi} mi · ${entry.store.walk_min} min walk`}</small>
                </span>
                {entry.store.id === plan?.store?.id && <span className="stamp stamp-ok">Your plan</span>}
              </button>
            </li>
          );
        })}
      </ul>

      <div className="store-head">
        <h2>{picked.store.name}</h2>
        <span>{isPlanStore && plan && plan.cart.length > 0 ? "Your list here" : "Weekly deals"}</span>
      </div>
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

      {needsReplan && (
        <Button size="lg" icon="next" isBlock onClick={onPlan}>Plan again with these stores</Button>
      )}
      {plan && !needsReplan && (
        <Button size="lg" icon="basket" isBlock onClick={() => go({ name: "plan" })}>
          {`View my ${money(plan.total_cost)} shopping plan`}
        </Button>
      )}
      {!plan && <Button size="lg" icon="scan" isBlock onClick={() => go({ name: "scan" })}>Scan my fridge</Button>}
      <p className="fineprint">
        {isReal
          ? "Store names and distances are real, from OpenStreetMap. Prices and deals are sample data, so check them in store."
          : "Sample stores and prices. No live deals or stock."}
      </p>
    </div>
  );
}
