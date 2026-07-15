# KOPO Formatter for COBOL

An opinionated but configurable code formatter for COBOL, designed to enforce consistent styling and indentation within Visual Studio Code.

## How it works

The formatter uses a **parse → AST → print** pipeline rather than processing source line-by-line.

1. **Format detection** — The source is first inspected to determine whether it is fixed-form or free-form COBOL. The detector checks for `>>SOURCE FORMAT IS FREE/FIXED` compiler directives, then falls back to heuristics (sequence numbers in columns 1–6, keywords at column 1, `*>` comments). The result can also be forced via a setting.

2. **Scanning** — The raw source text is converted into a list of logical `SourceLine` objects. In fixed-form mode this means stripping the sequence area (cols 1–6), reading the indicator character (col 7), extracting program text from cols 8–72, and joining continuation lines (col 7 = `-`). Blank lines and comment lines (`*`, `/`) are recorded as trivia and attached to the following node.

3. **Parsing** — A hand-written recursive descent parser walks the source lines and builds an **Abstract Syntax Tree (AST)**. The tree reflects the logical structure of the program:
   - `SourceFile` → `Division[]`
   - Each division contains sections and entries
   - The Data Division parser builds a proper level-number hierarchy — `01` items own their `05`/`10`/... children as nested `DataEntry` nodes
   - The Procedure Division parser recognises block statements (`IF`, `EVALUATE`, `PERFORM`, `READ`, etc.) and nests their bodies as child nodes, so indentation is a product of tree depth rather than mutable counters
   - Anything the parser does not recognise becomes an `UnparsedLine` node and is passed through verbatim — the formatter never destroys code it does not understand

4. **Printing** — The printer walks the AST and emits formatted lines. Before emitting the Data Division it runs a pre-pass over all `DataEntry` nodes to compute the maximum column width per indent depth, which is used to align `PIC` and `VALUE` clauses. Procedure division indentation is calculated purely from the recursion depth of the tree walk — no state is carried between lines.

## Features

- **Fixed-form column structure** — divisions/sections/paragraphs placed in Area A (col 8), statements in Area B (col 12+), indicator column preserved
- **Data division hierarchy** — level numbers produce correct nested indentation; `01`/`77`/`78` items reset to the root
- **PIC/VALUE alignment** — `PIC` and `VALUE` clauses aligned to a consistent column within each indentation group; Level 88 items align with their parent's group
- **Procedure division block indentation** — `IF`/`EVALUATE`/`PERFORM`/`READ` blocks and all their sub-clauses (`ELSE`, `WHEN`, `AT END`, `ON SIZE ERROR`, etc.)
- **Comment preservation** — comment lines (`*` and `/` in col 7) preserved exactly, including their indicator character
- **Blank line preservation** — blank lines are kept in their original positions
- **Tab-to-space conversion** and trailing whitespace removal on all lines
- **Free-form COBOL support** — detects or is configured to handle free-form source; emits clean indented output without fixed-form column constraints
- **Safe by default** — unrecognised constructs are never mangled

## Installation

This extension is not yet published on the VS Code Marketplace. Build the `.vsix` from source and install it manually.

1. Build the extension following the steps in [Building from Source](#building-from-source). A `.vsix` file will appear in the `packages/` directory.
2. Open Visual Studio Code.
3. Open the Extensions view (`Ctrl+Shift+X`).
4. Click the **...** menu at the top right of the Extensions view.
5. Select **Install from VSIX...** and pick the file from the `packages/` folder.
6. Reload VS Code when prompted.

## Usage

Once installed, KOPO Formatter integrates with VS Code's standard formatting commands.

- **Format Document** — `Shift+Alt+F` (Windows/Linux) or `Shift+Option+F` (Mac), or open the Command Palette (`Ctrl+Shift+P`) and run *Format Document*.
- **Format on Save** — add the following to your `settings.json`:
  ```json
  "[COBOL]": {
      "editor.formatOnSave": true
  }
  ```

## Settings

All settings are prefixed with `kopo-formatter` and can be set in the VS Code Settings UI or `settings.json`.

| Setting | Default | Description |
|---|---|---|
| `indentationSpaces` | `3` | Number of spaces per indentation level |
| `addEmptyLineAfterExit` | `true` | Insert a blank line after `EXIT.` statements |
| `evaluateIndentWhen` | `true` | Indent `WHEN`/`WHEN OTHER` clauses inside `EVALUATE` blocks |
| `alignPicClauses` | `true` | Align `PIC` and `VALUE` clauses to a consistent column in the Data Division |
| `sourceFormat` | `"auto"` | Source format: `"auto"` (detect), `"fixed"` (fixed-form), or `"free"` (free-form) |

## Building from Source

Requires Node.js 20+ and npm.

```bash
# Clone and install dependencies
git clone https://github.com/Tawga/kopo-formatter
cd kopo-formatter
npm install

# Type-check
npm run compile

# Run tests
npm test

# Bundle and package as .vsix
npm run package
```

The `npm run build` command compiles TypeScript and bundles the extension into `dist/extension.js` via esbuild. The `npm run package` command additionally packages it as a `.vsix` file in the `packages/` directory.

## Project Structure

```
src/
  extension.ts          VS Code entry point (thin wrapper, no business logic)
  core/
    index.ts            Public API — format() and parseSource()
    constants.ts        COBOL keyword lists and column constants
    types.ts            AST node type definitions
    options.ts          FormatterOptions interface and defaults
    tokens.ts           SourceLine type
    scanner.ts          Format-aware tokenizer
    formatDetector.ts   Fixed-form vs free-form detection
    parser.ts           Top-level recursive descent parser
    parser/
      dataDivisionParser.ts        Data Division — level hierarchy
      procedureDivisionParser.ts   Procedure Division — block statements
      miscDivisionParser.ts        Identification / Environment divisions
    printer.ts          AST walker and output coordinator
    layout.ts           Line construction helpers (fixed/free-form)
    printer/
      dataPrinter.ts    Data entries, PIC/VALUE alignment pre-pass
      procedurePrinter.ts  Procedure statements, depth-based indentation
test/
  scanner.test.ts
  formatDetector.test.ts
  parser.test.ts
  integration.test.ts
```
