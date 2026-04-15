import { describe, it, expect, vi } from 'vitest';

vi.mock('vscode', () => {
  const CodeActionKind = { QuickFix: 'quickfix', RefactorRewrite: 'refactor.rewrite' };
  function CodeAction(this: any, title: string, kind: any) {
    this.title = title;
    this.kind = kind;
    this.isPreferred = false;
    this.command = undefined;
  }
  return {
    CodeAction,
    CodeActionKind,
  };
});

import { extractSymbolName, RoadieCodeActionProvider } from './code-action-provider';

function makeDoc(lines: string[], languageId = 'typescript') {
  return {
    languageId,
    lineAt: (i: number) => ({ text: lines[i] ?? '' }),
  } as any;
}

describe('extractSymbolName', () => {
  it('finds function name', () => {
    const doc = makeDoc(['function foo() {', '  return 1;', '}']);
    const name = extractSymbolName(doc as any, { start: { line: 0 } } as any);
    expect(name).toBe('foo');
  });

  it('finds async function', () => {
    const doc = makeDoc(['async function handleRequest() {', ' }']);
    const name = extractSymbolName(doc as any, { start: { line: 0 } } as any);
    expect(name).toBe('handleRequest');
  });

  it('finds class name', () => {
    const doc = makeDoc(['class MyService {', ' }']);
    const name = extractSymbolName(doc as any, { start: { line: 0 } } as any);
    expect(name).toBe('MyService');
  });

  it('finds const identifier', () => {
    const doc = makeDoc(['const computeTotal = (a) => a;']);
    const name = extractSymbolName(doc as any, { start: { line: 0 } } as any);
    expect(name).toBe('computeTotal');
  });

  it('returns null when no symbol', () => {
    const doc = makeDoc(['// just a comment', 'console.log(1);']);
    const name = extractSymbolName(doc as any, { start: { line: 1 } } as any);
    expect(name).toBeNull();
  });
});

describe('RoadieCodeActionProvider.provideCodeActions', () => {
  it('returns Document and Review when no diagnostics', () => {
    const provider = new RoadieCodeActionProvider();
    const doc = makeDoc(['function foo() {}']);
    const actions = provider.provideCodeActions(doc as any, { start: { line: 0 } } as any, { diagnostics: [] } as any);
    expect(actions.length).toBe(2);
  });

  it('returns Document, Review and Fix when diagnostics present', () => {
    const provider = new RoadieCodeActionProvider();
    const doc = makeDoc(['function foo() {}']);
    const actions = provider.provideCodeActions(doc as any, { start: { line: 0 } } as any, { diagnostics: [{}] } as any);
    expect(actions.length).toBe(3);
  });

  it('returns empty for unknown symbol', () => {
    const provider = new RoadieCodeActionProvider();
    const doc = makeDoc(['console.log(1);']);
    const actions = provider.provideCodeActions(doc as any, { start: { line: 0 } } as any, { diagnostics: [] } as any);
    expect(actions.length).toBe(0);
  });

  it('queries contain correct @roadie prefixes', () => {
    const provider = new RoadieCodeActionProvider();
    const doc = makeDoc(['function FooBar() {}']);
    const actions = provider.provideCodeActions(doc as any, { start: { line: 0 } } as any, { diagnostics: [{}] } as any);
    const queries = actions.map((a: any) => a.command?.arguments?.[0]);
    expect(queries.some((q: string) => q.includes('@roadie /document'))).toBe(true);
    expect(queries.some((q: string) => q.includes('@roadie /review'))).toBe(true);
    expect(queries.some((q: string) => q.includes('@roadie /fix'))).toBe(true);
  });
});
