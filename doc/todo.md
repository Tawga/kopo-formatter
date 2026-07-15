# TODO: Code Review Fixes

Tracking document for issues identified in [code-review-report.md](./code-review-report.md).

---

## Priority 1 — Should Fix

- [x] **Fix AND/OR continuation line collection** (`procedureDivisionParser.ts`)
  - Removed the `break` on AND/OR line endings so multi-line conditions spanning 3+ lines are fully collected as continuations

- [x] **Add option validation** (`options.ts`)
  - `resolveOptions()` now validates `indentationSpaces` (positive integer), `sourceFormat`, and `keywordCase` with clear error messages

- [x] **Refactor trivia rollback to peek/lookahead** (`dataDivisionParser.ts`, `miscDivisionParser.ts`, `procedureDivisionParser.ts`)
  - Added `peekPastTrivia()` helper to `parser.ts`
  - Replaced all fragile `state.pos -= trivia.length` rollback patterns with peek-before-consume

## Priority 2 — Should Improve

- [x] **Add parsing diagnostics** (`parser.ts`, `types.ts`, `index.ts`)
  - Added `Diagnostic` type and `diagnostics` array to `ParserState` and `SourceFile`
  - Emits warnings when lines fall back to `UnparsedLine` with line number and context
  - Added `formatWithDiagnostics()` public API function
  - VS Code extension now logs diagnostics to an output channel

- [x] **Improve line wrapping** (`printer.ts`)
  - `findContinuationIndent` now handles multi-word verbs (XML GENERATE, JSON PARSE, GO TO)
  - `findSplitPoint` avoids splitting level numbers from data names and multi-word verbs
  - Added guard for when continuation indent exceeds available line width

- [x] **Replace `as` casts with type guards** (`dataDivisionParser.ts`, `miscDivisionParser.ts`, `dataPrinter.ts`)
  - Replaced `as CopyStatement`, `as UnparsedLine`, `as DivisionEntry` with `satisfies` operator
  - Replaced `as { rawText: string }` / `as Trivia[]` with runtime type narrowing checks

## Priority 3 — Nice to Have

- [x] **Unify continuation line representation** across divisions (v0.5)
  - Procedure Division now has a single shared collector (`collectContinuationLines`) used by
    both `SimpleStatement` and `ConditionalBlock`, with one representation (`continuationLines` array)
  - Data Division intentionally keeps joining into `rawText`: data entries are semantically
    single logical lines (level + name + clauses) that the printer re-aligns and re-wraps,
    so a line-per-line representation would carry no information

- [x] **Improve format auto-detection** (`formatDetector.ts`)
  - Increased scan range from 20 to 50 non-blank lines
  - Added penalty when cols 1-6 are numeric but col 7 has unexpected content
  - User override already supported via `sourceFormat: "fixed" | "free" | "auto"` option

- [x] **Add logging to VS Code extension** (`extension.ts`)
  - Created a dedicated "KOPO Formatter" output channel
  - Logs file name, line count, and resolved options on each format
  - Logs all parsing diagnostics
  - Error messages now include the actual failure reason

- [ ] **Document COBOL feature coverage**
  - List supported constructs explicitly
  - List known unsupported features: SCREEN SECTION, REPORT SECTION, OO COBOL, EXEC blocks, COPY REPLACING

- [ ] **Add performance benchmarks**
  - Create benchmark suite for large file formatting (10k+ lines)
  - Profile alignment pre-pass and deep nesting scenarios
