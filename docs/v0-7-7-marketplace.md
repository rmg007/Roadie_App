# v0.7.7 — Marketplace-Ready Package

## Problem

Roadie cannot be published to the VS Code Marketplace in its current state. `package.json` is missing required fields (`license`, `homepage`, `bugs`, `icon`, `galleryBanner`). No icon asset exists. The README contains a hardcoded version string (`roadie-0.5.2.vsix`) and developer-facing sideload install instructions not suited to Marketplace users. `doctor.js` does not verify any of the above before packaging. Keywords exceed the Marketplace cap of 5.

Reproduction: run `npm run package` — succeeds locally but the resulting VSIX would be rejected or render poorly on the Marketplace.

## Root cause

**`roadie/package.json` lines 6, 229–232** — no `license`, `homepage`, `bugs`, `icon`, or `galleryBanner` fields present; keywords array has 7 entries (Marketplace truncates to 5).

**`roadie/.vscodeignore`** — already exists and is well-formed; `docs/` and `scripts/` exclusion and `images/` inclusion must be verified.

**`roadie/README.md` lines 22–24** — hardcodes `roadie-0.5.2.vsix`; installation section describes developer sideload flow, not Marketplace install flow; missing Requirements and Known Limitations sections.

**`roadie/scripts/doctor.js` line 23** — `EXTENSION_ID` is hardcoded as `'roadie.roadie'`; no checks for icon, `.vscodeignore`, or required metadata fields.

## Fix plan

### Step 1 — `roadie/package.json`: add missing marketplace fields and trim keywords

Add the following fields after the existing `"repository"` block:

```json
"license": "MIT",
"homepage": "https://github.com/rmg007/Roadie_App",
"bugs": {
  "url": "https://github.com/rmg007/Roadie_App/issues"
},
"icon": "images/icon.png",
"galleryBanner": {
  "color": "#1e1e2e",
  "theme": "dark"
}
```

`publisher` stays `"roadie"` — the user owns this publisher on the Marketplace.

Change `"version"` from current to `"0.7.7"`.

Trim the `keywords` array from 7 to exactly 5, keeping the strongest:
`["copilot", "ai", "workflow", "automation", "code review"]`.
Drop `"bug fix"` and `"refactoring"` — these are the weakest signal terms and the Marketplace silently ignores anything beyond position 5.

Why: `vsce package` warns on missing `license`; `icon` and `galleryBanner` are required for a presentable Marketplace listing; keyword truncation silently drops discoverability terms if not managed.

### Step 2 — `roadie/.vscodeignore`: audit and patch

The file exists. Verify these rules are present (add if missing):

- `docs/**` — exclude internal plan docs
- `scripts/**` — exclude install/doctor scripts (not needed in VSIX)
- `!CHANGELOG.md` — explicitly include (Marketplace changelog tab reads it)
- `!README.md` — explicitly include (already default, but be explicit)
- `images/**` must NOT be excluded — icon must ship in the VSIX

Do not add a rule excluding `out/` — the compiled bundle must ship.
Do not alter the existing `node_modules` re-include block for `better-sqlite3`.

Why: shipping `docs/` and `scripts/` bloats the VSIX; excluding `images/` would break the icon.

### Step 3 — `roadie/images/icon.png`: create placeholder

Create directory `roadie/images/` and add a 128×128 PNG named `icon.png`.

Use a minimal monochrome placeholder (e.g., white "R" on a `#1e1e2e` dark background) — any image editor or a one-off `sharp`/`jimp` script is acceptable. A placeholder is sufficient for `npm run package` to produce a valid VSIX. Do NOT commit a zero-byte file — `vsce` validates that the file is a real PNG.

A proper branded icon can replace this placeholder before the user runs `vsce publish`.

Why: `vsce package` fails with `ERROR: Icon must be a valid PNG` if the file is missing or not a valid PNG.

### Step 4 — `roadie/README.md`: fix hardcoded version and add Marketplace sections

Surgical edits only — do not rewrite the full README.

1. Replace `roadie-0.5.2.vsix` (lines 22–24) with the generic phrase "the latest `.vsix` release."
2. Replace the developer sideload install section with a Marketplace install section:
   - Primary: search "Roadie" in the VS Code Extensions panel, click Install.
   - Alternative: `ext install roadie.roadie` in Quick Open (`Ctrl+P`).
3. Add a **Requirements** section: VS Code 1.93+, GitHub Copilot extension active.
4. Add a one-line **Known limitations / feedback** section linking to GitHub Issues.

Why: sideload instructions confuse Marketplace users; missing Requirements causes support noise.

### Step 5 — `roadie/scripts/doctor.js`: add marketplace-readiness checks and dynamic EXTENSION_ID

Update `EXTENSION_ID` (currently hardcoded on line 23) to derive from `package.json`:

```js
const { version, publisher, name } = require(join(PACKAGE_ROOT, 'package.json'));
const EXTENSION_ID = `${publisher}.${name}`;
```

Add a new check function `checkMarketplaceReadiness()` called after `checkExtensionBuild()`. It must verify:

1. `images/icon.png` exists — hard fail if missing (blocks `vsce package`).
2. `.vscodeignore` exists — warn if missing.
3. `package.json` `license` field is set — warn if missing.
4. `package.json` `keywords` array has 5 or fewer entries — warn if more.

Why: doctor must catch pre-publish blockers before packaging; dynamic `EXTENSION_ID` stays correct regardless of publisher value.

### Step 6 — `roadie/CHANGELOG.md`: add dated entry

Add at the top:

```
[0.7.7] — 2026-04-15 — Marketplace-ready package

- Added license, homepage, bugs, icon, galleryBanner fields to package.json
- Trimmed keywords to 5 (dropped "bug fix", "refactoring"); publisher stays "roadie"
- Audited and patched .vscodeignore: exclude docs/, scripts/; keep images/
- Created images/ directory with 128x128 PNG placeholder icon
- Updated README: replaced sideload install steps with Marketplace steps; added Requirements and Known Limitations sections
- Updated scripts/doctor.js: dynamic EXTENSION_ID from package.json; new marketplace-readiness check (icon, .vscodeignore, license, keyword count)
```

## Acceptance tests

```bash
# 1. All tests pass (646+ from 0.7.4/0.7.5/0.7.6 plus any additions)
cd /c/dev/Roadie/roadie && npm test
# Expected: all 646+ tests pass, exit 0

# 2. Lint passes
npm run lint
# Expected: no errors, exit 0

# 3. Build succeeds
npm run build
# Expected: out/extension.js written, exit 0

# 4. Doctor passes marketplace checks
node scripts/doctor.js
# Expected: check "Marketplace readiness" shows green for
#   icon.png exists, .vscodeignore exists, license set, keywords <= 5

# 5. Package produces a valid VSIX
npm run package
# Expected: roadie-0.7.7.vsix created, no vsce errors, exit 0

# 6. Record actual VSIX size (commit this number to acceptance criteria before publish)
ls -lh roadie-0.7.7.vsix
# Expected: measure and record; better-sqlite3 prebuilt binary may push total
#   above 3 MB — the measured size becomes the accepted baseline, not an estimate

# 7. Inspect VSIX contents
npx @vscode/vsce ls
# Expected to include:  images/icon.png, out/extension.js, README.md, CHANGELOG.md, package.json
# Expected to exclude:  src/, test/, docs/, scripts/, tsconfig.json, vitest.config.ts
```

## Risks / rollback

**VSIX size (medium risk):** `better-sqlite3` includes platform-specific prebuilt binaries (~2 MB on Windows). Total size must be measured after step 5 above — do not rely on the previous "3–4 MB estimated" figure. If the VSIX exceeds 5 MB, audit the `.vscodeignore` `!` re-include rules for `node_modules`.

**`.vscodeignore` re-include rules (low risk):** If the `better-sqlite3` re-include block is modified accidentally, the extension will fail to load at runtime with `Cannot find module 'better-sqlite3'`. Touch only the `docs/**` and `scripts/**` exclusion rules.

**Icon placeholder at publish time (low risk):** A placeholder icon passes `vsce package` but a real 128×128 PNG is required for a quality Marketplace listing. Gate `vsce publish` on a human check that a branded icon is in place.

**Rollback:** revert `package.json` version to `0.7.6`, restore original `doctor.js` line 23, delete `images/` directory. No database schema changes in this version — rollback is safe.

## Version bump

**Target version:** `0.7.6` → `0.7.7` (patch — metadata and tooling changes only, no runtime behaviour change)

**CHANGELOG entry:**

```
[0.7.7] — 2026-04-15 — Marketplace-ready package

Prepares Roadie for VS Code Marketplace publication: adds required metadata
fields (license, homepage, bugs, icon, galleryBanner), trims keywords to 5,
keeps publisher "roadie" (user-owned), patches .vscodeignore, updates README
install instructions, and extends doctor.js with pre-publish readiness checks.
```
