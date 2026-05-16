import { create } from 'zustand';
import type { CursorId, CursorSnapMode } from '../types';

type CursorState = {
  cursorA: number | null;
  cursorB: number | null;
  activeCursor: CursorId | null;
  cursorSnap: CursorSnapMode;
};

type CursorsStore = {
  cursorsByPlotId: Record<string, CursorState>;
  setPlotCursors: (plotId: string, cursors: CursorState) => void;
  clearPlotCursors: (plotId: string) => void;
};

export const useCursorsStore = create<CursorsStore>((set) => ({
  cursorsByPlotId: {},
  setPlotCursors: (plotId, cursors) =>
    set((state) => ({ cursorsByPlotId: { ...state.cursorsByPlotId, [plotId]: cursors } })),
  clearPlotCursors: (plotId) =>
    set((state) => {
      const next = { ...state.cursorsByPlotId };
      delete next[plotId];
      return { cursorsByPlotId: next };
    }),
}));
