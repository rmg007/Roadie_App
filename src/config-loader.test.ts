import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { getConfig, getRuntimeMode, initializeConfig, resetConfig } from './config-loader';

describe('config-loader', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'roadie-config-test-'));
    resetConfig();
    delete process.env.ROADIE_DRY_RUN;
    delete process.env.ROADIE_SAFE_MODE;
  });

  afterEach(async () => {
    resetConfig();
    delete process.env.ROADIE_DRY_RUN;
    delete process.env.ROADIE_SAFE_MODE;
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('loads config from the provided project root', async () => {
    const roadieDir = path.join(tmpDir, '.roadie');
    await fs.mkdir(roadieDir, { recursive: true });
    await fs.writeFile(path.join(roadieDir, 'config.json'), JSON.stringify({ dryRun: true }), 'utf8');

    const config = initializeConfig(tmpDir);
    expect(config.dryRun).toBe(true);
    expect(getConfig(tmpDir).dryRun).toBe(true);
  });

  it('applies env overrides over file config', async () => {
    const roadieDir = path.join(tmpDir, '.roadie');
    await fs.mkdir(roadieDir, { recursive: true });
    await fs.writeFile(path.join(roadieDir, 'config.json'), JSON.stringify({ dryRun: false, safeMode: false }), 'utf8');
    process.env.ROADIE_DRY_RUN = '1';
    process.env.ROADIE_SAFE_MODE = 'true';

    const config = initializeConfig(tmpDir);
    expect(config.dryRun).toBe(true);
    expect(config.safeMode).toBe(true);
    expect(getRuntimeMode(tmpDir)).toEqual({ dryRun: true, safeMode: true });
  });
});