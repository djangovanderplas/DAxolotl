import type { DatasetSummary } from '../types';

export async function fetchDatasetSummaries(): Promise<DatasetSummary[]> {
  const response = await fetch('/api/datasets');
  if (!response.ok) throw new Error(`Datasets HTTP ${response.status}`);
  return (await response.json()) as DatasetSummary[];
}

export async function fetchDataset(datasetId: number): Promise<DatasetSummary> {
  const response = await fetch(`/api/datasets/${datasetId}`);
  if (!response.ok) throw new Error(`Dataset ${datasetId} HTTP ${response.status}`);
  return (await response.json()) as DatasetSummary;
}

export async function fetchDatasetsWithDetails(): Promise<DatasetSummary[]> {
  const summaries = await fetchDatasetSummaries();
  return Promise.all(summaries.map((summary) => fetchDataset(summary.id)));
}
