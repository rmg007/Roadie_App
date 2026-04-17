# Performance Baseline

**Established:** 2026-04-17 — v0.15.0

## Activation latency
- Median (5 runs): < 250 ms (budget)
- Measured: [to be filled by CI run]

## Bundle size
- `out/extension.js`: ~561 KB (budget: 600 KB, hard limit: 630 KB)
- Measured after Phase E build

## Memory
- RSS delta after 10k classify ops: < 50 MB (budget)
- Measured: [to be filled by first nightly run]

## What contributes most to bundle size
Run `npx source-map-explorer out/extension.js` to get a breakdown.
The largest contributors as of v0.15.0 are expected to be:
- `src/classifier/intent-patterns.ts` — regex patterns
- `src/engine/` — step execution
- `src/generator/templates/` — template strings

## Lazy loading (Phase A)
All heavy modules are loaded via dynamic `import()` inside `activate()`.
Static imports are limited to types and VS Code API.
