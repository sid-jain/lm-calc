#!/usr/bin/env tsx
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import React from 'react';
import { renderToString } from 'react-dom/server';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PKG_PATH = resolve(__dirname, '../package.json');
const HTML_PATH = resolve(__dirname, '../dist/index.html');
const ROOT_PLACEHOLDER = '<div id="root"></div>';

const pkg = JSON.parse(readFileSync(PKG_PATH, 'utf-8')) as { version: string };
(globalThis as Record<string, unknown>).__APP_VERSION__ = pkg.version;

const { App } = await import('../src/App');

const html = renderToString(<App />);

const template = readFileSync(HTML_PATH, 'utf-8');
if (!template.includes(ROOT_PLACEHOLDER)) {
  throw new Error(`Could not find ${ROOT_PLACEHOLDER} in ${HTML_PATH}`);
}

writeFileSync(HTML_PATH, template.replace(ROOT_PLACEHOLDER, `<div id="root">${html}</div>`));

console.log(`Prerendered ${html.length.toLocaleString()} chars into ${HTML_PATH}`);
