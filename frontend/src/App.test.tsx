import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
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

const filteredChamberData = {
  ...chamberData,
  y: [21.15, 14.1333, 21.1],
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

type RelayoutHandler = (event: Record<string, unknown>) => void;

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

async function plotSelectedSignals(...names: string[]) {
  await screen.findByText(names[0]);
  for (const name of names) {
    clickCheckboxForText(name);
  }
  fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
  await waitFor(() => expect(plotlyReactMock).toHaveBeenCalled());
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
    if (url.includes('/channels/68/data') && url.includes('filter_kind=moving_average')) {
      return jsonResponse(filteredChamberData);
    }
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
  localStorage.clear();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('App', () => {
  it('loads datasets with no default channels and renders selected Plotly data', async () => {
    const fetchMock = mockFetchForHappyPath();

    render(<App />);

    expect(await screen.findByText('HF16')).toBeInTheDocument();
    expect(screen.getByText('1,157,937')).toBeInTheDocument();
    expect(screen.getAllByText('0 selected').length).toBeGreaterThan(0);
    expect(plotlyReactMock).not.toHaveBeenCalled();

    await plotSelectedSignals('Chamber Eth');
    await waitFor(() => expect(plotlyReactMock).toHaveBeenCalled());
    expect(fetchMock).toHaveBeenCalledWith('/api/datasets');
    expect(fetchMock).toHaveBeenCalledWith('/api/datasets/1');
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/api/datasets/1/channels/68/data?'),
      expect.any(Object),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('max_points=4000'),
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

    await plotSelectedSignals('Chamber Eth', 'Thrust');

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/api/datasets/1/channels/78/data?'),
        expect.any(Object),
      ),
    );
    await waitFor(() => {
      const [, traces] = lastPlotlyCall();
      expect(traces.map((trace) => trace.name)).toEqual(['Chamber Eth', 'Thrust']);
      expect(traces[1].y).toEqual(thrustData.y);
    });
  });

  it('adds tabs and splits the active tab into independently configurable plots', async () => {
    const fetchMock = mockFetchForHappyPath();

    render(<App />);
    await screen.findByText('HF16');

    fireEvent.click(screen.getByRole('button', { name: '+' }));
    expect(await screen.findByRole('button', { name: 'Tab 2' })).toBeInTheDocument();
    expect(screen.getByText('Tab 2 / Plot 2')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Split V' }));
    expect(await screen.findByRole('button', { name: 'Plot 3' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Plot 3' }));
    clickCheckboxForText('Chamber Eth');
    clickCheckboxForText('Thrust');
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/api/datasets/1/channels/78/data?'),
        expect.any(Object),
      ),
    );
    expect(screen.getByText('Tab 2 / Plot 3')).toBeInTheDocument();
  });

  it('renames tabs on double click', async () => {
    mockFetchForHappyPath();

    render(<App />);
    await screen.findByText('HF16');

    fireEvent.doubleClick(screen.getByRole('button', { name: 'Tab 1' }));
    const renameInput = screen.getByRole('textbox', { name: 'Rename Tab 1' });
    fireEvent.change(renameInput, { target: { value: 'Ignition' } });
    fireEvent.keyDown(renameInput, { key: 'Enter' });

    expect(await screen.findByRole('button', { name: 'Ignition' })).toBeInTheDocument();
    expect(screen.getByText('Ignition / Plot 1')).toBeInTheDocument();
  });

  it('splits and removes plots from the plot context menu', async () => {
    mockFetchForHappyPath();

    render(<App />);
    await screen.findByText('HF16');

    fireEvent.contextMenu(screen.getByRole('button', { name: 'Plot 1' }), {
      clientX: 100,
      clientY: 100,
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Split vertical' }));
    expect(await screen.findByRole('button', { name: 'Plot 2' })).toBeInTheDocument();

    fireEvent.contextMenu(screen.getByRole('button', { name: 'Plot 2' }), {
      clientX: 100,
      clientY: 100,
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Remove plot' }));
    expect(screen.queryByRole('button', { name: 'Plot 2' })).not.toBeInTheDocument();
  });

  it('saves, opens, and restores local browser sessions', async () => {
    mockFetchForHappyPath();
    vi.stubGlobal(
      'confirm',
      vi.fn(() => true),
    );

    render(<App />);
    await screen.findByText('HF16');

    fireEvent.doubleClick(screen.getByRole('button', { name: 'Tab 1' }));
    const renameInput = screen.getByRole('textbox', { name: 'Rename Tab 1' });
    fireEvent.change(renameInput, { target: { value: 'Saved run' } });
    fireEvent.keyDown(renameInput, { key: 'Enter' });
    expect(await screen.findByRole('button', { name: 'Saved run' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(screen.getByText('saved')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '+' }));
    expect(screen.getByRole('button', { name: 'Tab 2' })).toBeInTheDocument();
    expect(screen.getByText('unsaved')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'New' }));
    expect(await screen.findByRole('button', { name: 'Tab 1' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Saved run' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    expect(await screen.findByRole('button', { name: 'Saved run' })).toBeInTheDocument();

    cleanup();
    render(<App />);
    expect(await screen.findByRole('button', { name: 'Saved run' })).toBeInTheDocument();
  });

  it('can request full-resolution channel data', async () => {
    const fetchMock = mockFetchForHappyPath();

    render(<App />);

    await screen.findByText('Chamber Eth');
    clickCheckboxForText('Chamber Eth');
    fireEvent.click(screen.getByRole('button', { name: 'Full' }));
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/datasets/1/channels/68/data/full',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            filter: {
              kind: 'none',
              cutoff_hz: 20,
              order: 4,
              window_samples: 25,
            },
          }),
        }),
      ),
    );
    await waitFor(() => {
      const [, traces] = lastPlotlyCall();
      expect(traces[0].x).toEqual(fullChamberData.t);
      expect(screen.getAllByText('full · 5 / 5 points').length).toBeGreaterThan(0);
    });
  });

  it('requests server-side filtered data for plotted traces', async () => {
    const fetchMock = mockFetchForHappyPath();

    render(<App />);
    await plotSelectedSignals('Chamber Eth');

    fireEvent.change(screen.getByRole('combobox', { name: 'Filter' }), {
      target: { value: 'moving-average' },
    });
    const windowInput = screen.getByRole('spinbutton', { name: 'Window samples' });
    fireEvent.change(windowInput, {
      target: { value: '3' },
    });
    expect(fetchMock).not.toHaveBeenCalledWith(
      expect.stringContaining('window_samples=3'),
      expect.any(Object),
    );
    fireEvent.keyDown(windowInput, { key: 'Enter' });

    await waitFor(() => {
      const [, traces, layout] = lastPlotlyCall();
      expect(layout.title.text).toContain('Avg 3 samples');
      expect(traces[0].y).toEqual(filteredChamberData.y);
    });
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('filter_kind=moving_average'),
      expect.any(Object),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('window_samples=3'),
      expect.any(Object),
    );
  });

  it('lets fast mode request a custom point budget per trace', async () => {
    const fetchMock = mockFetchForHappyPath();

    render(<App />);
    await plotSelectedSignals('Chamber Eth');
    fetchMock.mockClear();

    const pointsInput = screen.getByRole('spinbutton', { name: 'Fast points per trace' });
    fireEvent.change(pointsInput, {
      target: { value: '9000' },
    });
    expect(fetchMock).not.toHaveBeenCalledWith(
      expect.stringContaining('max_points=9000'),
      expect.any(Object),
    );
    fireEvent.keyDown(pointsInput, { key: 'Enter' });

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('max_points=9000'),
        expect.any(Object),
      ),
    );
  });

  it('refetches the visible time window after Plotly relayout', async () => {
    const fetchMock = mockFetchForHappyPath();
    const handlers = new Map<string, RelayoutHandler>();
    const prototype = HTMLElement.prototype as HTMLElement & {
      on?: (eventName: string, handler: RelayoutHandler) => void;
      removeListener?: (eventName: string) => void;
    };
    const originalOn = prototype.on;
    const originalRemoveListener = prototype.removeListener;
    prototype.on = vi.fn((eventName: string, handler: RelayoutHandler) => {
      handlers.set(eventName, handler);
    });
    prototype.removeListener = vi.fn((eventName: string) => {
      handlers.delete(eventName);
    });

    try {
      render(<App />);
      await plotSelectedSignals('Chamber Eth');
      await waitFor(() => expect(handlers.has('plotly_relayout')).toBe(true));

      await act(async () => {
        handlers.get('plotly_relayout')?.({
          'xaxis.range[0]': 0.5,
          'xaxis.range[1]': 1.5,
        });
        await new Promise((resolve) => {
          window.setTimeout(resolve, 250);
        });
      });

      await waitFor(
        () =>
          expect(fetchMock).toHaveBeenCalledWith(
            expect.stringContaining('t_min=0.5&t_max=1.5'),
            expect.any(Object),
          ),
        { timeout: 1000 },
      );
    } finally {
      prototype.on = originalOn;
      prototype.removeListener = originalRemoveListener;
    }
  });

  it('applies selected valve overlays as Plotly shapes and annotations', async () => {
    const fetchMock = mockFetchForHappyPath();

    render(<App />);

    await screen.findByText('O-MV');
    clickCheckboxForText('Chamber Eth');
    clickCheckboxForText('O-MV');
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/api/datasets/1/channels/13/data?'),
        expect.any(Object),
      ),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/api/datasets/1/channels/13/data?filter_kind=none'),
      expect.any(Object),
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
