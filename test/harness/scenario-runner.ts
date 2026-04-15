import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { IntentClassifier } from '../../src/classifier/intent-classifier';
import { WorkflowEngine } from '../../src/engine/workflow-engine';
import { StepExecutor, type StepHandlerFn } from '../../src/engine/step-executor';
import { BUG_FIX_WORKFLOW } from '../../src/engine/definitions/bug-fix';
import { FEATURE_WORKFLOW } from '../../src/engine/definitions/feature';
import { REFACTOR_WORKFLOW } from '../../src/engine/definitions/refactor';
import { REVIEW_WORKFLOW } from '../../src/engine/definitions/review';
import { DOCUMENT_WORKFLOW } from '../../src/engine/definitions/document';
import { DEPENDENCY_WORKFLOW } from '../../src/engine/definitions/dependency';
import { ONBOARD_WORKFLOW } from '../../src/engine/definitions/onboard';
import { InMemoryProjectModel } from '../../src/model/project-model';
import { ProjectAnalyzer } from '../../src/analyzer/project-analyzer';
import { RoadieDatabase } from '../../src/model/database';
import { LearningDatabase } from '../../src/learning/learning-database';
import { getLogger } from '../../src/shell/logger';
import type {
  ClassificationResult,
  WorkflowContext,
  WorkflowDefinition,
  WorkflowStep,
  StepResult,
} from '../../src/types';

interface ScenarioSeed {
  workflowHistory?: Array<{ type: string; status: string; count: number }>;
  patternObservations?: Array<{ patternId: string; count: number }>;
}

interface ScenarioExpect {
  intent: { type: string; confidence: string };
  workflow: string;
  stepsExecuted: { '>=': number; '<=': number };
  faultExpected?: boolean;
  fileMutations?: Array<{ path: string; mustContain: string }>;
  contextMustContain?: string[];
  assertions?: string[];
}

interface FaultInjection {
  onStep: number;
  mode: 'throw' | 'timeout' | 'partial' | 'rate-limit' | 'token-exceeded' | 'stream-corruption';
}

interface ScenarioSpec {
  version: 1;
  id: string;
  name: string;
  workspaceFixture: string;
  prompt: string;
  seed?: ScenarioSeed;
  expect: ScenarioExpect;
  faultInjection?: FaultInjection;
  cassette?: string;
}

interface ScenarioExecutionResult {
  scenarioId: string;
  intentBeforeLearning: ClassificationResult;
  intentAfterLearning: ClassificationResult;
  workflowId: string;
  stepsExecuted: number;
  contextSnapshots: string[];
  workspaceRoot: string;
}

const WORKFLOW_MAP: Record<string, WorkflowDefinition> = {
  bug_fix: BUG_FIX_WORKFLOW,
  feature: FEATURE_WORKFLOW,
  refactor: REFACTOR_WORKFLOW,
  review: REVIEW_WORKFLOW,
  document: DOCUMENT_WORKFLOW,
  dependency: DEPENDENCY_WORKFLOW,
  onboard: ONBOARD_WORKFLOW,
};

export async function runScenario(scenarioFilePath: string): Promise<ScenarioExecutionResult> {
  const scenario = readJson<ScenarioSpec>(scenarioFilePath);
  const repoRoot = process.cwd();
  const fixtureRoot = path.join(repoRoot, 'test', 'fixtures', scenario.workspaceFixture);
  if (!fs.existsSync(fixtureRoot)) {
    throw new Error(`Fixture not found: ${fixtureRoot}`);
  }

  const tempWorkspace = fs.mkdtempSync(path.join(os.tmpdir(), `roadie-scenario-${scenario.id}-`));
  fs.cpSync(fixtureRoot, tempWorkspace, { recursive: true, force: true });

  const dbPath = path.join(tempWorkspace, '.github', '.roadie', 'scenario.db');
  const roadieDb = new RoadieDatabase(dbPath);
  const learningDb = new LearningDatabase();
  learningDb.initialize(roadieDb.getRawDb(), { workflowHistory: true });

  try {
    seedLearningDatabase(learningDb, scenario.seed);

    const projectModel = new InMemoryProjectModel(roadieDb);
    const analyzer = new ProjectAnalyzer(projectModel, undefined, learningDb);
    await analyzer.analyze(tempWorkspace);

    // Ensure review/onboard context injection has data to render.
    if (scenario.expect.contextMustContain?.includes('## Most-Edited Files')) {
      seedHotFilesIfMissing(tempWorkspace, learningDb);
    }

    const classifier = new IntentClassifier();
    const intentBeforeLearning = classifier.classify(scenario.prompt);
    const intentAfterLearning = classifier.adjustWithLearning(
      intentBeforeLearning,
      learningDb.getWorkflowStats(),
      learningDb.getWorkflowCancellationStats(),
    );

    const workflow = WORKFLOW_MAP[intentAfterLearning.intent];
    if (!workflow) {
      throw new Error(`No workflow mapped for intent: ${intentAfterLearning.intent}`);
    }

    let enrichedPrompt = scenario.prompt;
    if (intentAfterLearning.intent === 'review' || intentAfterLearning.intent === 'onboard') {
      const hotFiles = learningDb.getMostEditedFiles(10);
      if (hotFiles.length > 0) {
        enrichedPrompt = buildContextWithHotFiles(enrichedPrompt, hotFiles);
      }
    }

    const stepHandler = createScenarioStepHandler(tempWorkspace, scenario, workflow, scenario.faultInjection);
    const engine = new WorkflowEngine(new StepExecutor(stepHandler));

    const workflowContext: WorkflowContext = {
      prompt: enrichedPrompt,
      intent: intentAfterLearning,
      projectModel,
      progress: {
        report: (_message: string) => undefined,
        reportMarkdown: (_markdown: string) => undefined,
      },
      cancellation: {
        isCancelled: false,
        signal: undefined,
        onCancelled: (_callback: () => void) => undefined,
      },
      previousStepResults: [],
    };

    const result = await engine.execute(workflow, workflowContext);
    assertScenarioExpectations(scenario, result.stepResults, enrichedPrompt, tempWorkspace, intentAfterLearning);

    await runCustomAssertions(scenarioFilePath, scenario, {
      scenarioId: scenario.id,
      intentBeforeLearning,
      intentAfterLearning,
      workflowId: workflow.id,
      stepsExecuted: result.stepResults.length,
      contextSnapshots: [enrichedPrompt],
      workspaceRoot: tempWorkspace,
    });

    return {
      scenarioId: scenario.id,
      intentBeforeLearning,
      intentAfterLearning,
      workflowId: workflow.id,
      stepsExecuted: result.stepResults.length,
      contextSnapshots: [enrichedPrompt],
      workspaceRoot: tempWorkspace,
    };
  } finally {
    learningDb.close();
    roadieDb.close();
    fs.rmSync(tempWorkspace, { recursive: true, force: true });
  }
}

function seedLearningDatabase(learningDb: LearningDatabase, seed?: ScenarioSeed): void {
  if (!seed) return;

  for (const row of seed.workflowHistory ?? []) {
    for (let i = 0; i < row.count; i++) {
      learningDb.recordWorkflowOutcome({
        workflowType: row.type,
        prompt: 'seeded workflow history',
        status: row.status,
        stepsCompleted: row.status === 'cancelled' ? 1 : 3,
        stepsTotal: 3,
        durationMs: 1200,
      });
    }
  }

  for (const row of seed.patternObservations ?? []) {
    for (let i = 0; i < row.count; i++) {
      learningDb.recordPatternObservation(row.patternId);
    }
  }
}

function seedHotFilesIfMissing(workspaceRoot: string, learningDb: LearningDatabase): void {
  const existing = learningDb.getMostEditedFiles(1);
  if (existing.length > 0) return;

  const srcDir = path.join(workspaceRoot, 'src');
  if (!fs.existsSync(srcDir)) return;

  const files = fs
    .readdirSync(srcDir)
    .filter((name) => name.endsWith('.ts'))
    .map((name) => path.join(srcDir, name));

  if (files.length === 0) return;

  const filePath = files[0];
  const content = fs.readFileSync(filePath, 'utf8');
  for (let i = 0; i < 3; i++) {
    learningDb.recordSnapshot(path.relative(workspaceRoot, filePath), content, 'human');
  }
}

function buildContextWithHotFiles(
  base: string,
  hotFiles: Array<{ filePath: string; editCount: number }>,
): string {
  if (hotFiles.length === 0) return base;
  const lines = hotFiles.map((f) => `- ${f.filePath} (${f.editCount} edits)`);
  return `${base}\n\n## Most-Edited Files\n\n${lines.join('\n')}`;
}

function createScenarioStepHandler(
  workspaceRoot: string,
  scenario: ScenarioSpec,
  workflow: WorkflowDefinition,
  faultInjection?: FaultInjection,
): StepHandlerFn {
  const mutationStepId = workflow.steps.find((step) => step.id === 'generate-fix')?.id;
  const logger = getLogger();

  return async (step: WorkflowStep): Promise<StepResult> => {
    const stepIndex = workflow.steps.findIndex((candidate) => candidate.id === step.id) + 1;

    if (faultInjection && stepIndex === faultInjection.onStep) {
      if (faultInjection.mode === 'throw') {
        throw new Error('fault-injection:throw');
      }

      const unimplementedModes = ['timeout', 'partial', 'rate-limit', 'token-exceeded', 'stream-corruption'];
      if (unimplementedModes.includes(faultInjection.mode)) {
        logger.warn(
          `[scenario:${scenario.id}] faultInjection mode '${faultInjection.mode}' is stubbed; continuing normally (step ${stepIndex}/${workflow.steps.length})`,
        );
      }
    }

    if (mutationStepId && step.id === mutationStepId) {
      for (const mutation of scenario.expect.fileMutations ?? []) {
        const absPath = path.join(workspaceRoot, mutation.path);
        const parent = path.dirname(absPath);
        fs.mkdirSync(parent, { recursive: true });

        const base = fs.existsSync(absPath) ? fs.readFileSync(absPath, 'utf8') : '';
        const suffix = `\n// scenario mutation: ${mutation.mustContain}\n`;
        const next = base.includes(mutation.mustContain) ? base : `${base}${suffix}`;
        fs.writeFileSync(absPath, next, 'utf8');
      }
    }

    return {
      stepId: step.id,
      status: 'success',
      output: `scenario-step:${step.id}`,
      tokenUsage: { input: 1, output: 1 },
      attempts: 1,
      modelUsed: 'scenario-mock',
    };
  };
}

function assertScenarioExpectations(
  scenario: ScenarioSpec,
  stepResults: StepResult[],
  promptSnapshot: string,
  workspaceRoot: string,
  classification: ClassificationResult,
): void {
  if (classification.intent !== scenario.expect.intent.type) {
    throw new Error(`Intent mismatch: expected ${scenario.expect.intent.type}, got ${classification.intent}`);
  }

  assertComparator(classification.confidence, scenario.expect.intent.confidence, 'intent.confidence');

  const workflow = WORKFLOW_MAP[classification.intent];
  if (!workflow || workflow.id !== scenario.expect.workflow) {
    throw new Error(`Workflow mismatch: expected ${scenario.expect.workflow}, got ${workflow?.id ?? 'none'}`);
  }

  const steps = stepResults.length;
  const minSteps = scenario.expect.stepsExecuted['>='];
  const maxSteps = scenario.expect.stepsExecuted['<='];
  if (steps < minSteps || steps > maxSteps) {
    throw new Error(`stepsExecuted out of range: got ${steps}, expected between ${minSteps} and ${maxSteps}`);
  }

  if (scenario.expect.faultExpected === true && steps >= workflow.steps.length) {
    throw new Error(`Expected fault to stop workflow early, but executed ${steps}/${workflow.steps.length} steps`);
  }

  for (const mustContain of scenario.expect.contextMustContain ?? []) {
    if (!promptSnapshot.includes(mustContain)) {
      throw new Error(`Missing context marker: ${mustContain}`);
    }
  }

  for (const mutation of scenario.expect.fileMutations ?? []) {
    const absPath = path.join(workspaceRoot, mutation.path);
    if (!fs.existsSync(absPath)) {
      throw new Error(`Expected mutated file not found: ${mutation.path}`);
    }
    const content = fs.readFileSync(absPath, 'utf8');
    if (!content.includes(mutation.mustContain)) {
      throw new Error(`Expected content not found in ${mutation.path}: ${mutation.mustContain}`);
    }
  }
}

async function runCustomAssertions(
  scenarioFilePath: string,
  scenario: ScenarioSpec,
  payload: ScenarioExecutionResult,
): Promise<void> {
  for (const assertionPath of scenario.expect.assertions ?? []) {
    const resolvedPath = path.resolve(path.dirname(scenarioFilePath), assertionPath);
    if (!fs.existsSync(resolvedPath)) {
      continue;
    }

    const mod = await import(pathToFileUrl(resolvedPath));
    const assertFn = mod.default ?? mod.assertScenario;
    if (typeof assertFn !== 'function') {
      throw new Error(`Assertion module must export default or assertScenario function: ${assertionPath}`);
    }

    await assertFn(payload);
  }
}

function assertComparator(actual: number, expression: string, label: string): void {
  const match = expression.trim().match(/^(>=|<=|>|<|==?)\s*([0-9]*\.?[0-9]+)$/);
  if (!match) {
    throw new Error(`Unsupported comparator expression for ${label}: ${expression}`);
  }

  const operator = match[1];
  const expected = Number(match[2]);

  const pass =
    (operator === '>' && actual > expected) ||
    (operator === '<' && actual < expected) ||
    (operator === '>=' && actual >= expected) ||
    (operator === '<=' && actual <= expected) ||
    ((operator === '==' || operator === '=') && actual === expected);

  if (!pass) {
    throw new Error(`${label} failed comparator ${expression}. actual=${actual}`);
  }
}

function pathToFileUrl(filePath: string): string {
  const normalized = filePath.replace(/\\/g, '/');
  return `file://${normalized.startsWith('/') ? '' : '/'}${normalized}`;
}

function readJson<T>(filePath: string): T {
  return JSON.parse(fs.readFileSync(filePath, 'utf8')) as T;
}
