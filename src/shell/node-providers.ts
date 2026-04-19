import * as fs from 'node:fs/promises';
import { FileSystemProvider, ConfigProvider } from '../providers';

/** Standard Node.js implementation of file operations */
export class NodeFileSystemProvider implements FileSystemProvider {
  isFileOpenInEditor(): boolean {
    return false; // Not applicable in standalone mode
  }

  async readFile(filePath: string): Promise<string> {
    return await fs.readFile(filePath, 'utf8');
  }

  async writeFile(filePath: string, content: string): Promise<void> {
    await fs.writeFile(filePath, content, 'utf8');
  }

  async fileExists(filePath: string): Promise<boolean> {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }
}

/** Simple config provider for standalone mode */
export class NodeConfigProvider implements ConfigProvider {
  get<T>(_key: string, defaultValue: T): T {
    return defaultValue;
  }
}
