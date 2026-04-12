import { describe, it, expect } from 'vitest';
import { classifyChange, isIgnoredPath } from './change-classifier';

// =====================================================================
// classifyChange — Dependency files
// =====================================================================

describe('classifyChange — dependency files', () => {
  const dependencyFiles = [
    'package.json',
    'package-lock.json',
    'yarn.lock',
    'pnpm-lock.yaml',
    'go.mod',
    'go.sum',
    'Cargo.toml',
    'Cargo.lock',
    'requirements.txt',
    'Pipfile',
    'Pipfile.lock',
    'poetry.lock',
    'pyproject.toml',
    'Gemfile',
    'Gemfile.lock',
    'composer.json',
    'composer.lock',
  ];

  for (const file of dependencyFiles) {
    it(`classifies ${file} as DEPENDENCY_CHANGE with HIGH priority`, () => {
      const result = classifyChange(file, 'change');
      expect(result.type).toBe('DEPENDENCY_CHANGE');
      expect(result.priority).toBe('HIGH');
      expect(result.triggers).toContain('dependency-updater');
    });
  }

  it('classifies nested dependency file (src/backend/package.json)', () => {
    const result = classifyChange('src/backend/package.json', 'change');
    expect(result.type).toBe('DEPENDENCY_CHANGE');
    expect(result.priority).toBe('HIGH');
  });

  it('classifies dependency files on all event types', () => {
    for (const eventType of ['create', 'change', 'delete'] as const) {
      const result = classifyChange('package.json', eventType);
      expect(result.type).toBe('DEPENDENCY_CHANGE');
    }
  });
});

// =====================================================================
// classifyChange — Config files
// =====================================================================

describe('classifyChange — config files', () => {
  const configFiles = [
    'tsconfig.json',
    'tsconfig.build.json',
    'jest.config.ts',
    'jest.config.js',
    'vitest.config.ts',
    'vitest.config.mts',
    'eslint.config.js',
    'eslint.config.mjs',
    'webpack.config.js',
    'vite.config.ts',
    '.babelrc',
    '.babelrc.json',
    '.eslintrc',
    '.eslintrc.json',
    '.prettierrc',
    '.prettierrc.yaml',
    'rollup.config.js',
  ];

  for (const file of configFiles) {
    it(`classifies ${file} as CONFIG_CHANGE with MEDIUM priority`, () => {
      const result = classifyChange(file, 'change');
      expect(result.type).toBe('CONFIG_CHANGE');
      expect(result.priority).toBe('MEDIUM');
      expect(result.triggers).toContain('config-updater');
    });
  }
});

// =====================================================================
// classifyChange — GitHub / Copilot generated files
// =====================================================================

describe('classifyChange — GitHub generated files', () => {
  const githubFiles = [
    '.github/copilot-instructions.md',
    '.github/copilot-setup.md',
    '.github/agents/reviewer.yaml',
    '.github/skills/code-review.md',
  ];

  for (const file of githubFiles) {
    it(`classifies ${file} as USER_EDIT with MEDIUM priority`, () => {
      const result = classifyChange(file, 'change');
      expect(result.type).toBe('USER_EDIT');
      expect(result.priority).toBe('MEDIUM');
      expect(result.triggers).toContain('copilot-instructions-updater');
    });
  }
});

// =====================================================================
// classifyChange — Source additions (create only)
// =====================================================================

describe('classifyChange — source file creation', () => {
  const sourceFiles = [
    'src/index.ts',
    'lib/utils.js',
    'components/App.tsx',
    'pages/Home.jsx',
    'main.py',
    'cmd/server.go',
    'src/lib.rs',
  ];

  for (const file of sourceFiles) {
    it(`classifies new ${file} as SOURCE_ADDITION`, () => {
      const result = classifyChange(file, 'create');
      expect(result.type).toBe('SOURCE_ADDITION');
      expect(result.priority).toBe('LOW');
      expect(result.triggers).toContain('structure-updater');
    });
  }

  it('classifies modified source file as OTHER (not SOURCE_ADDITION)', () => {
    const result = classifyChange('src/index.ts', 'change');
    expect(result.type).toBe('OTHER');
  });

  it('classifies deleted source file as OTHER (not SOURCE_ADDITION)', () => {
    const result = classifyChange('src/index.ts', 'delete');
    expect(result.type).toBe('OTHER');
  });
});

// =====================================================================
// classifyChange — Other / unknown files
// =====================================================================

describe('classifyChange — other files', () => {
  it('classifies README.md as OTHER', () => {
    const result = classifyChange('README.md', 'change');
    expect(result.type).toBe('OTHER');
    expect(result.priority).toBe('LOW');
    expect(result.triggers).toEqual([]);
  });

  it('classifies a random data file as OTHER', () => {
    const result = classifyChange('data/users.csv', 'create');
    expect(result.type).toBe('OTHER');
  });

  it('classifies an image as OTHER', () => {
    const result = classifyChange('public/logo.png', 'change');
    expect(result.type).toBe('OTHER');
  });
});

// =====================================================================
// classifyChange — Windows path normalization
// =====================================================================

describe('classifyChange — path normalization', () => {
  it('handles Windows-style backslash paths', () => {
    const result = classifyChange('src\\backend\\package.json', 'change');
    expect(result.type).toBe('DEPENDENCY_CHANGE');
  });

  it('handles Windows-style GitHub paths', () => {
    const result = classifyChange('.github\\copilot-instructions.md', 'change');
    expect(result.type).toBe('USER_EDIT');
  });
});

// =====================================================================
// isIgnoredPath
// =====================================================================

describe('isIgnoredPath', () => {
  const ignoredPaths = [
    'node_modules/lodash/index.js',
    '.git/HEAD',
    'dist/bundle.js',
    'build/output.js',
    'out/compiled.js',
    '.next/cache/file.json',
    '.cache/some-tool/data',
    '.vscode/settings.json',
    '.idea/workspace.xml',
    'vendor/autoload.php',
    'venv/lib/python3.11/site.py',
    '.venv/bin/activate',
    'src/node_modules/pkg/index.js',
  ];

  for (const p of ignoredPaths) {
    it(`ignores ${p}`, () => {
      expect(isIgnoredPath(p)).toBe(true);
    });
  }

  const allowedPaths = [
    'src/index.ts',
    'package.json',
    'lib/utils.js',
    'test/helpers.ts',
    '.github/copilot-instructions.md',
  ];

  for (const p of allowedPaths) {
    it(`does NOT ignore ${p}`, () => {
      expect(isIgnoredPath(p)).toBe(false);
    });
  }

  it('handles Windows backslash paths in ignored check', () => {
    expect(isIgnoredPath('project\\node_modules\\pkg\\index.js')).toBe(true);
  });
});
