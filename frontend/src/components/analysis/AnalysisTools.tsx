import { useEffect, useMemo, useState } from 'react';
import {
  refKey,
  findDataset,
  timeRange,
  cursorInterval,
  dataInWindow,
  trapezoidArea,
  calculateStats,
  polynomialFit,
  normalizePolynomialDegree,
} from '../../lib/plotUtils';
import type {
  AnalysisIntervalMode,
  AnalysisTool,
  ChannelData,
  DatasetSummary,
  PlotAnalysisData,
  PlotConfig,
  RegressionConfig,
} from '../../types';
import AnalysisSidebar from './AnalysisSidebar';
import AreaPanel from './AreaPanel';
import FftPanel from './FftPanel';
import HistogramPanel from './HistogramPanel';
import PolyfitPanel from './PolyfitPanel';
import StatsPanel from './StatsPanel';

export default function AnalysisTools({
  datasets,
  plot,
  analysisData,
  onAddRegression,
  onRemoveRegression,
  onClose,
}: {
  datasets: DatasetSummary[];
  plot: PlotConfig;
  analysisData: PlotAnalysisData | null;
  onAddRegression: (regression: RegressionConfig) => void;
  onRemoveRegression: (id: string) => void;
  onClose: () => void;
}) {
  const cursorWindow = cursorInterval(plot);
  const viewportWindow = analysisData?.visibleWindow ?? timeRange(analysisData?.signals ?? []);
  const [tool, setTool] = useState<AnalysisTool>('polyfit');
  const [intervalMode, setIntervalMode] = useState<AnalysisIntervalMode>(
    cursorWindow ? 'cursors' : 'viewport',
  );
  const [manualMinDraft, setManualMinDraft] = useState('');
  const [manualMaxDraft, setManualMaxDraft] = useState('');
  const [polyfitDegree, setPolyfitDegree] = useState(1);
  const [selectedChannelKey, setSelectedChannelKey] = useState('');
  const [copyStatus, setCopyStatus] = useState('');
  const [statsView, setStatsView] = useState<'central' | 'dispersion'>('central');

  useEffect(() => {
    const fallback = cursorWindow ?? viewportWindow;
    setManualMinDraft(fallback ? String(fallback.tMin) : '');
    setManualMaxDraft(fallback ? String(fallback.tMax) : '');
  }, [cursorWindow?.tMax, cursorWindow?.tMin, viewportWindow?.tMax, viewportWindow?.tMin]);

  const manualWindow = useMemo(() => {
    const tMin = Number(manualMinDraft);
    const tMax = Number(manualMaxDraft);
    if (!Number.isFinite(tMin) || !Number.isFinite(tMax) || tMin === tMax) return null;
    return { tMin: Math.min(tMin, tMax), tMax: Math.max(tMin, tMax) };
  }, [manualMaxDraft, manualMinDraft]);
  const interval =
    intervalMode === 'cursors'
      ? cursorWindow
      : intervalMode === 'manual'
        ? manualWindow
        : viewportWindow;
  const signals = analysisData?.signals ?? [];

  useEffect(() => {
    if (selectedChannelKey || signals.length === 0) return;
    setSelectedChannelKey(
      refKey({ datasetId: signals[0].dataset_id, channelId: signals[0].channel_id }),
    );
  }, [selectedChannelKey, signals]);

  const plottedDatasetIds = new Set(signals.map((data) => data.dataset_id));
  const traceName = (data: ChannelData) => {
    const datasetName = findDataset(datasets, data.dataset_id)?.name;
    return plottedDatasetIds.size > 1 && datasetName
      ? `${datasetName} / ${data.channel_name}`
      : data.channel_name;
  };
  const windowed = signals.map((data) => ({
    data,
    name: traceName(data),
    unit: data.unit,
    window: dataInWindow(data, interval),
  }));
  const hasSamples = windowed.some((item) => item.window.y.length > 0);
  const selectedSignal = signals.find(
    (data) =>
      refKey({ datasetId: data.dataset_id, channelId: data.channel_id }) === selectedChannelKey,
  );
  const selectedWindow = selectedSignal ? dataInWindow(selectedSignal, interval) : { t: [], y: [] };
  const selectedCoefficients = polynomialFit(selectedWindow.t, selectedWindow.y, polyfitDegree);
  const selectedChannelRef = selectedSignal
    ? { datasetId: selectedSignal.dataset_id, channelId: selectedSignal.channel_id }
    : null;
  const area = trapezoidArea(selectedWindow.t, selectedWindow.y);
  const duration =
    selectedWindow.t.length > 1
      ? selectedWindow.t[selectedWindow.t.length - 1] - selectedWindow.t[0]
      : null;
  const average = area !== null && duration && duration !== 0 ? area / duration : null;
  const xStats = calculateStats(selectedWindow.t);
  const yStats = calculateStats(selectedWindow.y);

  const copyText = async (text: string) => {
    try {
      if (!navigator.clipboard) throw new Error('Clipboard unavailable');
      await navigator.clipboard.writeText(text);
      setCopyStatus('Copied');
    } catch {
      setCopyStatus('Copy failed');
    }
  };
  const copyCoefficients = () => {
    if (!selectedSignal || !selectedCoefficients || selectedWindow.t.length === 0) return;
    void copyText(
      [
        `channel=${traceName(selectedSignal)}`,
        `order=${normalizePolynomialDegree(polyfitDegree)}`,
        `t0_s=${selectedWindow.t[0].toPrecision(17)}`,
        `coefficients_dt_ascending=${selectedCoefficients
          .map((coefficient) => coefficient.toPrecision(17))
          .join(', ')}`,
      ].join('\n'),
    );
  };
  const copyArea = () => {
    if (!selectedSignal || area === null) return;
    void copyText(
      [
        `channel=${traceName(selectedSignal)}`,
        `t_min_s=${selectedWindow.t[0]?.toPrecision(17) ?? ''}`,
        `t_max_s=${selectedWindow.t[selectedWindow.t.length - 1]?.toPrecision(17) ?? ''}`,
        `area=${area.toPrecision(17)}${selectedSignal.unit ? ` ${selectedSignal.unit}*s` : ''}`,
      ].join('\n'),
    );
  };
  const copyHighPrecisionValue = (_label: string, value: number | null) => {
    if (value !== null) void copyText(value.toPrecision(17));
  };
  const applyRegression = () => {
    if (!selectedChannelRef || !interval || !selectedCoefficients) return;
    onAddRegression({
      id: `regression-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      channelRef: selectedChannelRef,
      degree: normalizePolynomialDegree(polyfitDegree),
      interval,
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/75 p-4">
      <div
        aria-modal="true"
        className="flex max-h-[88vh] w-full max-w-6xl flex-col rounded border border-slate-700 bg-slate-900 shadow-2xl shadow-slate-950"
        role="dialog"
      >
        <div className="flex shrink-0 items-center gap-3 border-b border-slate-800 px-4 py-3">
          <div>
            <div className="text-sm font-semibold text-slate-100">Analysis Tools</div>
            <div className="mt-0.5 text-xs text-slate-500">
              {plot.name} · {signals.length} visible {signals.length === 1 ? 'trace' : 'traces'}
            </div>
          </div>
          <button
            className="ml-auto h-8 rounded border border-slate-700 bg-slate-950 px-3 text-sm text-slate-300 hover:border-slate-500"
            type="button"
            onClick={onClose}
          >
            Close
          </button>
          <button
            className="h-8 rounded border border-sky-500 bg-sky-500/15 px-3 text-sm font-medium text-sky-100 hover:bg-sky-500/25 disabled:border-slate-700 disabled:bg-slate-950 disabled:text-slate-600"
            disabled={
              tool !== 'polyfit' || !selectedChannelRef || !interval || !selectedCoefficients
            }
            type="button"
            onClick={applyRegression}
          >
            Add regression
          </button>
        </div>

        <div className="grid min-h-0 flex-1 grid-cols-[15rem_minmax(0,1fr)] overflow-hidden">
          <AnalysisSidebar
            cursorWindow={cursorWindow}
            interval={interval}
            intervalMode={intervalMode}
            manualMaxDraft={manualMaxDraft}
            manualMinDraft={manualMinDraft}
            setIntervalMode={setIntervalMode}
            setManualMaxDraft={setManualMaxDraft}
            setManualMinDraft={setManualMinDraft}
            setTool={setTool}
            tool={tool}
          />
          <section className="min-h-0 overflow-y-auto p-4">
            {!hasSamples ? (
              <div className="rounded border border-slate-800 bg-slate-950 p-4 text-sm text-slate-400">
                No visible samples are available for this plot and interval.
              </div>
            ) : null}
            {hasSamples ? (
              <AnalysisPanel
                area={area}
                average={average}
                centralStatRows={[
                  ['Mean', xStats.mean, yStats.mean],
                  ['Median', xStats.median, yStats.median],
                  ['Mode value', xStats.modeValue, yStats.modeValue],
                  ['Mode count', xStats.modeCount, yStats.modeCount],
                ]}
                copyArea={copyArea}
                copyCoefficients={copyCoefficients}
                copyHighPrecisionValue={copyHighPrecisionValue}
                copyStatus={copyStatus}
                dispersionStatRows={[
                  ['Minimum', xStats.min, yStats.min],
                  ['Maximum', xStats.max, yStats.max],
                  ['Range', xStats.range, yStats.range],
                  ['Standard deviation', xStats.standardDeviation, yStats.standardDeviation],
                  ['Variance', xStats.variance, yStats.variance],
                  ['Interquartile range', xStats.interquartileRange, yStats.interquartileRange],
                  ['Skewness', xStats.skewness, yStats.skewness],
                  ['Kurtosis (Fisher)', xStats.kurtosis, yStats.kurtosis],
                ]}
                duration={duration}
                onRemoveRegression={onRemoveRegression}
                plot={plot}
                polyfitDegree={polyfitDegree}
                selectedChannelKey={selectedChannelKey}
                selectedCoefficients={selectedCoefficients}
                selectedSignal={selectedSignal}
                selectedWindow={selectedWindow}
                setPolyfitDegree={setPolyfitDegree}
                setSelectedChannelKey={setSelectedChannelKey}
                setStatsView={setStatsView}
                signals={signals}
                statsView={statsView}
                tool={tool}
                traceName={traceName}
              />
            ) : null}
          </section>
        </div>
      </div>
    </div>
  );
}

function AnalysisPanel(props: {
  area: number | null;
  average: number | null;
  centralStatRows: Array<readonly [string, number | null, number | null]>;
  copyArea: () => void;
  copyCoefficients: () => void;
  copyHighPrecisionValue: (label: string, value: number | null) => void;
  copyStatus: string;
  dispersionStatRows: Array<readonly [string, number | null, number | null]>;
  duration: number | null;
  onRemoveRegression: (id: string) => void;
  plot: PlotConfig;
  polyfitDegree: number;
  selectedChannelKey: string;
  selectedCoefficients: number[] | null;
  selectedSignal: ChannelData | undefined;
  selectedWindow: { t: number[]; y: number[] };
  setPolyfitDegree: (degree: number) => void;
  setSelectedChannelKey: (key: string) => void;
  setStatsView: (view: 'central' | 'dispersion') => void;
  signals: ChannelData[];
  statsView: 'central' | 'dispersion';
  tool: AnalysisTool;
  traceName: (data: ChannelData) => string;
}) {
  if (props.tool === 'polyfit') return <PolyfitPanel {...props} />;
  if (props.tool === 'stats') return <StatsPanel {...props} />;
  if (props.tool === 'fft') return <FftPanel {...props} />;
  if (props.tool === 'histogram') return <HistogramPanel {...props} />;
  return <AreaPanel {...props} />;
}
