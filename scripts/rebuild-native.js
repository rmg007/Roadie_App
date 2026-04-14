#!/usr/bin/env node
/**
 * Rebuild native dependencies (better-sqlite3) against the current Node ABI.
 * Invoked from the `postinstall` script. Fails soft (exit 0) on environments
 * where rebuild is not possible (Docker, cross-compile, CI caches, etc.) so
 * `npm install` does not abort.
 */
const { spawnSync } = require('node:child_process');

const result = spawnSync('npm', ['rebuild', 'better-sqlite3'], {
  stdio: 'inherit',
  shell: true,
});

if (result.status !== 0) {
  // Soft-fail: warn but do not break install.
  console.warn(
    '[rebuild-native] npm rebuild better-sqlite3 exited with a non-zero status. ' +
      'Continuing anyway — tests or runtime usage of better-sqlite3 may fail with ' +
      'ERR_DLOPEN_FAILED until this is resolved on your machine.'
  );
  process.exit(0);
}
process.exit(0);
