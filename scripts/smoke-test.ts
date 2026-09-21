/**
 * Production startup smoke test
 * Spawns dist-server/index.js in production mode and validates HTTP responses
 */
import { spawn } from 'child_process';

const PORT = process.env.TEST_PORT || '3099';
console.log(`[Smoke Test] Starting production server on port ${PORT}...`);

const proc = spawn('bun', ['dist-server/index.js'], {
  env: {
    ...process.env,
    PORT,
    NODE_ENV: 'production',
    KUBECONFIG: '/dev/null', // ensure smoke test runs even without cluster
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});

let output = '';
proc.stdout?.on('data', (d) => {
  output += d.toString();
});
proc.stderr?.on('data', (d) => {
  output += d.toString();
});

let exited = false;
let exitCode: number | null = null;
proc.on('exit', (code) => {
  exited = true;
  exitCode = code;
});

async function run() {
  const maxAttempts = 30;
  let connected = false;

  for (let i = 0; i < maxAttempts; i++) {
    if (exited) {
      console.error(`[Smoke Test] Server exited prematurely with code ${exitCode}!`);
      console.error(output);
      process.exit(1);
    }

    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/api/health`);
      if (res.status === 200) {
        connected = true;
        break;
      }
    } catch {
      // Wait and retry
    }
    await new Promise((r) => setTimeout(r, 200));
  }

  if (!connected) {
    proc.kill('SIGTERM');
    console.error('[Smoke Test] Timed out waiting for server to become healthy.');
    console.error(output);
    process.exit(1);
  }

  // Also verify catch-all frontend route
  const rootRes = await fetch(`http://127.0.0.1:${PORT}/`);
  if (rootRes.status !== 200) {
    proc.kill('SIGTERM');
    console.error(`[Smoke Test] Catch-all route returned status ${rootRes.status} instead of 200!`);
    process.exit(1);
  }

  proc.kill('SIGTERM');
  console.log('[Smoke Test] Success! Server started, served API health, and served static catch-all route.');
  process.exit(0);
}

run();
