#!/usr/bin/env tsx
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import React from 'react';
import satori from 'satori';
import { Resvg } from '@resvg/resvg-js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FONT_PATH = resolve(__dirname, '../assets/fonts/Inter-SemiBold.ttf');
const OUT_PATH = resolve(__dirname, '../dist/og.png');
const PKG_PATH = resolve(__dirname, '../package.json');

const pkg = JSON.parse(readFileSync(PKG_PATH, 'utf-8')) as { version: string };
const fontData = readFileSync(FONT_PATH);

const card = (
  <div
    style={{
      width: '100%',
      height: '100%',
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'space-between',
      padding: '64px',
      background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 100%)',
      color: '#f8fafc',
    }}
  >
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: '16px' }}>
        <span style={{ fontSize: 88, letterSpacing: '-0.02em' }}>LM Calc</span>
        <span
          style={{
            fontSize: 22,
            color: '#fbbf24',
            border: '2px solid #fbbf24',
            borderRadius: 8,
            padding: '4px 12px',
          }}
        >
          v{pkg.version}
        </span>
      </div>
      <span
        style={{
          fontSize: 44,
          color: '#cbd5e1',
          lineHeight: 1.2,
          maxWidth: 980,
          letterSpacing: '-0.01em',
        }}
      >
        Which open-weight LLMs fit in your RAM?
      </span>
    </div>

    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        fontSize: 26,
        color: '#94a3b8',
      }}
    >
      <span>RAM · Context · Quantization → fits / tight / over</span>
      <span style={{ color: '#38bdf8' }}>lmcalc.app</span>
    </div>
  </div>
);

const svg = await satori(card, {
  width: 1200,
  height: 630,
  fonts: [{ name: 'Inter', data: fontData, weight: 600, style: 'normal' }],
});

const png = new Resvg(svg, { fitTo: { mode: 'width', value: 1200 } }).render().asPng();
writeFileSync(OUT_PATH, png);

console.log(`Wrote ${png.length.toLocaleString()} bytes to ${OUT_PATH}`);
