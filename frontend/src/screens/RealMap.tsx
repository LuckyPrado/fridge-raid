import { useEffect, useRef } from "react";

import L from "leaflet";
import "leaflet/dist/leaflet.css";

import type { Origin, StoreInfo } from "../types";

const TILE_URL = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a>';
// Each map tile is drawn at twice its size with hard edges, which turns a normal street map into chunky pixels.
const PIXEL_TILE_SIZE = 512;
const PIXEL_ZOOM_OFFSET = -1;
const MAX_ZOOM = 17;
const FIT_PADDING = 36;

type RealMapProps = {
  origin: Origin;
  stores: readonly StoreInfo[];
  pickedId: string | null;
  onPick: (storeId: string) => void;
};

function label(className: string, text: string): L.DivIcon {
  const element = document.createElement("span");
  element.className = className;
  element.textContent = text;
  return L.divIcon({ html: element, className: "map-marker", iconSize: undefined });
}

/** A real street map of the player's area, with their position and the nearby stores. */
export function RealMap({ origin, stores, pickedId, onPick }: RealMapProps) {
  const holder = useRef<HTMLDivElement>(null);
  const pick = useRef(onPick);
  pick.current = onPick;

  useEffect(() => {
    if (!holder.current) {
      return;
    }
    const map = L.map(holder.current, { zoomControl: false, attributionControl: true, maxZoom: MAX_ZOOM });
    L.tileLayer(TILE_URL, {
      attribution: ATTRIBUTION,
      tileSize: PIXEL_TILE_SIZE,
      zoomOffset: PIXEL_ZOOM_OFFSET,
      maxZoom: MAX_ZOOM,
    }).addTo(map);

    const points: L.LatLngTuple[] = [[origin.lat, origin.lon]];
    L.marker([origin.lat, origin.lon], { icon: label("map-you", "You"), interactive: false, zIndexOffset: 500 }).addTo(map);
    for (const store of stores) {
      if (store.lat === null || store.lon === null) {
        continue;
      }
      points.push([store.lat, store.lon]);
      const isPicked = store.id === pickedId;
      L.marker([store.lat, store.lon], {
        icon: label(isPicked ? "map-store is-picked" : "map-store", store.name),
        title: store.name,
        zIndexOffset: isPicked ? 400 : 0,
      })
        .on("click", () => pick.current(store.id))
        .addTo(map);
    }
    map.fitBounds(L.latLngBounds(points), { padding: [FIT_PADDING, FIT_PADDING], maxZoom: MAX_ZOOM - 1 });
    return () => {
      map.remove();
    };
  }, [origin, stores, pickedId]);

  return <div ref={holder} className="real-map px-box" role="application" aria-label="Map of grocery stores near you" />;
}
