/**
 * Parsers for Identification and Environment divisions.
 * These divisions have relatively simple structure.
 */

import { type ParserState, consumeTrivia, isAtDivisionHeader, isDivisionHeaderText, peekUpperText, peekPastTrivia } from "../parser.js";
import {
    type DivisionChild,
    type Section,
    type DivisionEntry,
    type SelectEntry,
} from "../types.js";
import { parseCopyStatement } from "./dataDivisionParser.js";

/**
 * Parse children of the Identification Division.
 * Contains entries like PROGRAM-ID, AUTHOR, DATE-WRITTEN, etc.
 */
export function parseIdentificationChildren(state: ParserState): DivisionChild[] {
    const children: DivisionChild[] = [];

    while (state.pos < state.lines.length && !isAtDivisionHeader(state)) {
        // Peek ahead — if EOF or next division, leave trivia for the next division
        const peek = peekPastTrivia(state);
        if (!peek.nextUpper || isDivisionHeaderText(peek.nextUpper)) break;

        const trivia = consumeTrivia(state);
        const line = state.lines[state.pos];
        const entry: DivisionEntry = {
            kind: "DivisionEntry",
            rawText: line.text.trim(),
            leadingTrivia: trivia,
        };
        children.push(entry);
        state.pos++;
    }

    return children;
}

/**
 * Parse children of the Environment Division.
 * Contains CONFIGURATION SECTION, INPUT-OUTPUT SECTION, FILE-CONTROL, etc.
 */
export function parseEnvironmentChildren(state: ParserState): DivisionChild[] {
    const children: DivisionChild[] = [];

    while (state.pos < state.lines.length && !isAtDivisionHeader(state)) {
        // Peek ahead — if EOF or next division, leave trivia for the next division
        const peek = peekPastTrivia(state);
        if (!peek.nextUpper || isDivisionHeaderText(peek.nextUpper)) break;

        const trivia = consumeTrivia(state);

        const upper = peekUpperText(state);

        // Check for section headers
        if (upper.endsWith("SECTION.") || upper.startsWith("CONFIGURATION SECTION") ||
            upper.startsWith("INPUT-OUTPUT SECTION")) {
            const section = parseEnvironmentSection(state, trivia);
            children.push(section);
        } else if (upper.startsWith("FILE-CONTROL")) {
            const section = parseEnvironmentSection(state, trivia);
            children.push(section);
        } else if (upper.startsWith("SPECIAL-NAMES")) {
            const section = parseEnvironmentSection(state, trivia);
            children.push(section);
        } else if (upper.startsWith("SELECT")) {
            const line = state.lines[state.pos];
            // Collect continuation lines for SELECT
            let rawText = line.text.trim();
            state.pos++;
            while (state.pos < state.lines.length) {
                const nextLine = state.lines[state.pos];
                if (nextLine.isBlank || nextLine.isComment) break;
                const nextUpper = nextLine.text.trim().toUpperCase();
                if (isAtDivisionHeader(state) || isSectionOrSelectStart(nextUpper)) break;
                rawText += " " + nextLine.text.trim();
                state.pos++;
                if (rawText.endsWith(".")) break;
            }
            const select: SelectEntry = {
                kind: "SelectEntry",
                rawText,
                leadingTrivia: trivia,
            };
            children.push(select);
        } else {
            const line = state.lines[state.pos];
            const entry: DivisionEntry = {
                kind: "DivisionEntry",
                rawText: line.text.trim(),
                leadingTrivia: trivia,
            };
            children.push(entry);
            state.pos++;
        }
    }

    return children;
}

function parseEnvironmentSection(state: ParserState, leadingTrivia: import("../types.js").Trivia[]): Section {
    const headerLine = state.lines[state.pos];
    const section: Section = {
        kind: "Section",
        name: extractSectionName(headerLine.text.trim()),
        headerText: headerLine.text.trim(),
        leadingTrivia,
        children: [],
    };
    state.pos++;

    // Parse section contents until next section, division, or end
    while (state.pos < state.lines.length && !isAtDivisionHeader(state)) {
        // Peek ahead to decide whether to stop before consuming trivia
        const peek = peekPastTrivia(state);
        if (!peek.nextUpper || isDivisionHeaderText(peek.nextUpper)) break;

        // Stop at next section — don't consume trivia
        if (isSectionStart(peek.nextUpper) || peek.nextUpper.startsWith("FILE-CONTROL") || peek.nextUpper.startsWith("SPECIAL-NAMES")) {
            break;
        }

        const trivia = consumeTrivia(state);
        const upper = peekUpperText(state);

        if (upper.startsWith("SELECT")) {
            const line = state.lines[state.pos];
            let rawText = line.text.trim();
            state.pos++;
            while (state.pos < state.lines.length) {
                const nextLine = state.lines[state.pos];
                if (nextLine.isBlank || nextLine.isComment) break;
                const nextUpper = nextLine.text.trim().toUpperCase();
                if (isAtDivisionHeader(state) || isSectionOrSelectStart(nextUpper)) break;
                rawText += " " + nextLine.text.trim();
                state.pos++;
                if (rawText.endsWith(".")) break;
            }
            section.children.push({
                kind: "SelectEntry",
                rawText,
                leadingTrivia: trivia,
            });
        } else if (upper.startsWith("COPY ")) {
            section.children.push(parseCopyStatement(state, trivia));
        } else {
            const line = state.lines[state.pos];
            section.children.push({
                kind: "DivisionEntry",
                rawText: line.text.trim(),
                leadingTrivia: trivia,
            } satisfies DivisionEntry);
            state.pos++;
        }
    }

    return section;
}

function extractSectionName(text: string): string {
    const upper = text.toUpperCase();
    if (upper.startsWith("CONFIGURATION")) return "CONFIGURATION";
    if (upper.startsWith("INPUT-OUTPUT")) return "INPUT-OUTPUT";
    if (upper.startsWith("FILE-CONTROL")) return "FILE-CONTROL";
    if (upper.startsWith("SPECIAL-NAMES")) return "SPECIAL-NAMES";
    return text.split(/\s+/)[0];
}

function isSectionStart(upper: string): boolean {
    return upper.endsWith("SECTION.") ||
        upper.startsWith("CONFIGURATION SECTION") ||
        upper.startsWith("INPUT-OUTPUT SECTION");
}

function isSectionOrSelectStart(upper: string): boolean {
    return isSectionStart(upper) ||
        upper.startsWith("SELECT") ||
        upper.startsWith("FILE-CONTROL") ||
        upper.startsWith("SPECIAL-NAMES");
}

