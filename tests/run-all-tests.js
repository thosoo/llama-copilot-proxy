// Minimal test runner to execute all test scripts in this folder sequentially
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function run() {
  const dir = __dirname;
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.js') && f !== 'run-all-tests.js')
    .sort();

  let passed = 0;
  for (const file of files) {
    const full = path.join(dir, file);
    process.stdout.write(`\n➡️  Running ${file} ...\n`);
    try {
      // Dynamically import each test; tests should throw on failure
      await import(full + `?cachebust=${Date.now()}`);
      process.stdout.write(`✅ ${file} passed\n`);
      passed++;
    } catch (err) {
      console.error(`❌ ${file} failed`);
      console.error(err?.stack || err);
      process.exit(1);
    }
  }
  console.log(`\n🎉 All ${passed}/${files.length} tests passed`);
}

run();
