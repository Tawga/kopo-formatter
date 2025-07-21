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
    const disposable = vscode.languages.registerDocumentFormattingEditProvider(
        "cobol",
        {
            provideDocumentFormattingEdits(document) {
                const settings =
                    vscode.workspace.getConfiguration("cobol-formatter");

                const formatter = new CobolFormatter({
                    indentationSpaces: settings.get("indentationSpaces"),
                    addEmptyLineAfterExit: settings.get(
                        "addEmptyLineAfterExit"
                    ),
                    evaluateIndentWhen: settings.get("evaluateIndentWhen"),
                    alignPicClauses: settings.get("alignPicClauses"),
                });

                const text = document.getText();
                const formattedText = formatter.format(text);
                const wholeDocument = new vscode.Range(
                    document.positionAt(0),
                    document.positionAt(text.length)
                );

                return [vscode.TextEdit.replace(wholeDocument, formattedText)];
            },
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
