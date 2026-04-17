/**
 * @module error-reporter
 * @description Global error boundary for Roadie activation and deactivation,
 *   plus process-level unhandled rejection/exception traps.
 *
 *   Activation throws are caught, logged with stack, and surfaced with a
 *   user notification including "Copy diagnostics" and "Disable Roadie" actions.
 *   Deactivation errors are logged, not silently swallowed.
 *   Process-level handlers ensure no error is silently lost.
 *
 * @inputs Error objects, execution context
 * @outputs Logged errors, user notifications
 * @depends-on vscode (lazy-loaded), shell/logger
 * @depended-on-by extension.ts
 */

import type { ExtensionContext } from 'vscode';
import { getLogger } from './logger';

/**
 * Wraps an async activation function with a global error boundary.
 * On throw: logs the error + stack, shows a user notification with
 * "Copy diagnostics" and "Disable Roadie" actions.
 *
 * Usage in extension.ts:
 *   export async function activate(context: vscode.ExtensionContext): Promise<void> {
 *     return errorReporter.wrapActivation(context, async () => {
 *       // ... existing activation code ...
 *     });
 *   }
 */
export async function wrapActivation(
  context: ExtensionContext,
  fn: () => Promise<void>,
): Promise<void> {
  try {
    await fn();
  } catch (err: unknown) {
    const error = err instanceof Error ? err : new Error(String(err));
    const logger = getLogger();

    logger.error('Activation failed', error);

    // Lazy require vscode only if needed (when an error occurs)
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const vscode = require('vscode');

    // Build a user-friendly message with copy-to-clipboard and disable actions
    const message =
      'Roadie activation failed. ' +
      'Click "Copy diagnostics" to share error details, or "Disable Roadie" to deactivate.';

    const copyAction = 'Copy diagnostics';
    const disableAction = 'Disable Roadie';

    const result = await vscode.window.showErrorMessage(message, copyAction, disableAction);

    if (result === copyAction) {
      const diagnostics = `
Roadie Activation Error
=======================

Version: ${context.extension.packageJSON.version}
VS Code: ${vscode.version}
Platform: ${process.platform}
Node: ${process.version}

Error Message:
${error.message}

Stack Trace:
${error.stack}

Time: ${new Date().toISOString()}
`;
      await vscode.env.clipboard.writeText(diagnostics);
      void vscode.window.showInformationMessage('Diagnostics copied to clipboard');
    } else if (result === disableAction) {
      await vscode.commands.executeCommand('workbench.extensions.action.disableExtension', context.extension.id);
    }

    // Re-throw so VS Code can also log it in the extension host
    throw error;
  }
}

/**
 * Wraps a deactivation function.
 * On throw: logs the error (does not swallow it).
 * Does NOT show a user notification — deactivation failures are typically
 * best-effort cleanup and less urgent than activation failures.
 */
export function wrapDeactivation(fn: () => void): void {
  try {
    fn();
  } catch (err: unknown) {
    const error = err instanceof Error ? err : new Error(String(err));
    getLogger().error('Deactivation error', error);
    // Re-throw so VS Code can log it
    throw error;
  }
}

/**
 * Installs process-level handlers for uncaught exceptions and unhandled rejections.
 * Called once during activation; removed during deactivation.
 *
 * Usage in extension.ts activate():
 *   errorReporter.installGlobalHandlers();
 *
 * Usage in extension.ts deactivate():
 *   errorReporter.uninstallGlobalHandlers();
 */
const globalHandlers = {
  uncaughtException: (err: Error) => {
    getLogger().error('Uncaught exception (process-level)', err);
  },
  unhandledRejection: (reason: unknown) => {
    const error = reason instanceof Error ? reason : new Error(String(reason));
    getLogger().error('Unhandled rejection (process-level)', error);
  },
};

export function installGlobalHandlers(): void {
  process.on('uncaughtException', globalHandlers.uncaughtException);
  process.on('unhandledRejection', globalHandlers.unhandledRejection);
  getLogger().debug('[ErrorReporter] Global handlers installed');
}

export function uninstallGlobalHandlers(): void {
  process.off('uncaughtException', globalHandlers.uncaughtException);
  process.off('unhandledRejection', globalHandlers.unhandledRejection);
  getLogger().debug('[ErrorReporter] Global handlers removed');
}
