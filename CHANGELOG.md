# Change Log

All notable changes to the "kopo-formatter" extension will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.

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