// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
const vscode = require("vscode");
const CobolFormatter = require("./src/CobolFormatter");

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed

/**
 * @param {vscode.ExtensionContext} context
 */
function activate(context) {
    const disposable = vscode.commands.registerCommand(
        "kopo-formatter.formatDocument",
        () => {
            const { activeTextEditor } = vscode.window;
            if (
                activeTextEditor &&
                activeTextEditor.document.languageId === "cobol"
            ) {
                const settings =
                    vscode.workspace.getConfiguration("cobol-formatter");
                const formatter = new CobolFormatter({
                    indentationSpaces: settings.get("indentationSpaces") || 3,
                    addEmptyLineAfterExit:
                        settings.get("addEmptyLineAfterExit") || true,
                    evaluateIndentWhen:
                        settings.get("evaluateIndentWhen") || true,
                    alignPicClauses: settings.get("alignPicClauses") || true,
                });

                const text = activeTextEditor.document.getText();
                const formattedText = formatter.format(text);

                const edit = new vscode.WorkspaceEdit();
                const wholeDocument = new vscode.Range(
                    activeTextEditor.document.positionAt(0),
                    activeTextEditor.document.positionAt(text.length)
                );
                edit.replace(
                    activeTextEditor.document.uri,
                    wholeDocument,
                    formattedText
                );
                vscode.workspace.applyEdit(edit);
            }
        }
    );

    context.subscriptions.push(disposable);
}

// This method is called when your extension is deactivated
function deactivate() {}

module.exports = {
    activate,
    deactivate,
};
