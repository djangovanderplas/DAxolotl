import { refKey, formatAnalysisValue, formatPolynomial } from '../../lib/plotUtils';
import type { ChannelData, PlotConfig, RegressionConfig } from '../../types';
import type { TraceName } from './analysisTypes';

export default function PolyfitPanel({
  copyCoefficients,
  copyStatus,
  onRemoveRegression,
  plot,
  polyfitDegree,
  selectedChannelKey,
  selectedCoefficients,
  selectedSignal,
  selectedWindow,
  setPolyfitDegree,
  setSelectedChannelKey,
  signals,
  traceName,
}: {
  copyCoefficients: () => void;
  copyStatus: string;
  onRemoveRegression: (id: string) => void;
  plot: PlotConfig;
  polyfitDegree: number;
  selectedChannelKey: string;
  selectedCoefficients: number[] | null;
  selectedSignal: ChannelData | undefined;
  selectedWindow: { t: number[]; y: number[] };
  setPolyfitDegree: (degree: number) => void;
  setSelectedChannelKey: (key: string) => void;
  signals: ChannelData[];
  traceName: TraceName;
}) {
  return (
    <div>
      <div className="mb-3 flex items-center gap-3">
        <div className="text-sm font-semibold text-slate-100">Regression</div>
      </div>
      <div className="mb-4 grid max-w-2xl grid-cols-[10rem_minmax(0,1fr)] gap-3 rounded border border-slate-800 bg-slate-950 p-3 text-sm">
        <label className="self-center text-slate-400" htmlFor="regression-type">
          Regression Type
        </label>
        <select
          id="regression-type"
          aria-label="Regression type"
          className="h-9 rounded border border-slate-700 bg-slate-900 px-2 text-slate-100 outline-none focus:border-sky-500"
          value="polynomial"
          onChange={() => undefined}
        >
          <option value="polynomial">Polynomial</option>
        </select>
        <label className="self-center text-slate-400" htmlFor="polyfit-degree">
          Order
        </label>
        <input
          id="polyfit-degree"
          aria-label="Polynomial order"
          className="h-9 rounded border border-slate-700 bg-slate-900 px-2 font-mono text-slate-100 outline-none focus:border-sky-500"
          min={1}
          max={5}
          type="number"
          value={polyfitDegree}
          onChange={(event) => setPolyfitDegree(Number(event.target.value))}
        />
        <label className="self-center text-slate-400" htmlFor="regression-channel">
          Line
        </label>
        <ChannelSelect
          id="regression-channel"
          label="Regression channel"
          selectedChannelKey={selectedChannelKey}
          setSelectedChannelKey={setSelectedChannelKey}
          signals={signals}
          traceName={traceName}
        />
      </div>

      <div className="mb-3 flex items-center gap-3">
        <div className="text-sm font-semibold text-slate-100">Preview</div>
        <label className="ml-auto text-xs text-slate-500" htmlFor="polyfit-degree">
          samples
        </label>
        <span className="font-mono text-xs text-slate-400">{selectedWindow.y.length}</span>
      </div>
      <div className="space-y-3">
        {selectedSignal ? (
          <div className="rounded border border-slate-800 bg-slate-950 p-3">
            <div className="mb-2 text-sm font-medium text-slate-100">
              {traceName(selectedSignal)}
            </div>
            {selectedCoefficients ? (
              <div className="font-mono text-xs text-slate-300">
                y = {formatPolynomial(selectedCoefficients)}
                <span className="ml-2 text-slate-500">{selectedSignal.unit ?? ''}</span>
                <div className="mt-1 text-slate-500">
                  dt is seconds from {formatAnalysisValue(selectedWindow.t[0])} s
                </div>
              </div>
            ) : (
              <div className="text-xs text-slate-500">
                Not enough samples for this polynomial order.
              </div>
            )}
          </div>
        ) : (
          <div className="rounded border border-slate-800 bg-slate-950 p-3 text-sm text-slate-400">
            Select a channel to regress.
          </div>
        )}
        <div className="flex items-center gap-2">
          <button
            className="h-8 rounded border border-slate-700 bg-slate-950 px-3 text-sm text-slate-300 hover:border-slate-500 disabled:text-slate-600"
            disabled={!selectedCoefficients}
            type="button"
            onClick={copyCoefficients}
          >
            Copy coefficients
          </button>
          {copyStatus ? <span className="text-xs text-slate-500">{copyStatus}</span> : null}
        </div>
        <RegressionList
          onRemoveRegression={onRemoveRegression}
          regressions={plot.regressions}
          signals={signals}
          traceName={traceName}
        />
      </div>
    </div>
  );
}

export function ChannelSelect({
  id,
  label,
  selectedChannelKey,
  setSelectedChannelKey,
  signals,
  traceName,
}: {
  id: string;
  label: string;
  selectedChannelKey: string;
  setSelectedChannelKey: (key: string) => void;
  signals: ChannelData[];
  traceName: TraceName;
}) {
  return (
    <select
      id={id}
      aria-label={label}
      className="h-9 rounded border border-slate-700 bg-slate-900 px-2 text-slate-100 outline-none focus:border-sky-500"
      value={selectedChannelKey}
      onChange={(event) => setSelectedChannelKey(event.target.value)}
    >
      {signals.map((data) => (
        <option
          key={refKey({ datasetId: data.dataset_id, channelId: data.channel_id })}
          value={refKey({ datasetId: data.dataset_id, channelId: data.channel_id })}
        >
          {traceName(data)}
        </option>
      ))}
    </select>
  );
}

function RegressionList({
  onRemoveRegression,
  regressions,
  signals,
  traceName,
}: {
  onRemoveRegression: (id: string) => void;
  regressions: RegressionConfig[];
  signals: ChannelData[];
  traceName: TraceName;
}) {
  if (regressions.length === 0) return null;
  return (
    <>
      <div className="rounded border border-slate-800 bg-slate-950 p-3">
        <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
          Active Regressions
        </div>
        <div className="space-y-2">
          {regressions.map((regression) => {
            const signal = signals.find(
              (data) =>
                refKey({ datasetId: data.dataset_id, channelId: data.channel_id }) ===
                refKey(regression.channelRef),
            );
            return (
              <div
                key={regression.id}
                className="flex items-center gap-3 rounded border border-slate-800 bg-slate-900 px-3 py-2 text-xs"
              >
                <span className="min-w-0 flex-1 truncate text-slate-200">
                  {signal ? traceName(signal) : refKey(regression.channelRef)}
                </span>
                <span className="font-mono text-slate-500">order {regression.degree}</span>
                <button
                  className="rounded border border-slate-700 px-2 py-1 text-slate-300 hover:border-rose-500 hover:text-rose-100"
                  type="button"
                  onClick={() => onRemoveRegression(regression.id)}
                >
                  Remove
                </button>
              </div>
            );
          })}
        </div>
      </div>
      <button
        className="h-8 rounded border border-rose-500/60 bg-rose-500/10 px-3 text-sm text-rose-100 hover:bg-rose-500/20"
        type="button"
        onClick={() => {
          for (const regression of regressions) onRemoveRegression(regression.id);
        }}
      >
        Clear regressions
      </button>
    </>
  );
}
