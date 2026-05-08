export type DeviceCategory = 'system' | 'apple' | 'nvidia' | 'amd' | 'custom';

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
  { id: 'apple-m3', name: 'Apple M3', category: 'apple', bandwidthGBps: 100 },
  { id: 'apple-m3-pro', name: 'Apple M3 Pro', category: 'apple', bandwidthGBps: 150 },
  { id: 'apple-m3-max-14c', name: 'Apple M3 Max (14-core)', category: 'apple', bandwidthGBps: 300 },
  { id: 'apple-m3-max', name: 'Apple M3 Max (16-core)', category: 'apple', bandwidthGBps: 400 },
  { id: 'apple-m3-ultra', name: 'Apple M3 Ultra', category: 'apple', bandwidthGBps: 800 },
  { id: 'apple-m4', name: 'Apple M4', category: 'apple', bandwidthGBps: 120 },
  { id: 'apple-m4-pro', name: 'Apple M4 Pro', category: 'apple', bandwidthGBps: 273 },
  { id: 'apple-m4-max-14c', name: 'Apple M4 Max (14-core)', category: 'apple', bandwidthGBps: 410 },
  { id: 'apple-m4-max', name: 'Apple M4 Max (16-core)', category: 'apple', bandwidthGBps: 546 },

  // RTX 30 series
  {
    id: 'rtx-3060-12gb',
    name: 'Nvidia RTX 3060',
    category: 'nvidia',
    bandwidthGBps: 360,
    memoryGB: 12,
  },
  { id: 'rtx-3090', name: 'Nvidia RTX 3090', category: 'nvidia', bandwidthGBps: 936, memoryGB: 24 },
  {
    id: 'rtx-3090-ti',
    name: 'Nvidia RTX 3090 Ti',
    category: 'nvidia',
    bandwidthGBps: 1008,
    memoryGB: 24,
  },
  // RTX 40 series
  { id: 'rtx-4070', name: 'Nvidia RTX 4070', category: 'nvidia', bandwidthGBps: 504, memoryGB: 12 },
  {
    id: 'rtx-4070-ti',
    name: 'Nvidia RTX 4070 Ti',
    category: 'nvidia',
    bandwidthGBps: 504,
    memoryGB: 12,
  },
  {
    id: 'rtx-4070-ti-super',
    name: 'Nvidia RTX 4070 Ti Super',
    category: 'nvidia',
    bandwidthGBps: 672,
    memoryGB: 16,
  },
  { id: 'rtx-4080', name: 'Nvidia RTX 4080', category: 'nvidia', bandwidthGBps: 717, memoryGB: 16 },
  {
    id: 'rtx-4080-super',
    name: 'Nvidia RTX 4080 Super',
    category: 'nvidia',
    bandwidthGBps: 736,
    memoryGB: 16,
  },
  {
    id: 'rtx-4090',
    name: 'Nvidia RTX 4090',
    category: 'nvidia',
    bandwidthGBps: 1008,
    memoryGB: 24,
  },
  // RTX 50 series
  {
    id: 'rtx-5070-ti',
    name: 'Nvidia RTX 5070 Ti',
    category: 'nvidia',
    bandwidthGBps: 896,
    memoryGB: 16,
  },
  { id: 'rtx-5080', name: 'Nvidia RTX 5080', category: 'nvidia', bandwidthGBps: 960, memoryGB: 16 },
  {
    id: 'rtx-5090',
    name: 'Nvidia RTX 5090',
    category: 'nvidia',
    bandwidthGBps: 1792,
    memoryGB: 32,
  },
  // Workstation
  {
    id: 'rtx-a6000',
    name: 'Nvidia RTX A6000',
    category: 'nvidia',
    bandwidthGBps: 768,
    memoryGB: 48,
  },
  {
    id: 'rtx-6000-ada',
    name: 'Nvidia RTX 6000 Ada',
    category: 'nvidia',
    bandwidthGBps: 960,
    memoryGB: 48,
  },
  // Datacenter
  {
    id: 'a100-80gb',
    name: 'Nvidia A100 80GB',
    category: 'nvidia',
    bandwidthGBps: 1935,
    memoryGB: 80,
  },
  {
    id: 'h100-pcie',
    name: 'Nvidia H100 PCIe',
    category: 'nvidia',
    bandwidthGBps: 2000,
    memoryGB: 80,
  },
  {
    id: 'h100-sxm',
    name: 'Nvidia H100 SXM',
    category: 'nvidia',
    bandwidthGBps: 3350,
    memoryGB: 80,
  },
  {
    id: 'h200-sxm',
    name: 'Nvidia H200 SXM',
    category: 'nvidia',
    bandwidthGBps: 4800,
    memoryGB: 141,
  },

  { id: 'rx-7900-xt', name: 'AMD RX 7900 XT', category: 'amd', bandwidthGBps: 800, memoryGB: 20 },
  { id: 'rx-7900-xtx', name: 'AMD RX 7900 XTX', category: 'amd', bandwidthGBps: 960, memoryGB: 24 },
];

export const CATEGORY_LABELS: Record<Exclude<DeviceCategory, 'custom'>, string> = {
  system: 'System memory',
  apple: 'Apple Silicon',
  nvidia: 'Nvidia GPU',
  amd: 'AMD GPU',
};
