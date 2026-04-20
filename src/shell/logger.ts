/**
 * @module shell/logger
 * @description Module-level logger singleton for shell utilities.
 *   Returns the shared STUB_LOGGER instance so that tests can spy on it.
 */

import type { Logger } from '../platform-adapters';
import { STUB_LOGGER } from '../platform-adapters';

/**
 * Returns the module-level logger instance.
 * Tests can spy on the returned object's methods.
 */
export function getLogger(): Logger {
  return STUB_LOGGER;
}
