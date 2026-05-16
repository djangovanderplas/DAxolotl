import type { ChannelData, TimeWindow } from '../../types';

export type WindowedSignal = {
  data: ChannelData;
  name: string;
  unit: string | null;
  window: { t: number[]; y: number[] };
};

export type TraceName = (data: ChannelData) => string;
export type CopyText = (text: string) => void;
export type NullableNumberRow = readonly [string, number | null, number | null];
export type IntervalChoice = TimeWindow | null;
