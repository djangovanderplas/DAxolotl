import Plotly from 'plotly.js-dist-min';
import type { KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { fetchChannelData } from '../../api/channelData';
import { useCursorsStore } from '../../store/cursors';
import {
  TRACE_COLORS,
  DEFAULT_FILTER,
  formatCount,
  refKey,
  findDataset,
  overlayDomain,
  buildValveOverlay,
  valveSummary,
  parseRelayoutWindow,
  formatReadoutValue,
  timeRange,
  defaultCursorTime,
  yAtTime,
  nudgedCursorTime,
  cursorInterval,
  buildCursorShapes,
  parseCursorRelayout,
  traceVisible,
  dataInWindow,
  calculateSpectrogram,
  polynomialFit,
  evaluatePolynomial,
} from '../../lib/plotUtils';
import type {
  ChannelData,
  CursorId,
  DatasetSummary,
  LoadState,
  PlotAnalysisData,
  PlotConfig,
  PlotElement,
  PlotKind,
  PlotSummary,
  TimeWindow,
  VisibleSignalTrace,
  WelchWindow,
} from '../../types';

export default function PlotView({
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
  const setPlotCursors = useCursorsStore((state) => state.setPlotCursors);
  const clearPlotCursors = useCursorsStore((state) => state.clearPlotCursors);
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

  useEffect(() => {
    setPlotCursors(plot.id, {
      cursorA: plot.cursorA,
      cursorB: plot.cursorB,
      activeCursor: plot.activeCursor,
      cursorSnap: plot.cursorSnap,
    });
  }, [plot.activeCursor, plot.cursorA, plot.cursorB, plot.cursorSnap, plot.id, setPlotCursors]);

  useEffect(
    () => () => {
      clearPlotCursors(plot.id);
    },
    [clearPlotCursors, plot.id],
  );

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
            return fetchChannelData({
              channelRef,
              filter: channelFilter,
              maxPoints: plot.maxPoints,
              resolution: plot.resolution,
              signal: controller.signal,
              visibleWindow,
            });
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

    if (plot.kind === 'spectrogram') {
      const source =
        signalData.find(
          (data) =>
            plot.spectrogram.channelRef &&
            refKey({ datasetId: data.dataset_id, channelId: data.channel_id }) ===
              refKey(plot.spectrogram.channelRef),
        ) ?? signalData[0];
      const spectrogram = source
        ? calculateSpectrogram(
            source.t,
            source.y,
            plot.spectrogram.nperseg,
            plot.spectrogram.noverlap,
            plot.spectrogram.window,
          )
        : null;
      if (!source || !spectrogram) {
        plotElement.innerHTML = '';
        return;
      }
      const maxFrequency = plot.spectrogram.maxFrequency ?? spectrogram.sampleRate / 2;
      const rowIndexes = spectrogram.frequency
        .map((frequency, index) => ({ frequency, index }))
        .filter(({ frequency }) => {
          if (plot.spectrogram.logFrequency && frequency <= 0) return false;
          return frequency <= maxFrequency;
        });
      const z = rowIndexes.map(({ index }) =>
        spectrogram.magnitude[index].map((value) =>
          plot.spectrogram.db ? 20 * Math.log10(Math.max(value, 1e-12)) : value,
        ),
      );
      void Plotly.react(
        plotElement,
        [
          {
            x: spectrogram.time,
            y: rowIndexes.map(({ frequency }) => frequency),
            z,
            type: 'heatmap' as const,
            colorscale: 'Viridis',
            colorbar: {
              title: { text: plot.spectrogram.db ? 'Magnitude [dB]' : 'Magnitude' },
            },
            hovertemplate: 't=%{x:.4f}s<br>f=%{y:.4f} Hz<br>%{z:.6g}<extra>Spectrogram</extra>',
          },
        ],
        {
          autosize: true,
          paper_bgcolor: '#020617',
          plot_bgcolor: '#0f172a',
          font: { color: '#cbd5e1', family: 'Inter, ui-sans-serif, system-ui' },
          uirevision: `${plot.id}-spectrogram`,
          margin: { l: 72, r: 88, t: 52, b: 60 },
          title: {
            text: `${nameForTrace(source)} spectrogram${filterText}`,
            font: { size: 16, color: '#f8fafc' },
            x: 0,
            xanchor: 'left',
          },
          xaxis: {
            title: { text: 'Time [s]' },
            gridcolor: '#1e293b',
            zerolinecolor: '#334155',
          },
          yaxis: {
            title: { text: 'Frequency [Hz]' },
            type: plot.spectrogram.logFrequency ? 'log' : 'linear',
            gridcolor: '#1e293b',
            zerolinecolor: '#334155',
          },
          shapes: buildCursorShapes(plot, 1),
        },
        {
          responsive: true,
          displaylogo: false,
          scrollZoom: true,
          editable: true,
          edits: { shapePosition: true },
        },
      );
      return;
    }

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
        <select
          aria-label="Plot type"
          className="ml-2 h-7 rounded border border-slate-700 bg-slate-950 px-2 text-xs text-slate-300 outline-none hover:border-sky-500 focus:border-sky-500"
          value={plot.kind}
          onClick={(event) => event.stopPropagation()}
          onChange={(event) => {
            const kind = event.target.value as PlotKind;
            onUpdate((current) => ({
              ...current,
              kind,
              spectrogram: {
                ...current.spectrogram,
                channelRef: current.spectrogram.channelRef ?? current.signalRefs[0] ?? null,
              },
            }));
          }}
        >
          <option value="time">Time</option>
          <option value="spectrogram">Spectrogram</option>
        </select>
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
      {plot.kind === 'spectrogram' ? (
        <div className="flex h-9 shrink-0 items-center gap-2 border-b border-slate-800 bg-slate-950 px-2 text-xs">
          <select
            aria-label="Spectrogram channel"
            className="h-7 min-w-32 rounded border border-slate-700 bg-slate-950 px-2 text-slate-300 outline-none focus:border-sky-500"
            value={
              plot.spectrogram.channelRef
                ? refKey(plot.spectrogram.channelRef)
                : plot.signalRefs[0]
                  ? refKey(plot.signalRefs[0])
                  : ''
            }
            onClick={(event) => event.stopPropagation()}
            onChange={(event) => {
              const [datasetId, channelId] = event.target.value.split(':').map(Number);
              onUpdate((current) => ({
                ...current,
                spectrogram: {
                  ...current.spectrogram,
                  channelRef:
                    Number.isFinite(datasetId) && Number.isFinite(channelId)
                      ? { datasetId, channelId }
                      : null,
                },
              }));
            }}
          >
            {signalData.map((data) => (
              <option
                key={refKey({ datasetId: data.dataset_id, channelId: data.channel_id })}
                value={refKey({ datasetId: data.dataset_id, channelId: data.channel_id })}
              >
                {nameForTrace(data)}
              </option>
            ))}
          </select>
          <label className="flex items-center gap-1 text-slate-500">
            nperseg
            <input
              aria-label="Spectrogram nperseg"
              className="h-7 w-20 rounded border border-slate-700 bg-slate-950 px-1 font-mono text-slate-300 outline-none focus:border-sky-500"
              min={4}
              type="number"
              value={plot.spectrogram.nperseg}
              onClick={(event) => event.stopPropagation()}
              onChange={(event) =>
                onUpdate((current) => ({
                  ...current,
                  spectrogram: {
                    ...current.spectrogram,
                    nperseg: Math.max(4, Math.round(Number(event.target.value) || 4)),
                  },
                }))
              }
            />
          </label>
          <label className="flex items-center gap-1 text-slate-500">
            overlap
            <input
              aria-label="Spectrogram noverlap"
              className="h-7 w-20 rounded border border-slate-700 bg-slate-950 px-1 font-mono text-slate-300 outline-none focus:border-sky-500"
              placeholder="50%"
              type="number"
              value={plot.spectrogram.noverlap ?? ''}
              onClick={(event) => event.stopPropagation()}
              onChange={(event) =>
                onUpdate((current) => ({
                  ...current,
                  spectrogram: {
                    ...current.spectrogram,
                    noverlap:
                      event.target.value.trim() === ''
                        ? null
                        : Math.max(0, Math.round(Number(event.target.value) || 0)),
                  },
                }))
              }
            />
          </label>
          <select
            aria-label="Spectrogram window"
            className="h-7 rounded border border-slate-700 bg-slate-950 px-2 text-slate-300 outline-none focus:border-sky-500"
            value={plot.spectrogram.window}
            onClick={(event) => event.stopPropagation()}
            onChange={(event) =>
              onUpdate((current) => ({
                ...current,
                spectrogram: {
                  ...current.spectrogram,
                  window: event.target.value as WelchWindow,
                },
              }))
            }
          >
            <option value="hann">Hann</option>
            <option value="boxcar">Boxcar</option>
          </select>
          <label className="flex items-center gap-1 text-slate-300">
            <input
              checked={plot.spectrogram.db}
              className="accent-sky-500"
              type="checkbox"
              onClick={(event) => event.stopPropagation()}
              onChange={(event) =>
                onUpdate((current) => ({
                  ...current,
                  spectrogram: { ...current.spectrogram, db: event.target.checked },
                }))
              }
            />
            dB
          </label>
          <label className="flex items-center gap-1 text-slate-300">
            <input
              checked={plot.spectrogram.logFrequency}
              className="accent-sky-500"
              type="checkbox"
              onClick={(event) => event.stopPropagation()}
              onChange={(event) =>
                onUpdate((current) => ({
                  ...current,
                  spectrogram: { ...current.spectrogram, logFrequency: event.target.checked },
                }))
              }
            />
            Log f
          </label>
          <label className="ml-auto flex items-center gap-1 text-slate-500">
            max Hz
            <input
              aria-label="Spectrogram max frequency"
              className="h-7 w-24 rounded border border-slate-700 bg-slate-950 px-1 font-mono text-slate-300 outline-none focus:border-sky-500"
              placeholder="auto"
              type="number"
              value={plot.spectrogram.maxFrequency ?? ''}
              onClick={(event) => event.stopPropagation()}
              onChange={(event) =>
                onUpdate((current) => ({
                  ...current,
                  spectrogram: {
                    ...current.spectrogram,
                    maxFrequency:
                      event.target.value.trim() === ''
                        ? null
                        : Math.max(0, Number(event.target.value) || 0),
                  },
                }))
              }
            />
          </label>
        </div>
      ) : null}
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
