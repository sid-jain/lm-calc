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
// --manifest <path> lets you run multiple orchestrator instances in parallel
// against disjoint boxes (e.g. one orchestrator per box mid-flight without
// disrupting the others). Default lives at scripts/cloud-targets.json.
const cliArgs = process.argv.slice(2);
let MANIFEST_PATH = join(REPO_ROOT, 'scripts/cloud-targets.json');
for (let i = 0; i < cliArgs.length; i++) {
  if (cliArgs[i] === '--manifest') MANIFEST_PATH = resolve(cliArgs[++i]);
}
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

function scpFlags(box: Box): string[] {
  const args = ['-o', 'ServerAliveInterval=60', '-o', 'StrictHostKeyChecking=accept-new'];
  if (box.port) args.push('-P', String(box.port));
  if (box.ssh_key) args.push('-i', expand(box.ssh_key));
  return args;
}

function sshArgs(box: Box): string[] {
  // accept-new auto-trusts first-time host keys (so orchestrator doesn't hang
  // on the prompt for fresh cloud boxes) but still errors if a key changes —
  // safer than =no, and aligned with a "rented box, short-lived" threat model.
  const args = [
    '-o',
    'ServerAliveInterval=60',
    '-o',
    'ServerAliveCountMax=10',
    '-o',
    'StrictHostKeyChecking=accept-new',
  ];
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

  // Clear any stale results.csv on the box so this orchestration's bench runs
  // produce a clean CSV (bench.sh appends; we don't want rows from a previous
  // failed run mixed into this one's fixture). The llama.cpp build and any
  // downloaded models stay — those are expensive to redo.
  heartbeat('clear stale results.csv');
  await run('ssh', [...ssh, target, 'rm -f ~/lm-calc-bench/results/results.csv'], log, 'clear-csv');

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
      const jobTag = `${job.model_id}-${wq}`;
      // Detached-bench pattern: long llama.cpp builds (15-30 min) over flaky
      // cloud SSH cause idle channels that get killed by provider firewalls
      // even with ServerAliveInterval. Run the bench under `nohup` on the
      // remote so it survives any disconnect; we poll a per-job sentinel file
      // and pull the per-job log on completion. Poll interval is 60s — small
      // enough to get prompt heartbeats, large enough to not hammer ssh auth.
      const sentinel = `~/lm-calc-bench/.done-${jobTag}`;
      const remoteLog = `~/lm-calc-bench/cloud-${jobTag}.log`;
      // --python points at the venv created by cloud-bootstrap.sh. Bench.sh
      // uses it for the huggingface_hub model download; system python3 stays
      // untouched.
      const benchInner =
        `cd lm-calc && ./scripts/bench.sh ` +
        `--model-id ${job.model_id} ` +
        `--hf-repo ${job.hf_repo} ` +
        `--weight-quant ${wq}` +
        gpuFlag +
        ` --python $HOME/lm-calc-venv/bin/python`;
      // Wrap to capture exit code into the sentinel (so polling can distinguish
      // success from failure without scraping the log). setsid -f puts the
      // bench in a new session and forks immediately, so the parent ssh
      // channel closes cleanly without waiting on inherited file descriptors
      // (the nohup + & + disown variant left ssh zombies waiting on remote
      // pipes).
      const launchCmd =
        `mkdir -p ~/lm-calc-bench && rm -f ${sentinel} && ` +
        `setsid -f bash -c '(${benchInner}); echo "exit=$?" > ${sentinel}' ` +
        `</dev/null > ${remoteLog} 2>&1`;
      heartbeat(`bench ${job.model_id} ${wq} (detached)`);
      const launchCode = await run('ssh', [...ssh, target, launchCmd], log, `launch-${jobTag}`);
      if (launchCode !== 0) {
        jobsFailed++;
        heartbeat(`launch ${jobTag} FAILED (exit=${launchCode}) — continuing`);
        continue;
      }
      // Local mirror of the remote per-job log (and the cmake build log) so
      // operators can `tail -F cloud-logs/<box>__<job>.log` instead of ssh-ing
      // in. Plus a separate health log written by us (one line per poll) with
      // proc count, GPU util, and log sizes — easy to spot hangs or unexpected
      // exits without reading the bench log.
      const remoteBuildLog = `~/lm-calc-bench/logs/build.log`;
      const localBenchLog = `${LOGS_DIR}/${box.name}__${jobTag}.log`;
      const localBuildLog = `${LOGS_DIR}/${box.name}__build.log`;
      const localHealthLog = `${LOGS_DIR}/${box.name}__health.log`;
      const healthStream = createWriteStream(localHealthLog, { flags: 'a' });
      healthStream.write(
        `# job=${jobTag} launched=${new Date().toISOString()} sentinel=${sentinel}\n`,
      );
      // Poll for sentinel. Each poll is a fresh ssh, so a network blip just
      // delays the next poll — it doesn't kill the bench.
      let waitedSec = 0;
      // Hard wall to catch a truly stuck bench: PER_TEST_TIMEOUT * configs(=12)
      // * a fudge for download is ~6h. Use 4h to bound a single (model, quant).
      const maxWaitSec = 4 * 60 * 60;
      let done = false;
      let exitCode = -1;
      let consecutiveZeroProc = 0;
      while (waitedSec < maxWaitSec) {
        await new Promise((r) => setTimeout(r, 60_000));
        waitedSec += 60;

        // Single ssh that does everything we need this cycle: read sentinel,
        // count bench-related procs, read GPU state, and read remote log
        // sizes. Pipe-separated for trivial parsing.
        const probeCmd =
          `printf '%s|%s|%s|%s|%s\\n' ` +
          `"$(cat ${sentinel} 2>/dev/null || echo missing)" ` +
          `"$(pgrep -fc '(scripts/bench\\.sh|cmake|nvcc|llama-bench|huggingface_hub)' 2>/dev/null || echo 0)" ` +
          `"$(nvidia-smi --query-gpu=utilization.gpu,memory.used --format=csv,noheader 2>/dev/null | head -1 | tr -d ' ')" ` +
          `"$(stat -c%s ${remoteBuildLog} 2>/dev/null || echo 0)" ` +
          `"$(stat -c%s ${remoteLog} 2>/dev/null || echo 0)"`;
        const probe = await new Promise<{ code: number; stdout: string }>((resolveP) => {
          const child = spawn('ssh', [...ssh, target, probeCmd], {
            stdio: ['ignore', 'pipe', 'pipe'],
          });
          let buf = '';
          child.stdout.on('data', (d) => (buf += d.toString()));
          child.on('close', (c) => resolveP({ code: c ?? 1, stdout: buf.trim() }));
          child.on('error', () => resolveP({ code: 127, stdout: '' }));
        });
        const ts = new Date().toISOString();
        if (probe.code !== 0) {
          healthStream.write(`${ts} ssh_probe_failed code=${probe.code}\n`);
          continue;
        }
        const [sentRaw, procsRaw, gpu, buildSize, benchSize] = probe.stdout.split('|');
        const procs = Number(procsRaw) || 0;
        healthStream.write(
          `${ts} sentinel=${sentRaw} procs=${procs} gpu=${gpu || 'n/a'} build_log=${buildSize}b bench_log=${benchSize}b\n`,
        );
        // Pull both remote logs incrementally. rsync --append only sends bytes
        // appended since last sync; --partial keeps progress on transient drops.
        const sshOpts = [...ssh].join(' ');
        await Promise.all([
          run(
            'rsync',
            [
              '-a',
              '--append',
              '--partial',
              '-e',
              `ssh ${sshOpts}`,
              `${target}:${remoteLog}`,
              localBenchLog,
            ],
            log,
            `mirror-${jobTag}`,
          ),
          run(
            'rsync',
            [
              '-a',
              '--append',
              '--partial',
              '-e',
              `ssh ${sshOpts}`,
              `${target}:${remoteBuildLog}`,
              localBuildLog,
            ],
            log,
            `mirror-build`,
          ),
        ]);
        // Sentinel present? Done.
        if (sentRaw.startsWith('exit=')) {
          exitCode = Number(sentRaw.replace('exit=', '')) || 0;
          done = true;
          break;
        }
        // Hang detection: 2 consecutive minutes with zero bench-related procs
        // AND no sentinel = the bench died without writing the sentinel (a
        // SIGKILL, OOM-kill, or crash before the trap). Surface immediately.
        if (procs === 0) consecutiveZeroProc++;
        else consecutiveZeroProc = 0;
        if (consecutiveZeroProc >= 2) {
          heartbeat(
            `bench ${jobTag} appears DEAD: 0 procs, no sentinel, ${waitedSec}s in — abandoning`,
          );
          healthStream.write(`${ts} HANG_DETECTED zero_proc_minutes=${consecutiveZeroProc}\n`);
          break;
        }
        // Heartbeat every 5 min so the operator sees forward progress.
        if (waitedSec % 300 === 0) {
          heartbeat(
            `...still running ${jobTag} (${waitedSec / 60}m, procs=${procs}, build=${buildSize}b, bench=${benchSize}b)`,
          );
        }
      }
      healthStream.end();
      if (!done) {
        jobsFailed++;
        heartbeat(`bench ${jobTag} TIMEOUT after ${maxWaitSec / 3600}h — continuing`);
        continue;
      }
      if (exitCode === 0) {
        jobsOk++;
        heartbeat(`bench ${jobTag} OK`);
      } else {
        jobsFailed++;
        heartbeat(`bench ${jobTag} FAILED (exit=${exitCode}) — continuing`);
      }
    }
  }

  // scp the CSV regardless of per-job failures — partial data is still useful.
  heartbeat('scp results.csv');
  const scpCode = await run(
    'scp',
    [...scpFlags(box), `${target}:lm-calc-bench/results/results.csv`, csvPath],
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
