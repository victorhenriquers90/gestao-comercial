import { create } from "zustand";
import { persist } from "zustand/middleware";

type Sel = {
  storeId: number | null;
  sellerId: number | null;
  setStoreId: (id: number | null) => void;
  setSellerId: (id: number | null) => void;
};

export const useSelection = create<Sel>()(
  persist(
    (set) => ({
      storeId: null,
      sellerId: null,
      setStoreId: (storeId) => set({ storeId }),
      setSellerId: (sellerId) => set({ sellerId }),
    }),
    { name: "gc-selection" },
  ),
);
