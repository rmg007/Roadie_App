# Accessibility Audit — v1.0.0

**Date:** 2026-04-17
**Scope:** Roadie does not use any custom webviews. All UI surfaces are standard VS Code components:
- Command palette entries (VS Code renders these)
- Status bar item (VS Code renders this)
- Output channel (VS Code renders this)
- Notification messages (VS Code renders these)
- Code action lightbulb (VS Code renders this)

**Finding:** No custom DOM is rendered by Roadie. Accessibility is fully delegated to VS Code's built-in components, which meet WCAG 2.1 AA requirements.

**High-contrast theme:** Commands and status bar item use VS Code theme tokens. No hard-coded colours. Verified by reviewing `src/shell/status-bar.ts`.

**Screen reader:** Chat participant responses are plain text. No ARIA roles needed.

**Action:** No accessibility changes required for v1.0.
