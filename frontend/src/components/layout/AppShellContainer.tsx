import { useCallback, useEffect, useMemo, useState } from 'react';
import { fetchDatasetsWithDetails } from '../../api/datasets';
import { useDatasetsStore } from '../../store/datasets';
import { useTabsStore } from '../../store/tabs';
import { useViewsStore } from '../../store/views';
import AppHeader from './AppHeader';
import AppToolbar from './AppToolbar';
import PlotSetup from '../setup/PlotSetup';
import AnalysisTools from '../analysis/AnalysisTools';
import PlotView from '../plot/PlotView';
import {
  MAX_POINTS,
  CURRENT_SESSION_KEY,
  SAVED_SESSION_KEY,
  DEFAULT_FILTER,
  defaultPlot,
  freshSession,
  serializeSession,
  parseStoredSession,
  validSessionForDatasets,
  clampMaxPoints,
  layoutClass,
} from '../../lib/plotUtils';
import type {
  FilterConfig,
  PersistedSession,
  PlotAnalysisData,
  PlotConfig,
  PlotLayout,
  PlotSummary,
  PlotTab,
} from '../../types';

export default function AppShell() {
  useEffect(
    () => () => {
      useDatasetsStore.getState().reset();
      useTabsStore.getState().reset();
      useViewsStore.getState().reset();
    },
    [],
  );

  const datasets = useDatasetsStore((state) => state.datasets);
  const selectedDatasetId = useDatasetsStore((state) => state.selectedDatasetId);
  const datasetState = useDatasetsStore((state) => state.datasetState);
  const error = useDatasetsStore((state) => state.error);
  const setDatasets = useDatasetsStore((state) => state.setDatasets);
  const setSelectedDatasetId = useDatasetsStore((state) => state.setSelectedDatasetId);
  const setDatasetState = useDatasetsStore((state) => state.setDatasetState);
  const setError = useDatasetsStore((state) => state.setError);
  const tabs = useTabsStore((state) => state.tabs);
  const activeTabId = useTabsStore((state) => state.activeTabId);
  const activePlotId = useTabsStore((state) => state.activePlotId);
  const plotSummaries = useTabsStore((state) => state.plotSummaries);
  const plotAnalysisData = useTabsStore((state) => state.plotAnalysisData);
  const nextTabNumber = useTabsStore((state) => state.nextTabNumber);
  const nextPlotNumber = useTabsStore((state) => state.nextPlotNumber);
  const setTabs = useTabsStore((state) => state.setTabs);
  const setActiveTabId = useTabsStore((state) => state.setActiveTabId);
  const setActivePlotId = useTabsStore((state) => state.setActivePlotId);
  const setPlotSummaries = useTabsStore((state) => state.setPlotSummaries);
  const setPlotAnalysisData = useTabsStore((state) => state.setPlotAnalysisData);
  const setNextTabNumber = useTabsStore((state) => state.setNextTabNumber);
  const setNextPlotNumber = useTabsStore((state) => state.setNextPlotNumber);
  const savedSnapshot = useViewsStore((state) => state.savedSnapshot);
  const setSavedSnapshot = useViewsStore((state) => state.setSavedSnapshot);
  const [filter, setFilter] = useState<FilterConfig>(DEFAULT_FILTER);
  const [cutoffDraft, setCutoffDraft] = useState(String(DEFAULT_FILTER.cutoffHz));
  const [windowDraft, setWindowDraft] = useState(String(DEFAULT_FILTER.windowSamples));
  const [maxPointsDraft, setMaxPointsDraft] = useState(String(MAX_POINTS));
  const [renamingTabId, setRenamingTabId] = useState<string | null>(null);
  const [renamingTabName, setRenamingTabName] = useState('');
  const [configuringPlotId, setConfiguringPlotId] = useState<string | null>(null);
  const [analysisOpen, setAnalysisOpen] = useState(false);

  const sessionSnapshot = useMemo(
    () =>
      serializeSession({
        version: 1,
        selectedDatasetId,
        tabs,
        activeTabId,
        activePlotId,
        nextTabNumber,
        nextPlotNumber,
      }),
    [activePlotId, activeTabId, nextPlotNumber, nextTabNumber, selectedDatasetId, tabs],
  );
  const sessionDirty = tabs.length > 0 && sessionSnapshot !== savedSnapshot;

  const activeTab = useMemo(
    () => tabs.find((tab) => tab.id === activeTabId) ?? tabs[0] ?? null,
    [activeTabId, tabs],
  );
  const activePlot = useMemo(
    () => activeTab?.plots.find((plot) => plot.id === activePlotId) ?? activeTab?.plots[0] ?? null,
    [activePlotId, activeTab],
  );
  const configuringPlot = useMemo(
    () => tabs.flatMap((tab) => tab.plots).find((plot) => plot.id === configuringPlotId) ?? null,
    [configuringPlotId, tabs],
  );
  const activeSummary = activePlot ? plotSummaries[activePlot.id] : null;
  const activeAnalysisData = activePlot ? (plotAnalysisData[activePlot.id] ?? null) : null;

  const updatePlot = useCallback((plotId: string, updater: (plot: PlotConfig) => PlotConfig) => {
    setTabs((currentTabs) =>
      currentTabs.map((tab) => ({
        ...tab,
        plots: tab.plots.map((plot) => (plot.id === plotId ? updater(plot) : plot)),
      })),
    );
  }, []);

  const updateActivePlot = useCallback(
    (updater: (plot: PlotConfig) => PlotConfig) => {
      if (!activePlot) return;
      updatePlot(activePlot.id, updater);
    },
    [activePlot, updatePlot],
  );

  const handlePlotSummary = useCallback((plotId: string, summary: PlotSummary) => {
    setPlotSummaries((current) => ({ ...current, [plotId]: summary }));
  }, []);

  const handlePlotAnalysisData = useCallback((plotId: string, data: PlotAnalysisData) => {
    setPlotAnalysisData((current) => ({ ...current, [plotId]: data }));
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadDatasets() {
      setDatasetState('loading');
      setError(null);
      try {
        const detailed = await fetchDatasetsWithDetails();

        if (cancelled) return;
        setDatasets(detailed);

        const firstDataset = detailed[0] ?? null;
        const saved = localStorage.getItem(SAVED_SESSION_KEY);
        const restored = validSessionForDatasets(
          parseStoredSession(localStorage.getItem(CURRENT_SESSION_KEY)),
          detailed,
        );
        const initialSession = restored ?? freshSession(firstDataset?.id ?? null);
        setSelectedDatasetId(initialSession.selectedDatasetId);
        setTabs(initialSession.tabs);
        setActiveTabId(initialSession.activeTabId);
        setActivePlotId(initialSession.activePlotId);
        setNextTabNumber(initialSession.nextTabNumber);
        setNextPlotNumber(initialSession.nextPlotNumber);
        setSavedSnapshot(saved);
        setPlotSummaries({});
        setPlotAnalysisData({});
        setDatasetState('ready');
      } catch (err) {
        if (cancelled) return;
        setDatasetState('error');
        setError(err instanceof Error ? err.message : 'Unable to load datasets');
      }
    }

    void loadDatasets();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (tabs.length === 0) return;
    localStorage.setItem(CURRENT_SESSION_KEY, sessionSnapshot);
  }, [sessionSnapshot, tabs.length]);

  useEffect(() => {
    if (!activePlot) return;
    setFilter(activePlot.filter);
    setCutoffDraft(String(activePlot.filter.cutoffHz));
    setWindowDraft(String(activePlot.filter.windowSamples));
    setMaxPointsDraft(String(activePlot.maxPoints));
  }, [activePlot]);

  const confirmDiscardSession = useCallback(() => {
    if (!sessionDirty) return true;
    return window.confirm('Current session has unsaved changes. Continue?');
  }, [sessionDirty]);

  const applySession = useCallback((session: PersistedSession) => {
    setSelectedDatasetId(session.selectedDatasetId);
    setTabs(session.tabs);
    setActiveTabId(session.activeTabId);
    setActivePlotId(session.activePlotId);
    setNextTabNumber(session.nextTabNumber);
    setNextPlotNumber(session.nextPlotNumber);
    setPlotSummaries({});
    setPlotAnalysisData({});
  }, []);

  const handleNewSession = useCallback(() => {
    if (!confirmDiscardSession()) return;
    const firstDatasetId = datasets[0]?.id ?? null;
    applySession(freshSession(firstDatasetId));
    setSavedSnapshot(null);
    setError(null);
  }, [applySession, confirmDiscardSession, datasets]);

  const handleSaveSession = useCallback(() => {
    localStorage.setItem(SAVED_SESSION_KEY, sessionSnapshot);
    localStorage.setItem(CURRENT_SESSION_KEY, sessionSnapshot);
    setSavedSnapshot(sessionSnapshot);
    setError(null);
  }, [sessionSnapshot]);

  const handleOpenSession = useCallback(() => {
    if (!confirmDiscardSession()) return;
    const stored = localStorage.getItem(SAVED_SESSION_KEY);
    const session = validSessionForDatasets(parseStoredSession(stored), datasets);
    if (!session || !stored) {
      setError('No saved session found for the loaded datasets.');
      return;
    }
    applySession(session);
    setSavedSnapshot(stored);
    setError(null);
  }, [applySession, confirmDiscardSession, datasets]);

  const updateActiveFilter = useCallback(
    (nextFilter: FilterConfig) => {
      setFilter(nextFilter);
      updateActivePlot((plot) => ({ ...plot, filter: nextFilter }));
    },
    [updateActivePlot],
  );

  const updateActiveMaxPoints = useCallback(
    (maxPoints: number) => {
      const nextMaxPoints = clampMaxPoints(maxPoints);
      setMaxPointsDraft(String(nextMaxPoints));
      updateActivePlot((plot) => ({ ...plot, maxPoints: nextMaxPoints }));
    },
    [updateActivePlot],
  );

  const commitCutoffDraft = useCallback(() => {
    const value = Number(cutoffDraft);
    if (!Number.isFinite(value) || value <= 0) {
      setCutoffDraft(String(filter.cutoffHz));
      return;
    }
    updateActiveFilter({ ...filter, cutoffHz: value });
  }, [cutoffDraft, filter, updateActiveFilter]);

  const commitWindowDraft = useCallback(() => {
    const value = Number(windowDraft);
    if (!Number.isFinite(value) || value < 1) {
      setWindowDraft(String(filter.windowSamples));
      return;
    }
    updateActiveFilter({ ...filter, windowSamples: Math.max(1, Math.round(value)) });
  }, [filter, updateActiveFilter, windowDraft]);

  const commitMaxPointsDraft = useCallback(() => {
    updateActiveMaxPoints(Number(maxPointsDraft));
  }, [maxPointsDraft, updateActiveMaxPoints]);

  const beginRenameTab = useCallback((tab: PlotTab) => {
    setRenamingTabId(tab.id);
    setRenamingTabName(tab.name);
  }, []);

  const commitRenameTab = useCallback(() => {
    if (!renamingTabId) return;
    const nextName = renamingTabName.trim();
    if (nextName) {
      setTabs((currentTabs) =>
        currentTabs.map((tab) => (tab.id === renamingTabId ? { ...tab, name: nextName } : tab)),
      );
    }
    setRenamingTabId(null);
    setRenamingTabName('');
  }, [renamingTabId, renamingTabName]);

  const cancelRenameTab = useCallback(() => {
    setRenamingTabId(null);
    setRenamingTabName('');
  }, []);

  const addTab = useCallback(() => {
    const tabId = `tab-${nextTabNumber}`;
    const plotId = `plot-${nextPlotNumber}`;
    const newPlot = defaultPlot(plotId, `Plot ${nextPlotNumber}`);
    setTabs((currentTabs) => [
      ...currentTabs,
      { id: tabId, name: `Tab ${nextTabNumber}`, layout: 'single', plots: [newPlot] },
    ]);
    setActiveTabId(tabId);
    setActivePlotId(plotId);
    setNextTabNumber((value) => value + 1);
    setNextPlotNumber((value) => value + 1);
  }, [nextPlotNumber, nextTabNumber]);

  const splitPlot = useCallback(
    (plotToSplitId: string, direction: 'horizontal' | 'vertical') => {
      const tabToSplit = tabs.find((tab) => tab.plots.some((plot) => plot.id === plotToSplitId));
      if (!tabToSplit || tabToSplit.plots.length >= 4) return;
      const plotId = `plot-${nextPlotNumber}`;
      const newPlot = defaultPlot(plotId, `Plot ${nextPlotNumber}`);
      setTabs((currentTabs) =>
        currentTabs.map((tab) => {
          if (tab.id !== tabToSplit.id) return tab;
          const nextPlots = [...tab.plots, newPlot];
          const nextLayout: PlotLayout =
            nextPlots.length > 2 ? 'grid' : direction === 'vertical' ? 'columns' : 'rows';
          return { ...tab, layout: nextLayout, plots: nextPlots };
        }),
      );
      setActiveTabId(tabToSplit.id);
      setActivePlotId(plotId);
      setNextPlotNumber((value) => value + 1);
    },
    [nextPlotNumber, tabs],
  );

  const splitActivePlot = useCallback(
    (direction: 'horizontal' | 'vertical') => {
      if (!activePlot) return;
      splitPlot(activePlot.id, direction);
    },
    [activePlot, splitPlot],
  );

  const removePlot = useCallback(
    (plotId: string) => {
      const tabWithPlot = tabs.find((tab) => tab.plots.some((plot) => plot.id === plotId));
      if (!tabWithPlot || tabWithPlot.plots.length <= 1) return;
      const remainingPlots = tabWithPlot.plots.filter((plot) => plot.id !== plotId);
      const nextActivePlotId =
        activePlotId === plotId ? (remainingPlots[0]?.id ?? null) : activePlotId;
      setTabs((currentTabs) =>
        currentTabs.map((tab) => {
          if (tab.id !== tabWithPlot.id) return tab;
          const nextLayout: PlotLayout =
            remainingPlots.length === 1
              ? 'single'
              : remainingPlots.length === 2
                ? 'columns'
                : 'grid';
          return { ...tab, layout: nextLayout, plots: remainingPlots };
        }),
      );
      setActiveTabId(tabWithPlot.id);
      setActivePlotId(nextActivePlotId);
      setPlotSummaries((current) => {
        const next = { ...current };
        delete next[plotId];
        return next;
      });
      setPlotAnalysisData((current) => {
        const next = { ...current };
        delete next[plotId];
        return next;
      });
    },
    [activePlotId, tabs],
  );

  const hasDatasets = datasets.length > 0;
  const canSplit = Boolean(activeTab && activePlot && activeTab.plots.length < 4);

  const confirmPlotData = useCallback(
    (update: Pick<PlotConfig, 'signalRefs' | 'valveRefs' | 'resolution'>) => {
      if (!configuringPlotId) return;
      updatePlot(configuringPlotId, (plot) => ({ ...plot, ...update }));
      setSelectedDatasetId(
        update.signalRefs[0]?.datasetId ?? update.valveRefs[0]?.datasetId ?? selectedDatasetId,
      );
      setConfiguringPlotId(null);
    },
    [configuringPlotId, selectedDatasetId, updatePlot],
  );

  return (
    <main className="h-screen overflow-hidden bg-slate-950 text-slate-100">
      <div className="flex h-full min-h-0 flex-col">
        <AppHeader activePlot={activePlot} activeTab={activeTab} datasetCount={datasets.length} />

        <section className="flex min-h-0 flex-1 flex-col">
          <AppToolbar
            activePlot={activePlot}
            activeSummary={activeSummary}
            activeTab={activeTab}
            addTab={addTab}
            beginRenameTab={beginRenameTab}
            canSplit={canSplit}
            cancelRenameTab={cancelRenameTab}
            commitCutoffDraft={commitCutoffDraft}
            commitMaxPointsDraft={commitMaxPointsDraft}
            commitRenameTab={commitRenameTab}
            commitWindowDraft={commitWindowDraft}
            cutoffDraft={cutoffDraft}
            datasetState={datasetState}
            filter={filter}
            handleNewSession={handleNewSession}
            handleOpenSession={handleOpenSession}
            handleSaveSession={handleSaveSession}
            maxPointsDraft={maxPointsDraft}
            renamingTabId={renamingTabId}
            renamingTabName={renamingTabName}
            sessionDirty={sessionDirty}
            setActivePlotId={setActivePlotId}
            setActiveTabId={setActiveTabId}
            setAnalysisOpen={setAnalysisOpen}
            setCutoffDraft={setCutoffDraft}
            setMaxPointsDraft={setMaxPointsDraft}
            setRenamingTabName={setRenamingTabName}
            setWindowDraft={setWindowDraft}
            splitActivePlot={splitActivePlot}
            tabs={tabs}
            updateActiveFilter={updateActiveFilter}
            windowDraft={windowDraft}
          />

          <div className="relative min-h-0 flex-1 bg-slate-950 p-3">
            {activeTab ? (
              <div className={`grid h-full min-h-0 gap-2 ${layoutClass(activeTab.layout)}`}>
                {activeTab.plots.map((plot) => (
                  <PlotView
                    key={plot.id}
                    active={plot.id === activePlot?.id}
                    canRemove={activeTab.plots.length > 1}
                    datasets={datasets}
                    plot={plot}
                    onConfigure={() => {
                      setActivePlotId(plot.id);
                      setConfiguringPlotId(plot.id);
                    }}
                    onSelect={() => setActivePlotId(plot.id)}
                    onSplit={(direction) => splitPlot(plot.id, direction)}
                    onRemove={() => removePlot(plot.id)}
                    onUpdate={(updater) => updatePlot(plot.id, updater)}
                    onAnalysisData={handlePlotAnalysisData}
                    onSummary={handlePlotSummary}
                  />
                ))}
              </div>
            ) : null}

            {error ? (
              <div className="absolute left-6 top-6 rounded border border-rose-500/60 bg-rose-950 px-3 py-2 text-sm text-rose-100">
                {error}
              </div>
            ) : null}

            {!hasDatasets && datasetState === 'ready' ? (
              <div className="absolute left-6 top-6 rounded border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-300">
                No datasets registered.
              </div>
            ) : null}
          </div>
        </section>

        {configuringPlot ? (
          <PlotSetup
            datasets={datasets}
            plot={configuringPlot}
            onCancel={() => setConfiguringPlotId(null)}
            onConfirm={confirmPlotData}
          />
        ) : null}
        {analysisOpen && activePlot ? (
          <AnalysisTools
            analysisData={activeAnalysisData}
            datasets={datasets}
            plot={activePlot}
            onAddRegression={(regression) =>
              updatePlot(activePlot.id, (plot) => ({
                ...plot,
                regressions: [...plot.regressions, regression],
              }))
            }
            onRemoveRegression={(regressionId) =>
              updatePlot(activePlot.id, (plot) => ({
                ...plot,
                regressions: plot.regressions.filter(
                  (regression) => regression.id !== regressionId,
                ),
              }))
            }
            onClose={() => setAnalysisOpen(false)}
          />
        ) : null}
      </div>
    </main>
  );
}
