import Plotly from 'plotly.js-dist-min';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

type Channel = {
  id: number;
  group_name: string;
  name: string;
  unit: string | null;
  dtype: string;
  sample_count: number;
  is_valve: boolean;
};

type DatasetSummary = {
  id: number;
  name: string;
  test_id: string;
  metadata: {
    duration_s?: number;
    sample_count?: number;
    groups?: string[];
  };
  channels: Channel[];
};

type ChannelData = {
  dataset_id: number;
  channel_id: number;
  channel_name: string;
  group_name: string;
  unit: string | null;
  t: number[];
  y: number[];
  decimated: boolean;
  point_count: number;
  full_point_count: number;
};

type LoadState = 'idle' | 'loading' | 'ready' | 'error';
type PlotResolution = 'fast' | 'full';
type FilterKind = 'none' | 'butterworth' | 'moving-average';

type FilterConfig = {
  kind: FilterKind;
  cutoffHz: number;
  order: 2 | 4;
  windowSamples: number;
};

type TimeWindow = {
  tMin: number;
  tMax: number;
};

type PlotElement = HTMLDivElement & {
  on?: (eventName: string, handler: (event: Record<string, unknown>) => void) => void;
  removeListener?: (eventName: string, handler: (event: Record<string, unknown>) => void) => void;
};

const MAX_POINTS = 4000;
const TRACE_COLORS = ['#38bdf8', '#f97316', '#a78bfa', '#22c55e', '#f43f5e', '#eab308'];
const VALVE_COLORS = ['#facc15', '#fb7185', '#34d399', '#60a5fa', '#c084fc', '#f97316'];
const DEFAULT_FILTER: FilterConfig = {
  kind: 'none',
  cutoffHz: 20,
  order: 4,
  windowSamples: 25,
};

function displayChannels(channels: Channel[]): Channel[] {
  return channels.filter((channel) => !channel.name.endsWith(' (raw)'));
}

function signalChannels(channels: Channel[]): Channel[] {
  return displayChannels(channels).filter((channel) => !channel.is_valve);
}

function valveChannels(channels: Channel[]): Channel[] {
  return displayChannels(channels).filter((channel) => channel.is_valve);
}

function chooseDefaultSignalIds(channels: Channel[]): number[] {
  const signals = signalChannels(channels);
  const preferred = ['Chamber Eth', 'Chamber LOx']
    .map((name) =>
      signals.find((channel) => channel.group_name === 'Pressure Sensors' && channel.name === name),
    )
    .filter((channel): channel is Channel => Boolean(channel));

  if (preferred.length > 0) return preferred.map((channel) => channel.id);
  return signals[0] ? [signals[0].id] : [];
}

function groupChannels(channels: Channel[]): Array<[string, Channel[]]> {
  const groups = new Map<string, Channel[]>();
  for (const channel of channels) {
    const group = groups.get(channel.group_name) ?? [];
    group.push(channel);
    groups.set(channel.group_name, group);
  }
  return [...groups.entries()];
}

function formatCount(value: number | undefined): string {
  if (value === undefined) return '0';
  return Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(value);
}

function sameIds(a: number[], b: number[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function toggleId(ids: number[], id: number): number[] {
  return ids.includes(id) ? ids.filter((value) => value !== id) : [...ids, id];
}

function openSegments(data: ChannelData): Array<{ x0: number; x1: number }> {
  const segments: Array<{ x0: number; x1: number }> = [];
  let start: number | null = null;

  for (let i = 0; i < data.t.length; i += 1) {
    const isOpen = Number(data.y[i]) > 0.5;
    if (isOpen && start === null) start = data.t[i];
    if (!isOpen && start !== null) {
      segments.push({ x0: start, x1: data.t[i] });
      start = null;
    }
  }

  if (start !== null && data.t.length > 0) {
    segments.push({ x0: start, x1: data.t[data.t.length - 1] });
  }

  return segments;
}

function valveLabel(name: string): string {
  return name.replace(/-/g, '');
}

function overlayDomain(valveCount: number): { signalTop: number; overlayBottom: number } {
  if (valveCount === 0) return { signalTop: 1, overlayBottom: 1 };
  const overlayHeight = Math.min(0.3, Math.max(0.13, valveCount * 0.024));
  const signalTop = 1 - overlayHeight - 0.045;
  return { signalTop, overlayBottom: signalTop + 0.055 };
}

function buildValveOverlay(valves: ChannelData[]) {
  const shapes: Array<Record<string, unknown>> = [];
  const annotations: Array<Record<string, unknown>> = [];
  if (valves.length === 0) return { shapes, annotations };

  const { overlayBottom } = overlayDomain(valves.length);
  const laneArea = 0.98 - overlayBottom;
  const gap = Math.min(0.004, laneArea / valves.length / 5);
  const bandHeight = Math.max(0.008, (laneArea - gap * (valves.length - 1)) / valves.length);
  const labelSize = valves.length > 8 ? 8 : 9;
  const top = 0.99;

  valves.forEach((valve, index) => {
    const y1 = top - index * (bandHeight + gap);
    const y0 = y1 - bandHeight;
    const color = VALVE_COLORS[index % VALVE_COLORS.length];

    annotations.push({
      x: 0,
      xref: 'paper',
      xanchor: 'right',
      xshift: -6,
      y: (y0 + y1) / 2,
      yref: 'paper',
      text: valveLabel(valve.channel_name),
      font: { color: color, size: labelSize },
      showarrow: false,
    });

    for (const segment of openSegments(valve)) {
      shapes.push({
        type: 'rect',
        xref: 'x',
        yref: 'paper',
        x0: segment.x0,
        x1: segment.x1,
        y0,
        y1,
        fillcolor: color,
        opacity: 0.82,
        line: { width: 0 },
        layer: 'above',
      });
    }
  });

  return { shapes, annotations };
}

function valveSummary(valves: ChannelData[]): string {
  if (valves.length === 0) return '';
  const names = valves.map((valve) => valveLabel(valve.channel_name));
  const shown = names.slice(0, 8).join(' ');
  return names.length > 8 ? `${shown} +${names.length - 8}` : shown;
}

function apiFilterKind(kind: FilterKind): 'none' | 'butterworth' | 'moving_average' {
  return kind === 'moving-average' ? 'moving_average' : kind;
}

function addFilterParams(params: URLSearchParams, filter: FilterConfig) {
  params.set('filter_kind', apiFilterKind(filter.kind));
  if (filter.kind === 'butterworth') {
    params.set('cutoff_hz', String(filter.cutoffHz));
    params.set('order', String(filter.order));
  }
  if (filter.kind === 'moving-average') {
    params.set('window_samples', String(filter.windowSamples));
  }
}

function filterBody(filter: FilterConfig) {
  return {
    kind: apiFilterKind(filter.kind),
    cutoff_hz: filter.cutoffHz,
    order: filter.order,
    window_samples: filter.windowSamples,
  };
}

function parseRelayoutWindow(event: Record<string, unknown>): TimeWindow | null | undefined {
  if (event['xaxis.autorange']) return null;

  const range = event['xaxis.range'];
  if (Array.isArray(range) && range.length >= 2) {
    const tMin = Number(range[0]);
    const tMax = Number(range[1]);
    return Number.isFinite(tMin) && Number.isFinite(tMax) ? { tMin, tMax } : undefined;
  }

  const tMin = Number(event['xaxis.range[0]']);
  const tMax = Number(event['xaxis.range[1]']);
  if (Number.isFinite(tMin) && Number.isFinite(tMax)) return { tMin, tMax };
  return undefined;
}

function maxPointsForPlotWidth(width: number): number {
  if (width < 100) return MAX_POINTS;
  return Math.round(Math.min(12000, Math.max(2000, width * 3)));
}

export default function App() {
  const plotRef = useRef<HTMLDivElement | null>(null);
  const relayoutTimerRef = useRef<number | null>(null);
  const [datasets, setDatasets] = useState<DatasetSummary[]>([]);
  const [selectedDatasetId, setSelectedDatasetId] = useState<number | null>(null);
  const [draftSignalIds, setDraftSignalIds] = useState<number[]>([]);
  const [draftValveIds, setDraftValveIds] = useState<number[]>([]);
  const [draftResolution, setDraftResolution] = useState<PlotResolution>('fast');
  const [plotSignalIds, setPlotSignalIds] = useState<number[]>([]);
  const [plotValveIds, setPlotValveIds] = useState<number[]>([]);
  const [plotResolution, setPlotResolution] = useState<PlotResolution>('fast');
  const [filter, setFilter] = useState<FilterConfig>(DEFAULT_FILTER);
  const [visibleWindow, setVisibleWindow] = useState<TimeWindow | null>(null);
  const [displayMaxPoints, setDisplayMaxPoints] = useState(MAX_POINTS);
  const [signalData, setSignalData] = useState<ChannelData[]>([]);
  const [valveData, setValveData] = useState<ChannelData[]>([]);
  const [datasetState, setDatasetState] = useState<LoadState>('idle');
  const [plotState, setPlotState] = useState<LoadState>('idle');
  const [error, setError] = useState<string | null>(null);

  const selectedDataset = useMemo(
    () => datasets.find((dataset) => dataset.id === selectedDatasetId) ?? null,
    [datasets, selectedDatasetId],
  );

  const groupedSignals = useMemo(
    () => groupChannels(signalChannels(selectedDataset?.channels ?? [])),
    [selectedDataset],
  );
  const availableValves = useMemo(
    () => valveChannels(selectedDataset?.channels ?? []),
    [selectedDataset],
  );

  const setupDirty =
    !sameIds(draftSignalIds, plotSignalIds) ||
    !sameIds(draftValveIds, plotValveIds) ||
    draftResolution !== plotResolution;
  const totalDisplayedPoints = signalData.reduce((total, data) => total + data.point_count, 0);
  const totalFullPoints = signalData.reduce((total, data) => total + data.full_point_count, 0);

  useEffect(() => {
    let cancelled = false;

    async function loadDatasets() {
      setDatasetState('loading');
      setError(null);
      try {
        const listResponse = await fetch('/api/datasets');
        if (!listResponse.ok) throw new Error(`Datasets HTTP ${listResponse.status}`);
        const summaries = (await listResponse.json()) as DatasetSummary[];

        const detailed = await Promise.all(
          summaries.map(async (summary) => {
            const response = await fetch(`/api/datasets/${summary.id}`);
            if (!response.ok) throw new Error(`Dataset ${summary.id} HTTP ${response.status}`);
            return (await response.json()) as DatasetSummary;
          }),
        );

        if (cancelled) return;
        setDatasets(detailed);

        const firstDataset = detailed[0] ?? null;
        const defaultSignals = chooseDefaultSignalIds(firstDataset?.channels ?? []);
        setSelectedDatasetId(firstDataset?.id ?? null);
        setDraftSignalIds(defaultSignals);
        setDraftValveIds([]);
        setDraftResolution('fast');
        setPlotSignalIds(defaultSignals);
        setPlotValveIds([]);
        setPlotResolution('fast');
        setVisibleWindow(null);
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
    if (!selectedDatasetId || plotSignalIds.length === 0) {
      setSignalData([]);
      setValveData([]);
      setPlotState('idle');
      return;
    }

    const controller = new AbortController();
    async function loadPlotData() {
      setPlotState('loading');
      setError(null);
      try {
        const ids = [...plotSignalIds, ...plotValveIds];
        const signalIdSet = new Set(plotSignalIds);
        const responses = await Promise.all(
          ids.map(async (channelId) => {
            const channelFilter = signalIdSet.has(channelId) ? filter : DEFAULT_FILTER;
            const params = new URLSearchParams();
            addFilterParams(params, channelFilter);
            if (visibleWindow) {
              params.set('t_min', String(visibleWindow.tMin));
              params.set('t_max', String(visibleWindow.tMax));
            }
            params.set('max_points', String(displayMaxPoints));

            const fullBody = {
              ...(visibleWindow
                ? {
                    t_min: visibleWindow.tMin,
                    t_max: visibleWindow.tMax,
                  }
                : {}),
              filter: filterBody(channelFilter),
            };
            const response =
              plotResolution === 'full'
                ? await fetch(
                    `/api/datasets/${selectedDatasetId}/channels/${channelId}/data/full`,
                    {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify(fullBody),
                      signal: controller.signal,
                    },
                  )
                : await fetch(
                    `/api/datasets/${selectedDatasetId}/channels/${channelId}/data?${params.toString()}`,
                    { signal: controller.signal },
                  );
            if (!response.ok) throw new Error(`Channel data HTTP ${response.status}`);
            return (await response.json()) as ChannelData;
          }),
        );

        if (controller.signal.aborted) return;
        setSignalData(responses.filter((data) => signalIdSet.has(data.channel_id)));
        setValveData(responses.filter((data) => !signalIdSet.has(data.channel_id)));
        setPlotState('ready');
      } catch (err) {
        if (controller.signal.aborted) return;
        setPlotState('error');
        setError(err instanceof Error ? err.message : 'Unable to load channel data');
      }
    }

    void loadPlotData();
    return () => controller.abort();
  }, [
    selectedDatasetId,
    plotSignalIds,
    plotValveIds,
    plotResolution,
    filter,
    visibleWindow,
    displayMaxPoints,
  ]);

  useEffect(() => {
    const plot = plotRef.current;
    if (!plot || signalData.length === 0) return;

    const units = [...new Set(signalData.map((data) => data.unit).filter(Boolean))];
    const yLabel = units.length === 1 ? `Signals [${units[0]}]` : 'Signals';
    const { shapes, annotations } = buildValveOverlay(valveData);
    const { signalTop } = overlayDomain(valveData.length);
    const titleText =
      signalData.length === 1
        ? `${signalData[0].group_name} / ${signalData[0].channel_name}`
        : `${signalData.length} traces`;
    const overlayText = valveSummary(valveData);
    const filterText =
      filter.kind === 'none'
        ? ''
        : filter.kind === 'butterworth'
          ? ` · Butterworth ${filter.cutoffHz} Hz`
          : ` · Avg ${filter.windowSamples} samples`;

    void Plotly.react(
      plot,
      signalData.map((data, index) => ({
        x: data.t,
        y: data.y,
        type: 'scattergl',
        mode: 'lines',
        name: data.channel_name,
        line: { color: TRACE_COLORS[index % TRACE_COLORS.length], width: 1.6 },
        hovertemplate: 't=%{x:.4f}s<br>%{y:.4f}<extra>%{fullData.name}</extra>',
      })),
      {
        autosize: true,
        paper_bgcolor: '#020617',
        plot_bgcolor: '#0f172a',
        font: { color: '#cbd5e1', family: 'Inter, ui-sans-serif, system-ui' },
        uirevision: 'plot-1',
        margin: {
          l: 72,
          r: 28,
          t: valveData.length > 0 ? 82 : 52,
          b: signalData.length > 5 ? 88 : 60,
        },
        title: {
          text: overlayText
            ? `${titleText}${filterText}<br><sup>Valves: ${overlayText}</sup>`
            : `${titleText}${filterText}`,
          font: { size: 16, color: '#f8fafc' },
          x: 0,
          xanchor: 'left',
        },
        xaxis: {
          title: { text: 'Time [s]' },
          gridcolor: '#1e293b',
          zerolinecolor: '#334155',
          rangeslider: { visible: false },
        },
        yaxis: {
          title: { text: yLabel },
          gridcolor: '#1e293b',
          zerolinecolor: '#334155',
          domain: [0, signalTop],
        },
        hovermode: 'x unified',
        showlegend: true,
        legend: {
          orientation: signalData.length > 5 ? 'h' : 'v',
          x: signalData.length > 5 ? 0 : 1,
          xanchor: signalData.length > 5 ? 'left' : 'right',
          y: signalData.length > 5 ? -0.18 : signalTop - 0.02,
          yanchor: signalData.length > 5 ? 'top' : 'top',
          bgcolor: 'rgba(2, 6, 23, 0.74)',
          bordercolor: '#334155',
          borderwidth: 1,
          font: { size: 11 },
        },
        shapes,
        annotations,
      },
      {
        responsive: true,
        displaylogo: false,
        scrollZoom: true,
      },
    );
  }, [signalData, valveData, filter]);

  useEffect(() => {
    const plot = plotRef.current;
    if (!plot) return;

    const syncMaxPoints = () => {
      const nextMaxPoints = maxPointsForPlotWidth(plot.clientWidth);
      setDisplayMaxPoints((current) => (current === nextMaxPoints ? current : nextMaxPoints));
    };
    syncMaxPoints();

    const resizeObserver = new ResizeObserver(() => {
      syncMaxPoints();
      void Plotly.Plots.resize(plot);
    });
    resizeObserver.observe(plot);
    return () => resizeObserver.disconnect();
  }, []);

  useEffect(() => {
    const plot = plotRef.current as PlotElement | null;
    if (!plot?.on) return;

    const handleRelayout = (event: Record<string, unknown>) => {
      const nextWindow = parseRelayoutWindow(event);
      if (nextWindow === undefined) return;
      if (relayoutTimerRef.current !== null) {
        window.clearTimeout(relayoutTimerRef.current);
      }
      relayoutTimerRef.current = window.setTimeout(() => {
        setVisibleWindow(nextWindow);
      }, 200);
    };

    plot.on('plotly_relayout', handleRelayout);
    return () => {
      if (relayoutTimerRef.current !== null) {
        window.clearTimeout(relayoutTimerRef.current);
      }
      plot.removeListener?.('plotly_relayout', handleRelayout);
    };
  }, [signalData.length]);

  const handleDatasetChange = useCallback(
    (datasetId: number) => {
      const dataset = datasets.find((item) => item.id === datasetId) ?? null;
      const defaultSignals = chooseDefaultSignalIds(dataset?.channels ?? []);
      setSelectedDatasetId(dataset?.id ?? null);
      setDraftSignalIds(defaultSignals);
      setDraftValveIds([]);
      setDraftResolution('fast');
      setPlotSignalIds(defaultSignals);
      setPlotValveIds([]);
      setPlotResolution('fast');
      setVisibleWindow(null);
    },
    [datasets],
  );

  const applySetup = useCallback(() => {
    setPlotSignalIds(draftSignalIds);
    setPlotValveIds(draftValveIds);
    setPlotResolution(draftResolution);
  }, [draftSignalIds, draftValveIds, draftResolution]);

  const hasDatasets = datasets.length > 0;
  const canApply = draftSignalIds.length > 0 && setupDirty;

  return (
    <main className="h-screen overflow-hidden bg-slate-950 text-slate-100">
      <div className="flex h-full min-h-0 flex-col lg:flex-row">
        <aside className="flex h-[44vh] w-full shrink-0 flex-col border-b border-slate-800 bg-slate-900/95 lg:h-full lg:w-96 lg:border-b-0 lg:border-r">
          <div className="border-b border-slate-800 px-4 py-3">
            <div className="text-lg font-semibold tracking-tight">DAxolotl</div>
            <div className="mt-1 text-xs text-slate-400">plot setup</div>
          </div>

          <div className="border-b border-slate-800 p-3">
            <label className="text-xs font-medium uppercase tracking-wide text-slate-500">
              Dataset
            </label>
            <select
              className="mt-2 h-9 w-full rounded border border-slate-700 bg-slate-950 px-2 text-sm text-slate-100 outline-none focus:border-sky-500"
              disabled={!hasDatasets}
              value={selectedDatasetId ?? ''}
              onChange={(event) => handleDatasetChange(Number(event.target.value))}
            >
              {!hasDatasets ? <option value="">No datasets</option> : null}
              {datasets.map((dataset) => (
                <option key={dataset.id} value={dataset.id}>
                  {dataset.name}
                </option>
              ))}
            </select>

            {selectedDataset ? (
              <dl className="mt-3 grid grid-cols-2 gap-2 text-xs">
                <div className="rounded border border-slate-800 bg-slate-950 p-2">
                  <dt className="text-slate-500">Samples</dt>
                  <dd className="mt-1 font-mono text-slate-200">
                    {formatCount(selectedDataset.metadata.sample_count)}
                  </dd>
                </div>
                <div className="rounded border border-slate-800 bg-slate-950 p-2">
                  <dt className="text-slate-500">Duration</dt>
                  <dd className="mt-1 font-mono text-slate-200">
                    {(selectedDataset.metadata.duration_s ?? 0).toFixed(2)} s
                  </dd>
                </div>
              </dl>
            ) : null}
          </div>

          <div className="flex min-h-0 flex-1 flex-col">
            <div className="flex h-11 shrink-0 items-center border-b border-slate-800 px-3">
              <div className="text-xs font-medium uppercase tracking-wide text-slate-500">
                Plot setup
              </div>
              <button
                className="ml-auto h-8 whitespace-nowrap rounded border border-sky-500 bg-sky-500/15 px-3 text-xs font-medium text-sky-100 disabled:border-slate-700 disabled:bg-slate-950 disabled:text-slate-600"
                disabled={!canApply}
                type="button"
                onClick={applySetup}
              >
                Apply
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto p-3">
              <section className="mb-5">
                <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Resolution
                </div>
                <div className="grid grid-cols-2 rounded border border-slate-800 bg-slate-950 p-1">
                  {(['fast', 'full'] as PlotResolution[]).map((resolution) => {
                    const active = draftResolution === resolution;
                    return (
                      <button
                        key={resolution}
                        aria-pressed={active}
                        className={`h-8 rounded text-xs font-medium transition ${
                          active
                            ? 'bg-sky-500/20 text-sky-100'
                            : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200'
                        }`}
                        type="button"
                        onClick={() => setDraftResolution(resolution)}
                      >
                        {resolution === 'fast' ? 'Fast' : 'Full'}
                      </button>
                    );
                  })}
                </div>
              </section>

              <section>
                <div className="mb-2 flex items-center justify-between">
                  <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Signals
                  </div>
                  <div className="font-mono text-xs text-slate-500">
                    {draftSignalIds.length} selected
                  </div>
                </div>
                <div className="space-y-3">
                  {groupedSignals.map(([groupName, channels]) => (
                    <div key={groupName}>
                      <div className="mb-1 text-xs font-semibold text-slate-400">{groupName}</div>
                      <div className="space-y-1">
                        {channels.map((channel) => {
                          const checked = draftSignalIds.includes(channel.id);
                          return (
                            <label
                              key={channel.id}
                              className={`flex h-8 cursor-pointer items-center rounded border px-2 text-xs transition ${
                                checked
                                  ? 'border-sky-500 bg-sky-500/15 text-sky-100'
                                  : 'border-slate-800 bg-slate-950 text-slate-300 hover:border-slate-600'
                              }`}
                            >
                              <input
                                checked={checked}
                                className="mr-2 h-3.5 w-3.5 accent-sky-500"
                                type="checkbox"
                                onChange={() =>
                                  setDraftSignalIds((ids) => toggleId(ids, channel.id))
                                }
                              />
                              <span className="truncate">{channel.name}</span>
                              <span className="ml-auto shrink-0 pl-2 font-mono text-slate-500">
                                {channel.unit ?? channel.dtype}
                              </span>
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              </section>

              <section className="mt-5">
                <div className="mb-2 flex items-center justify-between">
                  <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Valve overlay
                  </div>
                  <div className="font-mono text-xs text-slate-500">
                    {draftValveIds.length} selected
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-1">
                  {availableValves.map((channel) => {
                    const checked = draftValveIds.includes(channel.id);
                    return (
                      <label
                        key={channel.id}
                        className={`flex h-8 cursor-pointer items-center rounded border px-2 text-xs transition ${
                          checked
                            ? 'border-amber-400 bg-amber-400/15 text-amber-100'
                            : 'border-slate-800 bg-slate-950 text-slate-300 hover:border-slate-600'
                        }`}
                      >
                        <input
                          checked={checked}
                          className="mr-2 h-3.5 w-3.5 accent-amber-400"
                          type="checkbox"
                          onChange={() => setDraftValveIds((ids) => toggleId(ids, channel.id))}
                        />
                        <span className="truncate">{channel.name}</span>
                      </label>
                    );
                  })}
                </div>
              </section>
            </div>
          </div>
        </aside>

        <section className="flex min-w-0 flex-1 flex-col">
          <div className="flex h-11 shrink-0 items-center border-b border-slate-800 bg-slate-900 px-3">
            <button
              className="h-8 whitespace-nowrap rounded border border-sky-500 bg-sky-500/15 px-3 text-sm font-medium text-sky-100"
              type="button"
            >
              Plot 1
            </button>
            <div className="ml-3 flex h-8 items-center gap-2 rounded border border-slate-800 bg-slate-950 px-2 text-xs">
              <label className="sr-only" htmlFor="plot-filter">
                Filter
              </label>
              <select
                id="plot-filter"
                aria-label="Filter"
                className="h-6 rounded bg-slate-950 text-slate-200 outline-none"
                value={filter.kind}
                onChange={(event) =>
                  setFilter((current) => ({
                    ...current,
                    kind: event.target.value as FilterKind,
                  }))
                }
              >
                <option value="none">No filter</option>
                <option value="butterworth">Butterworth</option>
                <option value="moving-average">Running avg</option>
              </select>
              {filter.kind === 'butterworth' ? (
                <>
                  <label className="sr-only" htmlFor="filter-cutoff">
                    Cutoff Hz
                  </label>
                  <input
                    id="filter-cutoff"
                    aria-label="Cutoff Hz"
                    className="h-6 w-16 rounded border border-slate-800 bg-slate-950 px-1 font-mono text-slate-200 outline-none focus:border-sky-500"
                    min={0.1}
                    step={1}
                    type="number"
                    value={filter.cutoffHz}
                    onChange={(event) =>
                      setFilter((current) => ({
                        ...current,
                        cutoffHz: Number(event.target.value),
                      }))
                    }
                  />
                  <span className="text-slate-500">Hz</span>
                  <label className="sr-only" htmlFor="filter-order">
                    Filter order
                  </label>
                  <select
                    id="filter-order"
                    aria-label="Filter order"
                    className="h-6 rounded bg-slate-950 font-mono text-slate-200 outline-none"
                    value={filter.order}
                    onChange={(event) =>
                      setFilter((current) => ({
                        ...current,
                        order: Number(event.target.value) as 2 | 4,
                      }))
                    }
                  >
                    <option value={2}>2p</option>
                    <option value={4}>4p</option>
                  </select>
                </>
              ) : null}
              {filter.kind === 'moving-average' ? (
                <>
                  <label className="sr-only" htmlFor="filter-window">
                    Window samples
                  </label>
                  <input
                    id="filter-window"
                    aria-label="Window samples"
                    className="h-6 w-16 rounded border border-slate-800 bg-slate-950 px-1 font-mono text-slate-200 outline-none focus:border-sky-500"
                    min={1}
                    step={1}
                    type="number"
                    value={filter.windowSamples}
                    onChange={(event) =>
                      setFilter((current) => ({
                        ...current,
                        windowSamples: Number(event.target.value),
                      }))
                    }
                  />
                  <span className="text-slate-500">pts</span>
                </>
              ) : null}
            </div>
            <div className="ml-auto font-mono text-xs text-slate-400">
              {signalData.length > 0
                ? `${plotResolution} · ${formatCount(totalDisplayedPoints)} / ${formatCount(totalFullPoints)} points`
                : datasetState === 'loading' || plotState === 'loading'
                  ? 'loading'
                  : 'idle'}
            </div>
          </div>

          <div className="relative min-h-0 flex-1 bg-slate-950 p-3">
            <div
              ref={plotRef}
              className="h-full min-h-[420px] w-full border border-slate-800 bg-slate-900"
            />

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

            {draftSignalIds.length === 0 && hasDatasets ? (
              <div className="absolute left-6 top-6 rounded border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-300">
                Select at least one signal.
              </div>
            ) : null}
          </div>
        </section>
      </div>
    </main>
  );
}
