# Roadie Privacy Policy

_Last updated: 2026-04-17_

## What Roadie collects

Roadie is a local-first VS Code extension. **All processing happens on your machine.**

| Data | Stored | Sent to network |
|------|--------|-----------------|
| Project file paths & tech-stack metadata | Local SQLite DB only | Never |
| Workflow outcomes (success/failure counts) | Local SQLite DB only | Never |
| Structured extension log (`roadie.log`) | Local disk only | Never |
| Telemetry events (command IDs, durations) | Local log only | Never |

## Telemetry

Telemetry is **off by default**. Enable it via:

```
Settings → Roadie → Telemetry: true
```

When enabled, Roadie records:
- Extension activation duration
- Command invocation counts and success/failure flags
- Error codes (never error messages or stack traces)

All telemetry is written to the local structured log (`<globalStoragePath>/roadie.log`).
**No data is ever transmitted to Anthropic, Microsoft, or any third party.**

## PII redaction

Before any event is logged, Roadie automatically strips:
- Absolute file paths (replaced with `[REDACTED_PATH]`)
- API tokens matching `sk-*` or `ghp_*` patterns (replaced with `[REDACTED_TOKEN]`)

## Export Diagnostics

The `Roadie: Export Diagnostics` command bundles:
- Last 1 000 lines of `roadie.log`
- Extension and VS Code version, OS, Node version
- DB schema (table and column names only — **no row data**)

The bundle is saved to a file you choose. It is never uploaded automatically.
Share it only when filing a bug report and only after reviewing the content.

## Contact

For privacy questions, open an issue at
<https://github.com/rmg007/Roadie_App/issues>.
