import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import App from './App';

const plotlyReactMock = vi.hoisted(() => vi.fn(() => Promise.resolve()));
const plotlyResizeMock = vi.hoisted(() => vi.fn(() => Promise.resolve()));

vi.mock('plotly.js-dist-min', () => ({
  default: {
    react: plotlyReactMock,
    Plots: {
      resize: plotlyResizeMock,
    },
  },
}));

const datasetSummary = {
  id: 1,
  name: 'HF16',
  test_id: 'HF16',
  raw_path: '/data/HF16/file.tdms',
  created_at: '2026-05-11T12:00:00Z',
  metadata: {
    duration_s: 289.484,
    sample_count: 1_157_937,
    groups: ['Pressure Sensors', 'Load Cells'],
  },
  channels: [],
};

const datasetDetail = {
  ...datasetSummary,
  channels: [
    {
      id: 68,
      group_name: 'Pressure Sensors',
      name: 'Chamber Eth',
      unit: 'bar',
      dtype: 'float64',
      sample_count: 1_157_937,
      is_valve: false,
    },
    {
      id: 78,
      group_name: 'Load Cells',
      name: 'Thrust',
      unit: 'N',
      dtype: 'float64',
      sample_count: 1_157_937,
      is_valve: false,
    },
    {
      id: 13,
      group_name: 'Digital Outputs',
      name: 'O-MV',
      unit: 'bool',
      dtype: 'bool',
      sample_count: 1_157_937,
      is_valve: true,
    },
    {
      id: 37,
      group_name: 'Thermocouples',
      name: 'LOx Tank Top (raw)',
      unit: 'V',
      dtype: 'float64',
      sample_count: 1_157_937,
      is_valve: false,
    },
  ],
};

const chamberData = {
  dataset_id: 1,
  channel_id: 68,
  channel_name: 'Chamber Eth',
  group_name: 'Pressure Sensors',
  unit: 'bar',
  t: [0, 1, 2],
  y: [0.2, 42.1, 0.1],
  decimated: true,
  point_count: 3,
  full_point_count: 1_157_937,
};

const fullChamberData = {
  ...chamberData,
  t: [0, 0.5, 1, 1.5, 2],
  y: [0.2, 18, 42.1, 19, 0.1],
  decimated: false,
  point_count: 5,
  full_point_count: 5,
};

const thrustData = {
  ...chamberData,
  channel_id: 78,
  channel_name: 'Thrust',
  group_name: 'Load Cells',
  unit: 'N',
  y: [0, 13_900, 10],
};

const valveData = {
  ...chamberData,
  channel_id: 13,
  channel_name: 'O-MV',
  group_name: 'Digital Outputs',
  unit: 'bool',
  t: [0, 1, 2, 3],
  y: [0, 1, 1, 0],
  point_count: 4,
};

type PlotlyTraceCall = [
  HTMLElement,
  Array<{ name: string; x: number[]; y: number[] }>,
  {
    title: { text: string };
    annotations?: Array<{ text?: string }>;
    shapes?: Array<Record<string, unknown>>;
  },
];

function lastPlotlyCall(): PlotlyTraceCall {
  const call = plotlyReactMock.mock.calls.at(-1);
  expect(call).toBeDefined();
  return call as unknown as PlotlyTraceCall;
}

function clickCheckboxForText(text: string) {
  const label = screen.getByText(text).closest('label');
  expect(label).not.toBeNull();
  const checkbox = label!.querySelector('input[type="checkbox"]');
  expect(checkbox).not.toBeNull();
  fireEvent.click(checkbox!);
}

function jsonResponse(body: unknown, status = 200) {
  return Promise.resolve(
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
  );
}

function mockFetchForHappyPath() {
  const fetchMock = vi.fn((input: RequestInfo | URL) => {
    const url = String(input);
    if (url === '/api/datasets') return jsonResponse([datasetSummary]);
    if (url === '/api/datasets/1') return jsonResponse(datasetDetail);
    if (url === '/api/datasets/1/channels/68/data/full') return jsonResponse(fullChamberData);
    if (url.includes('/channels/68/data')) return jsonResponse(chamberData);
    if (url.includes('/channels/78/data')) return jsonResponse(thrustData);
    if (url.includes('/channels/13/data')) return jsonResponse(valveData);
    return jsonResponse({ detail: 'not found' }, 404);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('App', () => {
  it('loads datasets, selects Chamber Eth by default, and renders Plotly data', async () => {
    const fetchMock = mockFetchForHappyPath();

    render(<App />);

    expect(await screen.findByText('HF16')).toBeInTheDocument();
    expect(screen.getByText('1,157,937')).toBeInTheDocument();

    await waitFor(() => expect(plotlyReactMock).toHaveBeenCalled());
    expect(fetchMock).toHaveBeenCalledWith('/api/datasets');
    expect(fetchMock).toHaveBeenCalledWith('/api/datasets/1');
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/datasets/1/channels/68/data?max_points=4000',
      expect.any(Object),
    );

    const [, traces, layout] = lastPlotlyCall();
    const trace = traces[0];
    expect(trace.name).toBe('Chamber Eth');
    expect(trace.x).toEqual(chamberData.t);
    expect(trace.y).toEqual(chamberData.y);
    expect(layout.title.text).toBe('Pressure Sensors / Chamber Eth');
  });

  it('applies multi-channel setup and renders both selected traces', async () => {
    const fetchMock = mockFetchForHappyPath();

    render(<App />);
    await waitFor(() => expect(plotlyReactMock).toHaveBeenCalled());

    await screen.findByText('Thrust');
    clickCheckboxForText('Thrust');
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/datasets/1/channels/78/data?max_points=4000',
        expect.any(Object),
      ),
    );
    await waitFor(() => {
      const [, traces] = lastPlotlyCall();
      expect(traces.map((trace) => trace.name)).toEqual(['Chamber Eth', 'Thrust']);
      expect(traces[1].y).toEqual(thrustData.y);
    });
  });

  it('can request full-resolution channel data', async () => {
    const fetchMock = mockFetchForHappyPath();

    render(<App />);
    await waitFor(() => expect(plotlyReactMock).toHaveBeenCalled());

    fireEvent.click(screen.getByRole('button', { name: 'Full' }));
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/datasets/1/channels/68/data/full',
        expect.objectContaining({
          method: 'POST',
          body: '{}',
        }),
      ),
    );
    await waitFor(() => {
      const [, traces] = lastPlotlyCall();
      expect(traces[0].x).toEqual(fullChamberData.t);
      expect(screen.getByText('full · 5 / 5 points')).toBeInTheDocument();
    });
  });

  it('applies client-side running average filtering to plotted traces', async () => {
    mockFetchForHappyPath();

    render(<App />);
    await waitFor(() => expect(plotlyReactMock).toHaveBeenCalled());

    fireEvent.change(screen.getByRole('combobox', { name: 'Filter' }), {
      target: { value: 'moving-average' },
    });
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Window samples' }), {
      target: { value: '3' },
    });

    await waitFor(() => {
      const [, traces, layout] = lastPlotlyCall();
      expect(layout.title.text).toContain('Avg 3 samples');
      expect(traces[0].y[0]).toBeCloseTo(21.15);
      expect(traces[0].y[1]).toBeCloseTo(14.1333);
      expect(traces[0].y[2]).toBeCloseTo(21.1);
    });
  });

  it('applies selected valve overlays as Plotly shapes and annotations', async () => {
    const fetchMock = mockFetchForHappyPath();

    render(<App />);
    await waitFor(() => expect(plotlyReactMock).toHaveBeenCalled());

    await screen.findByText('O-MV');
    clickCheckboxForText('O-MV');
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/datasets/1/channels/13/data?max_points=4000',
        expect.any(Object),
      ),
    );
    await waitFor(() => {
      const [, traces, layout] = lastPlotlyCall();
      expect(traces.map((trace) => trace.name)).toEqual(['Chamber Eth']);
      expect(layout.annotations?.some((annotation) => annotation.text === 'OMV')).toBe(true);
      expect(layout.shapes?.length).toBeGreaterThan(0);
    });
  });

  it('shows an empty state when the backend has no datasets', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => jsonResponse([])),
    );

    render(<App />);

    expect(await screen.findByText('No datasets registered.')).toBeInTheDocument();
    expect(plotlyReactMock).not.toHaveBeenCalled();
  });

  it('shows API errors without rendering a plot', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => jsonResponse({ detail: 'boom' }, 500)),
    );

    render(<App />);

    expect(await screen.findByText('Datasets HTTP 500')).toBeInTheDocument();
    expect(plotlyReactMock).not.toHaveBeenCalled();
  });
});
