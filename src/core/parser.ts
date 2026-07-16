/**
 * Recursive descent parser: SourceLine[] → AST (SourceFile).
 *
 * The parser is tolerant — unrecognized constructs become UnparsedLine nodes.
 */

import { type SourceLine } from "./tokens.js";
import { type SourceFormat } from "./formatDetector.js";
import {
    type SourceFile,
    type Division,
    type DivisionKind,
    type TopLevelNode,
    type Trivia,
    type UnparsedLine,
    type Diagnostic,
} from "./types.js";
import { DIVISION_KEYWORDS, DATA_SECTION_KEYWORDS, PROCEDURE_VERBS } from "./constants.js";
import { parseDataDivisionChildren } from "./parser/dataDivisionParser.js";
import { parseProcedureDivisionChildren } from "./parser/procedureDivisionParser.js";
import { parseIdentificationChildren, parseEnvironmentChildren } from "./parser/miscDivisionParser.js";

export interface ParserState {
    lines: SourceLine[];
    pos: number;
    format: SourceFormat;
    diagnostics: Diagnostic[];
}

export function parse(lines: SourceLine[], format: SourceFormat): SourceFile {
    const state: ParserState = { lines, pos: 0, format, diagnostics: [] };
    const children: TopLevelNode[] = [];
    const trailingTrivia: Trivia[] = [];

    // Fragment mode: a file with no division header at all (a copybook).
    // Detect what kind of content it holds and parse it with the matching
    // division parser inside a synthetic, header-less division node.
    const hasDivisions = lines.some(
        l => !l.isComment && !l.isBlank && isDivisionHeaderText(l.text.trim().toUpperCase()),
    );
    if (!hasDivisions) {
        const fragmentKind = detectFragmentKind(lines);
        if (fragmentKind) {
            const division: Division = {
                kind: "Division",
                divisionType: fragmentKind,
                headerText: "",
                leadingTrivia: [],
                children: [],
            };
            switch (fragmentKind) {
                case "EnvironmentDivision":
                    division.children = parseEnvironmentChildren(state);
                    break;
                case "ProcedureDivision":
                    division.children = parseProcedureDivisionChildren(state);
                    break;
                default:
                    division.children = parseDataDivisionChildren(state);
                    break;
            }
            trailingTrivia.push(...consumeTrivia(state));
            return {
                kind: "SourceFile",
                format,
                children: [division],
                trailingTrivia,
                diagnostics: state.diagnostics,
            };
        }
    }

    while (state.pos < state.lines.length) {
        const triviaBeforeDiv = consumeTrivia(state);
        if (state.pos >= state.lines.length) {
            trailingTrivia.push(...triviaBeforeDiv);
            break;
        }

        const divisionMatch = matchDivisionHeader(state);
        if (divisionMatch) {
            const division = parseDivision(state, divisionMatch.kind, divisionMatch.headerText, triviaBeforeDiv);
            children.push(division);
        } else {
            // Not a division header — emit as unparsed
            const line = state.lines[state.pos];
            const unparsed: UnparsedLine = {
                kind: "UnparsedLine",
                rawText: line.text.trim(),
                originalLine: line.originalLine,
                leadingTrivia: triviaBeforeDiv,
            };
            children.push(unparsed);
            state.diagnostics.push({
                severity: "warning",
                message: `Unrecognized line outside any division: "${line.text.trim().substring(0, 40)}"`,
                line: line.originalLine,
            });
            state.pos++;
        }
    }

    return {
        kind: "SourceFile",
        format,
        children,
        trailingTrivia,
        diagnostics: state.diagnostics,
    };
}

function matchDivisionHeader(state: ParserState): { kind: DivisionKind; headerText: string } | null {
    const line = state.lines[state.pos];
    if (line.isComment || line.isBlank) return null;

    const kind = matchDivisionKind(line.text.trim().toUpperCase());
    return kind ? { kind, headerText: line.text.trim() } : null;
}

/** Match upper-cased line text against the division header keywords. */
function matchDivisionKind(upper: string): DivisionKind | null {
    for (const keyword of DIVISION_KEYWORDS) {
        if (upper.startsWith(keyword)) {
            if (keyword.includes("IDENTIFICATION") || keyword.includes("ID")) {
                return "IdentificationDivision";
            } else if (keyword.includes("ENVIRONMENT")) {
                return "EnvironmentDivision";
            } else if (keyword.startsWith("DATA")) {
                return "DataDivision";
            }
            return "ProcedureDivision";
        }
    }
    return null;
}

/**
 * True when the given upper-cased line text is a division header.
 *
 * Use this on `peekPastTrivia().nextUpper` when deciding whether to stop a
 * child-parsing loop — `isAtDivisionHeader(state)` checks the CURRENT
 * position, which may be a comment/blank line sitting in front of the
 * header, and would wrongly report false.
 */
export function isDivisionHeaderText(upper: string): boolean {
    return matchDivisionKind(upper) !== null;
}

/**
 * Decide what kind of content a header-less fragment (copybook) holds by
 * inspecting its first real line:
 * - level numbers / FD / data section headers → Data Division content
 * - SELECT entries → Environment Division content (FILE-CONTROL copybooks)
 * - a known procedure verb or a paragraph header → Procedure Division content
 *
 * Defaults to Data Division — the dominant copybook kind — when the first
 * line is inconclusive. Returns null for files with no real content.
 */
function detectFragmentKind(lines: SourceLine[]): DivisionKind | null {
    for (const line of lines) {
        if (line.isComment || line.isBlank) continue;
        const upper = line.text.trim().toUpperCase();

        if (/^\d{1,2}(\s|$)/.test(upper) || /^FD(\s|$)/.test(upper)
            || DATA_SECTION_KEYWORDS.some(k => upper.startsWith(k))) {
            return "DataDivision";
        }
        if (/^SELECT(\s|$)/.test(upper)) {
            return "EnvironmentDivision";
        }
        const firstWord = upper.match(/^([A-Z][\w-]*)/)?.[1] ?? "";
        if (PROCEDURE_VERBS.some(v => v.split(" ")[0] === firstWord)) {
            return "ProcedureDivision";
        }
        if (/^[A-Z0-9][\w-]*\.\s*$/.test(upper)) {
            return "ProcedureDivision"; // paragraph header
        }
        return "DataDivision";
    }
    return null;
}

function parseDivision(
    state: ParserState,
    kind: DivisionKind,
    headerText: string,
    leadingTrivia: Trivia[],
): Division {
    // Consume the header line
    state.pos++;

    const division: Division = {
        kind: "Division",
        divisionType: kind,
        headerText,
        leadingTrivia,
        children: [],
    };

    // Parse children based on division type, stopping at next division
    switch (kind) {
        case "IdentificationDivision":
            division.children = parseIdentificationChildren(state);
            break;
        case "EnvironmentDivision":
            division.children = parseEnvironmentChildren(state);
            break;
        case "DataDivision":
            division.children = parseDataDivisionChildren(state);
            break;
        case "ProcedureDivision":
            division.children = parseProcedureDivisionChildren(state);
            break;
    }

    return division;
}

// ─── Shared helpers ─────────────────────────────────────────────────────

export function consumeTrivia(state: ParserState): Trivia[] {
    const trivia: Trivia[] = [];
    while (state.pos < state.lines.length) {
        const line = state.lines[state.pos];
        if (line.isBlank) {
            trivia.push({
                kind: "BlankLine",
                text: "",
                originalLine: line.originalLine,
            });
            state.pos++;
        } else if (line.isComment) {
            trivia.push({
                kind: "Comment",
                text: line.text,
                indicator: line.indicator,
                originalLine: line.originalLine,
            });
            state.pos++;
        } else {
            break;
        }
    }
    return trivia;
}

export function isAtDivisionHeader(state: ParserState): boolean {
    if (state.pos >= state.lines.length) return false;
    return matchDivisionHeader(state) !== null;
}

export function peekUpperText(state: ParserState): string {
    if (state.pos >= state.lines.length) return "";
    const line = state.lines[state.pos];
    if (line.isComment || line.isBlank) return "";
    return line.text.trim().toUpperCase();
}

/**
 * Peek at trivia without consuming it. Returns the trivia items and how many
 * lines they span, plus the upper-cased text of the first non-trivia line
 * (empty string if EOF/division boundary).
 *
 * Use this instead of consumeTrivia + state.pos -= trivia.length rollback.
 */
export function peekPastTrivia(state: ParserState): { triviaCount: number; trivia: import("./types.js").Trivia[]; nextUpper: string } {
    const trivia: import("./types.js").Trivia[] = [];
    let pos = state.pos;

    while (pos < state.lines.length) {
        const line = state.lines[pos];
        if (line.isBlank) {
            trivia.push({ kind: "BlankLine", text: "", originalLine: line.originalLine });
            pos++;
        } else if (line.isComment) {
            trivia.push({ kind: "Comment", text: line.text, indicator: line.indicator, originalLine: line.originalLine });
            pos++;
        } else {
            break;
        }
    }

    let nextUpper = "";
    if (pos < state.lines.length) {
        const line = state.lines[pos];
        if (!line.isComment && !line.isBlank) {
            nextUpper = line.text.trim().toUpperCase();
        }
    }

    return { triviaCount: trivia.length, trivia, nextUpper };
}
