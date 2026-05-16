import type { AnalysisIntervalMode, AnalysisTool, TimeWindow } from '../../types';
import { formatAnalysisValue } from '../../lib/plotUtils';

export default function AnalysisSidebar({
  cursorWindow,
  interval,
  intervalMode,
  manualMaxDraft,
  manualMinDraft,
  setIntervalMode,
  setManualMaxDraft,
  setManualMinDraft,
  setTool,
  tool,
}: {
  cursorWindow: TimeWindow | null;
  interval: TimeWindow | null;
  intervalMode: AnalysisIntervalMode;
  manualMaxDraft: string;
  manualMinDraft: string;
  setIntervalMode: (mode: AnalysisIntervalMode) => void;
  setManualMaxDraft: (value: string) => void;
  setManualMinDraft: (value: string) => void;
  setTool: (tool: AnalysisTool) => void;
  tool: AnalysisTool;
}) {
  const tools: Array<[AnalysisTool, string]> = [
    ['polyfit', 'Regression'],
    ['area', 'Area'],
    ['stats', 'Statistics'],
    ['fft', 'FFT'],
    ['histogram', 'Histogram'],
  ];

  return (
    <aside className="border-r border-slate-800 p-3">
      <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Tool</div>
      <div className="space-y-1">
        {tools.map(([value, label]) => (
          <button
            key={value}
            className={`block h-9 w-full rounded border px-3 text-left text-sm ${
              tool === value
                ? 'border-sky-500 bg-sky-500/15 text-sky-100'
                : 'border-slate-800 bg-slate-950 text-slate-300 hover:border-slate-600'
            }`}
            type="button"
            onClick={() => setTool(value)}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="mt-5 text-xs font-semibold uppercase tracking-wide text-slate-500">
        Interval
      </div>
      <div className="mt-2 space-y-1">
        <label className="flex h-8 items-center gap-2 rounded border border-slate-800 bg-slate-950 px-2 text-xs text-slate-300">
          <input
            checked={intervalMode === 'cursors'}
            className="accent-sky-500"
            disabled={!cursorWindow}
            type="radio"
            onChange={() => setIntervalMode('cursors')}
          />
          cursors
        </label>
        <label className="flex h-8 items-center gap-2 rounded border border-slate-800 bg-slate-950 px-2 text-xs text-slate-300">
          <input
            checked={intervalMode === 'viewport'}
            className="accent-sky-500"
            type="radio"
            onChange={() => setIntervalMode('viewport')}
          />
          viewport
        </label>
        <label className="flex h-8 items-center gap-2 rounded border border-slate-800 bg-slate-950 px-2 text-xs text-slate-300">
          <input
            checked={intervalMode === 'manual'}
            className="accent-sky-500"
            type="radio"
            onChange={() => setIntervalMode('manual')}
          />
          manual
        </label>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
        <label className="text-slate-500" htmlFor="analysis-t-min">
          t_min
          <input
            id="analysis-t-min"
            aria-label="Analysis t min"
            className="mt-1 h-8 w-full rounded border border-slate-800 bg-slate-950 px-2 font-mono text-slate-100 outline-none focus:border-sky-500 disabled:text-slate-600"
            disabled={intervalMode !== 'manual'}
            type="number"
            value={manualMinDraft}
            onChange={(event) => setManualMinDraft(event.target.value)}
          />
        </label>
        <label className="text-slate-500" htmlFor="analysis-t-max">
          t_max
          <input
            id="analysis-t-max"
            aria-label="Analysis t max"
            className="mt-1 h-8 w-full rounded border border-slate-800 bg-slate-950 px-2 font-mono text-slate-100 outline-none focus:border-sky-500 disabled:text-slate-600"
            disabled={intervalMode !== 'manual'}
            type="number"
            value={manualMaxDraft}
            onChange={(event) => setManualMaxDraft(event.target.value)}
          />
        </label>
      </div>

      <div className="mt-4 rounded border border-slate-800 bg-slate-950 p-2 font-mono text-xs text-slate-400">
        {interval
          ? `${formatAnalysisValue(interval.tMin)}-${formatAnalysisValue(interval.tMax)} s`
          : 'No interval'}
      </div>
    </aside>
  );
}
