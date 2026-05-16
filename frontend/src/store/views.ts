import { create } from 'zustand';

type ViewsStore = {
  savedSnapshot: string | null;
  setSavedSnapshot: (snapshot: string | null) => void;
  reset: () => void;
};

export const useViewsStore = create<ViewsStore>((set) => ({
  savedSnapshot: null,
  setSavedSnapshot: (savedSnapshot) => set({ savedSnapshot }),
  reset: () => set({ savedSnapshot: null }),
}));
