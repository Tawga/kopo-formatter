# KOPO Formatter for COBOL

An opinionated but configurable code formatter for COBOL, designed to enforce consistent styling and indentation within Visual Studio Code. This extension helps maintain clean, readable, and standardized COBOL source code.

## Features

This formatter provides a wide range of features to automatically clean up your COBOL files:

-   **Automatic Indentation**: Correctly indents procedural blocks, including:
    -   `IF...ELSE...END-IF`
    -   `EVALUATE...WHEN...END-EVALUATE`
    -   `READ...AT END...NOT AT END...END-READ`
    -   `PERFORM` loops (`UNTIL`, `VARYING`, etc.)
    -   Multi-line `STRING` statements.
-   **Data Division Alignment**:
    -   Optionally aligns `PIC`, `PICTURE`, and `VALUE` clauses in the `FILE SECTION`, `WORKING-STORAGE SECTION`, and `LINKAGE SECTION` to a consistent column for enhanced readability.
    -   Special alignment for `VALUE` clauses on Level 78 and 88 items.
-   **COBOL Area Formatting**: Correctly places `DIVISION`, `SECTION`, and paragraph headers in Area A, and statements in Area B.
-   **Whitespace Control**:
    -   Converts all tabs to spaces.
    -   Removes all trailing whitespace from lines.
-   **Code Structure**:
    -   Optionally adds a blank line after `EXIT.` statements to improve visual separation.

## Installation

This extension is not yet published on the VS Code Marketplace. To install it, you must build the `.vsix` file from the source and install it manually.

1.  Build the extension by following the steps in the [Building from Source](#building-from-source) section below. This will create a `kopo-formatter-x.x.x.vsix` file in the `build` directory.
2.  Open Visual Studio Code.
3.  Go to the **Extensions** view (Ctrl+Shift+X).
4.  Click the **three dots (...)** at the top-right of the Extensions view.
5.  Select **"Install from VSIX..."**.
6.  Navigate to the `build` folder in the project and select the `.vsix` file.
7.  Reload VS Code when prompted.

## Usage

Once installed, the formatter integrates directly with VS Code's built-in formatting capabilities.

-   **Format Document Command**:
    -   Open a COBOL file (`.cbl`, `.cob`, etc.).
    -   Open the Command Palette (Ctrl+Shift+P).
    -   Type "Format Document" and press Enter.
    -   If prompted, select "KOPO Cobol Formatter" as the default formatter for COBOL files.
-   **Keyboard Shortcut**:
    -   Press `Shift+Alt+F` (Windows/Linux) or `Shift+Option+F` (Mac).
-   **Format on Save**:
    -   To automatically format your files every time you save (not recommended), add the following to your VS Code `settings.json` file:
        ```json
        "[COBOL]": {
            "editor.formatOnSave": true
        }
        ```

## Extension Settings

This extension can be configured in your VS Code settings (`settings.json`) or through the Settings UI. All settings are prefixed with `kopo-formatter`.

-   `kopo-formatter.indentationSpaces` (default: `3`)

    -   The number of spaces to use for a single level of indentation.

-   `kopo-formatter.addEmptyLineAfterExit` (default: `true`)

    -   If `true`, an empty line will be inserted after an `EXIT.` statement, unless one already exists.

-   `kopo-formatter.evaluateIndentWhen` (default: `true`)

    -   If `true`, `WHEN` and `WHEN OTHER` clauses will be indented one level inside an `EVALUATE` block.

-   `kopo-formatter.alignPicClauses` (default: `true`)
    -   If `true`, the formatter will align `PIC` and `VALUE` clauses in the `FILE SECTION`, `WORKING-STORAGE SECTION`, and `LINKAGE SECTION` to a consistent column. This also affects `VALUE` clauses for Level 78 and 88 items.

## Building from Source

To build the extension yourself, you need Node.js and npm installed.

1.  **Clone the repository**:
    ```bash
    git clone <repository-url>
    cd kopo-formatter
    ```
2.  **Install dependencies**:
    ```bash
    npm install
    ```
3.  **Run the build script**:
    `bash
npm run build
`
    This will create the installable `.vsix` file in the `build/` directory.
