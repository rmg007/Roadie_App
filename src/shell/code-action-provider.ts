import * as vscode from 'vscode';

export function extractSymbolName(document: vscode.TextDocument, range: vscode.Range): string | null {
  const DECL_RE = /(?:function\*?\s+|class\s+|interface\s+|(?:const|let|var)\s+|async\s+function\s+)(\w+)/;
  const startLine = range.start.line;
  for (let i = startLine; i >= Math.max(0, startLine - 5); i--) {
    const text = document.lineAt(i).text;
    const m = DECL_RE.exec(text);
    if (m) return m[1] ?? null;
  }
  return null;
}

export class RoadieCodeActionProvider implements vscode.CodeActionProvider {
  private buildAction(title: string, kind: vscode.CodeActionKind, query: string): vscode.CodeAction {
    const action = new vscode.CodeAction(title, kind);
    action.command = {
      command: 'roadie._openChat',
      arguments: [query],
      title,
    };
    action.isPreferred = false;
    return action;
  }

  provideCodeActions(
    document: vscode.TextDocument,
    range: vscode.Range,
    context: vscode.CodeActionContext,
  ): vscode.CodeAction[] {
    const langs = ['typescript', 'typescriptreact', 'javascript', 'javascriptreact'];
    if (!langs.includes(document.languageId)) return [];

    const symbol = extractSymbolName(document, range);
    if (!symbol) return [];

    const actions: vscode.CodeAction[] = [];

    actions.push(
      this.buildAction(
        'Roadie: Document this',
        vscode.CodeActionKind.RefactorRewrite,
        `@roadie /document ${symbol}`,
      ),
    );

    actions.push(
      this.buildAction(
        'Roadie: Review this',
        vscode.CodeActionKind.RefactorRewrite,
        `@roadie /review ${symbol}`,
      ),
    );

    if (context.diagnostics && context.diagnostics.length > 0) {
      actions.push(
        this.buildAction(
          'Roadie: Fix this',
          vscode.CodeActionKind.QuickFix,
          `@roadie /fix ${symbol}`,
        ),
      );
    }

    return actions;
  }
}
