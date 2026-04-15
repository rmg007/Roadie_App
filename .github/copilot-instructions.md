<!-- roadie:start:tech-stack -->
## Tech Stack

- **npm** (package_manager)
- **TypeScript** 5.2.0 (language)
- **Node.js** (runtime)
- **Vitest** 0.34.0 (test_tool)
- **tsup** 8.0.0 (build_tool)
<!-- roadie:end:tech-stack -->

<!-- roadie:start:commands -->
## Project Commands

- **vscode:prepublish**: `npm run vscode:prepublish`
- **build**: `npm run build`
- **build:watch**: `npm run build:watch`
- **lint**: `npm run lint`
- **lint:fix**: `npm run lint:fix`
- **format**: `npm run format`
- **test**: `npm run test`
- **test:watch**: `npm run test:watch`
- **test:coverage**: `npm run test:coverage`
- **package**: `npm run package`
- **publish**: `npm run publish`
- **prepublish:test**: `npm run prepublish:test`
<!-- roadie:end:commands -->

## Release Policy

- Treat Marketplace publish as tag-driven.
- When preparing a release commit, create and push a matching semantic version tag (`vX.Y.Z`).
- Prefer `git push origin master --follow-tags` so commit and tag move together.
