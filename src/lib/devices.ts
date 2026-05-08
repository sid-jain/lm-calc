export type DeviceCategory = 'system' | 'apple' | 'nvidia' | 'custom';

export interface Device {
  id: string;
  name: string;
  category: DeviceCategory;
  bandwidthGBps: number;
  memoryGB?: number;
}

export const CUSTOM_DEVICE_ID = 'custom';

export const DEVICES: Device[] = [
  { id: 'ddr4-dual', name: 'DDR4 dual-channel', category: 'system', bandwidthGBps: 51 },
  { id: 'ddr5-dual', name: 'DDR5 dual-channel', category: 'system', bandwidthGBps: 89 },
  { id: 'ddr5-quad', name: 'DDR5 quad-channel (HEDT)', category: 'system', bandwidthGBps: 178 },

  { id: 'apple-m2', name: 'Apple M2', category: 'apple', bandwidthGBps: 100 },
  { id: 'apple-m2-pro', name: 'Apple M2 Pro', category: 'apple', bandwidthGBps: 200 },
  { id: 'apple-m2-max', name: 'Apple M2 Max', category: 'apple', bandwidthGBps: 400 },
  { id: 'apple-m2-ultra', name: 'Apple M2 Ultra', category: 'apple', bandwidthGBps: 800 },
  { id: 'apple-m3-pro', name: 'Apple M3 Pro', category: 'apple', bandwidthGBps: 150 },
  { id: 'apple-m3-max', name: 'Apple M3 Max', category: 'apple', bandwidthGBps: 400 },
  { id: 'apple-m4-pro', name: 'Apple M4 Pro', category: 'apple', bandwidthGBps: 273 },
  { id: 'apple-m4-max', name: 'Apple M4 Max', category: 'apple', bandwidthGBps: 546 },

  { id: 'rtx-3060-12gb', name: 'Nvidia RTX 3060', category: 'nvidia', bandwidthGBps: 360, memoryGB: 12 }, // prettier-ignore
  { id: 'rtx-4070-ti', name: 'Nvidia RTX 4070 Ti', category: 'nvidia', bandwidthGBps: 504, memoryGB: 12 }, // prettier-ignore
  { id: 'rtx-4080', name: 'Nvidia RTX 4080', category: 'nvidia', bandwidthGBps: 717, memoryGB: 16 },
  { id: 'rtx-3090', name: 'Nvidia RTX 3090', category: 'nvidia', bandwidthGBps: 936, memoryGB: 24 },
  { id: 'rtx-4090', name: 'Nvidia RTX 4090', category: 'nvidia', bandwidthGBps: 1008, memoryGB: 24 },
  { id: 'rtx-5090', name: 'Nvidia RTX 5090', category: 'nvidia', bandwidthGBps: 1792, memoryGB: 32 },
  { id: 'a100-80gb', name: 'Nvidia A100', category: 'nvidia', bandwidthGBps: 1935, memoryGB: 80 },
  { id: 'h100-sxm', name: 'Nvidia H100 SXM', category: 'nvidia', bandwidthGBps: 3350, memoryGB: 80 },
];

export const CATEGORY_LABELS: Record<Exclude<DeviceCategory, 'custom'>, string> = {
  system: 'System memory',
  apple: 'Apple Silicon',
  nvidia: 'Nvidia GPU',
};
