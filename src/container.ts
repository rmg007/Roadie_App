/**
 * @module container
 * @description Dependency injection container for the Roadie extension.
 *   Holds references to all core services. Empty in Step 2 — services
 *   are registered as subsequent build steps introduce them.
 * @inputs Service instances from activate()
 * @outputs Typed service accessors for all modules
 * @depends-on vscode (Disposable)
 * @depended-on-by extension.ts
 */

import * as vscode from 'vscode';

export class Container implements vscode.Disposable {
  private readonly disposables: vscode.Disposable[] = [];

  /**
   * Track a disposable resource (chat participant, status bar item, watcher, etc.).
   * All tracked resources are disposed when the container is disposed.
   */
  register<T extends vscode.Disposable>(disposable: T): T {
    this.disposables.push(disposable);
    return disposable;
  }

  /**
   * Dispose all registered resources. Called by VS Code during deactivation.
   */
  dispose(): void {
    for (const d of this.disposables) {
      d.dispose();
    }
    this.disposables.length = 0;
  }
}
