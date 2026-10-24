// The VS Code glue. Everything that can be tested lives in core.ts; this file only connects it to the editor.
import * as vscode from 'vscode';

import { cost, diagnose, lensText, type Costs } from './core.js';

const LANGS = new Set(['rev', 'rvm-asm']);

export function activate(context: vscode.ExtensionContext): void {
  const diagnostics = vscode.languages.createDiagnosticCollection('rev');
  const output = vscode.window.createOutputChannel('rev cost report');
  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 10);
  const lens = vscode.window.createTextEditorDecorationType({
    after: { margin: '0 0 0 2em', color: new vscode.ThemeColor('editorCodeLens.foreground'), fontStyle: 'italic' },
  });
  const costs = new Map<string, Costs>();
  const timers = new Map<string, NodeJS.Timeout>();

  const toVs = (doc: vscode.TextDocument, ds: ReturnType<typeof diagnose>): vscode.Diagnostic[] =>
    ds.map((d) => {
      const line = Math.min(Math.max(d.line, 1), doc.lineCount) - 1;
      const range = doc.lineAt(line).range;
      const v = new vscode.Diagnostic(range, d.message, d.severity === 'error' ? vscode.DiagnosticSeverity.Error : vscode.DiagnosticSeverity.Warning);
      v.source = doc.languageId;
      return v;
    });

  const check = (doc: vscode.TextDocument): void => {
    if (!LANGS.has(doc.languageId)) return;
    diagnostics.set(doc.uri, toVs(doc, diagnose(doc.languageId as 'rev' | 'rvm-asm', doc.getText())));
  };

  const paint = (editor: vscode.TextEditor | undefined): void => {
    if (!editor || editor.document.languageId !== 'rev') return;
    const c = costs.get(editor.document.uri.toString());
    if (!c) { editor.setDecorations(lens, []); return; }
    const opts: vscode.DecorationOptions[] = c.lines
      .filter((l) => l.line <= editor.document.lineCount)
      .map((l) => ({
        range: editor.document.lineAt(l.line - 1).range,
        renderOptions: { after: { contentText: lensText(l) } },
      }));
    editor.setDecorations(lens, opts);
    status.text = c.summary;
    status.tooltip = 'Click for the full cost report';
    status.command = 'rev.showReport';
    status.show();
  };

  const runCost = async (doc: vscode.TextDocument): Promise<void> => {
    if (doc.languageId !== 'rev') return;
    const max = vscode.workspace.getConfiguration('rev').get<number>('maxSteps', 400000);
    status.text = 'rev: running...';
    status.show();
    try {
      const c = await cost(doc.getText(), max);
      costs.set(doc.uri.toString(), c);
      if (c.diagnostics.length) diagnostics.set(doc.uri, toVs(doc, c.diagnostics));
      output.clear();
      output.appendLine(c.report);
      for (const e of vscode.window.visibleTextEditors) if (e.document === doc) paint(e);
      status.text = c.summary;
    } catch (e) {
      status.text = 'rev: cost run failed';
      output.appendLine(String((e as Error).stack ?? e));
    }
  };

  context.subscriptions.push(
    diagnostics, output, status, lens,
    vscode.workspace.onDidOpenTextDocument((d) => { check(d); if (d.languageId === 'rev' && vscode.workspace.getConfiguration('rev').get('costOnSave', true)) void runCost(d); }),
    vscode.workspace.onDidChangeTextDocument((e) => {
      const key = e.document.uri.toString();
      clearTimeout(timers.get(key));
      timers.set(key, setTimeout(() => { check(e.document); costs.delete(key); paint(vscode.window.activeTextEditor); }, 250));
    }),
    vscode.workspace.onDidSaveTextDocument((d) => { if (d.languageId === 'rev' && vscode.workspace.getConfiguration('rev').get('costOnSave', true)) void runCost(d); }),
    vscode.window.onDidChangeActiveTextEditor(paint),
    vscode.commands.registerCommand('rev.showReport', async () => {
      const doc = vscode.window.activeTextEditor?.document;
      if (doc?.languageId === 'rev') { if (!costs.has(doc.uri.toString())) await runCost(doc); output.show(true); }
    }),
    vscode.commands.registerCommand('rev.debug', () => {
      const doc = vscode.window.activeTextEditor?.document;
      if (!doc) return;
      const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      const term = vscode.window.createTerminal({ name: 'rvm debug', cwd: root });
      term.show();
      term.sendText(`npm run rvm -- debug "${doc.uri.fsPath}"`);
    }),
  );

  vscode.workspace.textDocuments.forEach(check);
  vscode.workspace.textDocuments.forEach((d) => { if (d.languageId === 'rev') void runCost(d); });
}

export function deactivate(): void {}
