# Contributing to Roadie

## Running tests

```bash
npm test              # all unit tests
npm run test:scenarios  # scenario integration tests only
npm run test:coverage   # unit tests with coverage report
```

## Release and publish policy

Roadie releases are tag-driven.

1. Bump `package.json` version and update `CHANGELOG.md`.
2. Commit the release changes.
3. Create an annotated version tag: `git tag -a vX.Y.Z -m "vX.Y.Z"`.
4. Push commit and tags together: `git push origin master --follow-tags`.

If GitHub automation is configured for publish, Marketplace release should run only from version tags (`v*`), not from every push.

## Writing scenario tests

Scenarios live in `test/harness/scenarios/`. Each scenario is a JSON file that specifies a prompt, an expected intent, and what the workflow engine should do.

### Scenario file structure

```jsonc
{
  "$schema": "test/harness/scenarios/schema.json",
  "version": 1,
  "id": "my-scenario",           // kebab-case, unique
  "name": "Human-readable name",
  "workspaceFixture": "ts-calculator",  // folder under test/fixtures/
  "prompt": "@roadie fix the crash in add()",
  "seed": {                       // optional: pre-populate learning DB
    "workflowHistory": [
      { "type": "bug_fix", "status": "completed", "count": 5 }
    ],
    "patternObservations": [
      { "patternId": "language:TypeScript", "count": 10 }
    ]
  },
  "expect": {
    "intent": { "type": "bug_fix", "confidence": ">= 0.7" },
    "workflow": "bug_fix",
    "stepsExecuted": { ">=": 4, "<=" : 8 },
    "fileMutations": [            // optional: assert file writes
      { "path": "src/calculator.ts", "mustContain": "null" }
    ],
    "contextMustContain": [       // optional: assert prompt enrichment
      "## Most-Edited Files"
    ],
    "assertions": [               // optional: custom assertion modules
      "./assertions/my-scenario.ts"
    ]
  },
  "faultInjection": {             // optional: inject a step failure
    "onStep": 2,
    "mode": "timeout"
  }
}
```

### Supported intent types

`bug_fix` · `feature` · `refactor` · `review` · `document` · `dependency` · `onboard` · `general_chat`

### Supported fault injection modes

`timeout` · `throw` · `partial` · `rate-limit` · `token-exceeded` · `stream-corruption`

### Confidence comparators

The `intent.confidence` field accepts: `>= 0.7`, `> 0.5`, `<= 1.0`, `== 1.0`.

### Custom assertions

Create a `.ts` file next to the scenario JSON. Export a default function or `assertScenario`:

```typescript
// test/harness/scenarios/assertions/my-scenario.ts
import type { ScenarioExecutionResult } from '../scenario-runner';

export default function assertScenario(result: ScenarioExecutionResult): void {
  if (result.intentAfterLearning.confidence <= result.intentBeforeLearning.confidence) {
    throw new Error('Expected learning to boost confidence');
  }
}
```

### Fixtures

Workspace fixtures live in `test/fixtures/`. Each is a minimal project directory. The scenario runner copies it to a temp directory before running, so mutations are isolated. Add a new fixture if your scenario needs a different project shape.

### Schema validation

All scenario files are validated against `test/harness/scenarios/schema.json` before the suite runs (`scenario-schema.test.ts`). A malformed scenario will fail fast with a clear error.
