# v0.6.3 — Hardening Audit

**Target version:** 0.6.3
**Base version:** 0.6.2
**Date drafted:** 2026-04-15

---

## 1. Summary

Deep audit of the extension lifecycle, VS Code language-model integration, and prompt/workflow execution found multiple hardening issues in `src/extension.ts`, `src/shell/chat-participant.ts`, `src/shell/vscode-providers.ts`, `src/engine/*`, and `src/spawner/*`.

The highest-risk items are:
- activation-time startup analysis + file generation on extension activation
- broad `**/*` workspace file watcher registration
- cancellation not wired into actual model requests
- token usage measured using raw char count instead of model tokens
- prompt engineering that uses a single user role and raw JSON context serialization

---

## 2. Findings

| # | Severity | Location | Why | Fix |
|---|----------|----------|-----|-----|
| 1 | Critical | `package.json` `activationEvents`; `src/extension.ts` startup block | Extension activation does heavy work on `onStartupFinished` / `onChat:roadie` activation. `analyzer.analyze()` + `fileGenerator.generateAll()` run immediately on activate, causing Extension Host lag and bad startup UX for large repos. | Defer analysis/generation until first explicit workflow/chat request or run asynchronously off the activate hot path. Keep activation cheap. |
| 2 | High | `src/extension.ts` line 149 | `vscode.workspace.createFileSystemWatcher('**/*')` watches every file in the workspace with no excludes. Large repos will generate expensive OS/file events and increase churn. | Use a narrower watcher pattern or exclude generated directories (`.github/.roadie`, `.git`, `node_modules`, `out`, `dist`, `.cursor`, `.github/instructions`). |
| 3 | Critical | `src/engine/step-executor.ts` line 73; `src/extension.ts` step handler at line ~216; `src/spawner/agent-spawner.ts` | Workflow cancellation is only checked between step attempts. The active model request is not cancelled, so user abort does not stop a long-running LLM call. This is a live cancellation race and can leave the UI stuck waiting. | Extend `AgentConfig` to accept cancellation/abort signal and pass it through to `ModelProvider.sendRequest()`. Abort the model request when `context.cancellation.isCancelled` becomes true. |
| 4 | High | `src/shell/vscode-providers.ts` line 66; line 85 | `ModelProvider.sendRequest()` measures token usage as `m.content.length` and `text.length`. This is a raw char count, not model token count, so token budgeting and cost tracking are inaccurate. | Replace with a proper token-counting strategy or use `response.usage` if provided by VS Code LLM API. Do not expose misleading char counts as token usage. |
| 5 | High | `src/spawner/prompt-builder.ts` line 45; `src/spawner/agent-spawner.ts` | Prompt construction uses a single `user` message with role prompt text injected as content. There is no native system role pinned to the model, so system instructions can be overwritten and primary goal is weaker. | Use proper chat message roles: one `system` message for role/constraints, one `user` message for task/context. Keep system prompt separate from user prompt. |
| 6 | Optimization | `src/engine/model-resolver.ts` line 16 | Comment promises cached `selectModels()` results, but implementation calls `modelProvider.selectModels({})` on every `resolve()` invocation. Repeated resolution can cost extra API queries. | Cache the first `selectModels()` result for the lifetime of the resolver, or memoize by selector. |
| 7 | UX | `src/shell/chat-participant.ts` line 146 | General-chat fallback makes a streaming model call but does not handle mid-stream cancellation or stream interruption explicitly. If `request.model.sendRequest()` throws after partial chunks, the response may already have emitted partial text and no recovery path exists. | Wrap streaming in `try/finally`, handle `token.isCancellationRequested` inside the loop, and emit a graceful cancellation/ retry message. |
| 8 | Optimization | `src/spawner/prompt-builder.ts` line 45 | `serializeContext()` JSON-stringifies objects including `previous_output` and raw `project_context`, which risks sending large untrimmed JSON and consumes tokens unnecessarily. | Serialize only the final prompt text and use compact context representations. Avoid raw `JSON.stringify()` of large arrays/objects inside the prompt. |
| 9 | High | `src/engine/workflow-engine.ts` parallel branch handling | `executeParallelBranches()` passes the same shared `WorkflowContext` to each branch. This can lead to context/progress/cancellation cross-talk when branches run concurrently. | Clone or isolate branch-local context for parallel steps, especially if progress reporting or cancellation callbacks are stateful. |

---

## 3. Recommended fixes and snippets

### 3.1 Defer heavy activation work

In `src/extension.ts`, remove startup analysis and generation from `activate()` and instead lazily run it from the first explicit chat workflow or user command. For example:

```ts
export async function activate(context: vscode.ExtensionContext): Promise<void> {
  // ... init logger, container, provider wiring ...
  registerChatParticipant({ stepHandler, projectModel, learningDb });
  createStatusBar();
  registerCommands({ ... });
  context.subscriptions.push(container);
}
```

Move the `analyzer.analyze()` / `fileGenerator.generateAll()` block into `onInit` or a dedicated `ensureProjectReady()` helper.

### 3.2 Narrow file watcher scope

Replace:

```ts
const vsWatcher = vscode.workspace.createFileSystemWatcher('**/*');
```

with a scoped watcher and/or excludes:

```ts
const vsWatcher = vscode.workspace.createFileSystemWatcher('**/*.{ts,tsx,js,jsx,json,md,yml,yaml}');
```

and ignore generated paths like `.github/.roadie`, `.git`, `node_modules`, `out`, `dist`, `.cursor`, `.github/instructions` in `change-classifier.ts`.

### 3.3 Wire cancellation into model requests

Extend `AgentConfig`:

```ts
export interface AgentConfig {
  ...
  cancellation?: AbortSignal;
}
```

Pass it in `src/extension.ts`:

```ts
const agentConfig: AgentConfig = {
  ...
  cancellation: workflowContext.cancellation instanceof VSCodeCancellationHandle
    ? workflowContext.cancellation.signal
    : undefined,
};
```

and use it in `src/spawner/agent-spawner.ts`:

```ts
const response = await this.modelProvider.sendRequest(
  modelInfo.id,
  [{ role: 'user', content: prompt }],
  { cancellation: config.cancellation, tools: [...] },
);
```

Then ensure `VSCodeModelProvider` passes the abort signal through to `CancellationTokenSource`.

### 3.4 Fix token usage accounting

In `src/shell/vscode-providers.ts` replace char-length accounting with model-provided usage:

```ts
return {
  text,
  toolCalls: [],
  usage: {
    inputTokens: response.usage?.inputTokens ?? 0,
    outputTokens: response.usage?.outputTokens ?? 0,
  },
};
```

If `response.usage` is unavailable, implement a dedicated token counter rather than using `.length`.

### 3.5 Use proper system/user roles for prompt engineering

In `src/spawner/prompt-builder.ts`, emit a system message for role constraints and a separate user message for task/context:

```ts
const systemBlock = ROLE_PROMPTS[config.role];
const contextBlock = this.serializeContext(config.context);
const prompt = [systemBlock, contextBlock, taskPrompt].filter(Boolean).join('\n\n');
```

Then send messages as:

```ts
await model.sendRequest(
  [
    { role: 'system', content: systemBlock },
    { role: 'user', content: `${contextBlock}\n\n${taskPrompt}` },
  ],
  ...
);
```

### 3.6 Cache model enumeration

Add caching to `src/engine/model-resolver.ts`:

```ts
private cachedModels: ModelInfo[] | null = null;
async resolve(tier: ModelTier): Promise<ModelInfo> {
  if (!this.cachedModels) {
    this.cachedModels = await this.modelProvider.selectModels({});
  }
  const availableModels = this.cachedModels;
  ...
}
```

### 3.7 Isolate parallel branch context

In `src/engine/workflow-engine.ts`:

```ts
const branchContext = { ...context, previousStepResults: context.previousStepResults };
await Promise.allSettled(branches.map((branch) => this.stepExecutor.executeStep(branch, branchContext)));
```

This prevents shared mutable state from leaking between parallel branches.

---

## 4. Notes

- `Container` disposal and `ExtensionContext.subscriptions` are correctly wired; no leak was found in the container registration path.
- The biggest latent risk is user-visible host lag from eager startup analysis and broad file watching.
- `request.model.sendRequest()` is used directly for general-chat fallback; the fallback path should also limit model selection and handle model unavailability gracefully.

---

## 5. Recommended version bump

**Release target:** `0.6.3`

**Change rationale:** hardening to improve activation latency, cancellation safety, token accounting, and prompt robustness prior to the major release line.
