export type LoadState = 'idle' | 'loading' | 'ready' | 'error';
export type PlotResolution = 'fast' | 'full';
export type FilterKind = 'none' | 'butterworth' | 'moving-average';
export type CursorId = 'A' | 'B';
export type CursorSnapMode = 'interpolate' | 'sample';
export type AnalysisTool = 'polyfit' | 'area' | 'stats' | 'fft' | 'histogram';
export type AnalysisIntervalMode = 'cursors' | 'viewport' | 'manual';
export type SpectrumMode = 'fft' | 'psd';
export type WelchWindow = 'hann' | 'boxcar';
export type PlotKind = 'time' | 'spectrogram';
export type PlotLayout = 'single' | 'columns' | 'rows' | 'grid';

export type Channel = {
  id: number;
  group_name: string;
  name: string;
  unit: string | null;
  dtype: string;
  sample_count: number;
  is_valve: boolean;
};

export type DatasetSummary = {
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

export type ChannelData = {
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

export type FilterConfig = {
  kind: FilterKind;
  cutoffHz: number;
  order: 2 | 4;
  windowSamples: number;
};

export type TimeWindow = {
  tMin: number;
  tMax: number;
};

export type PlotElement = HTMLDivElement & {
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

export type ChannelRef = {
  datasetId: number;
  channelId: number;
};

export type RegressionConfig = {
  id: string;
  channelRef: ChannelRef;
  degree: number;
  interval: TimeWindow;
};

export type SpectrogramConfig = {
  channelRef: ChannelRef | null;
  nperseg: number;
  noverlap: number | null;
  window: WelchWindow;
  db: boolean;
  logFrequency: boolean;
  maxFrequency: number | null;
};

export type NumericStats = {
  count: number;
  mean: number | null;
  median: number | null;
  modeValue: number | null;
  modeCount: number;
  min: number | null;
  max: number | null;
  range: number | null;
  variance: number | null;
  standardDeviation: number | null;
  interquartileRange: number | null;
  skewness: number | null;
  kurtosis: number | null;
};

export type FftResult = {
  frequency: number[];
  magnitude: number[];
  phase: number[];
  sampleCount: number;
  sampleRate: number;
};

export type PsdResult = {
  frequency: number[];
  psd: number[];
  sampleCount: number;
  sampleRate: number;
  nperseg: number;
  noverlap: number;
};

export type SpectrogramResult = {
  time: number[];
  frequency: number[];
  magnitude: number[][];
  sampleRate: number;
  nperseg: number;
  noverlap: number;
};

export type PlotConfig = {
  id: string;
  name: string;
  kind: PlotKind;
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
  spectrogram: SpectrogramConfig;
};

export type PlotTab = {
  id: string;
  name: string;
  layout: PlotLayout;
  plots: PlotConfig[];
};

export type PlotSummary = {
  state: LoadState;
  displayedPoints: number;
  fullPoints: number;
  error: string | null;
};

export type PlotAnalysisData = {
  signals: ChannelData[];
  visibleWindow: TimeWindow | null;
};

export type VisibleSignalTrace = {
  data: ChannelData;
  index: number;
};

export type PersistedSession = {
  version: 1;
  selectedDatasetId: number | null;
  tabs: PlotTab[];
  activeTabId: string | null;
  activePlotId: string | null;
  nextTabNumber: number;
  nextPlotNumber: number;
};
