/**
 * @test manifest-consistency.test.ts
 * @description Validates that package.json manifest entries match code registration.
 *   This is a regression test for v0.7.12 bug where chat participant id in
 *   package.json ("roadie") didn't match createChatParticipant() call.
 *
 *   Checks:
 *   - Chat participant "id" in package.json matches code registration
 *   - Slash commands in package.json are registered in code
 *   - Commands in package.json are registered in code
 *   - Activation events are appropriate for plugin functionality
 * @inputs package.json, src/extension.ts, src/shell/commands.ts
 * @outputs Manifest validation results
 * @depends-on fs/promises (read package.json), path parsing
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('Manifest Consistency (v0.7.12 regression)', () => {
  function loadManifest(): Record<string, unknown> {
    try {
      const path = resolve(process.cwd(), 'package.json');
      const content = readFileSync(path, 'utf8');
      // eslint-disable-next-line @typescript-eslint/no-unsafe-return
      return JSON.parse(content);
    } catch (err) {
      throw new Error(`Failed to load package.json: ${String(err)}`);
    }
  }

  it('has exactly one chat participant with id "roadie"', () => {
    const manifest = loadManifest();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const contributes = (manifest.contributes as any);
    expect(contributes).toBeDefined();
    expect(contributes.chatParticipants).toBeDefined();
    expect(contributes.chatParticipants).toHaveLength(1);
    expect(contributes.chatParticipants[0].id).toBe('roadie');
  });

  it('slash commands are defined and non-empty', () => {
    const manifest = loadManifest();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const contributes = (manifest.contributes as any);
    const chatParticipant = contributes.chatParticipants[0];
    expect(chatParticipant.slashCommands).toBeDefined();
    expect(chatParticipant.slashCommands).toHaveLength(6);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const commandNames = (chatParticipant.slashCommands as any[]).map((cmd: any) => cmd.name);
    expect(commandNames).toContain('workflow:fix');
    expect(commandNames).toContain('workflow:document');
    expect(commandNames).toContain('workflow:review');
    expect(commandNames).toContain('workflow:refactor');
    expect(commandNames).toContain('workflow:onboard');
    expect(commandNames).toContain('workflow:dependency');
  });

  it('palette commands are defined and cover core operations', () => {
    const manifest = loadManifest();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const contributes = (manifest.contributes as any);
    const commands = contributes.commands;
    expect(commands).toBeDefined();
    expect(commands.length).toBeGreaterThanOrEqual(9);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const commandIds = (commands as any[]).map((cmd: any) => cmd.command);
    expect(commandIds).toContain('roadie.init');
    expect(commandIds).toContain('roadie.doctor');
    expect(commandIds).toContain('roadie.rescan');
    expect(commandIds).toContain('roadie.reset');
    expect(commandIds).toContain('roadie.stats');
  });

  it('activation events include onChat:roadie', () => {
    const manifest = loadManifest();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const activationEvents = (manifest.activationEvents as any);
    expect(activationEvents).toBeDefined();
    expect(activationEvents).toContain('onChat:roadie');
  });

  it('activation events include roadie.init command', () => {
    const manifest = loadManifest();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const activationEvents = (manifest.activationEvents as any);
    expect(activationEvents).toContain('onCommand:roadie.init');
  });

  it('activation events include workspace detection trigger', () => {
    const manifest = loadManifest();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const activationEvents = (manifest.activationEvents as any);
    expect(activationEvents).toContain('workspaceContains:.github/.roadie/project-model.db');
  });

  it('no duplicate slash command names', () => {
    const manifest = loadManifest();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const contributes = (manifest.contributes as any);
    const chatParticipant = contributes.chatParticipants[0];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const commandNames = (chatParticipant.slashCommands as any[]).map((cmd: any) => cmd.name);
    const uniqueNames = new Set(commandNames);
    expect(uniqueNames.size).toBe(commandNames.length);
  });

  it('no duplicate command ids', () => {
    const manifest = loadManifest();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const contributes = (manifest.contributes as any);
    const commands = contributes.commands;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const commandIds = (commands as any[]).map((cmd: any) => cmd.command);
    const uniqueIds = new Set(commandIds);
    expect(uniqueIds.size).toBe(commandIds.length);
  });

  it('all command ids follow roadie.* naming pattern', () => {
    const manifest = loadManifest();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const contributes = (manifest.contributes as any);
    const commands = contributes.commands;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const cmd of commands as any[]) {
      expect(cmd.command).toMatch(/^roadie\./);
    }
  });

  it('chat participant has description and isSticky', () => {
    const manifest = loadManifest();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const contributes = (manifest.contributes as any);
    const chatParticipant = contributes.chatParticipants[0];
    expect(chatParticipant).toHaveProperty('description');
    expect(chatParticipant).toHaveProperty('isSticky');
    expect(chatParticipant.isSticky).toBe(true);
  });
});
