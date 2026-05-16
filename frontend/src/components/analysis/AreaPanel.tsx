import type { ChannelData } from '../../types';
import { formatAnalysisValue } from '../../lib/plotUtils';
import { ChannelSelect } from './PolyfitPanel';
import type { TraceName } from './analysisTypes';

export default function AreaPanel({
  area,
  average,
  copyArea,
  copyStatus,
  duration,
  selectedChannelKey,
  selectedSignal,
  selectedWindow,
  setSelectedChannelKey,
  signals,
  traceName,
}: {
  area: number | null;
  average: number | null;
  copyArea: () => void;
  copyStatus: string;
  duration: number | null;
  selectedChannelKey: string;
  selectedSignal: ChannelData | undefined;
  selectedWindow: { t: number[]; y: number[] };
  setSelectedChannelKey: (key: string) => void;
  signals: ChannelData[];
  traceName: TraceName;
}) {
  return (
    <div>
      <div className="mb-3 text-sm font-semibold text-slate-100">Area</div>
      <div className="mb-4 grid max-w-2xl grid-cols-[10rem_minmax(0,1fr)] gap-3 rounded border border-slate-800 bg-slate-950 p-3 text-sm">
        <label className="self-center text-slate-400" htmlFor="area-channel">
          Line
        </label>
        <ChannelSelect
          id="area-channel"
          label="Area channel"
          selectedChannelKey={selectedChannelKey}
          setSelectedChannelKey={setSelectedChannelKey}
          signals={signals}
          traceName={traceName}
        />
      </div>
      <div className="rounded border border-slate-800 bg-slate-950 p-4">
        <div className="mb-3 text-sm font-medium text-slate-100">
          {selectedSignal ? traceName(selectedSignal) : 'Select a channel'}
        </div>
        <dl className="grid max-w-lg grid-cols-2 gap-2 text-sm">
          <dt className="text-slate-500">Area</dt>
          <dd className="text-right font-mono text-slate-200">
            {formatAnalysisValue(area)} {selectedSignal?.unit ? `${selectedSignal.unit}*s` : ''}
          </dd>
          <dt className="text-slate-500">Duration</dt>
          <dd className="text-right font-mono text-slate-200">{formatAnalysisValue(duration)} s</dd>
          <dt className="text-slate-500">Average</dt>
          <dd className="text-right font-mono text-slate-200">
            {formatAnalysisValue(average)} {selectedSignal?.unit ?? ''}
          </dd>
          <dt className="text-slate-500">Samples</dt>
          <dd className="text-right font-mono text-slate-200">{selectedWindow.y.length}</dd>
        </dl>
        <div className="mt-4 flex items-center gap-2">
          <button
            className="h-8 rounded border border-slate-700 bg-slate-950 px-3 text-sm text-slate-300 hover:border-slate-500 disabled:text-slate-600"
            disabled={area === null}
            type="button"
            onClick={copyArea}
          >
            Copy area
          </button>
          {copyStatus ? <span className="text-xs text-slate-500">{copyStatus}</span> : null}
        </div>
      </div>
    </div>
  );
}
