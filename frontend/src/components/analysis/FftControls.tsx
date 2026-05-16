import type { SpectrumMode, WelchWindow } from '../../types';
import { calculateFft, calculateWelchPsd, formatAnalysisValue } from '../../lib/plotUtils';

export function Check({
  checked,
  disabled = false,
  label,
  setChecked,
}: {
  checked: boolean;
  disabled?: boolean;
  label: string;
  setChecked: (value: boolean) => void;
}) {
  return (
    <label className="flex items-center gap-2 text-slate-300">
      <input
        checked={checked}
        className="accent-sky-500"
        disabled={disabled}
        type="checkbox"
        onChange={(event) => setChecked(event.target.checked)}
      />
      {label}
    </label>
  );
}

export function ButtonGroup({
  current,
  options,
  setCurrent,
}: {
  current: string;
  options: Array<[string, string]>;
  setCurrent: (value: string) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1">
      {options.map(([value, label]) => (
        <button
          key={value}
          className={`h-8 rounded border px-3 text-xs font-medium ${
            current === value
              ? 'border-sky-500 bg-sky-500/15 text-sky-100'
              : 'border-slate-700 bg-slate-900 text-slate-300 hover:border-slate-500'
          }`}
          type="button"
          onClick={() => setCurrent(value)}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

export function WelchControls({
  noverlap,
  nperseg,
  setNoverlap,
  setNperseg,
  setWindow,
  window,
}: {
  noverlap: string;
  nperseg: string;
  setNoverlap: (value: string) => void;
  setNperseg: (value: string) => void;
  setWindow: (value: WelchWindow) => void;
  window: WelchWindow;
}) {
  return (
    <>
      <label className="self-center text-slate-400" htmlFor="welch-nperseg">
        Welch
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-2 text-xs text-slate-500">
          nperseg
          <input
            id="welch-nperseg"
            aria-label="Welch nperseg"
            className="h-8 w-24 rounded border border-slate-700 bg-slate-900 px-2 font-mono text-slate-100 outline-none focus:border-sky-500"
            min={4}
            step={1}
            type="number"
            value={nperseg}
            onChange={(event) => setNperseg(event.target.value)}
          />
        </label>
        <label className="flex items-center gap-2 text-xs text-slate-500">
          noverlap
          <input
            aria-label="Welch noverlap"
            className="h-8 w-24 rounded border border-slate-700 bg-slate-900 px-2 font-mono text-slate-100 outline-none focus:border-sky-500"
            min={0}
            placeholder="50%"
            step={1}
            type="number"
            value={noverlap}
            onChange={(event) => setNoverlap(event.target.value)}
          />
        </label>
        <label className="flex items-center gap-2 text-xs text-slate-500">
          window
          <select
            aria-label="Welch window"
            className="h-8 rounded border border-slate-700 bg-slate-900 px-2 text-slate-100 outline-none focus:border-sky-500"
            value={window}
            onChange={(event) => setWindow(event.target.value as WelchWindow)}
          >
            <option value="hann">Hann</option>
            <option value="boxcar">Boxcar</option>
          </select>
        </label>
      </div>
    </>
  );
}

export function SpectrumSummary({
  fft,
  psd,
  spectrumMode,
}: {
  fft: ReturnType<typeof calculateFft>;
  psd: ReturnType<typeof calculateWelchPsd>;
  spectrumMode: SpectrumMode;
}) {
  if (spectrumMode === 'psd' && psd) {
    return (
      <div className="ml-auto font-mono text-xs text-slate-500">
        n = {psd.sampleCount} · fs = {formatAnalysisValue(psd.sampleRate)} Hz · seg = {psd.nperseg}/
        {psd.noverlap}
      </div>
    );
  }
  if (!fft) return null;
  return (
    <div className="ml-auto font-mono text-xs text-slate-500">
      n = {fft.sampleCount} · fs = {formatAnalysisValue(fft.sampleRate)} Hz
    </div>
  );
}
