import { create } from 'zustand';
import type { DatasetSummary, LoadState } from '../types';

type DatasetsStore = {
  datasets: DatasetSummary[];
  selectedDatasetId: number | null;
  datasetState: LoadState;
  error: string | null;
  setDatasets: (datasets: DatasetSummary[]) => void;
  setSelectedDatasetId: (datasetId: number | null) => void;
  setDatasetState: (state: LoadState) => void;
  setError: (error: string | null) => void;
  reset: () => void;
};

const initialState = {
  datasets: [],
  selectedDatasetId: null,
  datasetState: 'idle' as LoadState,
  error: null,
};

export const useDatasetsStore = create<DatasetsStore>((set) => ({
  ...initialState,
  setDatasets: (datasets) => set({ datasets }),
  setSelectedDatasetId: (selectedDatasetId) => set({ selectedDatasetId }),
  setDatasetState: (datasetState) => set({ datasetState }),
  setError: (error) => set({ error }),
  reset: () => set(initialState),
}));
