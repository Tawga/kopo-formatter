/**
 * VS Code extension entry point.
 * Thin wrapper that wires the formatter core into VS Code's formatting API.
 */

import * as vscode from "vscode";
import { formatWithDiagnostics, type FormatterOptions } from "./core/index.js";

let outputChannel: vscode.OutputChannel;

function readOptions(formattingOptions?: vscode.FormattingOptions): Partial<FormatterOptions> {
    const settings = vscode.workspace.getConfiguration("kopo-formatter");
    return {
        indentationSpaces: formattingOptions?.tabSize
            ?? settings.get<number>("indentationSpaces"),
        addEmptyLineAfterExit: settings.get<boolean>("addEmptyLineAfterExit"),
        addEmptyLineAfterDivision: settings.get<boolean>("addEmptyLineAfterDivision"),
        addEmptyLineAfterSection: settings.get<boolean>("addEmptyLineAfterSection"),
        omitContinuationLines: settings.get<boolean>("omitContinuationLines"),
        evaluateIndentWhen: settings.get<boolean>("evaluateIndentWhen"),
        alignPicClauses: settings.get<boolean>("alignPicClauses"),
        sourceFormat: settings.get<"auto" | "fixed" | "free">("sourceFormat"),
        keywordCase: settings.get<"upper" | "lower" | "preserve">("keywordCase"),
        normalizeWhitespace: settings.get<boolean>("normalizeWhitespace"),
        wrapLongLines: settings.get<boolean>("wrapLongLines"),
        uppercaseProcedureNames: settings.get<boolean>("uppercaseProcedureNames"),
        alignDelimitedBy: settings.get<boolean>("alignDelimitedBy"),
    };
}

function logOptions(options: Partial<FormatterOptions>): void {
    outputChannel.appendLine(`Options: ${JSON.stringify(options)}`);
}

/**
 * Compute a minimal single edit covering only the changed region, instead of
 * replacing the whole document. Keeps the cursor stable and diffs clean when
 * most of the file is already formatted.
 */
function minimalEdits(document: vscode.TextDocument, formatted: string): vscode.TextEdit[] {
    const original = document.getText();
    if (original === formatted) return [];

    let start = 0;
    const minLen = Math.min(original.length, formatted.length);
    while (start < minLen && original[start] === formatted[start]) start++;

    let endOriginal = original.length;
    let endFormatted = formatted.length;
    while (endOriginal > start && endFormatted > start
        && original[endOriginal - 1] === formatted[endFormatted - 1]) {
        endOriginal--;
        endFormatted--;
    }

    const range = new vscode.Range(
        document.positionAt(start),
        document.positionAt(endOriginal),
    );
    return [vscode.TextEdit.replace(range, formatted.substring(start, endFormatted))];
}

/** Language ids used by common COBOL extensions (ids are case-sensitive). */
const COBOL_SELECTOR: vscode.DocumentSelector = [
    { language: "COBOL" },
    { language: "cobol" },
];

export function activate(context: vscode.ExtensionContext): void {
    outputChannel = vscode.window.createOutputChannel("KOPO Formatter");
    context.subscriptions.push(outputChannel);
    outputChannel.appendLine(`KOPO Formatter: activating... (build ${new Date().toISOString()})`);

    // Log options on activation
    logOptions(readOptions());

    // Log options whenever settings change
    context.subscriptions.push(
        vscode.workspace.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration("kopo-formatter") || e.affectsConfiguration("editor.tabSize")) {
                outputChannel.appendLine("Settings changed:");
                logOptions(readOptions());
            }
        }),
    );

    const disposable = vscode.languages.registerDocumentFormattingEditProvider(
        COBOL_SELECTOR,
        {
            provideDocumentFormattingEdits(
                document: vscode.TextDocument,
                formattingOptions: vscode.FormattingOptions,
            ): vscode.TextEdit[] | null {
                const options = readOptions(formattingOptions);

                const text = document.getText();
                const lineCount = text.split("\n").length;
                outputChannel.appendLine(`Formatting ${document.fileName} (${lineCount} lines)`);
                try {
                    const start = performance.now();
                    const result = formatWithDiagnostics(text, options);
                    const elapsed = (performance.now() - start).toFixed(1);
                    outputChannel.appendLine(`Formatted in ${elapsed}ms`);
                    for (const diag of result.diagnostics) {
                        outputChannel.appendLine(`[${diag.severity}] Line ${diag.line}: ${diag.message}`);
                    }
                    return minimalEdits(document, result.text);
                } catch (err) {
                    const message = err instanceof Error ? err.message : String(err);
                    outputChannel.appendLine(`ERROR: ${message}`);
                    vscode.window.showErrorMessage(
                        `KOPO Formatter failed: ${message}`,
                    );
                    console.error(err);
                    return null;
                }
            },
        },
    );
    context.subscriptions.push(disposable);

    // The command declared in package.json — delegates to the standard
    // Format Document action, which routes through the provider above.
    context.subscriptions.push(
        vscode.commands.registerCommand("kopo-formatter.formatDocument", () =>
            vscode.commands.executeCommand("editor.action.formatDocument"),
        ),
    );

    outputChannel.appendLine("KOPO Formatter: activated");
}

export function deactivate(): void {}
