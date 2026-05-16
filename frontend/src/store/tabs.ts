import { create } from 'zustand';
import type { PlotAnalysisData, PlotConfig, PlotSummary, PlotTab } from '../types';

type TabsStore = {
  tabs: PlotTab[];
  activeTabId: string | null;
  activePlotId: string | null;
  plotSummaries: Record<string, PlotSummary>;
  plotAnalysisData: Record<string, PlotAnalysisData>;
  nextTabNumber: number;
  nextPlotNumber: number;
  setTabs: (tabs: PlotTab[] | ((tabs: PlotTab[]) => PlotTab[])) => void;
  setActiveTabId: (tabId: string | null) => void;
  setActivePlotId: (plotId: string | null) => void;
  setNextTabNumber: (value: number | ((value: number) => number)) => void;
  setNextPlotNumber: (value: number | ((value: number) => number)) => void;
  setPlotSummaries: (
    summaries:
      | Record<string, PlotSummary>
      | ((summaries: Record<string, PlotSummary>) => Record<string, PlotSummary>),
  ) => void;
  setPlotAnalysisData: (
    data:
      | Record<string, PlotAnalysisData>
      | ((data: Record<string, PlotAnalysisData>) => Record<string, PlotAnalysisData>),
  ) => void;
  updatePlot: (plotId: string, updater: (plot: PlotConfig) => PlotConfig) => void;
  reset: () => void;
};

const initialState = {
  tabs: [],
  activeTabId: null,
  activePlotId: null,
  plotSummaries: {},
  plotAnalysisData: {},
  nextTabNumber: 2,
  nextPlotNumber: 2,
};

export const useTabsStore = create<TabsStore>((set) => ({
  ...initialState,
  setTabs: (tabs) =>
    set((state) => ({ tabs: typeof tabs === 'function' ? tabs(state.tabs) : tabs })),
  setActiveTabId: (activeTabId) => set({ activeTabId }),
  setActivePlotId: (activePlotId) => set({ activePlotId }),
  setNextTabNumber: (value) =>
    set((state) => ({
      nextTabNumber: typeof value === 'function' ? value(state.nextTabNumber) : value,
    })),
  setNextPlotNumber: (value) =>
    set((state) => ({
      nextPlotNumber: typeof value === 'function' ? value(state.nextPlotNumber) : value,
    })),
  setPlotSummaries: (plotSummaries) =>
    set((state) => ({
      plotSummaries:
        typeof plotSummaries === 'function' ? plotSummaries(state.plotSummaries) : plotSummaries,
    })),
  setPlotAnalysisData: (plotAnalysisData) =>
    set((state) => ({
      plotAnalysisData:
        typeof plotAnalysisData === 'function'
          ? plotAnalysisData(state.plotAnalysisData)
          : plotAnalysisData,
    })),
  updatePlot: (plotId, updater) =>
    set((state) => ({
      tabs: state.tabs.map((tab) => ({
        ...tab,
        plots: tab.plots.map((plot) => (plot.id === plotId ? updater(plot) : plot)),
      })),
    })),
  reset: () => set(initialState),
}));
