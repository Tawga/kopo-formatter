# KOPO Formatter — Product Roadmap (v0.5 → v1.0)

**Date:** 2026-07-15
**Baseline:** v0.4.1 + unreleased correctness fixes (`dev`)
**Owner:** Jussi Säilä

## Context

kopo-formatter is a COBOL formatter VS Code extension with a solid parse → AST → print pipeline, 96 passing tests, and proven idempotency. Product direction: **serve the internal team first** (legacy Finnish COBOL, Veryant isCOBOL / ACUCOBOL dialect), **prioritize feature breadth** so more of the real codebase formats meaningfully instead of passing through as `UnparsedLine`, and structure work as **version milestones**. Marketplace publication is the 1.0 capstone, not an early goal.

Open items from [code-review-report.md](./code-review-report.md) and [todo.md](./todo.md) are folded into the milestones below.

## Guiding principles (apply to every release)

1. **Never corrupt code** — anything not understood passes through verbatim. Every new construct ships with round-trip + idempotency tests.
2. **Measure coverage, don't guess** — the KPI is the *unparsed-line ratio* on the internal corpus (`test/test_material` + real programs). Each feature-breadth release should demonstrably lower it.
3. **The internal codebase is the spec** — dialect priorities (ACUCOBOL screen syntax, embedded SQL, copybook style) come from what the team's programs actually use.

---

## v0.5 — Statement coverage: conditional-clause blocks

*Theme: the remaining everyday verbs that have block structure today but are treated as flat text.*

- **Generalize the `ReadBlock` pattern** into a generic conditional-clause block (`src/core/parser/procedureDivisionParser.ts` — `parseReadBlock` already handles the AT END / INVALID KEY / NOT-forms and period-termination correctly; reuse it rather than writing new parsers):
  - `SEARCH` / `SEARCH ALL` with `AT END` and multiple `WHEN` branches
  - `START` with `INVALID KEY` / `NOT INVALID KEY`
  - Arithmetic verbs (`ADD`, `SUBTRACT`, `MULTIPLY`, `DIVIDE`, `COMPUTE`) with `ON SIZE ERROR` / `NOT ON SIZE ERROR`
  - `CALL` with `ON EXCEPTION` / `ON OVERFLOW` / `NOT ON EXCEPTION`
  - `STRING` / `UNSTRING` with `ON OVERFLOW`
  - `ACCEPT ... ON EXCEPTION` (ACUCOBOL screen accept)
- **Unify continuation-line representation** (open item from todo.md) — prerequisite so the new blocks and existing `SimpleStatement.continuationLines` don't diverge further.
- **Structured DECLARATIVES** — parse `DECLARATIVES ... END DECLARATIVES` as a proper node with `USE` sections instead of `UnparsedLine` (currently special-cased in `parseProcedureDivisionChildren`).
- **Definition of done:** unparsed-line ratio drops measurably on the corpus; all new blocks period-termination-safe (same regression pattern as `test/bugfixes.test.ts`).

## v0.6 — Embedded SQL and copybooks

*Theme: the two biggest internal-codebase blockers that aren't "pure COBOL".*

- **`EXEC SQL ... END-EXEC` (and `EXEC CICS`) blocks** — pass the interior through verbatim (SQL has its own layout), indent the `EXEC`/`END-EXEC` frame at statement depth. Must never re-wrap or case-normalize SQL text.
- **Copybook fragment formatting** — `.CPY` files have no division headers, so today every line becomes an `UnparsedLine` warning. Add fragment detection in `src/core/index.ts` / `parser.ts`: if no division header is found but content looks like data entries or procedure statements, format it with the appropriate division parser. This makes the formatter usable on the large copybook inventory.
- **`COPY ... REPLACING`** — multi-line COPY statements preserved and indented as one logical unit (single-line `COPY` already handled in `dataDivisionParser.ts` / `miscDivisionParser.ts`).
- **Definition of done:** representative internal copybooks and SQL-bearing programs format cleanly and idempotently.

## v0.7 — Screen-era and dialect constructs

*Theme: ACUCOBOL/isCOBOL specifics the internal programs rely on.*

- **SCREEN SECTION entries** — level-numbered screen items with `LINE`/`COL`/`VALUE`/attribute clauses formatted with the data-division hierarchy logic (section keyword already recognized in `DATA_SECTION_KEYWORDS`; entries currently get generic treatment).
- **`DISPLAY`/`ACCEPT` screen statements** — clause-per-line layout for FLOATING WINDOW / attribute options (builds on the existing continuation-line collection in `parseStatementSequence`).
- **`GO TO ... DEPENDING ON`** — one target per line, aligned.
- **Literal-aware line wrapping** — emit proper quote-resume continuations when a literal itself must be split (the scanner already *reads* them correctly since the v0.4.x fixes; the printer currently leaves un-splittable lines long).
- **REPORT SECTION** — verbatim-preserving pass-through with correct Area A/B placement (full formatting only if the corpus actually contains report writer code — validate first).
- **Definition of done:** the team can format-on-save the screen-heavy programs without manual cleanup.

## v0.8 — Editor experience

*Theme: from "a formatter" to "a good VS Code citizen", pre-publication.*

- **Range formatting** (`registerDocumentRangeFormattingEditProvider`) — format only the selected paragraph/section; the AST pipeline supports this by printing a subtree.
- **Diagnostics in the Problems panel** — surface the existing `Diagnostic[]` (today only logged to the output channel in `src/extension.ts`) via a `DiagnosticCollection`, so unparsed constructs are visible where developers look.
- **"Show unformatted regions" command** — jump between `UnparsedLine`s; doubles as the tool for finding coverage gaps to feed back into the roadmap.
- **Settings presets** — a `kopo-formatter.preset` (e.g. "house style") so new team members get the agreed configuration in one setting.
- **Definition of done:** format-on-save + Problems-panel workflow demoed to the team; feedback logged as 1.0 backlog.

## v0.9 — Hardening and proof

*Theme: earn the right to publish; open items from the code review land here.*

- **Corpus regression harness in CI** — format the entire internal corpus; assert idempotency and zero unexpected diffs against committed snapshots (extends `test/material.test.ts`).
- **Compile-verification loop** — format → compile with the local isCOBOL compiler (ISCC) → assert success. The strongest possible "we didn't break your code" guarantee, and cheap given the compiler is already available locally.
- **Performance benchmarks** (todo.md open item) — 10k+ line generated COBOL; budget: <500 ms for typical programs.
- **Feature coverage document** (todo.md open item) — explicit supported/unsupported list in README; unsupported = guaranteed pass-through.
- **Definition of done:** CI green on corpus + compile check; coverage doc published.

## v1.0 — Marketplace publication

*Theme: everything needed to hand the extension to strangers.*

- Publisher account, extension icon, gallery banner, keywords/categories.
- README rewrite for external users (screenshots/GIF, settings table already exists), `LICENSE` review.
- Issue templates + contribution guide; publish pipeline (`vsce publish` from CI on tag).
- Version guarantee statement: semantic versioning, "formatter output changes are minor-version events".
- **Definition of done:** listed on the Marketplace; install + format works on a clean machine with a mainstream COBOL language extension.

---

## Explicit non-goals (for this roadmap horizon)

- OO COBOL (`CLASS-ID`/`METHOD-ID`) — not present in the internal codebase; stays pass-through.
- Syntax highlighting / language server features — the formatter composes with existing COBOL language extensions.
- Reformatting of comment contents — comments stay byte-identical forever.

## Success metrics

| Metric | Today | Target by 1.0 |
| --- | --- | --- |
| Unparsed-line ratio on internal corpus | baseline to be measured in v0.5 | < 2 % |
| Idempotency on corpus | 100 % (tested) | 100 % (CI-enforced) |
| Compile-after-format success | not verified | 100 % (CI-enforced) |
| Team adoption (format-on-save) | ad hoc | default for all COBOL devs |
