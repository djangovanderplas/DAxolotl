import Plotly from 'plotly.js-dist-min';
import type { KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent } from 'react';
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
type CursorId = 'A' | 'B';
type CursorSnapMode = 'interpolate' | 'sample';
type AnalysisTool = 'polyfit' | 'area';
type AnalysisIntervalMode = 'cursors' | 'viewport' | 'manual';

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
  data?: Array<{ visible?: boolean | 'legendonly' }>;
  _fullLayout?: {
    _size?: { l: number; t: number; w: number; h: number };
    xaxis?: {
      p2l?: (value: number) => number;
      l2p?: (value: number) => number;
      range?: [number, number];
    };
    yaxis?: {
      p2l?: (value: number) => number;
      l2p?: (value: number) => number;
      range?: [number, number];
    };
  };
};

type PlotLayout = 'single' | 'columns' | 'rows' | 'grid';

type ChannelRef = {
  datasetId: number;
  channelId: number;
};

type RegressionConfig = {
  id: string;
  channelRef: ChannelRef;
  degree: number;
  interval: TimeWindow;
};

type PlotConfig = {
  id: string;
  name: string;
  signalRefs: ChannelRef[];
  valveRefs: ChannelRef[];
  resolution: PlotResolution;
  filter: FilterConfig;
  maxPoints: number;
  cursorA: number | null;
  cursorB: number | null;
  activeCursor: CursorId | null;
  cursorSnap: CursorSnapMode;
  cursorPanelCollapsed: boolean;
  cursorPanelPosition: { x: number; y: number } | null;
  regressions: RegressionConfig[];
};

type PlotTab = {
  id: string;
  name: string;
  layout: PlotLayout;
  plots: PlotConfig[];
};

type PlotSummary = {
  state: LoadState;
  displayedPoints: number;
  fullPoints: number;
  error: string | null;
};

type PlotAnalysisData = {
  signals: ChannelData[];
  visibleWindow: TimeWindow | null;
};

type VisibleSignalTrace = {
  data: ChannelData;
  index: number;
};

type PersistedSession = {
  version: 1;
  selectedDatasetId: number | null;
  tabs: PlotTab[];
  activeTabId: string | null;
  activePlotId: string | null;
  nextTabNumber: number;
  nextPlotNumber: number;
};

const MAX_POINTS = 4000;
const CURRENT_SESSION_KEY = 'daxolotl.currentSession';
const SAVED_SESSION_KEY = 'daxolotl.savedSession';
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

function refKey(ref: ChannelRef): string {
  return `${ref.datasetId}:${ref.channelId}`;
}

function hasRef(refs: ChannelRef[], ref: ChannelRef): boolean {
  return refs.some((value) => refKey(value) === refKey(ref));
}

function toggleRef(refs: ChannelRef[], ref: ChannelRef): ChannelRef[] {
  return hasRef(refs, ref) ? refs.filter((value) => refKey(value) !== refKey(ref)) : [...refs, ref];
}

function channelLabel(dataset: DatasetSummary | null | undefined, channel: Channel): string {
  return dataset ? `${dataset.name} / ${channel.name}` : channel.name;
}

function findDataset(datasets: DatasetSummary[], datasetId: number): DatasetSummary | null {
  return datasets.find((dataset) => dataset.id === datasetId) ?? null;
}

function findChannel(datasets: DatasetSummary[], ref: ChannelRef): Channel | null {
  return (
    findDataset(datasets, ref.datasetId)?.channels.find(
      (channel) => channel.id === ref.channelId,
    ) ?? null
  );
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

function numberOrNull(value: unknown): number | null {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function formatReadoutValue(value: number | null, unit?: string | null): string {
  if (value === null || !Number.isFinite(value)) return '—';
  const formatted = Number(value).toPrecision(Math.abs(value) >= 1000 ? 4 : 3);
  return unit ? `${formatted} ${unit}` : formatted;
}

function timeRange(data: ChannelData[]): TimeWindow | null {
  const first = data.find((item) => item.t.length > 0);
  if (!first) return null;
  return { tMin: first.t[0], tMax: first.t[first.t.length - 1] };
}

function defaultCursorTime(
  cursor: CursorId,
  signalData: ChannelData[],
  visibleWindow: TimeWindow | null,
): number | null {
  const range = visibleWindow ?? timeRange(signalData);
  if (!range) return null;
  const span = range.tMax - range.tMin;
  if (!Number.isFinite(span) || span <= 0) return range.tMin;
  return cursor === 'A' ? range.tMin + span / 3 : range.tMin + (span * 2) / 3;
}

function nearestSampleIndex(data: ChannelData, t: number): number {
  if (data.t.length <= 1) return 0;
  let low = 0;
  let high = data.t.length - 1;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (data.t[mid] < t) low = mid + 1;
    else high = mid;
  }
  if (low === 0) return 0;
  const previous = low - 1;
  return Math.abs(data.t[low] - t) < Math.abs(data.t[previous] - t) ? low : previous;
}

function yAtTime(data: ChannelData, t: number, mode: CursorSnapMode): number | null {
  if (data.t.length === 0) return null;
  const nearestIndex = nearestSampleIndex(data, t);
  if (mode === 'sample' || data.t.length === 1) return data.y[nearestIndex] ?? null;
  const rightIndex = data.t[nearestIndex] < t ? nearestIndex + 1 : nearestIndex;
  const leftIndex = Math.max(0, rightIndex - 1);
  if (rightIndex >= data.t.length || leftIndex === rightIndex) return data.y[nearestIndex] ?? null;
  const t0 = data.t[leftIndex];
  const t1 = data.t[rightIndex];
  const y0 = data.y[leftIndex];
  const y1 = data.y[rightIndex];
  if (!Number.isFinite(t0) || !Number.isFinite(t1) || t1 === t0)
    return data.y[nearestIndex] ?? null;
  return y0 + ((t - t0) / (t1 - t0)) * (y1 - y0);
}

function nudgedCursorTime(signalData: ChannelData[], current: number, steps: number): number {
  const data = signalData.find((item) => item.t.length > 0);
  if (!data) return current;
  const index = nearestSampleIndex(data, current);
  const nextIndex = Math.min(data.t.length - 1, Math.max(0, index + steps));
  return data.t[nextIndex] ?? current;
}

function cursorInterval(plot: PlotConfig): TimeWindow | null {
  // TODO(post-mvp): link cursors across plots and feed this interval into analysis panels.
  if (plot.cursorA === null || plot.cursorB === null) return null;
  return {
    tMin: Math.min(plot.cursorA, plot.cursorB),
    tMax: Math.max(plot.cursorA, plot.cursorB),
  };
}

function buildCursorShapes(plot: PlotConfig, signalTop: number): Array<Record<string, unknown>> {
  const cursorShape = (cursor: CursorId, t: number, color: string) => ({
    type: 'line',
    name: `cursor-${cursor}`,
    xref: 'x',
    yref: 'paper',
    x0: t,
    x1: t,
    y0: 0,
    y1: signalTop,
    line: { color, width: 2, dash: 'dot' },
    editable: true,
    layer: 'above',
  });
  return [
    ...(plot.cursorA !== null ? [cursorShape('A', plot.cursorA, '#facc15')] : []),
    ...(plot.cursorB !== null ? [cursorShape('B', plot.cursorB, '#38bdf8')] : []),
  ];
}

function cursorOrder(plot: PlotConfig): CursorId[] {
  return [
    ...(plot.cursorA !== null ? (['A'] as CursorId[]) : []),
    ...(plot.cursorB !== null ? (['B'] as CursorId[]) : []),
  ];
}

function parseCursorRelayout(
  event: Record<string, unknown>,
  plot: PlotConfig,
): { cursor: CursorId; t: number } | null {
  const order = cursorOrder(plot);
  for (const key of Object.keys(event)) {
    const match = key.match(/^shapes\[(\d+)\]\.x[01]$/);
    if (!match) continue;
    const cursor = order[Number(match[1])];
    const t = Number(event[key]);
    if (cursor && Number.isFinite(t)) return { cursor, t };
  }
  return null;
}

function traceVisible(plotElement: PlotElement | null, index: number): boolean {
  const plotData = plotElement?.data;
  if (!plotData || plotData.length <= index) return true;
  const visible = plotData[index]?.visible;
  return visible !== false && visible !== 'legendonly';
}

function formatAnalysisValue(value: number | null | undefined, digits = 4): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  if (value === 0) return '0';
  if (Math.abs(value) >= 1e4 || Math.abs(value) < 1e-3) return value.toExponential(3);
  return Number(value).toPrecision(digits);
}

function dataInWindow(
  data: ChannelData,
  interval: TimeWindow | null,
): { t: number[]; y: number[] } {
  if (!interval) return { t: data.t, y: data.y };
  const t: number[] = [];
  const y: number[] = [];
  const tMin = Math.min(interval.tMin, interval.tMax);
  const tMax = Math.max(interval.tMin, interval.tMax);
  for (let i = 0; i < data.t.length; i += 1) {
    const value = data.t[i];
    if (value >= tMin && value <= tMax) {
      t.push(value);
      y.push(data.y[i]);
    }
  }
  return { t, y };
}

function trapezoidArea(t: number[], y: number[]): number | null {
  if (t.length < 2 || y.length < 2) return null;
  let area = 0;
  for (let i = 1; i < t.length; i += 1) {
    area += ((y[i - 1] + y[i]) / 2) * (t[i] - t[i - 1]);
  }
  return area;
}

function solveLinearSystem(matrix: number[][], vector: number[]): number[] | null {
  const n = vector.length;
  const augmented = matrix.map((row, index) => [...row, vector[index]]);
  for (let pivot = 0; pivot < n; pivot += 1) {
    let maxRow = pivot;
    for (let row = pivot + 1; row < n; row += 1) {
      if (Math.abs(augmented[row][pivot]) > Math.abs(augmented[maxRow][pivot])) maxRow = row;
    }
    if (Math.abs(augmented[maxRow][pivot]) < 1e-12) return null;
    [augmented[pivot], augmented[maxRow]] = [augmented[maxRow], augmented[pivot]];
    const pivotValue = augmented[pivot][pivot];
    for (let col = pivot; col <= n; col += 1) augmented[pivot][col] /= pivotValue;
    for (let row = 0; row < n; row += 1) {
      if (row === pivot) continue;
      const factor = augmented[row][pivot];
      for (let col = pivot; col <= n; col += 1)
        augmented[row][col] -= factor * augmented[pivot][col];
    }
  }
  return augmented.map((row) => row[n]);
}

function polynomialFit(t: number[], y: number[], degree: number): number[] | null {
  if (t.length === 0 || y.length === 0) return null;
  const fitDegree = Math.max(1, Math.min(5, Math.round(degree)));
  if (t.length < fitDegree + 1) return null;
  const t0 = t[0];
  const x = t.map((value) => value - t0);
  const size = fitDegree + 1;
  const matrix = Array.from({ length: size }, (_, row) =>
    Array.from({ length: size }, (_, col) =>
      x.reduce((total, value) => total + value ** (row + col), 0),
    ),
  );
  const vector = Array.from({ length: size }, (_, row) =>
    x.reduce((total, value, index) => total + y[index] * value ** row, 0),
  );
  return solveLinearSystem(matrix, vector);
}

function evaluatePolynomial(coefficients: number[], dt: number): number {
  return coefficients.reduce((total, coefficient, index) => total + coefficient * dt ** index, 0);
}

function formatPolynomial(coefficients: number[]): string {
  return coefficients
    .map((coefficient, index) =>
      index === 0
        ? formatAnalysisValue(coefficient)
        : `${formatAnalysisValue(coefficient)}·dt${index > 1 ? `^${index}` : ''}`,
    )
    .join(' + ');
}

function defaultPlot(id: string, name: string): PlotConfig {
  return {
    id,
    name,
    signalRefs: [],
    valveRefs: [],
    resolution: 'fast',
    filter: { ...DEFAULT_FILTER },
    maxPoints: MAX_POINTS,
    cursorA: null,
    cursorB: null,
    activeCursor: null,
    cursorSnap: 'interpolate',
    cursorPanelCollapsed: false,
    cursorPanelPosition: null,
    regressions: [],
  };
}

function freshSession(datasetId: number | null): PersistedSession {
  return {
    version: 1,
    selectedDatasetId: datasetId,
    tabs: [
      {
        id: 'tab-1',
        name: 'Tab 1',
        layout: 'single',
        plots: [defaultPlot('plot-1', 'Plot 1')],
      },
    ],
    activeTabId: 'tab-1',
    activePlotId: 'plot-1',
    nextTabNumber: 2,
    nextPlotNumber: 2,
  };
}

function serializeSession(session: PersistedSession): string {
  return JSON.stringify(session);
}

function parseStoredSession(value: string | null): PersistedSession | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as Partial<PersistedSession>;
    if (
      parsed.version !== 1 ||
      !Array.isArray(parsed.tabs) ||
      typeof parsed.nextTabNumber !== 'number' ||
      typeof parsed.nextPlotNumber !== 'number'
    ) {
      return null;
    }
    return {
      version: 1,
      selectedDatasetId:
        typeof parsed.selectedDatasetId === 'number' ? parsed.selectedDatasetId : null,
      tabs: parsed.tabs,
      activeTabId: typeof parsed.activeTabId === 'string' ? parsed.activeTabId : null,
      activePlotId: typeof parsed.activePlotId === 'string' ? parsed.activePlotId : null,
      nextTabNumber: parsed.nextTabNumber,
      nextPlotNumber: parsed.nextPlotNumber,
    };
  } catch {
    return null;
  }
}

function normalizeRefs(value: unknown, datasetIds: Set<number>): ChannelRef[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (
        item &&
        typeof item === 'object' &&
        typeof (item as ChannelRef).datasetId === 'number' &&
        typeof (item as ChannelRef).channelId === 'number' &&
        datasetIds.has((item as ChannelRef).datasetId)
      ) {
        return {
          datasetId: (item as ChannelRef).datasetId,
          channelId: (item as ChannelRef).channelId,
        };
      }
      return null;
    })
    .filter((item): item is ChannelRef => item !== null);
}

function normalizeTimeWindow(value: unknown): TimeWindow | null {
  if (!value || typeof value !== 'object') return null;
  const tMin = Number((value as TimeWindow).tMin);
  const tMax = Number((value as TimeWindow).tMax);
  if (!Number.isFinite(tMin) || !Number.isFinite(tMax) || tMin === tMax) return null;
  return { tMin: Math.min(tMin, tMax), tMax: Math.max(tMin, tMax) };
}

function normalizePolynomialDegree(value: unknown): number {
  return Math.max(1, Math.min(5, Math.round(Number(value ?? 1))));
}

function normalizeRegressionList(value: unknown, datasetIds: Set<number>): RegressionConfig[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item, index) => {
      if (!item || typeof item !== 'object') return null;
      const channelRef = normalizeRefs(
        [(item as Partial<RegressionConfig>).channelRef],
        datasetIds,
      )[0];
      const interval = normalizeTimeWindow((item as Partial<RegressionConfig>).interval);
      if (!channelRef || !interval) return null;
      return {
        id:
          typeof (item as Partial<RegressionConfig>).id === 'string'
            ? ((item as Partial<RegressionConfig>).id as string)
            : `regression-${index + 1}`,
        channelRef,
        degree: normalizePolynomialDegree((item as Partial<RegressionConfig>).degree),
        interval,
      };
    })
    .filter((item): item is RegressionConfig => item !== null);
}

function normalizePlot(
  value: unknown,
  fallbackDatasetId: number | null,
  datasetIds: Set<number>,
): PlotConfig | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Partial<PlotConfig> & {
    signalIds?: unknown;
    valveIds?: unknown;
    regression?: unknown;
    regressions?: unknown;
  };
  if (typeof raw.id !== 'string' || typeof raw.name !== 'string') return null;

  const legacyDatasetId =
    typeof fallbackDatasetId === 'number' && datasetIds.has(fallbackDatasetId)
      ? fallbackDatasetId
      : null;
  const legacySignalRefs =
    legacyDatasetId !== null && Array.isArray(raw.signalIds)
      ? raw.signalIds
          .filter((channelId): channelId is number => typeof channelId === 'number')
          .map((channelId) => ({ datasetId: legacyDatasetId, channelId }))
      : [];
  const legacyValveRefs =
    legacyDatasetId !== null && Array.isArray(raw.valveIds)
      ? raw.valveIds
          .filter((channelId): channelId is number => typeof channelId === 'number')
          .map((channelId) => ({ datasetId: legacyDatasetId, channelId }))
      : [];
  const savedRegressions = normalizeRegressionList(raw.regressions, datasetIds);
  const legacyRegression =
    raw.regression &&
    typeof raw.regression === 'object' &&
    (raw.regression as { enabled?: unknown }).enabled === true
      ? normalizeRegressionList(
          [
            {
              id: 'legacy-regression',
              channelRef: (raw.regression as { channelRef?: unknown }).channelRef,
              degree: (raw.regression as { degree?: unknown }).degree,
              interval: (raw.regression as { interval?: unknown }).interval,
            },
          ],
          datasetIds,
        )
      : [];

  return {
    id: raw.id,
    name: raw.name,
    signalRefs:
      normalizeRefs(raw.signalRefs, datasetIds).length > 0
        ? normalizeRefs(raw.signalRefs, datasetIds)
        : legacySignalRefs,
    valveRefs:
      normalizeRefs(raw.valveRefs, datasetIds).length > 0
        ? normalizeRefs(raw.valveRefs, datasetIds)
        : legacyValveRefs,
    resolution: raw.resolution === 'full' ? 'full' : 'fast',
    filter: {
      ...DEFAULT_FILTER,
      ...(raw.filter ?? {}),
      kind:
        raw.filter?.kind === 'butterworth' || raw.filter?.kind === 'moving-average'
          ? raw.filter.kind
          : 'none',
      order: raw.filter?.order === 2 ? 2 : 4,
    },
    maxPoints: clampMaxPoints(Number(raw.maxPoints ?? MAX_POINTS)),
    cursorA: numberOrNull(raw.cursorA),
    cursorB: numberOrNull(raw.cursorB),
    activeCursor: raw.activeCursor === 'A' || raw.activeCursor === 'B' ? raw.activeCursor : null,
    cursorSnap: raw.cursorSnap === 'sample' ? 'sample' : 'interpolate',
    cursorPanelCollapsed: raw.cursorPanelCollapsed === true,
    cursorPanelPosition:
      raw.cursorPanelPosition &&
      typeof raw.cursorPanelPosition === 'object' &&
      Number.isFinite(Number(raw.cursorPanelPosition.x)) &&
      Number.isFinite(Number(raw.cursorPanelPosition.y))
        ? {
            x: Number(raw.cursorPanelPosition.x),
            y: Number(raw.cursorPanelPosition.y),
          }
        : null,
    regressions: [...savedRegressions, ...legacyRegression],
  };
}

function validSessionForDatasets(
  session: PersistedSession | null,
  datasets: DatasetSummary[],
): PersistedSession | null {
  if (!session || session.tabs.length === 0) return null;
  const datasetIds = new Set(datasets.map((dataset) => dataset.id));
  if (session.selectedDatasetId !== null && !datasetIds.has(session.selectedDatasetId)) return null;
  const tabs = session.tabs
    .map((tab) => {
      const plots = tab.plots
        .map((plot) => normalizePlot(plot, session.selectedDatasetId, datasetIds))
        .filter((plot): plot is PlotConfig => plot !== null);
      return typeof tab.id === 'string' && typeof tab.name === 'string' && plots.length > 0
        ? {
            id: tab.id,
            name: tab.name,
            layout:
              tab.layout === 'columns' || tab.layout === 'rows' || tab.layout === 'grid'
                ? tab.layout
                : 'single',
            plots,
          }
        : null;
    })
    .filter((tab): tab is PlotTab => tab !== null);
  if (tabs.length === 0) return null;
  return { ...session, tabs };
}

function clampMaxPoints(value: number): number {
  return Number.isFinite(value) ? Math.min(100000, Math.max(500, Math.round(value))) : MAX_POINTS;
}

function layoutClass(layout: PlotLayout): string {
  if (layout === 'columns') return 'grid-cols-2';
  if (layout === 'rows') return 'grid-cols-1 grid-rows-2';
  if (layout === 'grid') return 'grid-cols-2 auto-rows-fr';
  return 'grid-cols-1';
}

function PlotCell({
  datasets,
  plot,
  active,
  canRemove,
  onSelect,
  onConfigure,
  onSplit,
  onRemove,
  onUpdate,
  onAnalysisData,
  onSummary,
}: {
  datasets: DatasetSummary[];
  plot: PlotConfig;
  active: boolean;
  canRemove: boolean;
  onSelect: () => void;
  onConfigure: () => void;
  onSplit: (direction: 'horizontal' | 'vertical') => void;
  onRemove: () => void;
  onUpdate: (updater: (plot: PlotConfig) => PlotConfig) => void;
  onAnalysisData: (plotId: string, data: PlotAnalysisData) => void;
  onSummary: (plotId: string, summary: PlotSummary) => void;
}) {
  const plotRef = useRef<HTMLDivElement | null>(null);
  const relayoutTimerRef = useRef<number | null>(null);
  const panelDragRef = useRef<{ dx: number; dy: number } | null>(null);
  const [visibleWindow, setVisibleWindow] = useState<TimeWindow | null>(null);
  const [signalData, setSignalData] = useState<ChannelData[]>([]);
  const [valveData, setValveData] = useState<ChannelData[]>([]);
  const [plotState, setPlotState] = useState<LoadState>('idle');
  const [error, setError] = useState<string | null>(null);
  const [menuPosition, setMenuPosition] = useState<{ x: number; y: number } | null>(null);
  const [legendVersion, setLegendVersion] = useState(0);
  const [manualIntervalOpen, setManualIntervalOpen] = useState(false);
  const [manualMinDraft, setManualMinDraft] = useState('');
  const [manualMaxDraft, setManualMaxDraft] = useState('');

  const totalDisplayedPoints = signalData.reduce((total, data) => total + data.point_count, 0);
  const totalFullPoints = signalData.reduce((total, data) => total + data.full_point_count, 0);
  const plottedDatasetIds = useMemo(
    () => new Set(signalData.map((data) => data.dataset_id)),
    [signalData],
  );
  const nameForTrace = useCallback(
    (data: ChannelData) => {
      const datasetName = findDataset(datasets, data.dataset_id)?.name;
      return plottedDatasetIds.size > 1 && datasetName
        ? `${datasetName} / ${data.channel_name}`
        : data.channel_name;
    },
    [datasets, plottedDatasetIds],
  );
  const visibleSignalTraces = useMemo(
    () =>
      signalData.flatMap((data, index): VisibleSignalTrace[] => {
        void legendVersion;
        return traceVisible(plotRef.current as PlotElement | null, index) ? [{ data, index }] : [];
      }),
    [legendVersion, signalData],
  );
  const cursorAReadout = useMemo(
    () =>
      plot.cursorA === null
        ? []
        : visibleSignalTraces.map(({ data, index }) => ({
            key: refKey({ datasetId: data.dataset_id, channelId: data.channel_id }),
            name: nameForTrace(data),
            unit: data.unit,
            color: TRACE_COLORS[index % TRACE_COLORS.length],
            y: yAtTime(data, plot.cursorA ?? 0, plot.cursorSnap),
          })),
    [nameForTrace, plot.cursorA, plot.cursorSnap, visibleSignalTraces],
  );
  const cursorBReadout = useMemo(
    () =>
      plot.cursorB === null
        ? []
        : visibleSignalTraces.map(({ data, index }) => ({
            key: refKey({ datasetId: data.dataset_id, channelId: data.channel_id }),
            name: nameForTrace(data),
            unit: data.unit,
            color: TRACE_COLORS[index % TRACE_COLORS.length],
            y: yAtTime(data, plot.cursorB ?? 0, plot.cursorSnap),
          })),
    [nameForTrace, plot.cursorB, plot.cursorSnap, visibleSignalTraces],
  );
  const cursorWindow = cursorInterval(plot);

  const updateCursor = useCallback(
    (cursor: CursorId, t: number | null) => {
      onUpdate((current) => ({
        ...current,
        [cursor === 'A' ? 'cursorA' : 'cursorB']: t,
        activeCursor:
          t === null ? (current.activeCursor === cursor ? null : current.activeCursor) : cursor,
      }));
    },
    [onUpdate],
  );

  const placeCursor = useCallback(
    (cursor: CursorId, t?: number) => {
      const nextTime = Number.isFinite(t)
        ? Number(t)
        : defaultCursorTime(cursor, signalData, visibleWindow);
      if (nextTime === null) return;
      updateCursor(cursor, nextTime);
    },
    [signalData, updateCursor, visibleWindow],
  );

  const eventTime = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>) => {
      const plotElement = plotRef.current as PlotElement | null;
      if (!plotElement) return null;
      const rect = plotElement.getBoundingClientRect();
      const size = plotElement._fullLayout?._size;
      const plotX = event.clientX - rect.left - (size?.l ?? 0);
      const axisTime = plotElement._fullLayout?.xaxis?.p2l?.(plotX);
      if (Number.isFinite(axisTime)) return Number(axisTime);
      const range = visibleWindow ?? timeRange(signalData);
      if (!range) return null;
      return (
        range.tMin +
        ((event.clientX - rect.left) / Math.max(1, rect.width)) * (range.tMax - range.tMin)
      );
    },
    [signalData, visibleWindow],
  );

  const handleKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      if (!plot.activeCursor) return;
      const current = plot.activeCursor === 'A' ? plot.cursorA : plot.cursorB;
      if (current === null) return;
      event.preventDefault();
      const direction = event.key === 'ArrowLeft' ? -1 : 1;
      const steps = direction * (event.shiftKey ? 10 : 1);
      updateCursor(plot.activeCursor, nudgedCursorTime(signalData, current, steps));
    },
    [plot.activeCursor, plot.cursorA, plot.cursorB, signalData, updateCursor],
  );

  const openManualInterval = useCallback(() => {
    const range = cursorInterval(plot) ?? visibleWindow ?? timeRange(signalData);
    setManualMinDraft(range ? String(range.tMin) : '');
    setManualMaxDraft(range ? String(range.tMax) : '');
    setManualIntervalOpen(true);
  }, [plot, signalData, visibleWindow]);

  const applyManualInterval = useCallback(() => {
    const tMin = Number(manualMinDraft);
    const tMax = Number(manualMaxDraft);
    if (!Number.isFinite(tMin) || !Number.isFinite(tMax) || tMin === tMax) return;
    onUpdate((current) => ({
      ...current,
      cursorA: Math.min(tMin, tMax),
      cursorB: Math.max(tMin, tMax),
      activeCursor: 'B',
    }));
    setManualIntervalOpen(false);
  }, [manualMaxDraft, manualMinDraft, onUpdate]);

  useEffect(() => {
    if (plot.signalRefs.length === 0) {
      setSignalData([]);
      setValveData([]);
      setPlotState('idle');
      setError(null);
      return;
    }

    const controller = new AbortController();
    async function loadPlotData() {
      setPlotState('loading');
      setError(null);
      try {
        const refs = [...plot.signalRefs, ...plot.valveRefs];
        const signalRefKeys = new Set(plot.signalRefs.map(refKey));
        const responses = await Promise.all(
          refs.map(async (channelRef) => {
            const channelFilter = signalRefKeys.has(refKey(channelRef))
              ? plot.filter
              : DEFAULT_FILTER;
            const params = new URLSearchParams();
            addFilterParams(params, channelFilter);
            if (visibleWindow) {
              params.set('t_min', String(visibleWindow.tMin));
              params.set('t_max', String(visibleWindow.tMax));
            }
            params.set('max_points', String(plot.maxPoints));

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
              plot.resolution === 'full'
                ? await fetch(
                    `/api/datasets/${channelRef.datasetId}/channels/${channelRef.channelId}/data/full`,
                    {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify(fullBody),
                      signal: controller.signal,
                    },
                  )
                : await fetch(
                    `/api/datasets/${channelRef.datasetId}/channels/${
                      channelRef.channelId
                    }/data?${params.toString()}`,
                    { signal: controller.signal },
                  );
            if (!response.ok) throw new Error(`Channel data HTTP ${response.status}`);
            return (await response.json()) as ChannelData;
          }),
        );

        if (controller.signal.aborted) return;
        setSignalData(
          responses.filter((data) =>
            signalRefKeys.has(refKey({ datasetId: data.dataset_id, channelId: data.channel_id })),
          ),
        );
        setValveData(
          responses.filter(
            (data) =>
              !signalRefKeys.has(
                refKey({ datasetId: data.dataset_id, channelId: data.channel_id }),
              ),
          ),
        );
        setPlotState('ready');
      } catch (err) {
        if (controller.signal.aborted) return;
        setPlotState('error');
        setError(err instanceof Error ? err.message : 'Unable to load channel data');
      }
    }

    void loadPlotData();
    return () => controller.abort();
  }, [plot, visibleWindow]);

  useEffect(() => {
    onSummary(plot.id, {
      state: plotState,
      displayedPoints: totalDisplayedPoints,
      fullPoints: totalFullPoints,
      error,
    });
  }, [error, onSummary, plot.id, plotState, totalDisplayedPoints, totalFullPoints]);

  useEffect(() => {
    onAnalysisData(plot.id, {
      signals: visibleSignalTraces.map(({ data }) => data),
      visibleWindow,
    });
  }, [onAnalysisData, plot.id, visibleSignalTraces, visibleWindow]);

  useEffect(() => {
    const plotElement = plotRef.current;
    if (!plotElement) return;
    if (signalData.length === 0) {
      plotElement.innerHTML = '';
      return;
    }

    const units = [...new Set(signalData.map((data) => data.unit).filter(Boolean))];
    const yLabel = units.length === 1 ? `Signals [${units[0]}]` : 'Signals';
    const { shapes: valveShapes, annotations } = buildValveOverlay(valveData);
    const { signalTop } = overlayDomain(valveData.length);
    const shapes = [...buildCursorShapes(plot, signalTop), ...valveShapes];
    const titleText =
      signalData.length === 1
        ? `${nameForTrace(signalData[0])} · ${signalData[0].group_name}`
        : `${signalData.length} traces`;
    const overlayText = valveSummary(valveData);
    const filterText =
      plot.filter.kind === 'none'
        ? ''
        : plot.filter.kind === 'butterworth'
          ? ` · Butterworth ${plot.filter.cutoffHz} Hz`
          : ` · Avg ${plot.filter.windowSamples} samples`;
    const regressionColors = ['#f8fafc', '#facc15', '#c084fc', '#34d399', '#fb7185'];
    const regressionTraces = plot.regressions.flatMap((regression, index) => {
      const source = signalData.find(
        (data) =>
          refKey({ datasetId: data.dataset_id, channelId: data.channel_id }) ===
          refKey(regression.channelRef),
      );
      if (!source) return [];
      const window = dataInWindow(source, regression.interval);
      const coefficients = polynomialFit(window.t, window.y, regression.degree);
      if (!coefficients || window.t.length === 0) return [];
      const t0 = window.t[0];
      return [
        {
          x: window.t,
          y: window.t.map((time) => evaluatePolynomial(coefficients, time - t0)),
          type: 'scattergl' as const,
          mode: 'lines' as const,
          name: `${nameForTrace(source)} regression`,
          line: {
            color: regressionColors[index % regressionColors.length],
            width: 2.4,
            dash: 'dash',
          },
          hovertemplate: 't=%{x:.4f}s<br>%{y:.4f}<extra>%{fullData.name}</extra>',
        },
      ];
    });

    void Plotly.react(
      plotElement,
      [
        ...signalData.map((data, index) => ({
          x: data.t,
          y: data.y,
          type: 'scattergl' as const,
          mode: 'lines' as const,
          name: nameForTrace(data),
          line: { color: TRACE_COLORS[index % TRACE_COLORS.length], width: 1.6 },
          hovertemplate: 't=%{x:.4f}s<br>%{y:.4f}<extra>%{fullData.name}</extra>',
        })),
        ...regressionTraces,
      ],
      {
        autosize: true,
        paper_bgcolor: '#020617',
        plot_bgcolor: '#0f172a',
        font: { color: '#cbd5e1', family: 'Inter, ui-sans-serif, system-ui' },
        uirevision: plot.id,
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
        editable: true,
        edits: { shapePosition: true },
      },
    );
  }, [nameForTrace, plot, plot.cursorA, plot.cursorB, plot.filter, plot.id, signalData, valveData]);

  useEffect(() => {
    const plotElement = plotRef.current;
    if (!plotElement) return;

    const resizeObserver = new ResizeObserver(() => {
      void Plotly.Plots.resize(plotElement);
    });
    resizeObserver.observe(plotElement);
    return () => resizeObserver.disconnect();
  }, []);

  useEffect(() => {
    const plotElement = plotRef.current as PlotElement | null;
    if (!plotElement?.on) return;

    const handleRelayout = (event: Record<string, unknown>) => {
      const cursorMove = parseCursorRelayout(event, plot);
      if (cursorMove) {
        onUpdate((current) => ({
          ...current,
          [cursorMove.cursor === 'A' ? 'cursorA' : 'cursorB']: cursorMove.t,
          activeCursor: cursorMove.cursor,
        }));
        return;
      }
      const nextWindow = parseRelayoutWindow(event);
      if (nextWindow === undefined) return;
      if (relayoutTimerRef.current !== null) {
        window.clearTimeout(relayoutTimerRef.current);
      }
      relayoutTimerRef.current = window.setTimeout(() => {
        setVisibleWindow(nextWindow);
      }, 200);
    };
    const handleRestyle = () => setLegendVersion((value) => value + 1);

    plotElement.on('plotly_relayout', handleRelayout);
    plotElement.on('plotly_restyle', handleRestyle);
    return () => {
      if (relayoutTimerRef.current !== null) {
        window.clearTimeout(relayoutTimerRef.current);
      }
      plotElement.removeListener?.('plotly_relayout', handleRelayout);
      plotElement.removeListener?.('plotly_restyle', handleRestyle);
    };
  }, [onUpdate, plot, signalData.length]);

  useEffect(() => {
    if (!menuPosition) return;
    const closeMenu = (event: MouseEvent) => {
      if (event.button !== 0) return;
      setMenuPosition(null);
    };
    const closeMenuOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuPosition(null);
    };
    window.addEventListener('mousedown', closeMenu);
    window.addEventListener('keydown', closeMenuOnEscape);
    return () => {
      window.removeEventListener('mousedown', closeMenu);
      window.removeEventListener('keydown', closeMenuOnEscape);
    };
  }, [menuPosition]);

  useEffect(() => {
    const handleMove = (event: MouseEvent) => {
      const drag = panelDragRef.current;
      if (!drag) return;
      const host = plotRef.current?.getBoundingClientRect();
      if (!host) return;
      onUpdate((current) => ({
        ...current,
        cursorPanelPosition: {
          x: Math.max(8, Math.min(host.width - 180, event.clientX - host.left - drag.dx)),
          y: Math.max(8, Math.min(host.height - 80, event.clientY - host.top - drag.dy)),
        },
      }));
    };
    const handleUp = () => {
      panelDragRef.current = null;
    };
    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
    return () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
    };
  }, [onUpdate]);

  return (
    <div
      className={`flex min-h-0 flex-col border bg-slate-900 ${
        active ? 'border-sky-500' : 'border-slate-800'
      }`}
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={handleKeyDown}
      onMouseDown={(event) => {
        if (event.button !== 2) return;
        event.preventDefault();
        onSelect();
        setMenuPosition({ x: event.clientX, y: event.clientY });
      }}
      onContextMenu={(event) => {
        event.preventDefault();
        onSelect();
        setMenuPosition({ x: event.clientX, y: event.clientY });
      }}
    >
      <div className="flex h-9 shrink-0 items-center border-b border-slate-800 bg-slate-900 px-2">
        <button
          className={`h-7 rounded border px-2 text-xs font-medium ${
            active
              ? 'border-sky-500 bg-sky-500/15 text-sky-100'
              : 'border-slate-700 bg-slate-950 text-slate-300'
          }`}
          type="button"
        >
          {plot.name}
        </button>
        <button
          className="ml-2 h-7 rounded border border-slate-700 bg-slate-950 px-2 text-xs font-medium text-slate-300 hover:border-sky-500 hover:text-sky-100"
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onConfigure();
          }}
        >
          Signals
        </button>
        <div className="ml-2 flex items-center gap-1 border-l border-slate-800 pl-2">
          {(['A', 'B'] as CursorId[]).map((cursor) => {
            const placed = cursor === 'A' ? plot.cursorA !== null : plot.cursorB !== null;
            return (
              <button
                key={cursor}
                className={`h-7 rounded border px-2 text-xs font-medium ${
                  placed
                    ? 'border-amber-400 bg-amber-400/15 text-amber-100'
                    : 'border-slate-700 bg-slate-950 text-slate-300 hover:border-amber-400 hover:text-amber-100'
                }`}
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  placeCursor(cursor);
                }}
              >
                Cursor {cursor}
              </button>
            );
          })}
          <button
            aria-pressed={plot.cursorSnap === 'sample'}
            className="h-7 rounded border border-slate-700 bg-slate-950 px-2 text-xs text-slate-300 hover:border-sky-500 hover:text-sky-100"
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onUpdate((current) => ({
                ...current,
                cursorSnap: current.cursorSnap === 'sample' ? 'interpolate' : 'sample',
              }));
            }}
          >
            {plot.cursorSnap === 'sample' ? 'Snap sample' : 'Interpolate'}
          </button>
          <button
            className="h-7 rounded border border-slate-700 bg-slate-950 px-2 text-xs text-slate-300 hover:border-rose-400 hover:text-rose-100"
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onUpdate((current) => ({
                ...current,
                cursorA: null,
                cursorB: null,
                activeCursor: null,
              }));
            }}
          >
            Clear
          </button>
          <button
            className="h-7 rounded border border-slate-700 bg-slate-950 px-2 text-xs text-slate-300 hover:border-sky-500 hover:text-sky-100"
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              openManualInterval();
            }}
          >
            Manual interval
          </button>
        </div>
        <div className="ml-auto font-mono text-xs text-slate-500">
          {plotState === 'loading'
            ? 'loading'
            : `${plot.resolution} · ${formatCount(totalDisplayedPoints)} / ${formatCount(
                totalFullPoints,
              )} points`}
        </div>
      </div>
      <div className="relative min-h-0 flex-1">
        <div
          ref={plotRef}
          className="h-full min-h-[260px] w-full bg-slate-900"
          onClick={(event) => {
            if (!event.shiftKey) return;
            event.stopPropagation();
            const t = eventTime(event);
            if (t === null) return;
            const nextCursor =
              plot.cursorA === null
                ? 'A'
                : plot.cursorB === null
                  ? 'B'
                  : (plot.activeCursor ?? 'A');
            placeCursor(nextCursor, t);
          }}
        />
        {error ? (
          <div className="absolute left-3 top-3 rounded border border-rose-500/60 bg-rose-950 px-3 py-2 text-sm text-rose-100">
            {error}
          </div>
        ) : null}
        {plot.cursorA !== null || plot.cursorB !== null ? (
          <div
            className="absolute z-20 w-80 max-w-[calc(100%-1rem)] rounded border border-slate-700 bg-slate-950/92 text-xs shadow-xl shadow-slate-950/50 backdrop-blur"
            style={
              plot.cursorPanelPosition
                ? { left: plot.cursorPanelPosition.x, top: plot.cursorPanelPosition.y }
                : { right: 12, top: 12 }
            }
            onClick={(event) => event.stopPropagation()}
          >
            <div
              className="flex h-8 cursor-move items-center border-b border-slate-800 px-2"
              onMouseDown={(event) => {
                const rect = event.currentTarget.parentElement?.getBoundingClientRect();
                if (!rect) return;
                panelDragRef.current = {
                  dx: event.clientX - rect.left,
                  dy: event.clientY - rect.top,
                };
              }}
            >
              <span className="font-semibold text-slate-100">Cursors</span>
              <span className="ml-2 font-mono text-[11px] text-slate-500">
                {cursorWindow
                  ? `analysis ${formatReadoutValue(cursorWindow.tMax - cursorWindow.tMin, 's')}`
                  : 'single cursor'}
              </span>
              <button
                className="ml-auto h-6 rounded px-2 text-slate-400 hover:bg-slate-800 hover:text-slate-100"
                type="button"
                onClick={() =>
                  onUpdate((current) => ({
                    ...current,
                    cursorPanelCollapsed: !current.cursorPanelCollapsed,
                  }))
                }
              >
                {plot.cursorPanelCollapsed ? 'show' : 'hide'}
              </button>
            </div>
            {!plot.cursorPanelCollapsed ? (
              <div className="max-h-80 overflow-y-auto p-2">
                {plot.cursorA !== null ? (
                  <section className="mb-2">
                    <div className="mb-1 flex items-center font-mono text-amber-200">
                      A: t = {formatReadoutValue(plot.cursorA, 's')}
                      <button
                        aria-label="Remove cursor A"
                        className="ml-auto h-5 w-5 rounded text-slate-400 hover:bg-slate-800 hover:text-rose-100"
                        type="button"
                        onClick={() => updateCursor('A', null)}
                      >
                        ×
                      </button>
                    </div>
                    {cursorAReadout.map((row) => (
                      <div key={row.key} className="grid grid-cols-[1fr_auto] gap-3">
                        <span className="truncate" style={{ color: row.color }}>
                          {row.name}
                        </span>
                        <span className="text-right font-mono text-slate-100">
                          {formatReadoutValue(row.y, row.unit)}
                        </span>
                      </div>
                    ))}
                  </section>
                ) : null}
                {plot.cursorB !== null ? (
                  <section className="mb-2">
                    <div className="mb-1 flex items-center font-mono text-sky-200">
                      B: t = {formatReadoutValue(plot.cursorB, 's')}
                      <button
                        aria-label="Remove cursor B"
                        className="ml-auto h-5 w-5 rounded text-slate-400 hover:bg-slate-800 hover:text-rose-100"
                        type="button"
                        onClick={() => updateCursor('B', null)}
                      >
                        ×
                      </button>
                    </div>
                    {cursorBReadout.map((row) => (
                      <div key={row.key} className="grid grid-cols-[1fr_auto] gap-3">
                        <span className="truncate" style={{ color: row.color }}>
                          {row.name}
                        </span>
                        <span className="text-right font-mono text-slate-100">
                          {formatReadoutValue(row.y, row.unit)}
                        </span>
                      </div>
                    ))}
                  </section>
                ) : null}
                {plot.cursorA !== null && plot.cursorB !== null ? (
                  <section className="border-t border-slate-800 pt-2">
                    <div className="mb-1 font-mono text-slate-300">
                      Δt = {formatReadoutValue(Math.abs(plot.cursorB - plot.cursorA), 's')}
                    </div>
                    {cursorAReadout.map((rowA) => {
                      const cursorA = plot.cursorA ?? 0;
                      const cursorB = plot.cursorB ?? 0;
                      const rowB = cursorBReadout.find((row) => row.key === rowA.key);
                      const delta =
                        rowA.y !== null && rowB?.y !== null && rowB !== undefined
                          ? rowB.y - rowA.y
                          : null;
                      const dt = cursorB !== cursorA ? cursorB - cursorA : null;
                      const slope = delta !== null && dt ? delta / dt : null;
                      return (
                        <div key={rowA.key} className="grid grid-cols-[1fr_auto] gap-3">
                          <span className="truncate" style={{ color: rowA.color }}>
                            Δ{rowA.name}
                          </span>
                          <span className="text-right font-mono text-slate-100">
                            {formatReadoutValue(delta, rowA.unit)}
                            {slope !== null
                              ? ` (${formatReadoutValue(slope, `${rowA.unit ?? ''}/s`)})`
                              : ''}
                          </span>
                        </div>
                      );
                    })}
                  </section>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}
        {manualIntervalOpen ? (
          <div
            aria-modal="true"
            className="absolute left-1/2 top-12 z-40 w-80 -translate-x-1/2 rounded border border-slate-700 bg-slate-950 p-3 text-sm shadow-xl shadow-slate-950/50"
            role="dialog"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mb-3 font-semibold text-slate-100">Manual interval</div>
            <div className="grid grid-cols-2 gap-2">
              <label className="text-xs text-slate-400" htmlFor={`manual-min-${plot.id}`}>
                t_min
                <input
                  id={`manual-min-${plot.id}`}
                  aria-label="Manual t min"
                  className="mt-1 h-8 w-full rounded border border-slate-800 bg-slate-900 px-2 font-mono text-slate-100 outline-none focus:border-sky-500"
                  type="number"
                  value={manualMinDraft}
                  onChange={(event) => setManualMinDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') applyManualInterval();
                  }}
                />
              </label>
              <label className="text-xs text-slate-400" htmlFor={`manual-max-${plot.id}`}>
                t_max
                <input
                  id={`manual-max-${plot.id}`}
                  aria-label="Manual t max"
                  className="mt-1 h-8 w-full rounded border border-slate-800 bg-slate-900 px-2 font-mono text-slate-100 outline-none focus:border-sky-500"
                  type="number"
                  value={manualMaxDraft}
                  onChange={(event) => setManualMaxDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') applyManualInterval();
                  }}
                />
              </label>
            </div>
            <div className="mt-3 flex justify-end gap-2">
              <button
                className="h-8 rounded border border-slate-700 px-3 text-xs text-slate-300 hover:border-slate-500"
                type="button"
                onClick={() => setManualIntervalOpen(false)}
              >
                Cancel
              </button>
              <button
                className="h-8 rounded border border-sky-500 bg-sky-500/15 px-3 text-xs font-medium text-sky-100 hover:bg-sky-500/25"
                type="button"
                onClick={applyManualInterval}
              >
                Apply
              </button>
            </div>
          </div>
        ) : null}
        {menuPosition ? (
          <div
            className="fixed z-50 w-36 rounded border border-slate-700 bg-slate-950 py-1 text-sm shadow-xl shadow-slate-950/40"
            style={{ left: menuPosition.x, top: menuPosition.y }}
            onClick={(event) => event.stopPropagation()}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <button
              className="block h-8 w-full px-3 text-left text-slate-200 hover:bg-slate-800"
              type="button"
              onClick={() => {
                setMenuPosition(null);
                onSplit('vertical');
              }}
            >
              Split vertical
            </button>
            <button
              className="block h-8 w-full px-3 text-left text-slate-200 hover:bg-slate-800"
              type="button"
              onClick={() => {
                setMenuPosition(null);
                onSplit('horizontal');
              }}
            >
              Split horizontal
            </button>
            <button
              className="block h-8 w-full px-3 text-left text-rose-200 hover:bg-rose-950 disabled:text-slate-600 disabled:hover:bg-transparent"
              disabled={!canRemove}
              type="button"
              onClick={() => {
                setMenuPosition(null);
                onRemove();
              }}
            >
              Remove plot
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function PlotDataDialog({
  datasets,
  plot,
  onCancel,
  onConfirm,
}: {
  datasets: DatasetSummary[];
  plot: PlotConfig;
  onCancel: () => void;
  onConfirm: (update: Pick<PlotConfig, 'signalRefs' | 'valveRefs' | 'resolution'>) => void;
}) {
  const firstRef = plot.signalRefs[0] ?? plot.valveRefs[0] ?? null;
  const [selectedDatasetId, setSelectedDatasetId] = useState<number | null>(
    firstRef?.datasetId ?? datasets[0]?.id ?? null,
  );
  const [signalRefs, setSignalRefs] = useState<ChannelRef[]>(plot.signalRefs);
  const [valveRefs, setValveRefs] = useState<ChannelRef[]>(plot.valveRefs);
  const [resolution, setResolution] = useState<PlotResolution>(plot.resolution);

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
  const selectedSignalLabels = signalRefs
    .map((ref) => {
      const dataset = findDataset(datasets, ref.datasetId);
      const channel = findChannel(datasets, ref);
      return dataset && channel ? channelLabel(dataset, channel) : null;
    })
    .filter((label): label is string => label !== null);

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/75 p-4">
      <div
        aria-modal="true"
        className="flex max-h-[88vh] w-full max-w-5xl flex-col rounded border border-slate-700 bg-slate-900 shadow-2xl shadow-slate-950"
        role="dialog"
      >
        <div className="flex shrink-0 items-center gap-3 border-b border-slate-800 px-4 py-3">
          <div>
            <div className="text-sm font-semibold text-slate-100">Select plot signals</div>
            <div className="mt-0.5 text-xs text-slate-500">
              {selectedSignalLabels.length > 0
                ? `${selectedSignalLabels.length} signals selected`
                : 'No signals selected'}
            </div>
          </div>
          <label className="ml-auto text-xs text-slate-500" htmlFor="dialog-dataset">
            Dataset
          </label>
          <select
            id="dialog-dataset"
            aria-label="Dataset"
            className="h-8 min-w-56 rounded border border-slate-700 bg-slate-950 px-2 text-sm text-slate-100 outline-none focus:border-sky-500"
            value={selectedDatasetId ?? ''}
            onChange={(event) => setSelectedDatasetId(Number(event.target.value))}
          >
            {datasets.map((dataset) => (
              <option key={dataset.id} value={dataset.id}>
                {dataset.name}
              </option>
            ))}
          </select>
        </div>

        <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_18rem] gap-4 overflow-hidden p-4">
          <div className="min-h-0 overflow-y-auto pr-1">
            <section className="mb-4">
              <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                Resolution
              </div>
              <div className="grid w-64 grid-cols-2 rounded border border-slate-800 bg-slate-950 p-1">
                {(['fast', 'full'] as PlotResolution[]).map((option) => {
                  const active = resolution === option;
                  return (
                    <button
                      key={option}
                      aria-pressed={active}
                      className={`h-8 rounded text-xs font-medium transition ${
                        active
                          ? 'bg-sky-500/20 text-sky-100'
                          : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200'
                      }`}
                      type="button"
                      onClick={() => setResolution(option)}
                    >
                      {option === 'fast' ? 'Fast' : 'Full'}
                    </button>
                  );
                })}
              </div>
            </section>

            <section>
              <div className="mb-2 flex items-center justify-between">
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Signals in selected dataset
                </div>
                <div className="font-mono text-xs text-slate-500">{signalRefs.length} selected</div>
              </div>
              <div className="space-y-3">
                {groupedSignals.map(([groupName, channels]) => (
                  <div key={groupName}>
                    <div className="mb-1 text-xs font-semibold text-slate-400">{groupName}</div>
                    <div className="grid grid-cols-1 gap-1 md:grid-cols-2">
                      {channels.map((channel) => {
                        const ref = { datasetId: selectedDataset?.id ?? 0, channelId: channel.id };
                        const checked = hasRef(signalRefs, ref);
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
                              onChange={() => setSignalRefs((refs) => toggleRef(refs, ref))}
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
                  Valve overlay in selected dataset
                </div>
                <div className="font-mono text-xs text-slate-500">{valveRefs.length} selected</div>
              </div>
              <div className="grid grid-cols-2 gap-1 md:grid-cols-3">
                {availableValves.map((channel) => {
                  const ref = { datasetId: selectedDataset?.id ?? 0, channelId: channel.id };
                  const checked = hasRef(valveRefs, ref);
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
                        onChange={() => setValveRefs((refs) => toggleRef(refs, ref))}
                      />
                      <span className="truncate">{channel.name}</span>
                    </label>
                  );
                })}
              </div>
            </section>
          </div>

          <aside className="min-h-0 overflow-y-auto border-l border-slate-800 pl-4">
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
              Selected signals
            </div>
            <div className="space-y-1">
              {selectedSignalLabels.length === 0 ? (
                <div className="rounded border border-slate-800 bg-slate-950 p-3 text-sm text-slate-400">
                  Pick channels from one or more datasets.
                </div>
              ) : (
                selectedSignalLabels.map((label) => (
                  <div
                    key={label}
                    className="rounded border border-slate-800 bg-slate-950 px-2 py-1.5 text-xs text-slate-200"
                  >
                    {label}
                  </div>
                ))
              )}
            </div>
          </aside>
        </div>

        <div className="flex shrink-0 justify-end gap-2 border-t border-slate-800 px-4 py-3">
          <button
            className="h-8 rounded border border-slate-700 bg-slate-950 px-3 text-sm text-slate-300 hover:border-slate-500"
            type="button"
            onClick={onCancel}
          >
            Cancel
          </button>
          <button
            className="h-8 rounded border border-sky-500 bg-sky-500/15 px-3 text-sm font-medium text-sky-100 hover:bg-sky-500/25"
            type="button"
            onClick={() => onConfirm({ signalRefs, valveRefs, resolution })}
          >
            Confirm
          </button>
        </div>
      </div>
    </div>
  );
}

function AnalysisToolsDialog({
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
    const t0 = selectedWindow.t[0];
    void copyText(
      [
        `channel=${traceName(selectedSignal)}`,
        `order=${normalizePolynomialDegree(polyfitDegree)}`,
        `t0_s=${t0.toPrecision(17)}`,
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
          <aside className="border-r border-slate-800 p-3">
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
              Tool
            </div>
            <div className="space-y-1">
              {[
                ['polyfit', 'Regression'],
                ['area', 'Area'],
              ].map(([value, label]) => (
                <button
                  key={value}
                  className={`block h-9 w-full rounded border px-3 text-left text-sm ${
                    tool === value
                      ? 'border-sky-500 bg-sky-500/15 text-sky-100'
                      : 'border-slate-800 bg-slate-950 text-slate-300 hover:border-slate-600'
                  }`}
                  type="button"
                  onClick={() => setTool(value as AnalysisTool)}
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
                ? `${formatAnalysisValue(interval.tMin)}–${formatAnalysisValue(interval.tMax)} s`
                : 'No interval'}
            </div>
          </aside>

          <section className="min-h-0 overflow-y-auto p-4">
            {!hasSamples ? (
              <div className="rounded border border-slate-800 bg-slate-950 p-4 text-sm text-slate-400">
                No visible samples are available for this plot and interval.
              </div>
            ) : null}

            {tool === 'polyfit' && hasSamples ? (
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
                  <select
                    id="regression-channel"
                    aria-label="Regression channel"
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
                </div>
                <div className="mb-3 flex items-center gap-3">
                  <div className="text-sm font-semibold text-slate-100">Preview</div>
                  <label className="ml-auto text-xs text-slate-500" htmlFor="polyfit-degree">
                    samples
                  </label>
                  <span className="font-mono text-xs text-slate-400">
                    {selectedWindow.y.length}
                  </span>
                </div>
                <div className="space-y-3">
                  {selectedSignal ? (
                    (() => {
                      const name = traceName(selectedSignal);
                      const unit = selectedSignal.unit;
                      const coeffs = selectedCoefficients;
                      return (
                        <div className="rounded border border-slate-800 bg-slate-950 p-3">
                          <div className="mb-2 text-sm font-medium text-slate-100">{name}</div>
                          {coeffs ? (
                            <div className="font-mono text-xs text-slate-300">
                              y = {formatPolynomial(coeffs)}
                              <span className="ml-2 text-slate-500">{unit ?? ''}</span>
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
                      );
                    })()
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
                    {copyStatus ? (
                      <span className="text-xs text-slate-500">{copyStatus}</span>
                    ) : null}
                  </div>
                  {plot.regressions.length > 0 ? (
                    <div className="rounded border border-slate-800 bg-slate-950 p-3">
                      <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                        Active Regressions
                      </div>
                      <div className="space-y-2">
                        {plot.regressions.map((regression) => {
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
                              <span className="font-mono text-slate-500">
                                order {regression.degree}
                              </span>
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
                  ) : null}
                  {plot.regressions.length > 0 ? (
                    <button
                      className="h-8 rounded border border-rose-500/60 bg-rose-500/10 px-3 text-sm text-rose-100 hover:bg-rose-500/20"
                      type="button"
                      onClick={() => {
                        for (const regression of plot.regressions) {
                          onRemoveRegression(regression.id);
                        }
                      }}
                    >
                      Clear regressions
                    </button>
                  ) : null}
                </div>
              </div>
            ) : null}

            {tool === 'area' && hasSamples ? (
              <div>
                <div className="mb-3 text-sm font-semibold text-slate-100">Area</div>
                <div className="mb-4 grid max-w-2xl grid-cols-[10rem_minmax(0,1fr)] gap-3 rounded border border-slate-800 bg-slate-950 p-3 text-sm">
                  <label className="self-center text-slate-400" htmlFor="area-channel">
                    Line
                  </label>
                  <select
                    id="area-channel"
                    aria-label="Area channel"
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
                </div>
                <div className="rounded border border-slate-800 bg-slate-950 p-4">
                  <div className="mb-3 text-sm font-medium text-slate-100">
                    {selectedSignal ? traceName(selectedSignal) : 'Select a channel'}
                  </div>
                  <dl className="grid max-w-lg grid-cols-2 gap-2 text-sm">
                    <dt className="text-slate-500">Area</dt>
                    <dd className="text-right font-mono text-slate-200">
                      {formatAnalysisValue(area)}{' '}
                      {selectedSignal?.unit ? `${selectedSignal.unit}·s` : ''}
                    </dd>
                    <dt className="text-slate-500">Duration</dt>
                    <dd className="text-right font-mono text-slate-200">
                      {formatAnalysisValue(duration)} s
                    </dd>
                    <dt className="text-slate-500">Average</dt>
                    <dd className="text-right font-mono text-slate-200">
                      {formatAnalysisValue(average)} {selectedSignal?.unit ?? ''}
                    </dd>
                    <dt className="text-slate-500">Samples</dt>
                    <dd className="text-right font-mono text-slate-200">
                      {selectedWindow.y.length}
                    </dd>
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
                    {copyStatus ? (
                      <span className="text-xs text-slate-500">{copyStatus}</span>
                    ) : null}
                  </div>
                </div>
              </div>
            ) : null}
          </section>
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const [datasets, setDatasets] = useState<DatasetSummary[]>([]);
  const [selectedDatasetId, setSelectedDatasetId] = useState<number | null>(null);
  const [tabs, setTabs] = useState<PlotTab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const [activePlotId, setActivePlotId] = useState<string | null>(null);
  const [plotSummaries, setPlotSummaries] = useState<Record<string, PlotSummary>>({});
  const [plotAnalysisData, setPlotAnalysisData] = useState<Record<string, PlotAnalysisData>>({});
  const [nextTabNumber, setNextTabNumber] = useState(2);
  const [nextPlotNumber, setNextPlotNumber] = useState(2);
  const [filter, setFilter] = useState<FilterConfig>(DEFAULT_FILTER);
  const [cutoffDraft, setCutoffDraft] = useState(String(DEFAULT_FILTER.cutoffHz));
  const [windowDraft, setWindowDraft] = useState(String(DEFAULT_FILTER.windowSamples));
  const [maxPointsDraft, setMaxPointsDraft] = useState(String(MAX_POINTS));
  const [renamingTabId, setRenamingTabId] = useState<string | null>(null);
  const [renamingTabName, setRenamingTabName] = useState('');
  const [configuringPlotId, setConfiguringPlotId] = useState<string | null>(null);
  const [analysisOpen, setAnalysisOpen] = useState(false);
  const [savedSnapshot, setSavedSnapshot] = useState<string | null>(null);
  const [datasetState, setDatasetState] = useState<LoadState>('idle');
  const [error, setError] = useState<string | null>(null);

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
        <header className="flex h-12 shrink-0 items-center gap-3 border-b border-slate-800 bg-slate-900 px-4">
          <div className="min-w-36">
            <div className="text-lg font-semibold tracking-tight">DAxolotl</div>
            <div className="text-xs text-slate-500">
              {activePlot ? `${activeTab?.name ?? 'Tab'} / ${activePlot.name}` : 'plot setup'}
            </div>
          </div>
          <div className="font-mono text-xs text-slate-500">
            {datasets.length} {datasets.length === 1 ? 'dataset' : 'datasets'}
          </div>
        </header>

        <section className="flex min-h-0 flex-1 flex-col">
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
                    value={cutoffDraft}
                    onChange={(event) => setCutoffDraft(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') commitCutoffDraft();
                    }}
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

          <div className="relative min-h-0 flex-1 bg-slate-950 p-3">
            {activeTab ? (
              <div className={`grid h-full min-h-0 gap-2 ${layoutClass(activeTab.layout)}`}>
                {activeTab.plots.map((plot) => (
                  <PlotCell
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
          <PlotDataDialog
            datasets={datasets}
            plot={configuringPlot}
            onCancel={() => setConfiguringPlotId(null)}
            onConfirm={confirmPlotData}
          />
        ) : null}
        {analysisOpen && activePlot ? (
          <AnalysisToolsDialog
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
