// Fixture file for the Roadie code-action E2E suite.
//
// The Roadie CodeActionProvider (see src/shell/code-action-provider.ts) offers
// a quick-fix / refactor action whenever the cursor is on a declaration of a
// function, class, interface, or const/let/var binding. The symbol name is
// extracted by scanning up to 5 lines above the cursor.
//
// Tests place the cursor on `computeSum` below and expect the
// "Roadie: Document this" and "Roadie: Review this" actions to appear in the
// quick-fix menu (Ctrl+.).
export function computeSum(a: number, b: number): number {
  return a + b;
}

export class Calculator {
  add(a: number, b: number): number {
    return computeSum(a, b);
  }
}
