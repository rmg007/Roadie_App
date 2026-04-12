/**
 * @module intent-patterns
 * @description Canonical pattern weight matrix for local intent classification.
 *   INTENT_PATTERNS, NEGATIVE_SIGNALS, and CONFIDENCE_THRESHOLDS are the
 *   single source of truth — copied verbatim from Intent Classification Taxonomy.md.
 *   Do NOT invent pattern weights or threshold values.
 * @inputs None (constants only)
 * @outputs INTENT_PATTERNS, NEGATIVE_SIGNALS, CONFIDENCE_THRESHOLDS
 * @depends-on None
 * @depended-on-by intent-classifier.ts
 */

export interface IntentPattern {
  regex: RegExp;
  weight: number;   // additive score contribution per match (negative = reduces confidence)
  label: string;    // for debugging / matched signals output
}

export const INTENT_PATTERNS: Record<string, IntentPattern[]> = {
  bug_fix: [
    { regex: /\bfix\b/i,                                    weight: 0.35, label: 'keyword:fix' },
    { regex: /\bbug\b/i,                                    weight: 0.35, label: 'keyword:bug' },
    { regex: /\bbroken\b/i,                                 weight: 0.30, label: 'keyword:broken' },
    { regex: /\berror\b/i,                                  weight: 0.25, label: 'keyword:error' },
    { regex: /\bnot working\b/i,                            weight: 0.30, label: 'keyword:not-working' },
    { regex: /\bcrash(ing|es)?\b/i,                         weight: 0.35, label: 'keyword:crash' },
    { regex: /\bfailing\b/i,                                weight: 0.30, label: 'keyword:failing' },
    { regex: /\b500\b/,                                     weight: 0.20, label: 'signal:500-error' },
    { regex: /null pointer|undefined is not|cannot read/i,  weight: 0.40, label: 'signal:error-message' },
    { regex: /TypeError:|ReferenceError:|SyntaxError:/,     weight: 0.45, label: 'signal:runtime-error-type' },
    { regex: /at \/[\w/.-]+:\d+/,                          weight: 0.40, label: 'signal:stack-trace' },
    { regex: /\bstack trace\b/i,                            weight: 0.35, label: 'signal:stack-trace-mention' },
  ],

  feature: [
    { regex: /\badd\b/i,                                    weight: 0.30, label: 'keyword:add' },
    { regex: /\bcreate\b/i,                                 weight: 0.25, label: 'keyword:create' },
    { regex: /\bbuild\b/i,                                  weight: 0.20, label: 'keyword:build' },
    { regex: /\bnew feature\b/i,                            weight: 0.40, label: 'keyword:new-feature' },
    { regex: /\bimplement\b/i,                              weight: 0.35, label: 'keyword:implement' },
    { regex: /\bmake\b.*\bwork\b/i,                         weight: 0.20, label: 'keyword:make-work' },
    { regex: /\bsupport\b/i,                                weight: 0.20, label: 'keyword:support' },
    { regex: /\benable\b/i,                                 weight: 0.20, label: 'keyword:enable' },
    { regex: /dark mode|export|search|filter|pagination/i,  weight: 0.25, label: 'signal:feature-name' },
  ],

  refactor: [
    { regex: /\brefactor\b/i,                               weight: 0.45, label: 'keyword:refactor' },
    { regex: /\bclean\s*up\b/i,                             weight: 0.35, label: 'keyword:clean-up' },
    { regex: /\brestructure\b/i,                            weight: 0.40, label: 'keyword:restructure' },
    { regex: /\bsimplify\b/i,                               weight: 0.35, label: 'keyword:simplify' },
    { regex: /\bextract\b/i,                                weight: 0.30, label: 'keyword:extract' },
    { regex: /\breorganize\b/i,                             weight: 0.35, label: 'keyword:reorganize' },
    { regex: /\boptimize\b/i,                               weight: 0.25, label: 'keyword:optimize' },
    { regex: /\bmessy\b|\bcomplex\b|\bhard to test\b/i,    weight: 0.20, label: 'signal:quality-complaint' },
  ],

  review: [
    { regex: /\breview\b/i,                                 weight: 0.45, label: 'keyword:review' },
    { regex: /\baudit\b/i,                                  weight: 0.40, label: 'keyword:audit' },
    { regex: /\banalyze\b/i,                                weight: 0.30, label: 'keyword:analyze' },
    { regex: /\bevaluate\b/i,                               weight: 0.25, label: 'keyword:evaluate' },
    { regex: /\blook at\b/i,                                weight: 0.25, label: 'keyword:look-at' },
    { regex: /\bbefore I push\b/i,                          weight: 0.40, label: 'signal:before-push' },
    { regex: /\bany issues\b/i,                             weight: 0.30, label: 'signal:any-issues' },
    { regex: /\bPR\b|\bpull request\b/i,                    weight: 0.25, label: 'signal:PR' },
    { regex: /\bmy (code|changes)\b/i,                      weight: 0.20, label: 'signal:my-code' },
  ],

  document: [
    { regex: /\bdocument\b/i,                               weight: 0.45, label: 'keyword:document' },
    { regex: /\bdocs?\b/i,                                  weight: 0.35, label: 'keyword:docs' },
    { regex: /\bREADME\b/,                                  weight: 0.40, label: 'signal:README' },
    { regex: /\bAPI docs?\b/i,                              weight: 0.40, label: 'signal:API-docs' },
    { regex: /\bJSDoc\b/i,                                  weight: 0.40, label: 'signal:JSDoc' },
    { regex: /\bwrite documentation\b/i,                    weight: 0.45, label: 'keyword:write-documentation' },
    { regex: /\bcomments?\b/i,                              weight: 0.20, label: 'keyword:comments' },
    { regex: /\bexplain\b/i,                                weight: 0.15, label: 'keyword:explain' },
  ],

  dependency: [
    { regex: /\bupgrade\b/i,                                weight: 0.35, label: 'keyword:upgrade' },
    { regex: /\bmigrate\b/i,                                weight: 0.30, label: 'keyword:migrate' },
    { regex: /\bdependenc(y|ies)\b/i,                       weight: 0.40, label: 'keyword:dependency' },
    { regex: /\bpackage\b/i,                                weight: 0.20, label: 'keyword:package' },
    { regex: /\bvulnerab|CVE\b/i,                           weight: 0.40, label: 'signal:vulnerability' },
    { regex: /\boutdated\b/i,                               weight: 0.35, label: 'signal:outdated' },
    { regex: /\bbreaking changes?\b/i,                      weight: 0.30, label: 'signal:breaking-change' },
    { regex: /\bsecurity audit\b/i,                         weight: 0.40, label: 'signal:security-audit' },
    { regex: /\bReact\b|\bTypeScript\b|\bPrisma\b|\bNext\.js\b|\bExpress\b/, weight: 0.20, label: 'signal:package-name' },
  ],

  onboard: [
    { regex: /\bonboard\b/i,                                weight: 0.45, label: 'keyword:onboard' },
    { regex: /\bnew to\b/i,                                 weight: 0.35, label: 'keyword:new-to' },
    { regex: /\bunderstand\b/i,                             weight: 0.20, label: 'keyword:understand' },
    { regex: /\bhow does\b/i,                               weight: 0.20, label: 'keyword:how-does' },
    { regex: /\barchitecture\b/i,                           weight: 0.25, label: 'keyword:architecture' },
    { regex: /\bwhere do I start\b/i,                       weight: 0.40, label: 'keyword:where-start' },
    { regex: /\bwalk me through\b/i,                        weight: 0.40, label: 'signal:walk-through' },
    { regex: /\bexplain the project\b/i,                    weight: 0.45, label: 'signal:explain-project' },
    { regex: /\bstarter task\b|\bfirst task\b/i,            weight: 0.35, label: 'signal:starter-task' },
    { regex: /\bget up to speed\b/i,                        weight: 0.40, label: 'signal:up-to-speed' },
  ],

  // general_chat is the fallback — no patterns. It is returned when no other intent scores >= 0.3.
};

// Negative signals: if these match, subtract weight from the top-scoring intent
export const NEGATIVE_SIGNALS: IntentPattern[] = [
  { regex: /\bdon'?t fix\b|\bdo not fix\b/i,        weight: -0.40, label: 'negative:dont-fix' },
  { regex: /\bdon'?t document\b/i,                   weight: -0.40, label: 'negative:dont-document' },
  { regex: /\bnot a bug\b|\bexpected behavior\b/i,   weight: -0.30, label: 'negative:not-a-bug' },
];

// Canonical confidence thresholds — every workflow and every test MUST import this
// constant rather than hardcoding floats. The values are frozen via `as const` so
// downstream code receives literal types (e.g. `0.80`, not `number`).
export const CONFIDENCE_THRESHOLDS = {
  /** Single primary signal matched -> confidence returned by classifier. */
  primaryOnly: 0.80,
  /** Primary + at least one secondary signal matched -> highest local confidence. */
  primaryPlusSecondary: 0.90,
  /** Two or more intents scored within this delta of each other -> confidence is capped. */
  ambiguousDelta: 0.30,
  /** Cap applied when multiple intents are within `ambiguousDelta` of each other. */
  ambiguousCap: 0.60,
  /** Below this score, no intent is recognized -> classifier returns general_chat with this confidence. */
  unknown: 0.10,
  /** A negative signal matches the top intent -> confidence collapses to this floor. */
  negativeOverride: 0.10,
  /** Minimum confidence at which the classifier is allowed to skip LLM fallback. */
  requiresLLMBelow: 0.70,
  /** LLM fallback always returns this confidence when it produces a classification. */
  llmClassification: 0.85,
} as const;
