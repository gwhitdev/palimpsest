import { create } from "zustand";
import { KappaSummary } from "@/lib/kappa";
import { withProjectQuery } from "@/lib/projectClient";

interface KappaStore {
  summary: KappaSummary | null;
  isLoading: boolean;
  lastFetched: string | null;
  setSummary: (summary: KappaSummary) => void;
  setLoading: (loading: boolean) => void;
  fetchKappa: (args?: { roundId?: string; projectId?: string | null }) => Promise<void>;
}

export const useKappaStore = create<KappaStore>((set) => ({
  summary: null,
  isLoading: false,
  lastFetched: null,

  setSummary: (summary) =>
    set({
      summary,
      lastFetched: new Date().toISOString(),
    }),
  setLoading: (isLoading) => set({ isLoading }),

  fetchKappa: async (args) => {
    set({ isLoading: true });

    try {
      const params = new URLSearchParams();
      if (args?.roundId) {
        params.set("roundId", args.roundId);
      }

      const path = params.size > 0 ? `/api/kappa?${params.toString()}` : "/api/kappa";
      const response = await fetch(withProjectQuery(path, args?.projectId));
      const payload = (await response.json()) as KappaSummary & { error?: string };

      if (!response.ok) {
        throw new Error(payload.error ?? "Failed to fetch kappa summary.");
      }

      set({
        summary: payload,
        isLoading: false,
        lastFetched: new Date().toISOString(),
      });
    } catch {
      set({ isLoading: false });
    }
  },
}));
