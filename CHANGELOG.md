# Change Log

All notable changes to the "kopo-formatter" extension will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.

## [0.6.5] - 2026-07-16

### Fixed

- **`ELSE IF` on one line no longer loses the nested condition** — the parser assumed `ELSE` always sits alone on its line and consumed the whole line, so in `ELSE IF CLEAN-IMPORT = "K"` the nested `IF` condition was dropped and the rest of the chain collapsed (caught in production by the no-loss verifier, which left the document unchanged). A statement following `ELSE` on the same line is now parsed as the first statement of the else body, so `ELSE IF` chains nest correctly under the shared `END-IF.`. The `ELSE` match is also stricter: a line starting with `ELSEX...` no longer matches as `ELSE`.
- **Cursor no longer jumps to the end of the document after formatting** — the printer always joined lines with `\n`, so formatting a CRLF file (the common case on Windows/mainframe COBOL sources) silently rewrote every line ending to LF. That turned the "minimal edit" computed for VS Code into a single edit spanning almost the entire file (confirmed: 100% of the document on a real CRLF sample), which VS Code can only resolve by moving the cursor to the end of the edit. The formatter now detects the source's line ending and matches it in the output, so re-formatting an already-formatted CRLF file with one small change produces a tiny, localized edit again and the cursor stays put.

## [0.6.4] - 2026-07-16

### Added

- **Keyboard shortcut for Format COBOL Document** — `Ctrl+Alt+F` (`Cmd+Alt+F` on macOS) now runs `kopo-formatter.formatDocument` when a COBOL editor has focus. Previously the command had no keybinding and showed blank in the Keyboard Shortcuts column of the extension's Commands panel.

## [0.6.3] - 2026-07-16

### Fixed

- **Unsplittable long literals are wrapped as literal continuations instead of overflowing column 72** — a line whose string literal left no space to split at was emitted wider than column 72; if it stayed within 80 columns, reformatting the output misdetected a punched-card identification area and silently truncated the literal's tail. The wrapper now cuts inside the literal at exactly column 72 and re-opens the quote after the `-` indicator (the scanner rejoins this form byte-exactly), so every emitted line stays within column 72 and the split round-trips losslessly. Found by the idempotency test on a 59-program corpus — this was the one loss mode the token verifier is inherently blind to, since scanning applies the same identification-area truncation to both sides of the comparison.

## [0.6.2] - 2026-07-16

Fixes for six parser/printer bugs surfaced by expanding the test corpus from 4 to 26 real programs (the no-loss verifier and idempotency tests caught all of them; no lossy output ever reached a document).

### Fixed

- **Comments before `WHEN` / `ELSE` / `END-xxx` with an empty body are no longer dropped** — statement-sequence parsing no longer pre-consumes trivia; a comment now stays in the stream and attaches to the next construct. Previously the no-loss fallback refused to format such files.
- **`SELECT` no longer swallows the following statement** — the continuation collector checked for the closing period only after appending the next line, so a select rejoined from a wrapped continuation absorbed the next `COPY` statement on the second pass.
- **Deterministic wrapping of aligned data entries** — interior space runs in `PIC`/`VALUE` clauses are collapsed (literal-aware) and wrapped head pieces are trimmed, so line-wrap decisions no longer flip between passes.
- **Lines with content only in the sequence area (e.g. a lone `*` in column 1) are treated as blank** — previously they became empty "code" lines that halted every parser loop and dumped the rest of the division into raw passthrough.
- **A COBOL reserved word is never taken as a paragraph name** — a lone `KEY.` (tail of a wrapped `ACCEPT ... FROM ESCAPE KEY.`) was parsed as a paragraph header, splitting the statement and re-nesting `END-ACCEPT` deeper on every pass.

## [0.6.1] - 2026-07-16

### Added

- **No-code-loss guarantee** — after printing, a verifier tokenizes input and output and confirms every meaningful token of the input (words case-insensitively, string literals verbatim, comment lines) survives in order in the output. If anything would be lost, the formatter returns the **original text unchanged** with an `error` diagnostic describing the loss, and the VS Code extension shows a warning. Lossy output can no longer reach the document.
- Five silent-drop sites in the parser/scanner now pass unrecognized lines through as `UnparsedLine` nodes with a `warning` diagnostic instead of dropping them: stray lines inside `EVALUATE`, the conditional-block no-progress guard, unattachable data-division continuation lines, malformed data entries, and orphan continuation lines with no preceding code line.

### Fixed

- **Explicit scope terminators keep their sentence period** — `END-IF.` / `END-CALL.` / `END-READ.` etc. were printed without the trailing period, silently changing sentence structure. The period is now preserved and correctly closes the sentence for the enclosing parser scopes. (Found by the new no-loss verifier on the test corpus.)
- **Spaces inside string literals of data entries are preserved** — `VALUE 'A  B'` was collapsed to `VALUE 'A B'` by whitespace normalization; the data printer now uses the literal-aware space collapser.

## [0.6.0] - 2026-07-15

### Added

- **`EXEC SQL` / `EXEC CICS` blocks** — parsed as pass-through blocks in both the Procedure Division and the Data Division (`INCLUDE SQLCA`, `DECLARE TABLE/CURSOR`). The interior is preserved completely verbatim: original columns, casing (immune to `keywordCase`), spacing, comments, and blank lines. Only the `EXEC` header and `END-EXEC` frame participate in COBOL indentation. SQL keywords like `DELETE` or `UPDATE` inside the block can no longer be mistaken for COBOL verbs.
- **Copybook fragment formatting** — files without any division header (`.CPY` copybooks) are now detected and formatted by content kind: data entries (level hierarchy + PIC alignment), `SELECT` entries (FILE-CONTROL copybooks), or procedure statements. Previously every line fell through as an unparsed warning.
- **Multi-line `COPY ... REPLACING`** — COPY statements spanning several lines are collected to the closing period and kept as one logical unit in the Data and Environment Divisions.
- **`$` compiler directives** (ACUCOBOL `$XFD` etc.) — lines with `$` in column 7 are preserved verbatim; previously the `$` indicator was silently dropped.

### Fixed

- PIC/VALUE alignment is now capped at column 49 so a single long entry (e.g. a `REDEFINES` with a long name) no longer drags the whole group's PIC clauses into line-wrapping territory.

## [0.5.0] - 2026-07-15

### Added

- **Generic conditional-clause blocks** — the READ-block logic is generalized to all verbs with conditional clauses, driven by a single configuration table (`CONDITIONAL_VERBS`):
  - `SEARCH` / `SEARCH ALL` with `AT END` and multiple `WHEN` branches
  - `START` with `INVALID KEY` / `NOT INVALID KEY`
  - `ADD`/`SUBTRACT`/`MULTIPLY`/`DIVIDE`/`COMPUTE` with `[NOT] [ON] SIZE ERROR`
  - `CALL` with `[NOT] ON EXCEPTION` / `ON OVERFLOW`
  - `STRING`/`UNSTRING` with `[NOT] ON OVERFLOW`
  - `ACCEPT` with `[NOT] ON EXCEPTION` / `[NOT] ON ESCAPE` (ACUCOBOL)
  - `WRITE` additionally with `[NOT] AT END-OF-PAGE` / `AT EOP`
- Uniform clause layout: clause keywords at one indent level below the verb, clause bodies one further; `NOT`-forms now align with their positive counterparts
- Clause keywords are matched at word boundaries and outside string literals — `SIZE-ERROR-FLAG` or `CALL "ON EXCEPTION"` never trigger a block
- Statements without clauses stay flat (`ADD 1 TO X.` is unchanged), and period-terminated blocks never get an invented `END-xxx`
- **Structured DECLARATIVES** — `DECLARATIVES ... END DECLARATIVES` is parsed as a proper node containing its USE sections instead of falling back to unparsed lines
- `scripts/coverage.mjs` — reports the unparsed-line ratio on the test corpus (roadmap KPI); v0.5 takes the corpus from 0.24 % to 0.00 %

### Fixed

- **Division headers preceded by comment lines are now recognized** — previously a comment block right before e.g. `ENVIRONMENT DIVISION.` caused the header (and everything after it) to be swallowed into the previous division as flat, unformatted entries
- Comments immediately before `ELSE`, `END-IF`, `END-EVALUATE`, `END-PERFORM`, and `END-READ`-style terminators are no longer silently deleted
- A clause-less `READ`/`WRITE` no longer swallows the following statements into a phantom clause body
- `WHEN` inside EVALUATE/SEARCH no longer matches paragraph names like `WHEN-X.` (word-boundary matching)
- Out-of-line `PERFORM ... UNTIL x.` no longer swallows following statements into a phantom body and no longer gets a spurious `END-PERFORM` (which produced non-compiling output)
- Period-terminated `EVALUATE` (legacy style without `END-EVALUATE`) no longer gets a spurious `END-EVALUATE` inserted after the period
- Fixed-form continued string literals (`-` in col 7 resuming with a quote) are now spliced per punched-card semantics instead of being joined with a space, which corrupted the literal's value and quote pairing
- Identification area (cols 73-80) is now stripped when the file uses punched-card layout, instead of sequence numbers/tags being merged into statements; files containing lines longer than 80 columns are left untouched
- Line wrapping no longer picks a split point inside the leading indent (could recurse indefinitely on lines whose only spaces sit inside a long literal)
- The `kopo-formatter.formatDocument` command declared in package.json is now actually registered
- The formatting provider is registered for both `COBOL` and `cobol` language ids
- Formatting now returns a minimal edit for the changed region instead of replacing the whole document (keeps cursor position stable)
- Removed the invalid `contributes.formatters` block from package.json; README install instructions now point to `packages/` instead of `build/`