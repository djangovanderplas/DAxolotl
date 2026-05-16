import { useMemo, useState } from 'react';
import {
  channelLabel,
  findChannel,
  findDataset,
  groupChannels,
  hasRef,
  signalChannels,
  toggleRef,
  valveChannels,
} from '../../lib/plotUtils';
import type { ChannelRef, DatasetSummary, PlotConfig, PlotResolution } from '../../types';

export default function PlotSetup({
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
