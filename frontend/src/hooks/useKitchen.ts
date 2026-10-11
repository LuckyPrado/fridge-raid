import { useCallback, useEffect, useState } from "react";

import { api, errorMessage } from "../lib/api";
import type { DemoFridge, InventoryItem, RaidStat, StatusInfo, Threat } from "../types";

const NO_THREAT: Threat = { waste_value_total: 0, at_risk: [] };

export interface Kitchen {
  loading: boolean;
  status: StatusInfo | null;
  fridges: DemoFridge[];
  inventory: InventoryItem[];
  threat: Threat;
  stats: RaidStat[];
  problem: string | null;
  clearProblem: () => void;
  reportProblem: (message: string) => void;
  saveInventory: (items: InventoryItem[]) => Promise<void>;
  adoptInventory: (items: InventoryItem[]) => void;
  refreshStats: () => Promise<void>;
}

/** Server-backed kitchen state: the fridge contents, what is about to spoil, and raid history. */
export function useKitchen(): Kitchen {
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<StatusInfo | null>(null);
  const [fridges, setFridges] = useState<DemoFridge[]>([]);
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [threat, setThreat] = useState<Threat>(NO_THREAT);
  const [stats, setStats] = useState<RaidStat[]>([]);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([api.status(), api.demoFridges(), api.inventory(), api.stats()])
      .then(([nextStatus, nextFridges, items, nextStats]) => {
        if (cancelled) {
          return;
        }
        setStatus(nextStatus);
        setFridges(nextFridges);
        setInventory(items);
        setStats(nextStats);
      })
      .catch((error: unknown) => !cancelled && setProblem(errorMessage(error)))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (inventory.length === 0) {
      setThreat(NO_THREAT);
      return;
    }
    let cancelled = false;
    api
      .threat(inventory)
      .then((next) => !cancelled && setThreat(next))
      .catch((error: unknown) => !cancelled && setProblem(errorMessage(error)));
    return () => {
      cancelled = true;
    };
  }, [inventory]);

  const saveInventory = useCallback(async (items: InventoryItem[]) => {
    setInventory(items);
    try {
      await api.saveInventory(items);
    } catch (error: unknown) {
      setProblem(`Fridge contents were not saved. ${errorMessage(error)}`);
    }
  }, []);

  const refreshStats = useCallback(async () => {
    try {
      setStats(await api.stats());
    } catch (error: unknown) {
      setProblem(errorMessage(error));
    }
  }, []);

  return {
    loading,
    status,
    fridges,
    inventory,
    threat,
    stats,
    problem,
    clearProblem: useCallback(() => setProblem(null), []),
    reportProblem: setProblem,
    saveInventory,
    adoptInventory: setInventory,
    refreshStats,
  };
}
