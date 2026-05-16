# DAxolotl

Web-based test data analysis tool for engine hotfires and
coldflows. DAxolotl can use NI TDMS files, converts raw DAQ
channels into engineering units, caches processed data in Parquet, and provides
a browser UI for plotting, filtering, cursors, valve overlays, and analysis.

DAxolotl is currently an MVP for a single user on `localhost`. It reads raw test
files from `./data/` and stores metadata in local SQLite.

## Current Status

Implemented:

- FastAPI backend with SQLite metadata, TDMS ingest, Parquet cache, and typed
  channel data endpoints.
- TDMS loader for group timebases, packed valves, pressure/load-cell conversion,
  thermocouples, and the active sequence channel.
- React/Vite frontend with multi-tab plots, split plot grids, multi-dataset
  channel selection, valve overlays, server-side filters, cursor readouts, and
  browser-local session save/open.
- Analysis tools for regression, area, statistics, FFT/PSD, spectrogram, and
  histogram.
- Backend trusted-user Python scripting endpoint for cached derived channels.

Not implemented yet:

- Frontend script editor UI.
- Backend-backed saved views.
- Annotation UI/API, sequence-step overlay, export flow, and pipeline runner.

## Install for a New Developer

Prerequisites:

- Conda or Mamba.
- Git.

Recommended setup from a fresh clone:

```bash
git clone git@github.com:djangovanderplas/DAxolotl.git
cd DAxolotl
conda env create -f environment.yml
conda activate DAxolotl
cd frontend && npm install && cd ..
cp .env.example .env  # optional; defaults are usable
```

The conda environment installs Python 3.11, Node 20+, and the Python package in
editable development mode with dev tools. The separate `npm install` installs
the frontend dependencies from `frontend/package-lock.json`.

If the environment already exists:

```bash
conda activate DAxolotl
conda env update -f environment.yml --prune
cd frontend && npm install && cd ..
```

Alternative without conda:

```bash
python -m venv .venv
source .venv/bin/activate
pip install -e ".[dev]"
cd frontend && npm install && cd ..
```

Use Python 3.11+ and Node 20+ if you choose the non-conda route.

## Run

Start backend and frontend together:

```bash
conda activate DAxolotl
make dev
```

Or run them in separate terminals:

```bash
conda activate DAxolotl
make backend

conda activate DAxolotl
make frontend
```

Open <http://localhost:5173>. The Vite dev server proxies `/api/*` requests to
the backend on port `8000`.

## Add Data

Raw test files are intentionally not tracked by git. Put one TDMS file under a
test folder:

```bash
mkdir -p data/HF16
cp /path/to/file.tdms data/HF16/
```

Register the dataset with the CLI:

```bash
conda activate DAxolotl
daxolotl ingest ./data/HF16 --name "HF16"
```

Processed Parquet caches are written under `data/.processed/` and are also not
tracked by git.

## Derived Channels

The backend exposes a trusted-user Python scripting endpoint:

```bash
curl -X POST http://localhost:8000/api/datasets/1/script \
  -H 'Content-Type: application/json' \
  -d '{"name":"Double chamber","code":"channels[\"Pressure Sensors/Chamber Eth\"] * 2"}'
```

Scripts can read source arrays from `channels["Group/Channel"]`, use `t` for
the common time array, and expose outputs as the final expression or variables
named with an `out_` prefix. Outputs are cached as Parquet-derived channels and
can be fetched through the normal channel data endpoints.

This is a trusted-user execution path with no isolation, timeout, or resource
limits. Only run scripts from people you trust on machines you control.

## Test and Lint

```bash
conda activate DAxolotl
make test             # backend pytest + frontend Vitest
make test-backend     # backend pytest only
make test-frontend    # frontend Vitest only
make lint             # Ruff + Prettier checks
make format           # Ruff + Prettier auto-format
```

The real-file TDMS integration test skips when no matching local TDMS file is
present. Synthetic TDMS tests do not require external data.

## Project Structure

```text
backend/daxolotl/    FastAPI app, loaders, processing, routers, storage
backend/tests/       pytest suite with synthetic TDMS fixtures
frontend/src/        React + Vite + Tailwind + Zustand + Plotly UI
data/                local raw and processed data; gitignored except .gitkeep
```

## TDMS File-Format Notes

These details are verified against current loader behavior:

1. **Valves are bit-packed.** `Digital Outputs/Digital Outputs` is a `uint32`
   with `Valve names` and `Unpowered states` properties. DAxolotl unpacks 32
   boolean valve channels and XORs each bit with its unpowered state so `1`
   means commanded open.
2. **Groups can have separate `Ticks [us]` channels.** Observed files have
   aligned ticks, but the loader still handles divergent group timebases with
   nearest-neighbor alignment onto the longest group timebase.
3. **Pressure and load-cell conversion is multiply.** Engineering units are
   computed as `value = raw * slope + offset`.
4. **Thermocouples use the NI 9213 chain.** DAxolotl applies CJC thermistor
   conversion, autozero compensation, and K/T lookup-table interpolation.
5. **`General/Active Sequence Step` is surfaced raw.** It appears to be a
   monotonic counter in current files, so UI interpretation is deferred.

## Local Files and Git

The repository tracks source code, tests, package metadata, and `data/.gitkeep`.
It intentionally ignores:

- Raw TDMS data and processed Parquet caches.
- SQLite databases and local environment files.
- Generated Python, Node, Vite, and TypeScript build artifacts.
- Read-only legacy/reference material outside the app source tree.
