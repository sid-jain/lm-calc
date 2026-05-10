#!/usr/bin/env tsx
/**
 * cloud-orchestrate.ts — drive bench.sh on N rented cloud GPUs from local.
 *
 * Reads scripts/cloud-targets.json (boxes + jobs + per-job quant sweep).
 * For each box (in parallel): rsync the working tree, run cloud-bootstrap.sh
 * once, then sweep every (job × weight_quant) serially through bench.sh.
 * Finally scp back ~/lm-calc-bench/results/results.csv into
 * cloud-results/<box.name>/results.csv.
 *
 * After all boxes complete:
 *   npx tsx scripts/bench-import.ts cloud-results/* /results.csv
 *
 * Concurrency model:
 *   - across boxes: parallel (Promise.allSettled)
 *   - within a box: serial (the GPU is the bottleneck — running two benches
 *     on one GPU thrashes VRAM and ruins both measurements)
 *
 * Network resilience: ssh uses ServerAliveInterval=60. For multi-hour runs,
 * launch the orchestrator under tmux locally so a laptop sleep / wifi drop
 * doesn't tear it down.
 */
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, existsSync, createWriteStream, WriteStream } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');
const MANIFEST_PATH = join(REPO_ROOT, 'scripts/cloud-targets.json');
const RESULTS_DIR = join(REPO_ROOT, 'cloud-results');
const LOGS_DIR = join(REPO_ROOT, 'cloud-logs');

interface Box {
  name: string;
  host: string;
  port?: number;
  user: string;
  ssh_key?: string;
  gpu_id?: string; // optional override; default is bench.sh auto-detect
}

interface Job {
  model_id: string;
  hf_repo: string;
  weight_quants: string[];
}

interface Manifest {
  boxes: Box[];
  jobs: Job[];
}

function expand(path: string): string {
  if (path.startsWith('~')) return path.replace(/^~/, homedir());
  return path;
}

function sshArgs(box: Box): string[] {
  const args = ['-o', 'ServerAliveInterval=60', '-o', 'ServerAliveCountMax=10'];
  if (box.port) args.push('-p', String(box.port));
  if (box.ssh_key) args.push('-i', expand(box.ssh_key));
  return args;
}

// Run a child process, streaming both stdout and stderr to a per-box log file
// AND back as a Promise that resolves to the exit code. Logs are tee'd through
// the given WriteStream so that long ssh execs leave a trail even when the
// orchestrator's own stdout is busy with other boxes' heartbeats.
function run(cmd: string, args: string[], log: WriteStream, label: string): Promise<number> {
  return new Promise((resolveP) => {
    log.write(`\n$ ${cmd} ${args.join(' ')}\n`);
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.on('data', (d) => log.write(d));
    child.stderr.on('data', (d) => log.write(d));
    child.on('close', (code) => {
      log.write(`[${label}] exit=${code}\n`);
      resolveP(code ?? 1);
    });
    child.on('error', (e) => {
      log.write(`[${label}] error: ${e.message}\n`);
      resolveP(127);
    });
  });
}

interface BoxOutcome {
  box: string;
  ok: boolean;
  jobs_ok: number;
  jobs_failed: number;
  csv_pulled: boolean;
  log_path: string;
  csv_path: string;
}

async function runBox(box: Box, jobs: Job[]): Promise<BoxOutcome> {
  const boxResultsDir = join(RESULTS_DIR, box.name);
  const csvPath = join(boxResultsDir, 'results.csv');
  const logPath = join(LOGS_DIR, `${box.name}.log`);
  mkdirSync(boxResultsDir, { recursive: true });
  mkdirSync(LOGS_DIR, { recursive: true });
  const log = createWriteStream(logPath, { flags: 'a' });
  const heartbeat = (msg: string) => {
    const line = `[${new Date().toISOString()}] [${box.name}] ${msg}`;
    console.log(line);
    log.write(line + '\n');
  };

  const target = `${box.user}@${box.host}`;
  const ssh = sshArgs(box);

  heartbeat('rsync repo');
  // -e mirrors ssh's port/key onto rsync.
  const rsyncSshCmd = ['ssh', ...ssh].join(' ');
  const rsyncCode = await run(
    'rsync',
    [
      '-az',
      '--delete',
      '--exclude=node_modules',
      '--exclude=dist',
      '--exclude=.git',
      '--exclude=cloud-results',
      '--exclude=cloud-logs',
      '--exclude=*.tsbuildinfo',
      '-e',
      rsyncSshCmd,
      `${REPO_ROOT}/`,
      `${target}:lm-calc/`,
    ],
    log,
    'rsync',
  );
  if (rsyncCode !== 0) {
    heartbeat('rsync FAILED — abort box');
    log.end();
    return {
      box: box.name,
      ok: false,
      jobs_ok: 0,
      jobs_failed: jobs.reduce((n, j) => n + j.weight_quants.length, 0),
      csv_pulled: false,
      log_path: logPath,
      csv_path: csvPath,
    };
  }

  heartbeat('bootstrap');
  const bootCode = await run(
    'ssh',
    [...ssh, target, 'bash lm-calc/scripts/cloud-bootstrap.sh'],
    log,
    'bootstrap',
  );
  if (bootCode !== 0) {
    heartbeat('bootstrap FAILED — abort box');
    log.end();
    return {
      box: box.name,
      ok: false,
      jobs_ok: 0,
      jobs_failed: jobs.reduce((n, j) => n + j.weight_quants.length, 0),
      csv_pulled: false,
      log_path: logPath,
      csv_path: csvPath,
    };
  }

  // npm ci — needed for tsx and the calculator's TS modules that bench.sh imports.
  heartbeat('npm ci');
  const npmCode = await run(
    'ssh',
    [...ssh, target, 'cd lm-calc && npm ci --silent --no-audit --no-fund'],
    log,
    'npm-ci',
  );
  if (npmCode !== 0) {
    heartbeat('npm ci FAILED — abort box');
    log.end();
    return {
      box: box.name,
      ok: false,
      jobs_ok: 0,
      jobs_failed: jobs.reduce((n, j) => n + j.weight_quants.length, 0),
      csv_pulled: false,
      log_path: logPath,
      csv_path: csvPath,
    };
  }

  let jobsOk = 0;
  let jobsFailed = 0;
  for (const job of jobs) {
    for (const wq of job.weight_quants) {
      const gpuFlag = box.gpu_id ? ` --gpu-id ${box.gpu_id}` : '';
      const benchCmd =
        `cd lm-calc && ./scripts/bench.sh ` +
        `--model-id ${job.model_id} ` +
        `--hf-repo ${job.hf_repo} ` +
        `--weight-quant ${wq}` +
        gpuFlag;
      heartbeat(`bench ${job.model_id} ${wq}`);
      const benchCode = await run(
        'ssh',
        [...ssh, target, benchCmd],
        log,
        `bench-${job.model_id}-${wq}`,
      );
      if (benchCode === 0) jobsOk++;
      else {
        jobsFailed++;
        heartbeat(`bench ${job.model_id} ${wq} FAILED (exit=${benchCode}) — continuing`);
      }
    }
  }

  // scp the CSV regardless of per-job failures — partial data is still useful.
  heartbeat('scp results.csv');
  const scpArgs = ['-o', 'ServerAliveInterval=60'];
  if (box.port) scpArgs.push('-P', String(box.port));
  if (box.ssh_key) scpArgs.push('-i', expand(box.ssh_key));
  const scpCode = await run(
    'scp',
    [...scpArgs, `${target}:lm-calc-bench/results/results.csv`, csvPath],
    log,
    'scp',
  );
  const csvPulled = scpCode === 0 && existsSync(csvPath);
  if (!csvPulled) heartbeat('scp FAILED (no results pulled)');
  else heartbeat(`done: ${jobsOk} ok, ${jobsFailed} failed → ${csvPath}`);

  log.end();
  return {
    box: box.name,
    ok: jobsFailed === 0 && csvPulled,
    jobs_ok: jobsOk,
    jobs_failed: jobsFailed,
    csv_pulled: csvPulled,
    log_path: logPath,
    csv_path: csvPath,
  };
}

async function main() {
  if (!existsSync(MANIFEST_PATH)) {
    console.error(`No manifest: ${MANIFEST_PATH}`);
    console.error(`Copy scripts/cloud-targets.example.json to that path and edit.`);
    process.exit(1);
  }
  const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8')) as Manifest;
  if (!manifest.boxes?.length || !manifest.jobs?.length) {
    console.error(`Manifest needs non-empty boxes[] and jobs[].`);
    process.exit(1);
  }

  console.log(
    `Orchestrating ${manifest.boxes.length} boxes × ` +
      `${manifest.jobs.reduce((n, j) => n + j.weight_quants.length, 0)} (model,quant) pairs each`,
  );
  console.log(`Per-box logs: ${LOGS_DIR}/<box>.log`);
  console.log(`Per-box CSVs: ${RESULTS_DIR}/<box>/results.csv`);
  console.log();

  const results = await Promise.allSettled(manifest.boxes.map((b) => runBox(b, manifest.jobs)));

  console.log(`\n=== Summary ===`);
  let allOk = true;
  for (const r of results) {
    if (r.status === 'rejected') {
      console.log(`  REJECTED: ${r.reason}`);
      allOk = false;
      continue;
    }
    const o = r.value;
    const tag = o.ok ? '   OK' : '  FAIL';
    console.log(
      `  ${tag}  ${o.box}: ${o.jobs_ok} ok, ${o.jobs_failed} failed; ` +
        `csv=${o.csv_pulled ? o.csv_path : '<missing>'}`,
    );
    if (!o.ok) allOk = false;
  }

  console.log(`\nImport with:`);
  console.log(`  npx tsx scripts/bench-import.ts cloud-results/*/results.csv`);
  process.exit(allOk ? 0 : 2);
}

main();
