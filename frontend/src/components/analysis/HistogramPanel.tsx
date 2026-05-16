import type { ChannelData } from '../../types';
import { formatAnalysisValue } from '../../lib/plotUtils';
import { ChannelSelect } from './PolyfitPanel';
import type { TraceName } from './analysisTypes';

export default function HistogramPanel({
  selectedChannelKey,
  selectedSignal,
  selectedWindow,
  setSelectedChannelKey,
  signals,
  traceName,
}: {
  selectedChannelKey: string;
  selectedSignal: ChannelData | undefined;
  selectedWindow: { t: number[]; y: number[] };
  setSelectedChannelKey: (key: string) => void;
  signals: ChannelData[];
  traceName: TraceName;
}) {
  const bins = histogramBins(selectedWindow.y, 20);
  return (
    <div>
      <div className="mb-3 text-sm font-semibold text-slate-100">Histogram</div>
      <div className="mb-4 grid max-w-2xl grid-cols-[10rem_minmax(0,1fr)] gap-3 rounded border border-slate-800 bg-slate-950 p-3 text-sm">
        <label className="self-center text-slate-400" htmlFor="histogram-channel">
          Line
        </label>
        <ChannelSelect
          id="histogram-channel"
          label="Histogram channel"
          selectedChannelKey={selectedChannelKey}
          setSelectedChannelKey={setSelectedChannelKey}
          signals={signals}
          traceName={traceName}
        />
      </div>
      <div className="rounded border border-slate-800 bg-slate-950 p-4">
        <div className="mb-3 flex items-center gap-3">
          <div className="text-sm font-medium text-slate-100">
            {selectedSignal ? traceName(selectedSignal) : 'Select a channel'}
          </div>
          <div className="ml-auto font-mono text-xs text-slate-500">
            n = {selectedWindow.y.length}
          </div>
        </div>
        <div className="space-y-1">
          {bins.map((bin) => (
            <div key={`${bin.start}-${bin.end}`} className="grid grid-cols-[8rem_1fr_4rem] gap-2">
              <span className="font-mono text-xs text-slate-500">
                {formatAnalysisValue(bin.start)}-{formatAnalysisValue(bin.end)}
              </span>
              <div className="h-4 rounded bg-slate-900">
                <div className="h-4 rounded bg-sky-500/70" style={{ width: `${bin.percent}%` }} />
              </div>
              <span className="text-right font-mono text-xs text-slate-300">{bin.count}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function histogramBins(values: number[], binCount: number) {
  if (values.length === 0) return [];
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (min === max) return [{ start: min, end: max, count: values.length, percent: 100 }];
  const counts = Array.from({ length: binCount }, () => 0);
  for (const value of values) {
    const index = Math.min(binCount - 1, Math.floor(((value - min) / (max - min)) * binCount));
    counts[index] += 1;
  }
  const maxCount = Math.max(...counts, 1);
  const width = (max - min) / binCount;
  return counts.map((count, index) => ({
    start: min + index * width,
    end: min + (index + 1) * width,
    count,
    percent: (count / maxCount) * 100,
  }));
}
