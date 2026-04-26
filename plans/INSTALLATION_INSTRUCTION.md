# Roadie Installation Instructions

## Prerequisites
- Node.js >= 22
- Git (if using submodule or link workflows)

## Build Roadie (from the Roadie repo)
From the Roadie repo root:
```powershell
cd C:\dev\Roadie\roadie-App
npm install
npm run build
```

## Global CLI (recommended)
Install Roadie globally so any project can invoke `roadie`:
```powershell
cd C:\dev\Roadie\roadie-App
npm run build
npm install -g .
```
Verify:
```powershell
roadie --help
roadie
```

## Per-project devDependency (no global install)
From the target project directory:
```powershell
npm install --save-dev C:\dev\Roadie\roadie-App
npx roadie
```
Or add a script in the target project's `package.json`:
```json
"scripts": {
  "roadie": "roadie"
}
```

## Local dev workflow (fast feedback using linking)
In Roadie:
```powershell
cd C:\dev\Roadie\roadie-App
npm install
npm run build
npm link
```
In target project:
```powershell
cd C:\path\to\target\project
npm link roadie
roadie
```

## Vendored / Submodule approach
- Add the Roadie repo as a git submodule or copy the folder into the target project.
- Inside the vendored folder run `npm install` and `npm run build`.
- Invoke via an npm script or direct path to the built `out/index.js`.

## Run as a background service (optional)
Use a process manager (pm2, NSSM on Windows, Windows Service, etc.). Example with `pm2`:
```powershell
npm i -g pm2
pm2 start C:\dev\Roadie\roadie-App\out\index.js --name roadie
```

## Safety / Rollout Environment Variables
- Run in suggestion-only mode during initial rollout:
  - PowerShell:
    ```powershell
    $env:ROADIE_AUTONOMY_LEVEL='suggest'
    ```
  - CMD:
    ```cmd
    set ROADIE_AUTONOMY_LEVEL=suggest
    ```
- Emergency kill-switch (prevents tool execution):
  - PowerShell (session):
    ```powershell
    $env:ROADIE_DISABLE='1'
    ```
  - CMD:
    ```cmd
    set ROADIE_DISABLE=1
    ```
- For persistent user-level env vars on Windows:
  ```powershell
  setx ROADIE_AUTONOMY_LEVEL suggest
  ```

## Verification & Logs
- After install/build:
```powershell
roadie --help
roadie
```
- Logs are in `logs/runtime` by default. If `ROADIE_DISABLE=1` is set, no writes should occur.

## Example one-line PowerShell bootstrap (build + global install + set safe default)
```powershell
cd C:\dev\Roadie\roadie-App; npm install; npm run build; npm install -g .; setx ROADIE_AUTONOMY_LEVEL suggest
```

## Notes
- Prefer `ROADIE_AUTONOMY_LEVEL=suggest` during onboarding and enable writes only after verifying behavior.
- Use `ROADIE_DISABLE=1` as an emergency brake if you see unexpected writes or behavior.

## Optional Elevated Modes (Opt-In)
- `roadie install` does **not** auto-apply elevated permissions by default.
- To opt in to Claude superpowers during install, set:
  - PowerShell: `$env:ROADIE_INSTALL_SUPERPOWERS='1'`
- To opt in to Windows startup launcher creation, set:
  - PowerShell: `$env:ROADIE_INSTALL_AUTOSTART='1'`
- This keeps default installs safe and portable for teams and shared projects.
