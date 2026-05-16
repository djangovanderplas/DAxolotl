import Plotly from 'plotly.js-dist-min';
import { useEffect, useRef, useState } from 'react';
import type { ChannelData, SpectrumMode, WelchWindow } from '../../types';
import { calculateFft, calculateWelchPsd, formatAnalysisValue } from '../../lib/plotUtils';
import { ChannelSelect } from './PolyfitPanel';
import type { TraceName } from './analysisTypes';
import { ButtonGroup, Check, SpectrumSummary, WelchControls } from './FftControls';

export default function FftPanel({
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
  const [showFftMagnitude, setShowFftMagnitude] = useState(true);
  const [showFftPhase, setShowFftPhase] = useState(false);
  const [spectrumMode, setSpectrumMode] = useState<SpectrumMode>('fft');
  const [dropFftDc, setDropFftDc] = useState(true);
  const [showFftDb, setShowFftDb] = useState(false);
  const [logFftFrequency, setLogFftFrequency] = useState(false);
  const [fftMaxFrequencyDraft, setFftMaxFrequencyDraft] = useState('');
  const [welchNpersegDraft, setWelchNpersegDraft] = useState('256');
  const [welchNoverlapDraft, setWelchNoverlapDraft] = useState('');
  const [welchWindow, setWelchWindow] = useState<WelchWindow>('hann');
  const fftPlotRef = useRef<HTMLDivElement | null>(null);
  const fft = calculateFft(selectedWindow.t, selectedWindow.y);
  const welchNperseg = Math.max(4, Math.round(Number(welchNpersegDraft) || 256));
  const welchNoverlap = welchNoverlapDraft.trim() === '' ? null : Number(welchNoverlapDraft);
  const psd = calculateWelchPsd(
    selectedWindow.t,
    selectedWindow.y,
    welchNperseg,
    Number.isFinite(welchNoverlap) ? welchNoverlap : null,
    welchWindow,
  );
  const spectrumSampleRate = spectrumMode === 'psd' ? psd?.sampleRate : fft?.sampleRate;
  const spectrumNyquist = spectrumSampleRate ? spectrumSampleRate / 2 : null;
  const rawMaxFrequency = Number(fftMaxFrequencyDraft);
  const maxFrequency =
    Number.isFinite(rawMaxFrequency) && rawMaxFrequency > 0
      ? Math.min(rawMaxFrequency, spectrumNyquist ?? rawMaxFrequency)
      : spectrumNyquist;

  useEffect(() => {
    if (!fftPlotRef.current) return;
    const result = spectrumMode === 'psd' ? psd : fft;
    if (!result || (!showFftMagnitude && (spectrumMode === 'psd' || !showFftPhase))) {
      fftPlotRef.current.innerHTML = '';
      return;
    }
    const excludeDc = dropFftDc || logFftFrequency;
    const valueAt = (index: number) =>
      'psd' in result ? result.psd[index] : result.magnitude[index];
    const frequency: number[] = [];
    const values: number[] = [];
    const phases: number[] = [];
    for (let index = 0; index < result.frequency.length; index += 1) {
      const currentFrequency = result.frequency[index];
      if (excludeDc && currentFrequency === 0) continue;
      if (logFftFrequency && currentFrequency <= 0) continue;
      if (maxFrequency !== null && currentFrequency > maxFrequency) continue;
      frequency.push(currentFrequency);
      const value = valueAt(index);
      values.push(
        showFftDb ? (spectrumMode === 'psd' ? 10 : 20) * Math.log10(Math.max(value, 1e-12)) : value,
      );
      phases.push('phase' in result ? result.phase[index] : 0);
    }
    const yAxisLabel = spectrumLabel(spectrumMode, showFftDb, selectedSignal?.unit);
    void Plotly.react(
      fftPlotRef.current,
      [
        ...(showFftMagnitude
          ? [
              {
                x: frequency,
                y: values,
                type: 'scatter' as const,
                mode: 'lines' as const,
                name: spectrumMode === 'psd' ? 'PSD (Welch)' : 'Magnitude',
                line: { color: '#38bdf8', width: 1.5 },
                hovertemplate:
                  spectrumMode === 'psd'
                    ? 'f=%{x:.4f} Hz<br>PSD=%{y:.6g}<extra>PSD</extra>'
                    : 'f=%{x:.4f} Hz<br>|Y|=%{y:.6g}<extra>Magnitude</extra>',
              },
            ]
          : []),
        ...(showFftPhase && spectrumMode === 'fft'
          ? [
              {
                x: frequency,
                y: phases,
                type: 'scatter' as const,
                mode: 'lines' as const,
                name: 'Phase',
                yaxis: showFftMagnitude ? 'y2' : 'y',
                line: { color: '#f59e0b', width: 1.4 },
                hovertemplate: 'f=%{x:.4f} Hz<br>phase=%{y:.6g} rad<extra>Phase</extra>',
              },
            ]
          : []),
      ],
      {
        autosize: true,
        paper_bgcolor: '#020617',
        plot_bgcolor: '#0f172a',
        font: { color: '#cbd5e1', family: 'Inter, ui-sans-serif, system-ui' },
        margin: { l: 64, r: showFftMagnitude && showFftPhase ? 64 : 24, t: 16, b: 52 },
        xaxis: {
          title: { text: 'Frequency [Hz]' },
          type: logFftFrequency ? 'log' : 'linear',
          gridcolor: '#1e293b',
          zerolinecolor: '#334155',
        },
        yaxis: {
          title: { text: showFftPhase && !showFftMagnitude ? 'Phase [rad]' : yAxisLabel },
          gridcolor: '#1e293b',
          zerolinecolor: '#334155',
        },
        ...(showFftMagnitude && showFftPhase
          ? {
              yaxis2: {
                title: { text: 'Phase [rad]' },
                overlaying: 'y',
                side: 'right',
                gridcolor: '#1e293b',
                zerolinecolor: '#334155',
              },
            }
          : {}),
        legend: { orientation: 'h', x: 0, y: 1.12 },
        hovermode: 'x unified',
      },
      { responsive: true, displaylogo: false },
    );
  }, [
    dropFftDc,
    fft,
    logFftFrequency,
    maxFrequency,
    psd,
    selectedSignal?.unit,
    showFftDb,
    showFftMagnitude,
    showFftPhase,
    spectrumMode,
  ]);

  return (
    <div>
      <div className="mb-3 text-sm font-semibold text-slate-100">FFT</div>
      <div className="mb-4 grid max-w-3xl grid-cols-[10rem_minmax(0,1fr)] gap-3 rounded border border-slate-800 bg-slate-950 p-3 text-sm">
        <label className="self-center text-slate-400" htmlFor="fft-channel">
          Line
        </label>
        <ChannelSelect
          id="fft-channel"
          label="FFT channel"
          selectedChannelKey={selectedChannelKey}
          setSelectedChannelKey={setSelectedChannelKey}
          signals={signals}
          traceName={traceName}
        />
        <div className="self-center text-slate-400">Mode</div>
        <ButtonGroup
          current={spectrumMode}
          options={[
            ['fft', 'FFT'],
            ['psd', 'PSD (Welch)'],
          ]}
          setCurrent={(value) => setSpectrumMode(value as SpectrumMode)}
        />
        <div className="self-center text-slate-400">Show</div>
        <div className="flex flex-wrap items-center gap-3">
          <Check label="Magnitude" checked={showFftMagnitude} setChecked={setShowFftMagnitude} />
          <Check
            label="Phase"
            checked={showFftPhase}
            disabled={spectrumMode === 'psd'}
            setChecked={setShowFftPhase}
          />
          <Check label="Drop DC" checked={dropFftDc} setChecked={setDropFftDc} />
          <Check label="dB" checked={showFftDb} setChecked={setShowFftDb} />
          <Check label="Log frequency" checked={logFftFrequency} setChecked={setLogFftFrequency} />
        </div>
        <label className="self-center text-slate-400" htmlFor="fft-max-frequency">
          Max frequency
        </label>
        <div className="flex items-center gap-2">
          <input
            id="fft-max-frequency"
            aria-label="FFT max frequency"
            className="h-8 w-32 rounded border border-slate-700 bg-slate-900 px-2 font-mono text-slate-100 outline-none focus:border-sky-500"
            max={spectrumNyquist ?? undefined}
            min={0}
            placeholder={spectrumNyquist ? formatAnalysisValue(spectrumNyquist) : 'auto'}
            step="any"
            type="number"
            value={fftMaxFrequencyDraft}
            onChange={(event) => setFftMaxFrequencyDraft(event.target.value)}
          />
          <span className="text-xs text-slate-500">
            Hz {spectrumNyquist ? `(< ${formatAnalysisValue(spectrumNyquist)})` : ''}
          </span>
        </div>
        {spectrumMode === 'psd' ? (
          <WelchControls
            nperseg={welchNpersegDraft}
            noverlap={welchNoverlapDraft}
            setNoverlap={setWelchNoverlapDraft}
            setNperseg={setWelchNpersegDraft}
            setWindow={setWelchWindow}
            window={welchWindow}
          />
        ) : null}
      </div>
      <div className="rounded border border-slate-800 bg-slate-950 p-3">
        <div className="mb-3 flex items-center gap-3">
          <div className="text-sm font-medium text-slate-100">
            {selectedSignal ? traceName(selectedSignal) : 'Select a channel'}
          </div>
          <SpectrumSummary fft={fft} psd={psd} spectrumMode={spectrumMode} />
        </div>
        {(spectrumMode === 'psd' ? psd : fft) ? (
          <div ref={fftPlotRef} className="h-96 w-full" />
        ) : (
          <div className="rounded border border-slate-800 bg-slate-900 p-4 text-sm text-slate-400">
            Not enough samples are available for this spectrum in the selected interval.
          </div>
        )}
      </div>
    </div>
  );
}

function spectrumLabel(mode: SpectrumMode, db: boolean, unit?: string | null) {
  if (db) return mode === 'psd' ? 'PSD [dB/Hz]' : 'Magnitude [dB]';
  if (mode === 'psd') return unit ? `PSD [${unit}²/Hz]` : 'PSD [units²/Hz]';
  return 'Magnitude';
}
