import { useEffect, useState } from 'react';
import { CONTEXT_SNAPS, formatContext } from '../lib/contextSnaps';
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

function groupDevices(): { group: string; devices: Device[] }[] {
  const order: Device['category'][] = ['system', 'apple', 'nvidia', 'amd'];
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
  const fixedMemoryGB = device.memoryGB;
  const ramFixed = fixedMemoryGB !== undefined;
  const displayedRamGB = ramFixed ? fixedMemoryGB : ramGB;
  const [ramText, setRamText] = useState(String(displayedRamGB));
  useEffect(() => {
    setRamText(String(displayedRamGB));
  }, [displayedRamGB]);
  return (
    <div className="space-y-4">
      {/* Row 1 — hardware: device + memory */}
      <section>
        <h3 className="mb-2 text-sm font-semibold text-slate-700 dark:text-slate-200">Hardware</h3>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-5">
          <div className="rounded-lg border border-slate-200 p-4 md:col-span-3 dark:border-slate-800">
            <label
              htmlFor="device-select"
              className="block text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400"
            >
              Device
            </label>
            <div className="mt-2 flex items-center gap-2">
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
                className="h-11 min-w-0 flex-1 rounded border border-slate-300 bg-white text-slate-900 dark:bg-slate-900 dark:text-slate-100 px-3 text-lg font-semibold focus:outline-none focus:ring-2 focus:ring-sky-500 dark:border-slate-700"
              >
                {groupDevices().map(({ group, devices }) => (
                  <optgroup key={group} label={group}>
                    {devices.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name} | {d.bandwidthGBps} GB/s
                        {d.memoryGB !== undefined ? ` · ${d.memoryGB} GB VRAM` : ''}
                      </option>
                    ))}
                  </optgroup>
                ))}
                <option value={CUSTOM_DEVICE_ID}>Custom…</option>
              </select>
              {isCustom ? (
                <>
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
                    className="h-11 w-24 shrink-0 rounded border border-slate-300 bg-white text-slate-900 dark:bg-slate-900 dark:text-slate-100 px-3 text-right text-lg font-semibold tabular-nums focus:outline-none focus:ring-2 focus:ring-sky-500 dark:border-slate-700"
                    aria-label="Custom memory bandwidth in GB/s"
                  />
                  <span className="shrink-0 text-sm text-slate-500 dark:text-slate-400">GB/s</span>
                </>
              ) : null}
            </div>
            <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
              Memory bandwidth caps token generation speed.
            </p>
          </div>

          <div className="rounded-lg border border-slate-200 p-4 md:col-span-2 dark:border-slate-800">
            <label
              htmlFor="ram-input"
              className="block text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400"
            >
              Memory <span className="text-slate-400 dark:text-slate-500">· GB</span>
            </label>
            <input
              id="ram-input"
              type="number"
              min={RAM_MIN}
              max={RAM_MAX}
              step={1}
              value={ramFixed ? String(displayedRamGB) : ramText}
              disabled={ramFixed}
              onChange={(e) => {
                const v = e.target.value;
                setRamText(v);
                const n = Number(v);
                if (v !== '' && Number.isFinite(n) && n >= RAM_MIN && n <= RAM_MAX) {
                  onRamGB(Math.round(n));
                }
              }}
              onBlur={() => {
                const n = Number(ramText);
                if (Number.isFinite(n) && ramText !== '') {
                  const clamped = Math.max(RAM_MIN, Math.min(RAM_MAX, Math.round(n)));
                  setRamText(String(clamped));
                  onRamGB(clamped);
                } else {
                  setRamText(String(displayedRamGB));
                }
              }}
              className="mt-2 h-11 w-full rounded border border-slate-300 bg-white text-slate-900 dark:bg-slate-900 dark:text-slate-100 px-3 text-lg font-semibold tabular-nums focus:outline-none focus:ring-2 focus:ring-sky-500 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700"
            />
            <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
              {ramFixed
                ? 'Fixed by device. Offload not modeled.'
                : 'RAM available for the model and KV cache.'}
            </p>
          </div>
        </div>
      </section>

      {/* Row 2 — workload: context, min speed, quant */}
      <section>
        <h3 className="mb-2 text-sm font-semibold text-slate-700 dark:text-slate-200">Workload</h3>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-10">
          <div className="rounded-lg border border-slate-200 p-4 md:col-span-3 dark:border-slate-800">
            <label
              htmlFor="ctx-select"
              className="block text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400"
            >
              Context length <span className="text-slate-400 dark:text-slate-500">· tokens</span>
            </label>
            <select
              id="ctx-select"
              value={contextLen}
              onChange={(e) => onContextLen(Number(e.target.value))}
              className="mt-2 h-11 w-full rounded border border-slate-300 bg-white text-slate-900 dark:bg-slate-900 dark:text-slate-100 px-3 text-lg font-semibold tabular-nums focus:outline-none focus:ring-2 focus:ring-sky-500 dark:border-slate-700"
            >
              {CONTEXT_SNAPS.map((c) => (
                <option key={c} value={c}>
                  {formatContext(c)}
                </option>
              ))}
            </select>
            <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
              Tokens in scope (in + out)
            </p>
          </div>

          <div className="rounded-lg border border-slate-200 p-4 md:col-span-3 dark:border-slate-800">
            <label
              htmlFor="min-tps"
              className="block text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400"
            >
              Min speed <span className="text-slate-400 dark:text-slate-500">· tok/s</span>
            </label>
            <div className="mt-2 flex h-11 items-center gap-3">
              <input
                id="min-tps"
                aria-label="Min speed slider"
                type="range"
                min={0}
                max={60}
                step={1}
                value={minTps}
                onChange={(e) => onMinTps(Number(e.target.value))}
                className="flex-1 accent-sky-600"
              />
              <span className="w-8 shrink-0 text-right tabular-nums text-lg font-semibold text-slate-900 dark:text-slate-100">
                {minTps}
              </span>
            </div>
            <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
              Slower models are filtered out.
            </p>
          </div>

          <div className="rounded-lg border border-slate-200 p-4 md:col-span-4 dark:border-slate-800">
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
              className="mt-2 h-11 w-full rounded border border-slate-300 bg-white text-slate-900 dark:bg-slate-900 dark:text-slate-100 px-3 text-lg font-semibold focus:outline-none focus:ring-2 focus:ring-sky-500 dark:border-slate-700"
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
        </div>
      </section>
    </div>
  );
}
