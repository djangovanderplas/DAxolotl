import type {
  Channel,
  ChannelData,
  ChannelRef,
  CursorId,
  CursorSnapMode,
  DatasetSummary,
  FftResult,
  FilterConfig,
  NumericStats,
  PersistedSession,
  PlotConfig,
  PlotElement,
  PlotLayout,
  PlotTab,
  PsdResult,
  RegressionConfig,
  SpectrogramConfig,
  SpectrogramResult,
  TimeWindow,
  WelchWindow,
} from '../types';

export const MAX_POINTS = 4000;
export const CURRENT_SESSION_KEY = 'daxolotl.currentSession';
export const SAVED_SESSION_KEY = 'daxolotl.savedSession';
export const TRACE_COLORS = ['#38bdf8', '#f97316', '#a78bfa', '#22c55e', '#f43f5e', '#eab308'];
export const VALVE_COLORS = ['#facc15', '#fb7185', '#34d399', '#60a5fa', '#c084fc', '#f97316'];
export const DEFAULT_FILTER: FilterConfig = {
  kind: 'none',
  cutoffHz: 20,
  order: 4,
  windowSamples: 25,
};
export const DEFAULT_SPECTROGRAM: SpectrogramConfig = {
  channelRef: null,
  nperseg: 256,
  noverlap: null,
  window: 'hann',
  db: true,
  logFrequency: false,
  maxFrequency: null,
};

export function displayChannels(channels: Channel[]): Channel[] {
  return channels.filter((channel) => !channel.name.endsWith(' (raw)'));
}

export function signalChannels(channels: Channel[]): Channel[] {
  return displayChannels(channels).filter((channel) => !channel.is_valve);
}

export function valveChannels(channels: Channel[]): Channel[] {
  return displayChannels(channels).filter((channel) => channel.is_valve);
}

export function groupChannels(channels: Channel[]): Array<[string, Channel[]]> {
  const groups = new Map<string, Channel[]>();
  for (const channel of channels) {
    const group = groups.get(channel.group_name) ?? [];
    group.push(channel);
    groups.set(channel.group_name, group);
  }
  return [...groups.entries()];
}

export function formatCount(value: number | undefined): string {
  if (value === undefined) return '0';
  return Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(value);
}

export function refKey(ref: ChannelRef): string {
  return `${ref.datasetId}:${ref.channelId}`;
}

export function hasRef(refs: ChannelRef[], ref: ChannelRef): boolean {
  return refs.some((value) => refKey(value) === refKey(ref));
}

export function toggleRef(refs: ChannelRef[], ref: ChannelRef): ChannelRef[] {
  return hasRef(refs, ref) ? refs.filter((value) => refKey(value) !== refKey(ref)) : [...refs, ref];
}

export function channelLabel(dataset: DatasetSummary | null | undefined, channel: Channel): string {
  return dataset ? `${dataset.name} / ${channel.name}` : channel.name;
}

export function findDataset(datasets: DatasetSummary[], datasetId: number): DatasetSummary | null {
  return datasets.find((dataset) => dataset.id === datasetId) ?? null;
}

export function findChannel(datasets: DatasetSummary[], ref: ChannelRef): Channel | null {
  return (
    findDataset(datasets, ref.datasetId)?.channels.find(
      (channel) => channel.id === ref.channelId,
    ) ?? null
  );
}

export function openSegments(data: ChannelData): Array<{ x0: number; x1: number }> {
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

export function valveLabel(name: string): string {
  return name.replace(/-/g, '');
}

export function overlayDomain(valveCount: number): { signalTop: number; overlayBottom: number } {
  if (valveCount === 0) return { signalTop: 1, overlayBottom: 1 };
  const overlayHeight = Math.min(0.3, Math.max(0.13, valveCount * 0.024));
  const signalTop = 1 - overlayHeight - 0.045;
  return { signalTop, overlayBottom: signalTop + 0.055 };
}

export function buildValveOverlay(valves: ChannelData[]) {
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

export function valveSummary(valves: ChannelData[]): string {
  if (valves.length === 0) return '';
  const names = valves.map((valve) => valveLabel(valve.channel_name));
  const shown = names.slice(0, 8).join(' ');
  return names.length > 8 ? `${shown} +${names.length - 8}` : shown;
}

export function parseRelayoutWindow(event: Record<string, unknown>): TimeWindow | null | undefined {
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

export function numberOrNull(value: unknown): number | null {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

export function formatReadoutValue(value: number | null, unit?: string | null): string {
  if (value === null || !Number.isFinite(value)) return '—';
  const formatted = Number(value).toPrecision(Math.abs(value) >= 1000 ? 4 : 3);
  return unit ? `${formatted} ${unit}` : formatted;
}

export function timeRange(data: ChannelData[]): TimeWindow | null {
  const first = data.find((item) => item.t.length > 0);
  if (!first) return null;
  return { tMin: first.t[0], tMax: first.t[first.t.length - 1] };
}

export function defaultCursorTime(
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

export function nearestSampleIndex(data: ChannelData, t: number): number {
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

export function yAtTime(data: ChannelData, t: number, mode: CursorSnapMode): number | null {
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

export function nudgedCursorTime(
  signalData: ChannelData[],
  current: number,
  steps: number,
): number {
  const data = signalData.find((item) => item.t.length > 0);
  if (!data) return current;
  const index = nearestSampleIndex(data, current);
  const nextIndex = Math.min(data.t.length - 1, Math.max(0, index + steps));
  return data.t[nextIndex] ?? current;
}

export function cursorInterval(plot: PlotConfig): TimeWindow | null {
  // TODO(post-mvp): link cursors across plots and feed this interval into analysis panels.
  if (plot.cursorA === null || plot.cursorB === null) return null;
  return {
    tMin: Math.min(plot.cursorA, plot.cursorB),
    tMax: Math.max(plot.cursorA, plot.cursorB),
  };
}

export function buildCursorShapes(
  plot: PlotConfig,
  signalTop: number,
): Array<Record<string, unknown>> {
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

export function cursorOrder(plot: PlotConfig): CursorId[] {
  return [
    ...(plot.cursorA !== null ? (['A'] as CursorId[]) : []),
    ...(plot.cursorB !== null ? (['B'] as CursorId[]) : []),
  ];
}

export function parseCursorRelayout(
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

export function traceVisible(plotElement: PlotElement | null, index: number): boolean {
  const plotData = plotElement?.data;
  if (!plotData || plotData.length <= index) return true;
  const visible = plotData[index]?.visible;
  return visible !== false && visible !== 'legendonly';
}

export function formatAnalysisValue(value: number | null | undefined, digits = 4): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  if (value === 0) return '0';
  if (Math.abs(value) >= 1e4 || Math.abs(value) < 1e-3) return value.toExponential(3);
  return Number(value).toPrecision(digits);
}

export function dataInWindow(
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

export function trapezoidArea(t: number[], y: number[]): number | null {
  if (t.length < 2 || y.length < 2) return null;
  let area = 0;
  for (let i = 1; i < t.length; i += 1) {
    area += ((y[i - 1] + y[i]) / 2) * (t[i] - t[i - 1]);
  }
  return area;
}

export function quantile(values: number[], q: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const position = (sorted.length - 1) * q;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  const weight = position - lower;
  return sorted[lower] * (1 - weight) + sorted[upper] * weight;
}

export function mode(values: number[]): { value: number | null; count: number } {
  if (values.length === 0) return { value: null, count: 0 };
  const counts = new Map<number, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  let modeValue = values[0];
  let modeCount = 0;
  for (const [value, count] of counts.entries()) {
    if (count > modeCount) {
      modeValue = value;
      modeCount = count;
    }
  }
  return { value: modeValue, count: modeCount };
}

export function calculateStats(values: number[]): NumericStats {
  const count = values.length;
  if (count === 0) {
    return {
      count,
      mean: null,
      median: null,
      modeValue: null,
      modeCount: 0,
      min: null,
      max: null,
      range: null,
      variance: null,
      standardDeviation: null,
      interquartileRange: null,
      skewness: null,
      kurtosis: null,
    };
  }
  const avg = values.reduce((total, value) => total + value, 0) / count;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const variance =
    count > 1 ? values.reduce((total, value) => total + (value - avg) ** 2, 0) / (count - 1) : null;
  const standardDeviation = variance === null ? null : Math.sqrt(variance);
  const q1 = quantile(values, 0.25);
  const q3 = quantile(values, 0.75);
  const modeResult = mode(values);
  const moment2 = values.reduce((total, value) => total + (value - avg) ** 2, 0) / count;
  const moment3 = values.reduce((total, value) => total + (value - avg) ** 3, 0) / count;
  const moment4 = values.reduce((total, value) => total + (value - avg) ** 4, 0) / count;
  const skewness = moment2 > 0 ? moment3 / moment2 ** 1.5 : null;
  const kurtosis = moment2 > 0 ? moment4 / moment2 ** 2 - 3 : null;
  return {
    count,
    mean: avg,
    median: quantile(values, 0.5),
    modeValue: modeResult.value,
    modeCount: modeResult.count,
    min,
    max,
    range: max - min,
    variance,
    standardDeviation,
    interquartileRange: q1 !== null && q3 !== null ? q3 - q1 : null,
    skewness,
    kurtosis,
  };
}

export function largestPowerOfTwo(value: number): number {
  if (value < 2) return 0;
  return 2 ** Math.floor(Math.log2(value));
}

export function fftInPlace(real: number[], imaginary: number[]) {
  const n = real.length;
  for (let i = 1, j = 0; i < n; i += 1) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [real[i], real[j]] = [real[j], real[i]];
      [imaginary[i], imaginary[j]] = [imaginary[j], imaginary[i]];
    }
  }
  for (let length = 2; length <= n; length <<= 1) {
    const angle = (-2 * Math.PI) / length;
    const stepReal = Math.cos(angle);
    const stepImaginary = Math.sin(angle);
    for (let offset = 0; offset < n; offset += length) {
      let twiddleReal = 1;
      let twiddleImaginary = 0;
      for (let j = 0; j < length / 2; j += 1) {
        const even = offset + j;
        const odd = even + length / 2;
        const oddReal = real[odd] * twiddleReal - imaginary[odd] * twiddleImaginary;
        const oddImaginary = real[odd] * twiddleImaginary + imaginary[odd] * twiddleReal;
        real[odd] = real[even] - oddReal;
        imaginary[odd] = imaginary[even] - oddImaginary;
        real[even] += oddReal;
        imaginary[even] += oddImaginary;
        const nextReal = twiddleReal * stepReal - twiddleImaginary * stepImaginary;
        twiddleImaginary = twiddleReal * stepImaginary + twiddleImaginary * stepReal;
        twiddleReal = nextReal;
      }
    }
  }
}

export function sampleUniformPowerOfTwo(
  t: number[],
  y: number[],
  maxSamples: number,
): { t: number[]; y: number[] } | null {
  if (t.length < 4 || y.length < 4) return null;
  const targetCount = largestPowerOfTwo(Math.min(maxSamples, t.length));
  if (targetCount < 4) return null;
  const stride = Math.max(1, Math.floor(t.length / targetCount));
  const sampledT: number[] = [];
  const sampledY: number[] = [];
  for (let index = 0; index < t.length && sampledT.length < targetCount; index += stride) {
    sampledT.push(t[index]);
    sampledY.push(y[index]);
  }
  const sampleCount = largestPowerOfTwo(sampledT.length);
  if (sampleCount < 4) return null;
  sampledT.length = sampleCount;
  sampledY.length = sampleCount;
  return { t: sampledT, y: sampledY };
}

export function sampleRateFromT(t: number[]): number | null {
  if (t.length < 2) return null;
  const duration = t[t.length - 1] - t[0];
  const dt = duration / (t.length - 1);
  if (!Number.isFinite(dt) || dt <= 0) return null;
  return 1 / dt;
}

export function calculateFft(t: number[], y: number[], maxSamples = 4096): FftResult | null {
  const sampled = sampleUniformPowerOfTwo(t, y, maxSamples);
  if (!sampled) return null;
  const sampleRate = sampleRateFromT(sampled.t);
  if (sampleRate === null) return null;
  const sampleCount = sampled.y.length;
  const real = [...sampled.y];
  const imaginary = Array.from({ length: sampleCount }, () => 0);
  fftInPlace(real, imaginary);
  const frequency: number[] = [];
  const magnitude: number[] = [];
  const phase: number[] = [];
  for (let index = 0; index <= sampleCount / 2; index += 1) {
    frequency.push((index * sampleRate) / sampleCount);
    const scale = index === 0 || index === sampleCount / 2 ? 1 / sampleCount : 2 / sampleCount;
    magnitude.push(Math.hypot(real[index], imaginary[index]) * scale);
    phase.push(Math.atan2(imaginary[index], real[index]));
  }
  return { frequency, magnitude, phase, sampleCount, sampleRate };
}

export function welchWindowValues(window: WelchWindow, nperseg: number): number[] {
  if (window === 'boxcar') return Array.from({ length: nperseg }, () => 1);
  return Array.from(
    { length: nperseg },
    (_, index) => 0.5 - 0.5 * Math.cos((2 * Math.PI * index) / Math.max(1, nperseg - 1)),
  );
}

export function calculateWelchPsd(
  t: number[],
  y: number[],
  npersegDraft: number,
  noverlapDraft: number | null,
  windowKind: WelchWindow,
  maxSamples = 16384,
): PsdResult | null {
  const sampled = sampleUniformPowerOfTwo(t, y, maxSamples);
  if (!sampled) return null;
  const sampleRate = sampleRateFromT(sampled.t);
  if (sampleRate === null) return null;
  const nperseg = largestPowerOfTwo(
    Math.max(4, Math.min(sampled.y.length, Math.round(npersegDraft))),
  );
  if (nperseg < 4) return null;
  const noverlapDefault = Math.floor(nperseg / 2);
  const noverlap = Math.max(0, Math.min(nperseg - 1, Math.round(noverlapDraft ?? noverlapDefault)));
  const step = nperseg - noverlap;
  const window = welchWindowValues(windowKind, nperseg);
  const windowPower = window.reduce((total, value) => total + value * value, 0);
  if (windowPower <= 0) return null;
  const binCount = nperseg / 2 + 1;
  const psd = Array.from({ length: binCount }, () => 0);
  let segmentCount = 0;
  for (let start = 0; start + nperseg <= sampled.y.length; start += step) {
    const segment = sampled.y.slice(start, start + nperseg);
    const segmentMean = segment.reduce((total, value) => total + value, 0) / segment.length;
    const real = segment.map((value, index) => (value - segmentMean) * window[index]);
    const imaginary = Array.from({ length: nperseg }, () => 0);
    fftInPlace(real, imaginary);
    for (let index = 0; index < binCount; index += 1) {
      const oneSidedScale = index === 0 || index === nperseg / 2 ? 1 : 2;
      psd[index] +=
        (oneSidedScale * (real[index] * real[index] + imaginary[index] * imaginary[index])) /
        (sampleRate * windowPower);
    }
    segmentCount += 1;
  }
  if (segmentCount === 0) return null;
  const frequency = Array.from({ length: binCount }, (_, index) => (index * sampleRate) / nperseg);
  return {
    frequency,
    psd: psd.map((value) => value / segmentCount),
    sampleCount: sampled.y.length,
    sampleRate,
    nperseg,
    noverlap,
  };
}

export function calculateSpectrogram(
  t: number[],
  y: number[],
  npersegDraft: number,
  noverlapDraft: number | null,
  windowKind: WelchWindow,
  maxSamples = 32768,
): SpectrogramResult | null {
  const sampled = sampleUniformPowerOfTwo(t, y, maxSamples);
  if (!sampled) return null;
  const sampleRate = sampleRateFromT(sampled.t);
  if (sampleRate === null) return null;
  const nperseg = largestPowerOfTwo(
    Math.max(4, Math.min(sampled.y.length, Math.round(npersegDraft))),
  );
  if (nperseg < 4) return null;
  const noverlapDefault = Math.floor(nperseg / 2);
  const noverlap = Math.max(0, Math.min(nperseg - 1, Math.round(noverlapDraft ?? noverlapDefault)));
  const step = nperseg - noverlap;
  const window = welchWindowValues(windowKind, nperseg);
  const binCount = nperseg / 2 + 1;
  const time: number[] = [];
  const magnitude = Array.from({ length: binCount }, () => [] as number[]);
  for (let start = 0; start + nperseg <= sampled.y.length; start += step) {
    const segment = sampled.y.slice(start, start + nperseg);
    const segmentMean = segment.reduce((total, value) => total + value, 0) / segment.length;
    const real = segment.map((value, index) => (value - segmentMean) * window[index]);
    const imaginary = Array.from({ length: nperseg }, () => 0);
    fftInPlace(real, imaginary);
    time.push(sampled.t[start + Math.floor(nperseg / 2)]);
    for (let index = 0; index < binCount; index += 1) {
      const scale = index === 0 || index === nperseg / 2 ? 1 / nperseg : 2 / nperseg;
      magnitude[index].push(Math.hypot(real[index], imaginary[index]) * scale);
    }
  }
  if (time.length === 0) return null;
  return {
    time,
    frequency: Array.from({ length: binCount }, (_, index) => (index * sampleRate) / nperseg),
    magnitude,
    sampleRate,
    nperseg,
    noverlap,
  };
}

export function solveLinearSystem(matrix: number[][], vector: number[]): number[] | null {
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

export function polynomialFit(t: number[], y: number[], degree: number): number[] | null {
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

export function evaluatePolynomial(coefficients: number[], dt: number): number {
  return coefficients.reduce((total, coefficient, index) => total + coefficient * dt ** index, 0);
}

export function formatPolynomial(coefficients: number[]): string {
  return coefficients
    .map((coefficient, index) =>
      index === 0
        ? formatAnalysisValue(coefficient)
        : `${formatAnalysisValue(coefficient)}·dt${index > 1 ? `^${index}` : ''}`,
    )
    .join(' + ');
}

export function defaultPlot(id: string, name: string): PlotConfig {
  return {
    id,
    name,
    kind: 'time',
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
    spectrogram: { ...DEFAULT_SPECTROGRAM },
  };
}

export function freshSession(datasetId: number | null): PersistedSession {
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

export function serializeSession(session: PersistedSession): string {
  return JSON.stringify(session);
}

export function parseStoredSession(value: string | null): PersistedSession | null {
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

export function normalizeRefs(value: unknown, datasetIds: Set<number>): ChannelRef[] {
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

export function normalizeTimeWindow(value: unknown): TimeWindow | null {
  if (!value || typeof value !== 'object') return null;
  const tMin = Number((value as TimeWindow).tMin);
  const tMax = Number((value as TimeWindow).tMax);
  if (!Number.isFinite(tMin) || !Number.isFinite(tMax) || tMin === tMax) return null;
  return { tMin: Math.min(tMin, tMax), tMax: Math.max(tMin, tMax) };
}

export function normalizePolynomialDegree(value: unknown): number {
  return Math.max(1, Math.min(5, Math.round(Number(value ?? 1))));
}

export function normalizeRegressionList(
  value: unknown,
  datasetIds: Set<number>,
): RegressionConfig[] {
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

export function normalizeSpectrogramConfig(
  value: unknown,
  datasetIds: Set<number>,
): SpectrogramConfig {
  if (!value || typeof value !== 'object') return { ...DEFAULT_SPECTROGRAM };
  const raw = value as Partial<SpectrogramConfig>;
  const channelRef = normalizeRefs(raw.channelRef ? [raw.channelRef] : [], datasetIds)[0] ?? null;
  const maxFrequency = Number(raw.maxFrequency);
  const noverlap = Number(raw.noverlap);
  return {
    channelRef,
    nperseg: Math.max(4, Math.min(8192, Math.round(Number(raw.nperseg ?? 256)))),
    noverlap: Number.isFinite(noverlap) && noverlap >= 0 ? Math.round(noverlap) : null,
    window: raw.window === 'boxcar' ? 'boxcar' : 'hann',
    db: raw.db !== false,
    logFrequency: raw.logFrequency === true,
    maxFrequency: Number.isFinite(maxFrequency) && maxFrequency > 0 ? maxFrequency : null,
  };
}

export function normalizePlot(
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
    spectrogram?: unknown;
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
    kind: raw.kind === 'spectrogram' ? 'spectrogram' : 'time',
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
    spectrogram: normalizeSpectrogramConfig(raw.spectrogram, datasetIds),
  };
}

export function validSessionForDatasets(
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

export function clampMaxPoints(value: number): number {
  return Number.isFinite(value) ? Math.min(100000, Math.max(500, Math.round(value))) : MAX_POINTS;
}

export function layoutClass(layout: PlotLayout): string {
  if (layout === 'columns') return 'grid-cols-2';
  if (layout === 'rows') return 'grid-cols-1 grid-rows-2';
  if (layout === 'grid') return 'grid-cols-2 auto-rows-fr';
  return 'grid-cols-1';
}
