/**
 * Public API surface for Roadie v1.0.
 * Everything exported here is semver-stable.
 * Everything NOT exported here is @internal and subject to change.
 *
 * @public
 */

// Intent classification — stable public API
// ClassificationResult is defined in types.ts; IntentClassifier class is in classifier/intent-classifier.ts
export type { ClassificationResult } from '../types';
export { IntentClassifier } from '../classifier/intent-classifier';

// Error taxonomy — stable public API
export { RoadieError } from '../shell/errors';

// Telemetry reporter — stable public API (for extension contributors)
// TelemetryReporter is a class; export the type for extension contributors who want to type-check their usage
export { TelemetryReporter } from '../shell/telemetry';
