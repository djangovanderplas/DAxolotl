import type { PlotConfig, PlotTab } from '../../types';

export default function AppHeader({
  activePlot,
  activeTab,
  datasetCount,
}: {
  activePlot: PlotConfig | null;
  activeTab: PlotTab | null;
  datasetCount: number;
}) {
  return (
    <header className="flex h-12 shrink-0 items-center gap-3 border-b border-slate-800 bg-slate-900 px-4">
      <div className="min-w-36">
        <div className="text-lg font-semibold tracking-tight">DAxolotl</div>
        <div className="text-xs text-slate-500">
          {activePlot ? `${activeTab?.name ?? 'Tab'} / ${activePlot.name}` : 'plot setup'}
        </div>
      </div>
      <div className="font-mono text-xs text-slate-500">
        {datasetCount} {datasetCount === 1 ? 'dataset' : 'datasets'}
      </div>
    </header>
  );
}
