import type { ChannelData } from '../../types';
import { formatAnalysisValue } from '../../lib/plotUtils';
import { ChannelSelect } from './PolyfitPanel';
import type { NullableNumberRow, TraceName } from './analysisTypes';

export default function StatsPanel({
  centralStatRows,
  copyHighPrecisionValue,
  copyStatus,
  dispersionStatRows,
  selectedChannelKey,
  selectedWindow,
  setSelectedChannelKey,
  setStatsView,
  signals,
  statsView,
  traceName,
}: {
  centralStatRows: NullableNumberRow[];
  copyHighPrecisionValue: (label: string, value: number | null) => void;
  copyStatus: string;
  dispersionStatRows: NullableNumberRow[];
  selectedChannelKey: string;
  selectedWindow: { t: number[]; y: number[] };
  setSelectedChannelKey: (key: string) => void;
  setStatsView: (view: 'central' | 'dispersion') => void;
  signals: ChannelData[];
  statsView: 'central' | 'dispersion';
  traceName: TraceName;
}) {
  const rows = statsView === 'central' ? centralStatRows : dispersionStatRows;
  return (
    <div>
      <div className="mb-3 text-sm font-semibold text-slate-100">Statistics</div>
      <div className="mb-4 grid max-w-2xl grid-cols-[10rem_minmax(0,1fr)] gap-3 rounded border border-slate-800 bg-slate-950 p-3 text-sm">
        <label className="self-center text-slate-400" htmlFor="stats-channel">
          Line
        </label>
        <ChannelSelect
          id="stats-channel"
          label="Statistics channel"
          selectedChannelKey={selectedChannelKey}
          setSelectedChannelKey={setSelectedChannelKey}
          signals={signals}
          traceName={traceName}
        />
      </div>
      <div className="rounded border border-slate-800 bg-slate-950 p-4">
        <div className="mb-3 flex items-center gap-2">
          {(['central', 'dispersion'] as const).map((view) => (
            <button
              key={view}
              className={`h-8 rounded border px-3 text-sm ${
                statsView === view
                  ? 'border-sky-500 bg-sky-500/15 text-sky-100'
                  : 'border-slate-700 bg-slate-900 text-slate-300 hover:border-slate-500'
              }`}
              type="button"
              onClick={() => setStatsView(view)}
            >
              {view === 'central' ? 'Central tendency' : 'Dispersion'}
            </button>
          ))}
          <div className="ml-auto font-mono text-xs text-slate-500">
            n = {selectedWindow.y.length}
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-2 py-2 font-medium">Metric</th>
                <th className="px-2 py-2 text-right font-medium">X-data</th>
                <th className="px-2 py-2 font-medium" />
                <th className="px-2 py-2 text-right font-medium">Y-data</th>
                <th className="px-2 py-2 font-medium" />
              </tr>
            </thead>
            <tbody>
              {rows.map(([label, xValue, yValue]) => (
                <tr key={label} className="border-t border-slate-800">
                  <td className="px-2 py-2 text-slate-300">{label}</td>
                  <td className="px-2 py-2 text-right font-mono text-slate-100">
                    {formatAnalysisValue(xValue)}
                  </td>
                  <td className="px-2 py-2">
                    <CopyButton
                      disabled={xValue === null}
                      onClick={() => copyHighPrecisionValue(`x_${label.toLowerCase()}`, xValue)}
                    />
                  </td>
                  <td className="px-2 py-2 text-right font-mono text-slate-100">
                    {formatAnalysisValue(yValue)}
                  </td>
                  <td className="px-2 py-2">
                    <CopyButton
                      disabled={yValue === null}
                      onClick={() => copyHighPrecisionValue(`y_${label.toLowerCase()}`, yValue)}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {copyStatus ? <div className="mt-3 text-xs text-slate-500">{copyStatus}</div> : null}
      </div>
    </div>
  );
}

function CopyButton({ disabled, onClick }: { disabled: boolean; onClick: () => void }) {
  return (
    <button
      className="h-7 rounded border border-slate-700 px-2 text-xs text-slate-300 hover:border-slate-500 disabled:text-slate-600"
      disabled={disabled}
      type="button"
      onClick={onClick}
    >
      Copy
    </button>
  );
}
