/**
 * e2e/helpers/retry.js
 *
 * Flake budget for E2E suites.
 *
 * withRetry — wraps a suite function and re-runs it up to maxAttempts times
 * before surfacing the last error.
 *
 * 3-night flake detection:
 *   Detecting flakes across consecutive nightly runs requires querying the
 *   GitHub Actions API (workflow run history).  That requires a token and is
 *   out of scope for static test infrastructure.  The hook is scaffolded here
 *   as a comment; implement via GITHUB_TOKEN + the Actions REST API when ready:
 *
 *     GET /repos/{owner}/{repo}/actions/runs
 *       ?branch=main&status=failure&per_page=10
 *
 *   If a given test title appears in the failure annotation of 3 or more of
 *   the last N consecutive nightly runs, emit a [FLAKE WARNING] to stderr.
 */

'use strict';

/**
 * Retry a suite (async) function up to maxAttempts times.
 * On every attempt failure the error is logged; the last error is rethrown.
 *
 * @param {() => Promise<void>} fn
 * @param {number} [maxAttempts=2]
 * @returns {Promise<void>}
 */
async function withRetry(fn, maxAttempts = 2) {
  let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await fn();
      return; // success — stop retrying
    } catch (err) {
      lastError = err;
      console.warn(
        `[withRetry] attempt ${attempt}/${maxAttempts} failed: ${err && err.message ? err.message : String(err)}`,
      );
      if (attempt < maxAttempts) {
        // Brief pause between retries to let transient VS Code state settle.
        await new Promise((resolve) => setTimeout(resolve, 1_000));
      }
    }
  }
  throw lastError;
}

module.exports = { withRetry };
