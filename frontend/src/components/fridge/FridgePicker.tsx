import { useRef } from "react";

import type { DemoFridge } from "../../types";

interface FridgePickerProps {
  fridges: DemoFridge[];
  canScan: boolean;
  scanning: boolean;
  locked: boolean;
  hasItems: boolean;
  onPick: (fridge: DemoFridge) => void;
  onScan: (photo: File) => void;
  onEdit: () => void;
}

export function FridgePicker({
  fridges,
  canScan,
  scanning,
  locked,
  hasItems,
  onPick,
  onScan,
  onEdit,
}: FridgePickerProps) {
  const fileInput = useRef<HTMLInputElement>(null);

  return (
    <div className="picker">
      <div className="picker__actions">
        <button
          type="button"
          className="button button--light"
          disabled={locked || scanning || !canScan}
          title={canScan ? undefined : "Photo scanning needs a Gemini API key on the server"}
          onClick={() => fileInput.current?.click()}
        >
          {scanning ? "Scout is looking…" : "Scan a fridge photo"}
        </button>
        <button type="button" className="button button--ghost" disabled={locked} onClick={onEdit}>
          {hasItems ? "Edit contents" : "Add food by hand"}
        </button>
        <input
          ref={fileInput}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          capture="environment"
          hidden
          onChange={(event) => {
            const photo = event.target.files?.[0];
            if (photo) {
              onScan(photo);
            }
            event.target.value = "";
          }}
        />
      </div>
      <ul className="picker__demos" aria-label="Demo fridges">
        {fridges.map((fridge) => (
          <li key={fridge.id}>
            <button type="button" className="demo" disabled={locked} onClick={() => onPick(fridge)}>
              <span className="demo__title">{fridge.title}</span>
              <span className="demo__blurb">{fridge.blurb}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
