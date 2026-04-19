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
import type { Logger } from './platform-adapters';
import { STUB_LOGGER } from './platform-adapters';

// =====================================================================
// Config
// =====================================================================

export interface ContainerConfig {
  projectRoot: string;
  dbPath?: string;
  globalDbPath?: string;
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
// createMCPContainer — factory for MCP server mode
// =====================================================================

import { RoadieDatabase } from './model/database';
import { LearningDatabase } from './learning/learning-database';
import { NodeFileSystemProvider, NodeConfigProvider } from './shell/node-providers';

// =====================================================================
// createMCPContainer — factory for MCP server mode
// =====================================================================

/**
 * Create a container wired for MCP server mode (Node.js providers).
 */
export async function createMCPContainer(
  config: ContainerConfig,
  log: Logger = STUB_LOGGER,
  modelProvider?: ModelProvider, // Optional, can be injected by MCP server
): Promise<Container> {
  const projectRoot = config.projectRoot;
  const dbPath = config.dbPath ?? path.join(projectRoot, '.github', '.roadie', 'project-model.db');

  let roadieDb = null;
  let learningDb = null;
  let globalRoadieDb = null;

  // Attempt SQLite initialization (fault-tolerant & autonomous learning enabled)
  try {
    roadieDb = new RoadieDatabase(dbPath);
    if (config.globalDbPath) {
      globalRoadieDb = new RoadieDatabase(config.globalDbPath);
    }

    learningDb = new LearningDatabase();
    // Enable workflowHistory and editTracking for 'learn and grow' capability
    learningDb.initialize(
      roadieDb.getRawDb(), 
      { workflowHistory: true }, 
      dbPath, 
      log, 
      globalRoadieDb?.getRawDb() ?? undefined
    );
    log.info('Learning engine initialized and autonomous logging active (Syncing with Global Brain).');
  } catch (err) {
    log.error('Learning engine failed to initialize.', err);
    roadieDb = null;
    learningDb = null;
  }

  const projectModel = new InMemoryProjectModel(roadieDb);
  const projectAnalyzer = new ProjectAnalyzer(projectModel, undefined, learningDb ?? undefined, log);

  const fsProvider: FileSystemProvider = new NodeFileSystemProvider();
  const cfgProvider: ConfigProvider = new NodeConfigProvider();

  const fileGenerator = new FileGenerator(projectRoot, learningDb ?? undefined, fsProvider, log);

  const services: ContainerServices = {
    projectRoot,
    projectModel,
    projectAnalyzer,
    fileGenerator,
    modelProvider: modelProvider!, // Should be provided if model calls are needed
    fileSystemProvider: fsProvider,
    configProvider: cfgProvider,
  };

  return new Container(services);
}
