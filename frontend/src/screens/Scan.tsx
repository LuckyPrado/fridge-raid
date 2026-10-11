import { useEffect, useRef, useState, type ChangeEvent } from "react";

import type { Kitchen } from "../hooks/useKitchen";
import { api, errorMessage } from "../lib/api";
import { capitalize, isAtRisk, spriteFor } from "../lib/food";
import { preparePhoto } from "../lib/photo";
import type { Go } from "../nav";
import { PixelEmoji } from "../pixel/PixelEmoji";
import type { DemoFridge, InventoryItem } from "../types";
import { Icon, IconButton } from "../ui/kit";

const SHELF_COUNT = 3;
const ITEMS_PER_SHELF = 4;
const TAGGED_ITEMS = 2;
const SAMPLE_SCAN_MS = 900;

type ScanProps = {
  kitchen: Kitchen;
  go: Go;
};

function shelvesOf(items: readonly InventoryItem[]): InventoryItem[][] {
  const shown = items.slice(0, SHELF_COUNT * ITEMS_PER_SHELF);
  return Array.from({ length: SHELF_COUNT }, (_, shelf) =>
    shown.slice(shelf * ITEMS_PER_SHELF, (shelf + 1) * ITEMS_PER_SHELF),
  );
}

function PixelFridge({ fridge }: { fridge: DemoFridge | undefined }) {
  const items = fridge?.items ?? [];
  const tagged = items.filter((item) => isAtRisk(item.days_left)).slice(0, TAGGED_ITEMS);
  return (
    <div className="pf">
      <div className="pf-light" />
      {shelvesOf(items).map((shelf, index) => (
        <div className="pf-shelf" key={index}>
          {shelf.map((item) => (
            <PixelEmoji key={item.id} emoji={spriteFor(item)} size={44} />
          ))}
        </div>
      ))}
      {tagged.map((item, index) => (
        <span className={`pf-tag pf-tag-${index}`} key={item.id}>
          <Icon name="check" scale={1} />
          {capitalize(item.name)}
        </span>
      ))}
    </div>
  );
}

export function Scan({ kitchen, go }: ScanProps) {
  const { fridges, status, saveInventory } = kitchen;
  const isLive = status?.mode === "gemini";
  const [fridgeId, setFridgeId] = useState<string | null>(null);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const sampleTimer = useRef<number | null>(null);
  const cameraInput = useRef<HTMLInputElement>(null);
  const galleryInput = useRef<HTMLInputElement>(null);
  const sample = fridges.find((fridge) => fridge.id === fridgeId) ?? fridges[0];

  useEffect(() => () => {
    if (photoUrl) {
      URL.revokeObjectURL(photoUrl);
    }
  }, [photoUrl]);

  useEffect(() => () => {
    if (sampleTimer.current !== null) {
      window.clearTimeout(sampleTimer.current);
    }
  }, []);

  const finish = async (items: InventoryItem[]) => {
    await saveInventory(items);
    go({ name: "fridge" });
  };

  const handleSample = () => {
    if (isBusy) {
      return;
    }
    if (!sample) {
      setProblem("No sample fridge is loaded. Add ingredients manually instead.");
      return;
    }
    setIsBusy(true);
    setProblem(null);
    sampleTimer.current = window.setTimeout(() => void finish(sample.items), SAMPLE_SCAN_MS);
  };

  const handlePhoto = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) {
      return;
    }
    setProblem(null);
    setIsBusy(true);
    setPhotoUrl(URL.createObjectURL(file));
    try {
      const items = await api.scout(await preparePhoto(file));
      if (items.length === 0) {
        throw new Error("No food found in that photo. Open the door wide and try again.");
      }
      await finish(items);
    } catch (error: unknown) {
      setProblem(errorMessage(error));
      setPhotoUrl(null);
      setIsBusy(false);
    }
  };

  const hint = isBusy ? "Your party is reading the shelves" : "Keep every shelf inside the frame";
  const shutterLabel = isLive ? "Take a fridge photo" : "Scan the sample fridge";

  return (
    <div className="scan">
      <header className="scan-top">
        <IconButton icon="close" label="Close scanner" tone="night" disabled={isBusy} onClick={() => go({ name: "home" })} />
        <h1>Fridge scan</h1>
        <span className="scan-spacer" />
      </header>

      <div className={`viewfinder ${isBusy ? "is-scanning" : ""}`}>
        {photoUrl ? <img className="viewfinder-photo" src={photoUrl} alt="Your fridge photo" /> : <PixelFridge fridge={sample} />}
        <span className="viewfinder-badge">{isLive ? "Live camera" : "Demo camera"}</span>
        <div className="viewfinder-frame" />
        <div className="viewfinder-beam" />
        <p className="viewfinder-hint" role="status">{hint}</p>
      </div>

      <div className="scan-bottom">
        <p className="eyebrow eyebrow-gold">01 / Fridge first</p>
        <p className="scan-copy">
          {isLive
            ? "Snap your shelves. Your party takes it from here, and you can check every ingredient next."
            : "No Gemini key is set, so the camera scans a sample fridge. You can check every ingredient next."}
        </p>
        {problem && <p className="scan-problem" role="alert">{problem}</p>}

        <div className="sample-row" role="group" aria-label="Sample fridges">
          {fridges.map((fridge) => (
            <button
              type="button"
              key={fridge.id}
              className={`sample-chip ${fridge.id === sample?.id ? "is-picked" : ""}`}
              aria-pressed={fridge.id === sample?.id}
              onClick={() => setFridgeId(fridge.id)}
            >
              {fridge.title.replace(/^The /, "")}
            </button>
          ))}
        </div>

        <div className="scan-controls">
          {isLive ? (
            <IconButton icon="image" label="Choose a photo" tone="night" disabled={isBusy} onClick={() => galleryInput.current?.click()} />
          ) : (
            <span className="scan-spacer" />
          )}
          <button
            type="button"
            className="shutter"
            aria-label={shutterLabel}
            disabled={isBusy}
            onClick={isLive ? () => cameraInput.current?.click() : handleSample}
          >
            <span />
          </button>
          {isLive ? (
            <IconButton icon="fridge" label="Use the sample fridge" tone="night" disabled={isBusy} onClick={handleSample} />
          ) : (
            <span className="scan-spacer" />
          )}
        </div>
        <button type="button" className="text-link text-link-light" onClick={() => go({ name: "fridge", isAdding: true })}>
          Add ingredients manually
        </button>
      </div>

      <input ref={cameraInput} className="visually-hidden" type="file" accept="image/*" capture="environment" onChange={handlePhoto} tabIndex={-1} />
      <input ref={galleryInput} className="visually-hidden" type="file" accept="image/jpeg,image/png,image/webp" onChange={handlePhoto} tabIndex={-1} />
    </div>
  );
}
