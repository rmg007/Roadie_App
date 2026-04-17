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
    { regex: /\bbugs?\b/i,                                  weight: 0.35, label: 'keyword:bug' },
    { regex: /\bbroken\b/i,                                 weight: 0.30, label: 'keyword:broken' },
    { regex: /\berror\b/i,                                  weight: 0.25, label: 'keyword:error' },
    { regex: /\bnot working\b/i,                            weight: 0.30, label: 'keyword:not-working' },
    { regex: /\bcrash(ing|es)?\b/i,                         weight: 0.35, label: 'keyword:crash' },
    { regex: /\bfailing\b|\bfails?\b|\bfailure\b/i,         weight: 0.30, label: 'keyword:failing' },
    { regex: /\b(4\d{2}|5\d{2})\b/,                         weight: 0.25, label: 'signal:http-error' },
    { regex: /null pointer|undefined is not|cannot read/i,  weight: 0.40, label: 'signal:error-message' },
    { regex: /TypeError:|ReferenceError:|SyntaxError:/,     weight: 0.45, label: 'signal:runtime-error-type' },
    { regex: /at \/[\w/.-]+:\d+/,                          weight: 0.40, label: 'signal:stack-trace' },
    { regex: /\bstack trace\b/i,                            weight: 0.35, label: 'signal:stack-trace-mention' },
    // Symptom phrasings — users describe bugs without using "bug" or "fix"
    { regex: /\bstopped working\b|\bdoesn'?t work\b|\bdoes nothing\b|\bno longer works?\b/i, weight: 0.40, label: 'signal:stopped-working' },
    { regex: /\bwrong\b|\bincorrect(ly)?\b/i,               weight: 0.25, label: 'signal:wrong' },
    { regex: /\bmemory leak\b/i,                            weight: 0.45, label: 'signal:memory-leak' },
    { regex: /\bpromise rejection\b|\buncaught\b|\bunhandled exception\b/i, weight: 0.40, label: 'signal:uncaught' },
    { regex: /\bnot loading\b|\bwon'?t load\b|\bfails? to load\b/i, weight: 0.35, label: 'signal:not-loading' },
    { regex: /\bdouble-?post(s|ing)?\b|\bdouble-?submit/i,  weight: 0.35, label: 'signal:double-post' },
    { regex: /\bflicker(ing)?\b|\bglitch(ing|es)?\b/i,      weight: 0.30, label: 'signal:flicker' },
    { regex: /\bNaN\b/,                                     weight: 0.35, label: 'signal:NaN' },
    { regex: /\bhydration mismatch\b|\bhydration error\b/i, weight: 0.45, label: 'signal:hydration' },
    { regex: /\bnever terminates?\b|\binfinite loop\b|\bhangs?\b/i, weight: 0.40, label: 'signal:infinite' },
    { regex: /\bsilently fails?\b|\bsilent(ly)? fail/i,     weight: 0.40, label: 'signal:silent-fail' },
    { regex: /\bredirect loop\b|\binfinite redirect\b/i,    weight: 0.45, label: 'signal:redirect-loop' },
    { regex: /\bsegfault\b|\bsegmentation fault\b/i,        weight: 0.45, label: 'signal:segfault' },
    { regex: /\bduplicate results?\b|\breturning duplicates?\b/i, weight: 0.35, label: 'signal:duplicates' },
    { regex: /\btimezone\b|\boff by one\b/i,                weight: 0.25, label: 'signal:timezone' },
    { regex: /\bwhy (my|the|does|is)\b/i,                   weight: 0.20, label: 'signal:why-my' },
  ],

  feature: [
    { regex: /\badd\b/i,                                    weight: 0.30, label: 'keyword:add' },
    { regex: /\bcreate\b/i,                                 weight: 0.25, label: 'keyword:create' },
    { regex: /\bbuild\b/i,                                  weight: 0.20, label: 'keyword:build' },
    { regex: /\bnew feature\b/i,                            weight: 0.40, label: 'keyword:new-feature' },
    { regex: /\bimplement\b/i,                              weight: 0.35, label: 'keyword:implement' },
    { regex: /\bmake\b[\s\S]{0,200}?\bwork\b/i,         weight: 0.20, label: 'keyword:make-work' },
    { regex: /\bsupport\b/i,                                weight: 0.20, label: 'keyword:support' },
    { regex: /\benable\b/i,                                 weight: 0.20, label: 'keyword:enable' },
    { regex: /dark mode|export|search|filter|pagination/i,  weight: 0.25, label: 'signal:feature-name' },
    { regex: /\bgenerate\b/i,                               weight: 0.20, label: 'keyword:generate' },
    { regex: /\bupdate\b/i,                                 weight: 0.20, label: 'keyword:update' },
    { regex: /\bmake (the|it|this|a|an)\b/i,                weight: 0.25, label: 'signal:make-the' },
    { regex: /\blet users?\b|\ballow users?\b/i,            weight: 0.35, label: 'signal:let-users' },
    { regex: /\bship (a|an|the)\b/i,                        weight: 0.30, label: 'signal:ship' },
    { regex: /\bintroduce\b/i,                              weight: 0.25, label: 'keyword:introduce' },
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
    // Common refactor verbs missing from original list
    { regex: /\bsplit\b/i,                                  weight: 0.40, label: 'keyword:split' },
    { regex: /\brename\b/i,                                 weight: 0.40, label: 'keyword:rename' },
    { regex: /\breplace\b/i,                                weight: 0.30, label: 'keyword:replace' },
    { regex: /\bdeduplicate\b|\bde-?dupe\b/i,               weight: 0.40, label: 'keyword:dedupe' },
    { regex: /\bconsolidate\b/i,                            weight: 0.40, label: 'keyword:consolidate' },
    { regex: /\bconvert\b/i,                                weight: 0.30, label: 'keyword:convert' },
    { regex: /\bmove\b[\s\S]{0,40}?\b(into|to)\b/i,         weight: 0.30, label: 'signal:move-into' },
    { regex: /\btidy\b/i,                                   weight: 0.35, label: 'keyword:tidy' },
    { regex: /\bpull\b[\s\S]{0,30}?\b(into|out)\b/i,        weight: 0.30, label: 'signal:pull-into' },
    { regex: /\bbreak up\b|\bbreak down\b/i,                weight: 0.35, label: 'keyword:break-up' },
    { regex: /\bmake it better\b|\bmake it cleaner\b/i,     weight: 0.35, label: 'signal:make-better' },
    { regex: /\bchange that\b|\bchange this\b/i,            weight: 0.25, label: 'signal:change-that' },
    { regex: /\bcallback hell\b|\bgod object\b|\bmonolithic\b/i, weight: 0.40, label: 'signal:anti-pattern' },
    { regex: /\bsmaller (modules|pieces|components|functions)\b/i, weight: 0.35, label: 'signal:smaller' },
    { regex: /\b(class components?|hooks)\b/i,              weight: 0.15, label: 'signal:class-hooks' },
  ],

  review: [
    { regex: /\breview\b/i,                                 weight: 0.45, label: 'keyword:review' },
    { regex: /\baudit\b/i,                                  weight: 0.40, label: 'keyword:audit' },
    { regex: /\banalyze\b/i,                                weight: 0.30, label: 'keyword:analyze' },
    { regex: /\bevaluate\b/i,                               weight: 0.25, label: 'keyword:evaluate' },
    { regex: /\blook at\b/i,                                weight: 0.25, label: 'keyword:look-at' },
    { regex: /\bbefore I (push|merge|commit|ship)\b/i,      weight: 0.45, label: 'signal:before-push' },
    { regex: /\bany issues\b/i,                             weight: 0.30, label: 'signal:any-issues' },
    { regex: /\bPR\b|\bpull request\b/i,                    weight: 0.25, label: 'signal:PR' },
    { regex: /\bmy (code|changes|diff|change|approach|PR|pr)\b/i, weight: 0.30, label: 'signal:my-code' },
    { regex: /any bugs?/i,                                  weight: 0.25, label: 'signal:any-bugs' },
    { regex: /\bedge cases?\b/i,                            weight: 0.25, label: 'signal:edge-cases' },
    { regex: /\bunhandled\b/i,                              weight: 0.25, label: 'signal:unhandled' },
    { regex: /\bcheck\b/i,                                  weight: 0.15, label: 'keyword:check' },
    // Review-specific phrasings
    { regex: /\bfeedback\b/i,                               weight: 0.40, label: 'keyword:feedback' },
    { regex: /\bcritique\b/i,                               weight: 0.45, label: 'keyword:critique' },
    { regex: /\bsanity check\b/i,                           weight: 0.45, label: 'signal:sanity-check' },
    { regex: /\bwhat do you think\b/i,                      weight: 0.40, label: 'signal:what-think' },
    { regex: /\bidiomatic\b/i,                              weight: 0.40, label: 'signal:idiomatic' },
    { regex: /\bdiff\b/i,                                   weight: 0.25, label: 'keyword:diff' },
    { regex: /\bwalk through my\b|\btell me what'?s wrong\b/i, weight: 0.40, label: 'signal:walkthrough-my' },
    { regex: /\bdoes this look\b|\bhow does this look\b/i,  weight: 0.40, label: 'signal:does-this-look' },
  ],

  document: [
    { regex: /\bdocument\b/i,                               weight: 0.45, label: 'keyword:document' },
    { regex: /\bdocs?\b/i,                                  weight: 0.35, label: 'keyword:docs' },
    { regex: /\bREADME\b/,                                  weight: 0.40, label: 'signal:README' },
    { regex: /\bAPI docs?\b/i,                              weight: 0.40, label: 'signal:API-docs' },
    { regex: /\bJSDoc\b/i,                                  weight: 0.40, label: 'signal:JSDoc' },
    { regex: /\bwrite documentation\b/i,                    weight: 0.45, label: 'keyword:write-documentation' },
    { regex: /\bcomments?\b/i,                              weight: 0.35, label: 'keyword:comments' },
    { regex: /\bexplain\b/i,                                weight: 0.15, label: 'keyword:explain' },
    // Doc artifacts
    { regex: /\bCONTRIBUTING(\.md)?\b/,                     weight: 0.50, label: 'signal:contributing-md' },
    { regex: /\btypedoc\b/i,                                weight: 0.50, label: 'signal:typedoc' },
    { regex: /\btutorial\b/i,                               weight: 0.40, label: 'keyword:tutorial' },
    { regex: /\busage examples?\b/i,                        weight: 0.40, label: 'signal:usage-examples' },
    { regex: /\barchitecture overview\b/i,                  weight: 0.45, label: 'signal:arch-overview' },
    { regex: /\bmigration notes?\b/i,                       weight: 0.40, label: 'signal:migration-notes' },
    { regex: /\bchangelog\b/i,                              weight: 0.30, label: 'keyword:changelog' },
    { regex: /\brunbook\b/i,                                weight: 0.45, label: 'keyword:runbook' },
    { regex: /\bin markdown\b|\bto markdown\b/i,            weight: 0.35, label: 'signal:markdown' },
    { regex: /\bdescribe\b[\s\S]{0,40}?\b(payloads?|api|endpoints?|schema)\b/i, weight: 0.35, label: 'signal:describe-api' },
    { regex: /\bdraft\b[\s\S]{0,30}?\b(overview|doc|readme|guide)\b/i, weight: 0.40, label: 'signal:draft-doc' },
    { regex: /\binline comments?\b/i,                       weight: 0.45, label: 'signal:inline-comments' },
    { regex: /\bwrite\b[\s\S]{0,30}?\b(tutorial|guide|example|doc)/i, weight: 0.35, label: 'signal:write-guide' },
  ],

  dependency: [
    { regex: /\bupgrade\b/i,                                weight: 0.35, label: 'keyword:upgrade' },
    { regex: /\bmigrate\b/i,                                weight: 0.30, label: 'keyword:migrate' },
    { regex: /\bdependenc(y|ies)\b/i,                       weight: 0.40, label: 'keyword:dependency' },
    { regex: /\bpackage\b/i,                                weight: 0.25, label: 'keyword:package' },
    { regex: /\bvulnerab|CVE(s)?\b/i,                       weight: 0.45, label: 'signal:vulnerability' },
    { regex: /\boutdated\b/i,                               weight: 0.35, label: 'signal:outdated' },
    { regex: /\bbreaking changes?\b/i,                      weight: 0.30, label: 'signal:breaking-change' },
    { regex: /\bsecurity audit\b/i,                         weight: 0.40, label: 'signal:security-audit' },
    { regex: /\bReact\b|\bTypeScript\b|\bPrisma\b|\bNext\.js\b|\bExpress\b/, weight: 0.20, label: 'signal:package-name' },
    // npm / yarn / pnpm commands and common package operations
    { regex: /\bnpm (install|i|audit|update|outdated)\b/i,  weight: 0.50, label: 'signal:npm-cmd' },
    { regex: /\byarn (add|install|upgrade|audit)\b/i,       weight: 0.50, label: 'signal:yarn-cmd' },
    { regex: /\bpnpm (add|install|update)\b/i,              weight: 0.50, label: 'signal:pnpm-cmd' },
    { regex: /\binstall\b/i,                                weight: 0.35, label: 'keyword:install' },
    { regex: /\buninstall\b|\bremove\b/i,                   weight: 0.30, label: 'keyword:uninstall' },
    { regex: /\bbump\b/i,                                   weight: 0.45, label: 'keyword:bump' },
    { regex: /\bpin\b/i,                                    weight: 0.35, label: 'keyword:pin' },
    { regex: /\bdevDependenc(y|ies)\b/,                     weight: 0.50, label: 'signal:devDependency' },
    { regex: /\bswitch from\b[\s\S]{0,40}?\bto\b/i,         weight: 0.35, label: 'signal:switch-from' },
    { regex: /\bmove from\b[\s\S]{0,40}?\bto\b/i,           weight: 0.35, label: 'signal:move-from' },
    { regex: /\bmoment(\.js)?\b|\baxios\b|\blodash\b|\bzod\b|\bwebpack\b|\bvite\b|\byarn\b|\bpnpm\b|\beslint\b|\bprettier\b|\bbluebird\b|\bdate-fns\b/i, weight: 0.30, label: 'signal:lib-name' },
    { regex: /\b@types\/[\w-]+\b/,                          weight: 0.50, label: 'signal:types-pkg' },
    { regex: /\bnode_modules\b/,                            weight: 0.35, label: 'signal:node_modules' },
    { regex: /\bvulns?\b/i,                                 weight: 0.45, label: 'signal:vulns' },
  ],

  onboard: [
    { regex: /\bonboard(ed|ing)?\b/i,                       weight: 0.50, label: 'keyword:onboard' },
    { regex: /\bnew to\b/i,                                 weight: 0.35, label: 'keyword:new-to' },
    { regex: /\bunderstand\b/i,                             weight: 0.20, label: 'keyword:understand' },
    { regex: /\bhow does\b/i,                               weight: 0.20, label: 'keyword:how-does' },
    { regex: /\barchitecture\b/i,                           weight: 0.25, label: 'keyword:architecture' },
    { regex: /\bwhere do I start\b/i,                       weight: 0.40, label: 'keyword:where-start' },
    { regex: /\bwalk me through\b/i,                        weight: 0.40, label: 'signal:walk-through' },
    { regex: /\bexplain the project\b/i,                    weight: 0.45, label: 'signal:explain-project' },
    { regex: /\bstarter task\b|\bfirst task\b/i,            weight: 0.35, label: 'signal:starter-task' },
    { regex: /\bget up to speed\b/i,                        weight: 0.40, label: 'signal:up-to-speed' },
    { regex: /\bhow is\b/i,                                 weight: 0.25, label: 'keyword:how-is' },
    { regex: /\bstructured?\b/i,                            weight: 0.25, label: 'keyword:structured' },
    { regex: /\bresponsibilit/i,                            weight: 0.20, label: 'keyword:responsibilities' },
    { regex: /\bdescribe\b/i,                               weight: 0.25, label: 'keyword:describe' },
    { regex: /\bwhat (is|are|does)\b/i,                     weight: 0.20, label: 'keyword:what-is-are-does' },
    { regex: /\bgetting started\b/i,                        weight: 0.40, label: 'keyword:getting-started' },
    // Common onboarding phrasings
    { regex: /\btour\b/i,                                   weight: 0.40, label: 'keyword:tour' },
    { regex: /\bcodebase\b/i,                               weight: 0.20, label: 'keyword:codebase' },
    { regex: /\brun (this|the) project\b/i,                 weight: 0.40, label: 'signal:run-project' },
    { regex: /\brun (this|it) locally\b|\brun locally\b/i,  weight: 0.40, label: 'signal:run-locally' },
    { regex: /\bnew dev\b|\bnew hire\b|\bnew engineer\b|\bnew developer\b/i, weight: 0.45, label: 'signal:new-dev' },
    { regex: /\btech stack\b/i,                             weight: 0.45, label: 'signal:tech-stack' },
    { regex: /\bentry points?\b/i,                          weight: 0.45, label: 'signal:entry-points' },
    { regex: /\benv vars?\b|\benvironment variables?\b/i,   weight: 0.35, label: 'signal:env-vars' },
    { regex: /\bfirst day\b/i,                              weight: 0.45, label: 'signal:first-day' },
    { regex: /\bon the team\b/i,                            weight: 0.30, label: 'signal:on-the-team' },
    { regex: /\b(10|5|15)-minute overview\b/i,              weight: 0.45, label: 'signal:quick-overview' },
    { regex: /\boverview\b/i,                               weight: 0.20, label: 'keyword:overview' },
    { regex: /\bwhere (is|are)\b[\s\S]{0,60}?\b(defined|located|code|schema|config)\b/i, weight: 0.35, label: 'signal:where-is-defined' },
    { regex: /\bclone and run\b|\bhow (do|to) (i )?clone\b/i, weight: 0.45, label: 'signal:clone-run' },
    { regex: /\bshould I read\b|\bwhat.*read\b/i,           weight: 0.25, label: 'signal:what-read' },
    { regex: /\bsetup\b[\s\S]{0,20}?\b(new dev|new hire|project|dev)\b/i, weight: 0.40, label: 'signal:setup-dev' },
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
