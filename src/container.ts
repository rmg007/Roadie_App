/**
 * @module container
 * @description Dependency injection container for the Roadie extension.
 *   The Container class doubles as a disposable tracker (used by extension.ts).
 * @inputs ContainerConfig, provider instances
 * @outputs Container with typed service accessors
 * @depends-on providers.ts, model/*, analyzer/*, engine/*, generator/*,
 *   learning/learning-database.ts
 * @depended-on-by extension.ts
 */

import * as path from 'node:path';
import type {
  ModelProvider,
  FileSystemProvider,
  ConfigProvider,
} from './providers';
import type { ProjectModel } from './types';
import { InMemoryProjectModel } from './model/project-model';
import { ProjectAnalyzer } from './analyzer/project-analyzer';
import { FileGenerator } from './generator/file-generator';

// =====================================================================
// Config
// =====================================================================

export interface ContainerConfig {
  projectRoot: string;
  dbPath?: string;
}

// =====================================================================
// Services interface (used by MCP server)
// =====================================================================

export interface ContainerServices {
  projectRoot: string;
  projectModel: ProjectModel;
  projectAnalyzer: ProjectAnalyzer;
  fileGenerator: FileGenerator;
  modelProvider: ModelProvider;
  fileSystemProvider: FileSystemProvider;
  configProvider: ConfigProvider;
}

// =====================================================================
// Container class — disposable tracker + optional services holder
// =====================================================================

export class Container {
  private readonly disposables: Array<{ dispose(): void }> = [];
  public readonly services: ContainerServices | undefined;

  constructor(services?: ContainerServices) {
    this.services = services;
  }

  /**
   * Track a disposable resource.
   * All tracked resources are disposed when the container is disposed.
   */
  register<T extends { dispose(): void }>(disposable: T): T {
    this.disposables.push(disposable);
    return disposable;
  }

  /**
   * Dispose all registered resources.
   */
  dispose(): void {
    for (const d of this.disposables) {
      d.dispose();
    }
    this.disposables.length = 0;
  }
}

// =====================================================================
// createContainer — factory for VS Code extension mode
// =====================================================================

/**
 * Create a container wired for extension mode (VS Code providers).
 */
export async function createContainer(
  config: ContainerConfig,
): Promise<Container> {
  const projectRoot = config.projectRoot;
  const dbPath = config.dbPath ?? path.join(projectRoot, '.github', '.roadie', 'project-model.db');

  let roadieDb = null;
  let learningDb = null;

  // Attempt SQLite initialization (fault-tolerant)
  try {
    const { RoadieDatabase } = await import('./model/database.js');
    const { LearningDatabase } = await import('./learning/learning-database.js');

    roadieDb = new RoadieDatabase(dbPath);
    learningDb = new LearningDatabase();
    learningDb.initialize(roadieDb.getRawDb(), { workflowHistory: false });
  } catch {
    roadieDb = null;
    learningDb = null;
  }

  const projectModel = new InMemoryProjectModel(roadieDb);
  const projectAnalyzer = new ProjectAnalyzer(projectModel);

  const { VSCodeModelProvider, VSCodeFileSystemProvider, VSCodeConfigProvider } =
    await import('./shell/vscode-providers.js');
  const modelProvider: ModelProvider = new VSCodeModelProvider();
  const fileSystemProvider: FileSystemProvider = new VSCodeFileSystemProvider([]);
  const configProvider: ConfigProvider = new VSCodeConfigProvider();

  const fileGenerator = new FileGenerator(projectRoot, learningDb ?? undefined, fileSystemProvider);

  const services: ContainerServices = {
    projectRoot,
    projectModel,
    projectAnalyzer,
    fileGenerator,
    modelProvider,
    fileSystemProvider,
    configProvider,
  };

  return new Container(services);
}
