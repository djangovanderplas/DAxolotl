# DAxolotl

Web-based test data analysis tool for rocket engine hotfires and coldflows. Loads
National Instruments DAQ TDMS files, plots channels with valve/sequence overlays,
runs custom math, and saves view configs.

This is the MVP — single-user, runs on `localhost`, reads from `./data/`.

## Setup

Requires **Python 3.11+** and **Node 20+**.

```bash
make install          # pip install -e ".[dev]"  +  npm install
cp .env.example .env  # optional — defaults are fine
```

## Run

```bash
make dev              # backend on :8000, frontend on :5173, concurrently
# or, in two terminals:
make backend
make frontend
```

Open <http://localhost:5173>. The frontend proxies `/api/*` to the backend.

## Test / lint

```bash
make test             # backend pytest + frontend vitest
make test-backend     # pytest backend/tests
make test-frontend    # cd frontend && npm test
make lint             # ruff + prettier
make format           # auto-fix
```

## Project structure

```
backend/daxolotl/    FastAPI app + loaders + processing + scripting + pipelines
backend/tests/       pytest suite (incl. TDMS fixtures)
frontend/src/        React + Vite + Tailwind UI
data/                test data (gitignored)
```

See [`DAxolotl_prompt.md`](DAxolotl_prompt.md) for the full design brief.

## TDMS file-format quirks (future me, read this)

Documented in detail in `backend/daxolotl/loaders/tdms.py` once written
(build-plan step 2). Summary of the gotchas:

1. **Valves are bit-packed.** `Digital Outputs/Digital Outputs` is a uint32 with
   `Valve names` + `Unpowered states` properties — unpack into 32 boolean channels,
   XOR with unpowered state.
2. **Each group has its own `Ticks [us]` channel.** Independent timebases — merge
   onto a common axis (max-resolution group as the anchor, nearest-neighbour
   resample the rest), zero at start.
3. **Pressure / load cell `_slope` and `_offset`** properties give engineering
   units: `value = raw / slope + offset` (note: *divide* by slope).
4. **Thermocouple `_type` (`K`, `T`, …)** + `Autozero` / `CJC` channels in the
   `Thermocouples` group. MVP uses polynomial approximation with CJC compensation;
   `# TODO(post-mvp):` swap in NIST ITS-90 coefficients.
5. **`General/Active Sequence Step`** is a step-function int — surface as a
   first-class "sequence step" overlay.

## Scripting sandbox

`scripting/runtime.py` exposes `numpy`, a `channels` namespace, and helpers
(`butter`, `moving_avg`, `differentiate`, etc.) to a restricted `exec()`.

**This is a trusted-user sandbox.** No isolation, no resource limits. Fine for a
team of pilots / engineers on a LAN. Before any public deployment, swap for
`RestrictedPython` or a subprocess sandbox. See `# TODO(post-mvp):` markers.

## Roadmap (post-MVP)

- Real auth / org SSO
- Flight recorder data (IMU/GPS/baro), 2D/3D map view
- Theoretical model comparison tooling
- Drag-and-drop pipeline editor
- Sandboxed script execution
- NIST ITS-90 thermocouple coefficients
- Nextcloud / network storage
- Audit log of uploads / script runs
- Test campaign grouping
- Unit-aware math
- Postgres migration
