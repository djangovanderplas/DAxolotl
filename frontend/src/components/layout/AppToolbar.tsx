import type {
  FilterConfig,
  FilterKind,
  LoadState,
  PlotConfig,
  PlotSummary,
  PlotTab,
} from '../../types';
import { formatCount } from '../../lib/plotUtils';

export default function AppToolbar({
  activePlot,
  activeSummary,
  activeTab,
  addTab,
  beginRenameTab,
  canSplit,
  cancelRenameTab,
  commitCutoffDraft,
  commitMaxPointsDraft,
  commitRenameTab,
  commitWindowDraft,
  cutoffDraft,
  datasetState,
  filter,
  handleNewSession,
  handleOpenSession,
  handleSaveSession,
  maxPointsDraft,
  renamingTabId,
  renamingTabName,
  sessionDirty,
  setActivePlotId,
  setActiveTabId,
  setAnalysisOpen,
  setCutoffDraft,
  setMaxPointsDraft,
  setRenamingTabName,
  setWindowDraft,
  splitActivePlot,
  tabs,
  updateActiveFilter,
  windowDraft,
}: {
  activePlot: PlotConfig | null;
  activeSummary: PlotSummary | null;
  activeTab: PlotTab | null;
  addTab: () => void;
  beginRenameTab: (tab: PlotTab) => void;
  canSplit: boolean;
  cancelRenameTab: () => void;
  commitCutoffDraft: () => void;
  commitMaxPointsDraft: () => void;
  commitRenameTab: () => void;
  commitWindowDraft: () => void;
  cutoffDraft: string;
  datasetState: LoadState;
  filter: FilterConfig;
  handleNewSession: () => void;
  handleOpenSession: () => void;
  handleSaveSession: () => void;
  maxPointsDraft: string;
  renamingTabId: string | null;
  renamingTabName: string;
  sessionDirty: boolean;
  setActivePlotId: (plotId: string | null) => void;
  setActiveTabId: (tabId: string | null) => void;
  setAnalysisOpen: (open: boolean) => void;
  setCutoffDraft: (value: string) => void;
  setMaxPointsDraft: (value: string) => void;
  setRenamingTabName: (value: string) => void;
  setWindowDraft: (value: string) => void;
  splitActivePlot: (direction: 'horizontal' | 'vertical') => void;
  tabs: PlotTab[];
  updateActiveFilter: (nextFilter: FilterConfig) => void;
  windowDraft: string;
}) {
  return (
    <div className="flex h-12 shrink-0 items-center gap-2 border-b border-slate-800 bg-slate-900 px-3">
      <div className="flex shrink-0 items-center gap-1 border-r border-slate-800 pr-2">
        <button
          className="h-8 rounded border border-slate-700 bg-slate-950 px-2 text-xs text-slate-300 hover:border-sky-500 hover:text-sky-100"
          type="button"
          onClick={handleNewSession}
        >
          New
        </button>
        <button
          className="h-8 rounded border border-slate-700 bg-slate-950 px-2 text-xs text-slate-300 hover:border-sky-500 hover:text-sky-100"
          type="button"
          onClick={handleSaveSession}
        >
          Save
        </button>
        <button
          className="h-8 rounded border border-slate-700 bg-slate-950 px-2 text-xs text-slate-300 hover:border-sky-500 hover:text-sky-100"
          type="button"
          onClick={handleOpenSession}
        >
          Open
        </button>
        <span
          className={`ml-1 rounded border px-2 py-1 font-mono text-[11px] ${
            sessionDirty
              ? 'border-amber-400/50 bg-amber-400/10 text-amber-200'
              : 'border-emerald-400/40 bg-emerald-400/10 text-emerald-200'
          }`}
        >
          {sessionDirty ? 'unsaved' : 'saved'}
        </span>
      </div>

      <div className="flex min-w-0 items-center gap-1">
        {tabs.map((tab) => {
          const active = tab.id === activeTab?.id;
          return renamingTabId === tab.id ? (
            <input
              key={tab.id}
              aria-label={`Rename ${tab.name}`}
              autoFocus
              className="h-8 w-28 rounded border border-sky-500 bg-slate-950 px-2 text-sm font-medium text-sky-100 outline-none"
              value={renamingTabName}
              onBlur={commitRenameTab}
              onChange={(event) => setRenamingTabName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') commitRenameTab();
                if (event.key === 'Escape') cancelRenameTab();
              }}
            />
          ) : (
            <button
              key={tab.id}
              className={`h-8 whitespace-nowrap rounded border px-3 text-sm font-medium ${
                active
                  ? 'border-sky-500 bg-sky-500/15 text-sky-100'
                  : 'border-slate-700 bg-slate-950 text-slate-300 hover:border-slate-500'
              }`}
              type="button"
              onClick={() => {
                setActiveTabId(tab.id);
                setActivePlotId(tab.plots[0]?.id ?? null);
              }}
              onDoubleClick={() => beginRenameTab(tab)}
            >
              {tab.name}
            </button>
          );
        })}
        <button
          className="h-8 w-8 rounded border border-slate-700 bg-slate-950 text-sm font-semibold text-slate-300 hover:border-sky-500 hover:text-sky-100"
          type="button"
          onClick={addTab}
        >
          +
        </button>
      </div>

      <div className="flex items-center gap-1 border-l border-slate-800 pl-2">
        <button
          className="h-8 rounded border border-slate-700 bg-slate-950 px-2 text-xs text-slate-300 disabled:text-slate-600"
          disabled={!canSplit}
          type="button"
          onClick={() => splitActivePlot('vertical')}
        >
          Split V
        </button>
        <button
          className="h-8 rounded border border-slate-700 bg-slate-950 px-2 text-xs text-slate-300 disabled:text-slate-600"
          disabled={!canSplit}
          type="button"
          onClick={() => splitActivePlot('horizontal')}
        >
          Split H
        </button>
      </div>

      <button
        className="h-8 rounded border border-slate-700 bg-slate-950 px-3 text-xs font-medium text-slate-300 hover:border-sky-500 hover:text-sky-100 disabled:text-slate-600"
        disabled={!activePlot}
        type="button"
        onClick={() => setAnalysisOpen(true)}
      >
        Analysis Tools
      </button>

      <div className="flex h-8 items-center gap-2 rounded border border-slate-800 bg-slate-950 px-2 text-xs">
        <label className="sr-only" htmlFor="plot-filter">
          Filter
        </label>
        <select
          id="plot-filter"
          aria-label="Filter"
          className="h-6 rounded bg-slate-950 text-slate-200 outline-none"
          value={filter.kind}
          onChange={(event) =>
            updateActiveFilter({
              ...filter,
              kind: event.target.value as FilterKind,
            })
          }
        >
          <option value="none">No filter</option>
          <option value="butterworth">Butterworth</option>
          <option value="moving-average">Running avg</option>
        </select>
        {filter.kind === 'butterworth' ? (
          <>
            <input
              aria-label="Cutoff Hz"
              className="h-6 w-16 rounded border border-slate-800 bg-slate-950 px-1 font-mono text-slate-200 outline-none focus:border-sky-500"
              min={0.1}
              step={1}
              type="number"
              value={cutoffDraft}
              onChange={(event) => setCutoffDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') commitCutoffDraft();
              }}
            />
            <span className="text-slate-500">Hz</span>
            <select
              aria-label="Filter order"
              className="h-6 rounded bg-slate-950 font-mono text-slate-200 outline-none"
              value={filter.order}
              onChange={(event) =>
                updateActiveFilter({
                  ...filter,
                  order: Number(event.target.value) as 2 | 4,
                })
              }
            >
              <option value={2}>2p</option>
              <option value={4}>4p</option>
            </select>
          </>
        ) : null}
        {filter.kind === 'moving-average' ? (
          <>
            <input
              aria-label="Window samples"
              className="h-6 w-16 rounded border border-slate-800 bg-slate-950 px-1 font-mono text-slate-200 outline-none focus:border-sky-500"
              min={1}
              step={1}
              type="number"
              value={windowDraft}
              onChange={(event) => setWindowDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') commitWindowDraft();
              }}
            />
            <span className="text-slate-500">pts</span>
          </>
        ) : null}
      </div>

      <div className="flex h-8 items-center gap-2 rounded border border-slate-800 bg-slate-950 px-2 text-xs">
        <label className="text-slate-500" htmlFor="max-points">
          points/trace
        </label>
        <input
          id="max-points"
          aria-label="Fast points per trace"
          className="h-6 w-20 rounded border border-slate-800 bg-slate-950 px-1 font-mono text-slate-200 outline-none focus:border-sky-500"
          min={500}
          step={500}
          type="number"
          value={maxPointsDraft}
          onChange={(event) => setMaxPointsDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') commitMaxPointsDraft();
          }}
        />
      </div>

      <div className="ml-auto whitespace-nowrap font-mono text-xs text-slate-400">
        {activeSummary
          ? activeSummary.state === 'loading'
            ? 'loading'
            : `${activePlot?.resolution ?? 'fast'} · ${formatCount(
                activeSummary.displayedPoints,
              )} / ${formatCount(activeSummary.fullPoints)} points`
          : datasetState === 'loading'
            ? 'loading'
            : 'idle'}
      </div>
    </div>
  );
}
