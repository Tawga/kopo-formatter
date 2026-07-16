/**
 * Parser for Data Division: builds hierarchical DataEntry trees from level numbers.
 */

import { type ParserState, consumeTrivia, isAtDivisionHeader, isDivisionHeaderText, peekUpperText, peekPastTrivia } from "../parser.js";
import {
    type DivisionChild,
    type Section,
    type DataEntry,
    type DataClause,
    type FdEntry,
    type CopyStatement,
    type UnparsedLine,
} from "../types.js";
import { DATA_SECTION_KEYWORDS, AREA_A_KEYWORDS } from "../constants.js";
import { parseExecBlock } from "./execBlockParser.js";

/**
 * Parse a COPY statement, collecting continuation lines until the closing
 * period — "COPY x REPLACING ==A== BY ==B==." may span several lines.
 * The statement is kept as one logical unit in rawText.
 */
export function parseCopyStatement(state: ParserState, leadingTrivia: import("../types.js").Trivia[]): CopyStatement {
    const line = state.lines[state.pos];
    let rawText = line.text.trim();
    state.pos++;

    while (state.pos < state.lines.length && !rawText.endsWith(".")) {
        const next = state.lines[state.pos];
        if (next.isBlank || next.isComment) break;
        const nextUpper = next.text.trim().toUpperCase();
        // Defensive stops: a new entry means the period was simply missing.
        if (isDivisionHeaderText(nextUpper) || isDataSectionHeader(nextUpper)
            || /^\d{2}\s/.test(nextUpper) || /^FD\b/.test(nextUpper)
            || nextUpper.startsWith("COPY ")) break;
        rawText += " " + next.text.trim();
        state.pos++;
    }

    return { kind: "CopyStatement", rawText, leadingTrivia };
}

/**
 * Parse children of the Data Division.
 */
export function parseDataDivisionChildren(state: ParserState): DivisionChild[] {
    const children: DivisionChild[] = [];

    while (state.pos < state.lines.length && !isAtDivisionHeader(state)) {
        // Peek first: trivia in front of the next division header must stay
        // unconsumed so it becomes that division's leading trivia.
        const peek = peekPastTrivia(state);
        if (!peek.nextUpper || isDivisionHeaderText(peek.nextUpper)) break;

        const trivia = consumeTrivia(state);
        const upper = peekUpperText(state);

        if (isDataSectionHeader(upper)) {
            const section = parseDataSection(state, trivia);
            children.push(section);
        } else if (upper.startsWith("FD ") || upper === "FD") {
            const fd = parseFdEntry(state, trivia);
            children.push(fd);
        } else if (upper.startsWith("COPY ")) {
            children.push(parseCopyStatement(state, trivia));
        } else if (upper.startsWith("EXEC ")) {
            const line = state.lines[state.pos];
            state.pos++;
            children.push(parseExecBlock(state, line.text.trim(), trivia));
        } else if (/^\d{2}\s+/.test(upper) || /^\d{2}\s*$/.test(upper)) {
            // Data entry outside a section (shouldn't happen often)
            const entries = parseDataEntries(state, trivia);
            children.push(...entries);
        } else {
            const line = state.lines[state.pos];
            children.push({
                kind: "UnparsedLine",
                rawText: line.text.trim(),
                originalLine: line.originalLine,
                leadingTrivia: trivia,
            } satisfies UnparsedLine);
            state.pos++;
        }
    }

    return children;
}

function isDataSectionHeader(upper: string): boolean {
    return DATA_SECTION_KEYWORDS.some(kw => upper.startsWith(kw));
}

function parseDataSection(state: ParserState, leadingTrivia: import("../types.js").Trivia[]): Section {
    const headerLine = state.lines[state.pos];
    const headerText = headerLine.text.trim();
    const name = extractDataSectionName(headerText);

    const section: Section = {
        kind: "Section",
        name,
        headerText,
        leadingTrivia,
        children: [],
    };
    state.pos++;

    // Parse entries until next section or division
    while (state.pos < state.lines.length && !isAtDivisionHeader(state)) {
        // Peek ahead to decide whether to stop before consuming trivia
        const peek = peekPastTrivia(state);
        if (!peek.nextUpper || isDivisionHeaderText(peek.nextUpper)) break;

        // Stop at next section header or Area A keyword — don't consume trivia
        if (isDataSectionHeader(peek.nextUpper) || isAreaAKeywordNotData(peek.nextUpper)) {
            break;
        }

        const trivia = consumeTrivia(state);
        const upper = peekUpperText(state);

        if (upper.startsWith("FD ") || upper === "FD") {
            const fd = parseFdEntry(state, trivia);
            section.children.push(fd);
        } else if (upper.startsWith("COPY ")) {
            section.children.push(parseCopyStatement(state, trivia));
        } else if (upper.startsWith("EXEC ")) {
            const line = state.lines[state.pos];
            state.pos++;
            section.children.push(parseExecBlock(state, line.text.trim(), trivia));
        } else if (/^\d{2}\s/.test(upper) || /^\d{2}$/.test(upper)) {
            const entries = parseDataEntries(state, trivia);
            section.children.push(...entries);
        } else {
            // Continuation or unrecognized line
            const line = state.lines[state.pos];
            section.children.push({
                kind: "UnparsedLine",
                rawText: line.text.trim(),
                originalLine: line.originalLine,
                leadingTrivia: trivia,
            } satisfies UnparsedLine);
            state.pos++;
        }
    }

    return section;
}

function parseFdEntry(state: ParserState, leadingTrivia: import("../types.js").Trivia[]): FdEntry {
    const headerLine = state.lines[state.pos];
    let rawText = headerLine.text.trim();
    state.pos++;

    // Collect continuation lines (until period)
    while (state.pos < state.lines.length && !rawText.endsWith(".")) {
        const nextLine = state.lines[state.pos];
        if (nextLine.isBlank || nextLine.isComment) break;
        const nextUpper = nextLine.text.trim().toUpperCase();
        if (/^\d{2}\s/.test(nextUpper) || isAtDivisionHeader(state) || isDataSectionHeader(nextUpper)) break;
        rawText += " " + nextLine.text.trim();
        state.pos++;
    }

    // Extract FD name
    const nameMatch = rawText.match(/^FD\s+(\S+)/i);
    const name = nameMatch ? nameMatch[1].replace(/\.$/, "") : "";

    const fd: FdEntry = {
        kind: "FdEntry",
        name,
        rawText,
        records: [],
        leadingTrivia,
    };

    // Parse record descriptions under the FD
    while (state.pos < state.lines.length && !isAtDivisionHeader(state)) {
        // Peek ahead to decide whether to stop before consuming trivia
        const peek = peekPastTrivia(state);
        if (!peek.nextUpper || isDivisionHeaderText(peek.nextUpper)) break;

        if (isDataSectionHeader(peek.nextUpper) || peek.nextUpper.startsWith("FD ") || peek.nextUpper === "FD") {
            break;
        }

        const trivia = consumeTrivia(state);
        const upper = peekUpperText(state);

        if (/^\d{2}\s/.test(upper) || /^\d{2}$/.test(upper)) {
            const entries = parseDataEntries(state, trivia);
            for (const entry of entries) {
                if (entry.kind === "DataEntry") {
                    fd.records.push(entry);
                }
            }
        } else {
            break;
        }
    }

    return fd;
}

/**
 * Parse a sequence of data entries and build the level hierarchy.
 * Returns top-level entries (children are nested inside).
 */
function parseDataEntries(state: ParserState, initialTrivia: import("../types.js").Trivia[]): DataEntry[] {
    const allEntries: DataEntry[] = [];
    let firstTrivia = initialTrivia;

    // Parse the first entry
    if (state.pos < state.lines.length) {
        const entry = parseSingleDataEntry(state, firstTrivia);
        if (entry) allEntries.push(entry);
    }

    // Parse subsequent entries at the same or deeper level
    while (state.pos < state.lines.length && !isAtDivisionHeader(state)) {
        // Peek ahead to decide whether to stop before consuming trivia
        const peek = peekPastTrivia(state);
        if (!peek.nextUpper || isDivisionHeaderText(peek.nextUpper)) break;

        if (isDataSectionHeader(peek.nextUpper) || peek.nextUpper.startsWith("FD ") || isAreaAKeywordNotData(peek.nextUpper)) {
            break;
        }

        if (peek.nextUpper.startsWith("COPY ")) {
            break;
        }

        const trivia = consumeTrivia(state);
        const upper = peekUpperText(state);

        if (/^\d{2}\s/.test(upper) || /^\d{2}$/.test(upper)) {
            const entry = parseSingleDataEntry(state, trivia);
            if (entry) allEntries.push(entry);
        } else {
            // Continuation line or other - just consume
            const line = state.lines[state.pos];
            // Append to previous entry if possible
            if (allEntries.length > 0) {
                allEntries[allEntries.length - 1].rawText += " " + line.text.trim();
            }
            state.pos++;
        }
    }

    // Build hierarchy from flat list
    return buildDataHierarchy(allEntries);
}

function parseSingleDataEntry(state: ParserState, leadingTrivia: import("../types.js").Trivia[]): DataEntry | null {
    const line = state.lines[state.pos];
    let rawText = line.text.trim();
    state.pos++;

    // Collect continuation lines (lines that don't start with a level number and don't end the entry)
    while (state.pos < state.lines.length && !rawText.endsWith(".")) {
        const nextLine = state.lines[state.pos];
        if (nextLine.isBlank || nextLine.isComment) break;
        const nextUpper = nextLine.text.trim().toUpperCase();
        // Stop if next line starts a new data entry or section
        if (/^\d{2}\s/.test(nextUpper) || /^\d{2}$/.test(nextUpper) ||
            isAtDivisionHeader(state) || isDataSectionHeader(nextUpper)) break;
        rawText += " " + nextLine.text.trim();
        state.pos++;
    }

    // Parse the level number and name
    const match = rawText.match(/^(\d{2})\s+(\S+)/);
    if (!match) return null;

    const level = parseInt(match[1], 10);
    const name = match[2].replace(/\.$/, "");

    // Extract clauses
    const clauses = extractClauses(rawText, match[0].length);

    return {
        kind: "DataEntry",
        level,
        name,
        clauses,
        rawText,
        children: [],
        leadingTrivia,
    };
}

function extractClauses(rawText: string, afterNamePos: number): DataClause[] {
    const clauses: DataClause[] = [];
    const remaining = rawText.substring(afterNamePos).replace(/\.\s*$/, "").trim();
    if (!remaining) return clauses;

    const upper = remaining.toUpperCase();

    // PIC / PICTURE clause
    const picMatch = upper.match(/\bPIC(?:TURE)?\s+/);
    if (picMatch) {
        const picStart = upper.indexOf(picMatch[0]);
        // Find end of PIC clause (next keyword or end)
        let picEnd = remaining.length;
        const nextKeywords = ["VALUE", "OCCURS", "REDEFINES", "USAGE", "COMP", "PACKED-DECIMAL", "BINARY"];
        for (const kw of nextKeywords) {
            const kwIdx = upper.indexOf(" " + kw, picStart + picMatch[0].length);
            if (kwIdx !== -1 && kwIdx < picEnd) picEnd = kwIdx;
        }
        clauses.push({
            kind: "PicClause",
            text: remaining.substring(picStart, picEnd).trim(),
        });
    }

    // VALUE clause
    const valueMatch = upper.match(/\bVALUE\s+/);
    if (valueMatch) {
        const valueStart = upper.indexOf(valueMatch[0]);
        clauses.push({
            kind: "ValueClause",
            text: remaining.substring(valueStart).replace(/\.\s*$/, "").trim(),
        });
    }

    // OCCURS clause
    const occursMatch = upper.match(/\bOCCURS\s+/);
    if (occursMatch) {
        const occursStart = upper.indexOf(occursMatch[0]);
        clauses.push({
            kind: "OccursClause",
            text: remaining.substring(occursStart).trim(),
        });
    }

    // REDEFINES clause
    const redefinesMatch = upper.match(/\bREDEFINES\s+/);
    if (redefinesMatch) {
        const redefinesStart = upper.indexOf(redefinesMatch[0]);
        clauses.push({
            kind: "RedefinesClause",
            text: remaining.substring(redefinesStart).trim(),
        });
    }

    // If no specific clauses found but there's remaining text, add as generic
    if (clauses.length === 0 && remaining.trim()) {
        clauses.push({
            kind: "GenericClause",
            text: remaining.trim(),
        });
    }

    return clauses;
}

/**
 * Build a hierarchy of DataEntry nodes from a flat list using level numbers.
 */
function buildDataHierarchy(entries: DataEntry[]): DataEntry[] {
    if (entries.length === 0) return [];

    const roots: DataEntry[] = [];
    const stack: DataEntry[] = [];

    for (const entry of entries) {
        // Pop stack until we find a parent (lower level number)
        while (stack.length > 0 && stack[stack.length - 1].level >= entry.level) {
            stack.pop();
        }

        // Level 01, 77, 78 always go to root
        if (entry.level === 1 || entry.level === 77 || entry.level === 78) {
            roots.push(entry);
            stack.length = 0;
            stack.push(entry);
        } else if (stack.length === 0) {
            roots.push(entry);
            stack.push(entry);
        } else {
            // Nest under parent
            stack[stack.length - 1].children.push(entry);
            stack.push(entry);
        }
    }

    return roots;
}

function extractDataSectionName(headerText: string): string {
    const upper = headerText.toUpperCase();
    for (const kw of DATA_SECTION_KEYWORDS) {
        if (upper.startsWith(kw)) return kw.replace(" SECTION", "").replace(".", "");
    }
    return headerText.split(/\s+/)[0];
}

function isAreaAKeywordNotData(upper: string): boolean {
    return AREA_A_KEYWORDS.some(kw => upper.startsWith(kw)) && !upper.startsWith("FD");
}
