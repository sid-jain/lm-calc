import { CONTEXT_SNAPS, formatContext, snapContext } from '../lib/contextSnaps';
import { AUTO_QUANT, AUTO_QUANT_ID, QUANT_LEVELS } from '../lib/quants';
import { CATEGORY_LABELS, CUSTOM_DEVICE_ID, DEVICES, type Device } from '../lib/devices';
import type { QuantLevel } from '../lib/types';

interface Props {
  ramGB: number;
  contextLen: number;
  quant: QuantLevel;
  device: Device;
  customBandwidthGBps: number;
  minTps: number;
  onRamGB: (v: number) => void;
  onContextLen: (v: number) => void;
  onQuant: (q: QuantLevel) => void;
  onDevice: (d: Device) => void;
  onCustomBandwidth: (v: number) => void;
  onMinTps: (v: number) => void;
}

const RAM_MIN = 1;
const RAM_MAX = 1024;
const CTX_LOG_MIN = Math.log2(CONTEXT_SNAPS[0]);
const CTX_LOG_MAX = Math.log2(CONTEXT_SNAPS[CONTEXT_SNAPS.length - 1]);

function groupDevices(): { group: string; devices: Device[] }[] {
  const order: Device['category'][] = ['system', 'apple', 'nvidia'];
  return order.map((cat) => ({
    group: CATEGORY_LABELS[cat as keyof typeof CATEGORY_LABELS],
    devices: DEVICES.filter((d) => d.category === cat),
  }));
}

export function Controls({
  ramGB,
  contextLen,
  quant,
  device,
  customBandwidthGBps,
  minTps,
  onRamGB,
  onContextLen,
  onQuant,
  onDevice,
  onCustomBandwidth,
  onMinTps,
}: Props): JSX.Element {
  const isCustom = device.id === CUSTOM_DEVICE_ID;
  return (
    <div className="space-y-4">
      {/* Row 1 — slider-based inputs */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <div className="rounded-lg border border-slate-200 p-4 dark:border-slate-800">
          <label
            htmlFor="ram-input"
            className="block text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400"
          >
            Available RAM
          </label>
          <div className="mt-2 flex items-baseline gap-2">
            <input
              id="ram-input"
              type="number"
              min={RAM_MIN}
              max={RAM_MAX}
              step={1}
              value={ramGB}
              onChange={(e) => {
                const n = Number(e.target.value);
                if (Number.isFinite(n)) {
                  onRamGB(Math.max(RAM_MIN, Math.min(RAM_MAX, Math.round(n))));
                }
              }}
              className="w-24 rounded border border-slate-300 bg-white text-slate-900 dark:bg-slate-900 dark:text-slate-100 px-2 py-1 text-lg font-semibold tabular-nums focus:outline-none focus:ring-2 focus:ring-sky-500 dark:border-slate-700"
            />
            <span className="text-sm text-slate-500 dark:text-slate-400">GB</span>
          </div>
          <input
            aria-label="RAM slider"
            type="range"
            min={RAM_MIN}
            max={RAM_MAX}
            step={1}
            value={ramGB}
            onChange={(e) => onRamGB(Number(e.target.value))}
            className="mt-3 w-full accent-sky-600"
          />
        </div>

        <div className="rounded-lg border border-slate-200 p-4 dark:border-slate-800">
          <label
            htmlFor="ctx-select"
            className="block text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400"
          >
            Context length
          </label>
          <div className="mt-2 flex items-baseline gap-2">
            <select
              id="ctx-select"
              value={contextLen}
              onChange={(e) => onContextLen(Number(e.target.value))}
              className="rounded border border-slate-300 bg-white text-slate-900 dark:bg-slate-900 dark:text-slate-100 px-2 py-1 text-lg font-semibold tabular-nums focus:outline-none focus:ring-2 focus:ring-sky-500 dark:border-slate-700"
            >
              {CONTEXT_SNAPS.map((c) => (
                <option key={c} value={c}>
                  {formatContext(c)}
                </option>
              ))}
            </select>
            <span className="text-sm text-slate-500 dark:text-slate-400">tokens</span>
          </div>
          <input
            aria-label="Context length slider"
            type="range"
            min={CTX_LOG_MIN}
            max={CTX_LOG_MAX}
            step={0.001}
            value={Math.log2(contextLen)}
            onChange={(e) => onContextLen(snapContext(2 ** Number(e.target.value)))}
            className="mt-3 w-full accent-sky-600"
          />
        </div>

        <div className="rounded-lg border border-slate-200 p-4 dark:border-slate-800">
          <label
            htmlFor="min-tps"
            className="block text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400"
          >
            Min speed
          </label>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="w-10 tabular-nums text-lg font-semibold text-slate-900 dark:text-slate-100">
              {minTps}
            </span>
            <span className="text-sm text-slate-500 dark:text-slate-400">tok/s</span>
          </div>
          <input
            id="min-tps"
            aria-label="Min speed slider"
            type="range"
            min={0}
            max={60}
            step={1}
            value={minTps}
            onChange={(e) => onMinTps(Number(e.target.value))}
            className="mt-3 w-full accent-sky-600"
          />
        </div>
      </div>

      {/* Row 2 — dropdown inputs */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="rounded-lg border border-slate-200 p-4 dark:border-slate-800">
          <label
            htmlFor="quant-select"
            className="block text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400"
          >
            Quantization
          </label>
          <select
            id="quant-select"
            value={quant.id}
            onChange={(e) => {
              const id = e.target.value;
              if (id === AUTO_QUANT_ID) {
                onQuant(AUTO_QUANT);
                return;
              }
              const next = QUANT_LEVELS.find((q) => q.id === id);
              if (next) onQuant(next);
            }}
            className="mt-2 w-full rounded border border-slate-300 bg-white text-slate-900 dark:bg-slate-900 dark:text-slate-100 px-2 py-2 text-lg font-semibold focus:outline-none focus:ring-2 focus:ring-sky-500 dark:border-slate-700"
          >
            <option value={AUTO_QUANT_ID}>{AUTO_QUANT.name}</option>
            <option disabled>──────────</option>
            {QUANT_LEVELS.map((q) => (
              <option key={q.id} value={q.id}>
                {q.name}
              </option>
            ))}
          </select>
          <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">{quant.description}</p>
        </div>

        <div className="rounded-lg border border-slate-200 p-4 dark:border-slate-800">
          <label
            htmlFor="device-select"
            className="block text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400"
          >
            Device
          </label>
          <select
            id="device-select"
            value={device.id}
            onChange={(e) => {
              const id = e.target.value;
              if (id === CUSTOM_DEVICE_ID) {
                onDevice({
                  id: CUSTOM_DEVICE_ID,
                  name: 'Custom',
                  category: 'custom',
                  bandwidthGBps: customBandwidthGBps,
                });
                return;
              }
              const next = DEVICES.find((d) => d.id === id);
              if (next) onDevice(next);
            }}
            className="mt-2 w-full rounded border border-slate-300 bg-white text-slate-900 dark:bg-slate-900 dark:text-slate-100 px-2 py-2 text-lg font-semibold focus:outline-none focus:ring-2 focus:ring-sky-500 dark:border-slate-700"
          >
            {groupDevices().map(({ group, devices }) => (
              <optgroup key={group} label={group}>
                {devices.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name} | {d.bandwidthGBps} GB/s
                  </option>
                ))}
              </optgroup>
            ))}
            <option value={CUSTOM_DEVICE_ID}>Custom…</option>
          </select>
          {isCustom ? (
            <div className="mt-2 flex items-baseline gap-2">
              <input
                type="number"
                min={1}
                max={10000}
                step={1}
                value={customBandwidthGBps}
                onChange={(e) => {
                  const n = Number(e.target.value);
                  if (Number.isFinite(n) && n > 0) {
                    onCustomBandwidth(Math.round(n));
                    onDevice({
                      id: CUSTOM_DEVICE_ID,
                      name: 'Custom',
                      category: 'custom',
                      bandwidthGBps: Math.round(n),
                    });
                  }
                }}
                className="w-24 rounded border border-slate-300 bg-white px-2 py-1 text-sm tabular-nums text-slate-900 focus:outline-none focus:ring-2 focus:ring-sky-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                aria-label="Custom memory bandwidth in GB/s"
              />
              <span className="text-xs text-slate-500 dark:text-slate-400">GB/s</span>
            </div>
          ) : (
            <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
              {device.bandwidthGBps} GB/s memory bandwidth
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
