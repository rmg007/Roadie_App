import * as fs from 'node:fs';
import * as path from 'node:path';
import Ajv2020 from 'ajv/dist/2020';
import addFormats from 'ajv-formats';

export interface ScenarioValidationError {
  filePath: string;
  message: string;
}

export function getScenarioFiles(baseDir: string): string[] {
  return fs
    .readdirSync(baseDir)
    .filter((name) => name.endsWith('.json') && name !== 'schema.json')
    .map((name) => path.join(baseDir, name));
}

export function validateScenarioDirectory(baseDir: string): ScenarioValidationError[] {
  const schemaPath = path.join(baseDir, 'schema.json');
  const schema = readJson(schemaPath);

  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);
  const validate = ajv.compile(schema);

  const files = getScenarioFiles(baseDir);

  const errors: ScenarioValidationError[] = [];
  for (const filePath of files) {
    const scenario = readJson(filePath);
    const valid = validate(scenario);
    if (!valid) {
      for (const err of validate.errors ?? []) {
        const instancePath = err.instancePath || '/';
        errors.push({
          filePath,
          message: `${instancePath} ${err.message ?? 'invalid scenario'}`,
        });
      }
      continue;
    }

    const expectedId = path.basename(filePath, '.json');
    if (scenario.id !== expectedId) {
      errors.push({
        filePath,
        message: `/id must match filename: expected "${expectedId}", got "${scenario.id}"`,
      });
    }
  }

  return errors;
}

export function validateScenarioFile(baseDir: string, filePath: string): ScenarioValidationError[] {
  const schemaPath = path.join(baseDir, 'schema.json');
  const schema = readJson(schemaPath);

  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);
  const validate = ajv.compile(schema);

  const scenario = readJson(filePath);
  const errors: ScenarioValidationError[] = [];

  const valid = validate(scenario);
  if (!valid) {
    for (const err of validate.errors ?? []) {
      const instancePath = err.instancePath || '/';
      errors.push({
        filePath,
        message: `${instancePath} ${err.message ?? 'invalid scenario'}`,
      });
    }
    return errors;
  }

  const expectedId = path.basename(filePath, '.json');
  if (scenario.id !== expectedId) {
    errors.push({
      filePath,
      message: `/id must match filename: expected "${expectedId}", got "${scenario.id}"`,
    });
  }

  return errors;
}

function readJson(filePath: string): any {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}
