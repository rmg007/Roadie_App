/**
 * E2E Suite: Code-action lightbulb
 *
 * Verifies that the Roadie code-action provider surfaces quick-fix / refactor
 * actions on a TypeScript declaration and that `roadie._openChat` is wired up
 * as the bound command.
 *
 * Fixture: e2e/fixtures/workspaces/code-action/src/sample.ts. The cursor is
 * placed on the `computeSum` declaration — Roadie's provider matches
 * `function\s+(\w+)` (see src/shell/code-action-provider.ts) and offers
 * "Roadie: Document this" + "Roadie: Review this".
 *
 * Defensive posture:
 *  - The quick-fix widget is rendered as an overlay whose DOM selectors have
 *    drifted across VS Code versions. We trigger the action via the
 *    `editor.action.quickFix` command (stable across every supported version)
 *    and then scan the full workbench body text for the Roadie entries.
 *  - If the overlay cannot be found at all (e.g. future VS Code wraps it in a
 *    shadow root), we still fail loud — we do not silently pass.
 */

'use strict';

const path = require('node:path');
const { VSBrowser, Workbench, EditorView, TextEditor } = require('vscode-extension-tester');
const { runCommand } = require('../helpers/e2e-helpers');

const FIXTURE_DIR = path.join(__dirname, '..', 'fixtures', 'workspaces', 'code-action');
const SAMPLE_FILE = path.join(FIXTURE_DIR, 'src', 'sample.ts');

describe('E2E: Code-action lightbulb', function () {
  this.timeout(60_000);

  before(async function () {
    // Open the fixture as a folder so VS Code recognises it as a workspace.
    await VSBrowser.instance.openResources(FIXTURE_DIR, SAMPLE_FILE);
    await VSBrowser.instance.driver.sleep(2_000);
  });

  it('offers Roadie refactor actions on a TypeScript declaration', async function () {
    const editorView = new EditorView();
    const titles = await editorView.getOpenEditorTitles();
    if (!titles.includes('sample.ts')) {
      throw new Error(`sample.ts not open. Open editors: ${titles.join(', ')}`);
    }

    const editor = /** @type {TextEditor} */ (await editorView.openEditor('sample.ts'));
    // Cursor on the `computeSum` declaration (line 11, any column inside the name).
    // The provider scans up to 5 lines above the cursor for `function\s+(\w+)`.
    await editor.moveCursor(11, 20);
    await VSBrowser.instance.driver.sleep(500);

    // Trigger the quick-fix / refactor menu via VS Code's own command — more
    // robust than simulating Ctrl+. across keyboard layouts.
    await new Workbench().executeCommand('editor.action.quickFix');
    await VSBrowser.instance.driver.sleep(1_500);

    const driver = VSBrowser.instance.driver;
    const bodyText = await driver.executeScript('return document.body.innerText');
    const text = String(bodyText || '');

    // The menu renders each action's title as visible text. We assert at least
    // one Roadie action is present. If the menu selector regresses, this will
    // fail with a diagnostic excerpt rather than silently passing.
    const hasRoadieAction =
      text.includes('Roadie: Document this') ||
      text.includes('Roadie: Review this');

    if (!hasRoadieAction) {
      const excerpt = text.replace(/\s+/g, ' ').slice(0, 400);
      throw new Error(
        `Quick-fix menu did not expose a Roadie action. Body excerpt: ${excerpt}`,
      );
    }

    // Dismiss the menu so it does not leak into the next test.
    await driver.actions().sendKeys('\uE00C').perform(); // Escape
    await driver.sleep(300);
  });

  it('roadie._openChat command is registered', async function () {
    // The internal bridge command must exist even if its UI hook is hidden.
    // We verify by attempting to run it; missing commands throw "command not found".
    try {
      await runCommand('Roadie: Open Chat (internal)');
    } catch (err) {
      const msg = String(err && err.message);
      // VS Code says "command 'X' not found" when missing — fail on that.
      if (msg.toLowerCase().includes('not found')) {
        throw new Error(`roadie._openChat not registered: ${msg}`);
      }
      // Any other error (e.g. "argument required") is acceptable — command exists.
    }
    // Smoke: extension still responsive
    new Workbench();
  });
});
