import type { ChannelData, ChannelRef, FilterConfig, TimeWindow } from '../types';

function apiFilterKind(kind: FilterConfig['kind']): 'none' | 'butterworth' | 'moving_average' {
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

export async function fetchChannelData({
  channelRef,
  filter,
  maxPoints,
  resolution,
  signal,
  visibleWindow,
}: {
  channelRef: ChannelRef;
  filter: FilterConfig;
  maxPoints: number;
  resolution: 'fast' | 'full';
  signal?: AbortSignal;
  visibleWindow: TimeWindow | null;
}): Promise<ChannelData> {
  if (resolution === 'full') {
    const response = await fetch(
      `/api/datasets/${channelRef.datasetId}/channels/${channelRef.channelId}/data/full`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...(visibleWindow
            ? {
                t_min: visibleWindow.tMin,
                t_max: visibleWindow.tMax,
              }
            : {}),
          filter: filterBody(filter),
        }),
        signal,
      },
    );
    if (!response.ok) throw new Error(`Channel data HTTP ${response.status}`);
    return (await response.json()) as ChannelData;
  }

  const params = new URLSearchParams();
  addFilterParams(params, filter);
  if (visibleWindow) {
    params.set('t_min', String(visibleWindow.tMin));
    params.set('t_max', String(visibleWindow.tMax));
  }
  params.set('max_points', String(maxPoints));
  const response = await fetch(
    `/api/datasets/${channelRef.datasetId}/channels/${channelRef.channelId}/data?${params.toString()}`,
    { signal },
  );
  if (!response.ok) throw new Error(`Channel data HTTP ${response.status}`);
  return (await response.json()) as ChannelData;
}
