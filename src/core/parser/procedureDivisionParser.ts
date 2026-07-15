/**
 * Parser for Procedure Division: paragraphs, sections, and block statements.
 */

import { type ParserState, consumeTrivia, isAtDivisionHeader, peekUpperText, peekPastTrivia } from "../parser.js";
import {
    type DivisionChild,
    type Paragraph,
    type ProcedureSection,
    type ProcedureStatement,
    type SimpleStatement,
    type IfStatement,
    type EvaluateStatement,
    type WhenBranch,
    type PerformBlock,
    type ReadBlock,
    type UnparsedLine,
    type Trivia,
} from "../types.js";
import {
    AREA_A_KEYWORDS,
    AREA_B_STATEMENTS,
    INDENT_START_KEYWORDS,
    INDENT_END_KEYWORDS,
    PROCEDURE_VERBS,
} from "../constants.js";

/**
 * Parse children of the Procedure Division.
 */
export function parseProcedureDivisionChildren(state: ParserState): DivisionChild[] {
    const children: DivisionChild[] = [];

    while (state.pos < state.lines.length && !isAtDivisionHeader(state)) {
        const trivia = consumeTrivia(state);
        if (state.pos >= state.lines.length || isAtDivisionHeader(state)) break;

        const upper = peekUpperText(state);

        // Check for SECTION header (e.g., "MAIN-SECTION SECTION.")
        if (/^\S+\s+SECTION\.?$/.test(upper)) {
            const section = parseProcSection(state, trivia);
            children.push(section);
        } else if (isParagraphName(state, upper)) {
            const para = parseParagraph(state, trivia);
            children.push(para);
        } else if (upper.startsWith("DECLARATIVES") || upper.startsWith("END DECLARATIVES")) {
            // DECLARATIVES and END DECLARATIVES are division-level structural markers
            const line = state.lines[state.pos];
            children.push({
                kind: "UnparsedLine",
                rawText: line.text.trim(),
                originalLine: line.originalLine,
                leadingTrivia: trivia,
            });
            state.pos++;
        } else {
            // Statement or unrecognized line at division level
            const { stmts } = parseStatementSequence(state, trivia, []);
            for (const stmt of stmts) {
                children.push(stmt as DivisionChild);
            }
        }
    }

    return children;
}

function parseProcSection(state: ParserState, leadingTrivia: Trivia[]): ProcedureSection {
    const headerLine = state.lines[state.pos];
    const name = headerLine.text.trim().split(/\s+/)[0];

    const section: ProcedureSection = {
        kind: "ProcedureSection",
        name,
        headerText: headerLine.text.trim(),
        leadingTrivia,
        paragraphs: [],
    };
    state.pos++;

    while (state.pos < state.lines.length && !isAtDivisionHeader(state)) {
        // Peek ahead to decide whether to stop before consuming trivia
        const peek = peekPastTrivia(state);
        if (!peek.nextUpper || isAtDivisionHeader(state)) break;

        // Stop at next SECTION or END DECLARATIVES — don't consume trivia
        if (/^\S+\s+SECTION\.?$/.test(peek.nextUpper) || peek.nextUpper.startsWith("END DECLARATIVES")) {
            break;
        }

        // Now consume trivia since we're staying in this section
        const trivia = consumeTrivia(state);
        const upper = peekUpperText(state);

        if (isParagraphName(state, upper)) {
            const para = parseParagraph(state, trivia);
            section.paragraphs.push(para);
        } else {
            // Statements before first paragraph — wrap in anonymous paragraph
            const { stmts } = parseStatementSequence(state, trivia, []);
            if (stmts.length > 0) {
                section.paragraphs.push({
                    kind: "Paragraph",
                    name: "",
                    leadingTrivia: [],
                    statements: stmts,
                });
            }
        }
    }

    return section;
}

function parseParagraph(state: ParserState, leadingTrivia: Trivia[]): Paragraph {
    const headerLine = state.lines[state.pos];
    const name = headerLine.text.trim().replace(/\.\s*$/, "");

    const para: Paragraph = {
        kind: "Paragraph",
        name,
        leadingTrivia,
        statements: [],
    };
    state.pos++;

    // Parse statements until next paragraph, section, or division
    while (state.pos < state.lines.length && !isAtDivisionHeader(state)) {
        // Peek ahead to decide whether to stop before consuming trivia
        const peek = peekPastTrivia(state);
        if (!peek.nextUpper || isAtDivisionHeader(state)) break;

        // Stop at next paragraph, section, or END DECLARATIVES — don't consume trivia
        if (isParagraphName(state, peek.nextUpper) || /^\S+\s+SECTION\.?$/.test(peek.nextUpper) || peek.nextUpper.startsWith("END DECLARATIVES")) {
            break;
        }

        const trivia = consumeTrivia(state);
        const { stmts } = parseStatementSequence(state, trivia, []);
        para.statements.push(...stmts);
    }

    return para;
}

/**
 * Result of parsing a statement sequence.
 * periodTerminated is true when parsing stopped because a statement ended with a period.
 */
interface SeqResult {
    stmts: ProcedureStatement[];
    periodTerminated: boolean;
}

/**
 * Parse a sequence of statements, respecting block structure.
 * Stops at a period-terminated statement (COBOL period closes all open scopes).
 * terminators: keywords that signal the end of the current block.
 */
function parseStatementSequence(
    state: ParserState,
    initialTrivia: Trivia[],
    terminators: string[],
): SeqResult {
    const stmts: ProcedureStatement[] = [];
    let currentTrivia = initialTrivia;

    while (state.pos < state.lines.length && !isAtDivisionHeader(state)) {
        const line = state.lines[state.pos];
        if (line.isBlank || line.isComment) {
            currentTrivia = [...currentTrivia, ...consumeTrivia(state)];
            continue;
        }

        const upper = peekUpperText(state);

        // Check terminators
        if (terminators.length > 0 && matchesTerminator(upper, terminators)) {
            break;
        }

        // Check for paragraph/section boundary or END DECLARATIVES
        if (isParagraphName(state, upper) || /^\S+\s+SECTION\.?$/.test(upper) || upper.startsWith("END DECLARATIVES")) {
            break;
        }

        const rawText = line.text.trim();
        const verb = extractVerb(upper);
        state.pos++;

        // Handle block statements
        if (verb === "IF") {
            const stmt = parseIfStatement(state, rawText, currentTrivia);
            stmts.push(stmt);
            currentTrivia = [];
            if (stmt.periodTerminated) return { stmts, periodTerminated: true };
        } else if (verb === "EVALUATE") {
            const stmt = parseEvaluateStatement(state, rawText, currentTrivia);
            stmts.push(stmt);
            currentTrivia = [];
            if (stmt.periodTerminated) return { stmts, periodTerminated: true };
        } else if (verb === "PERFORM" && isBlockPerform(upper, rawText)) {
            const stmt = parsePerformBlock(state, rawText, currentTrivia);
            stmts.push(stmt);
            currentTrivia = [];
            if (stmt.periodTerminated) return { stmts, periodTerminated: true };
        } else if (verb === "READ") {
            const stmt = parseReadBlock(state, rawText, currentTrivia, "END-READ");
            stmts.push(stmt);
            currentTrivia = [];
            if (stmt.periodTerminated) return { stmts, periodTerminated: true };
        } else if (verb === "REWRITE") {
            const stmt = parseReadBlock(state, rawText, currentTrivia, "END-REWRITE");
            stmts.push(stmt);
            currentTrivia = [];
            if (stmt.periodTerminated) return { stmts, periodTerminated: true };
        } else if (verb === "WRITE") {
            const stmt = parseReadBlock(state, rawText, currentTrivia, "END-WRITE");
            stmts.push(stmt);
            currentTrivia = [];
            if (stmt.periodTerminated) return { stmts, periodTerminated: true };
        } else if (verb === "DELETE") {
            const stmt = parseReadBlock(state, rawText, currentTrivia, "END-DELETE");
            stmts.push(stmt);
            currentTrivia = [];
            if (stmt.periodTerminated) return { stmts, periodTerminated: true };
        } else {
            // Simple statement
            const stmt: SimpleStatement = {
                kind: "SimpleStatement",
                verb,
                rawText,
                leadingTrivia: currentTrivia,
            };
            currentTrivia = [];

            // A period in a statement body closes all open scopes
            if (rawText.trimEnd().endsWith(".")) {
                stmts.push(stmt);
                return { stmts, periodTerminated: true };
            }

            // Collect continuation lines: subsequent lines that don't start with a known
            // COBOL verb. This handles multi-line statements like DISPLAY FLOATING WINDOW
            // where LINES/SYSTEM MENU/TITLE/POP-UP follow as option lines, and also
            // multi-line argument lists like CALL ... USING a, b, c where the final
            // argument(s) appear on their own line(s).
            let lastContinuedLine = rawText;
            const continuationLines: string[] = [];
            while (state.pos < state.lines.length && !isAtDivisionHeader(state)) {
                const nextLine = state.lines[state.pos];
                if (nextLine.isBlank || nextLine.isComment) break;
                const nextUpper = nextLine.text.trim().toUpperCase();
                // Only treat as a paragraph boundary when the previous line is "complete"
                // (not ending with a comma, which signals an incomplete argument list).
                if (isParagraphName(state, nextUpper) && !lastContinuedLine.trimEnd().endsWith(",")) break;
                if (/^\S+\s+SECTION\.?$/.test(nextUpper)) break;
                if (nextUpper.startsWith("END DECLARATIVES")) break;
                if (terminators.length > 0 && matchesTerminator(nextUpper, terminators)) break;
                if (isKnownVerb(nextUpper)) break;
                // A line ending with AND/OR is a boolean connector: the following
                // line continues the same logical expression. Keep collecting so
                // that multi-line conditions spanning 3+ lines (e.g. condition
                // AND condition AND condition) are fully gathered.
                // (No break here — the next line is still part of this statement.)
                const contText = nextLine.text.trim();
                continuationLines.push(contText);
                lastContinuedLine = contText;
                state.pos++;
                if (contText.trimEnd().endsWith(".")) break;
            }
            if (continuationLines.length > 0) {
                stmt.continuationLines = continuationLines;
                stmts.push(stmt);
                if (continuationLines[continuationLines.length - 1].trimEnd().endsWith(".")) {
                    return { stmts, periodTerminated: true };
                }
            } else {
                stmts.push(stmt);
            }
        }
    }

    return { stmts, periodTerminated: false };
}

function parseIfStatement(state: ParserState, headerText: string, leadingTrivia: Trivia[]): IfStatement {
    const conditionText = headerText;
    const thenBody: ProcedureStatement[] = [];
    let elseBody: ProcedureStatement[] = [];

    // Parse THEN body until ELSE, END-IF, or a period-terminated statement
    const thenTrivia = consumeTrivia(state);
    const thenResult = parseStatementSequence(state, thenTrivia, ["END-IF", "ELSE"]);
    thenBody.push(...thenResult.stmts);

    // If a period closed the then-body, the IF is period-terminated — no END-IF or ELSE
    if (thenResult.periodTerminated) {
        return {
            kind: "IfStatement",
            conditionText,
            thenBody,
            elseBody: [],
            leadingTrivia,
            periodTerminated: true,
        };
    }

    // Check if we hit ELSE
    const upper = peekUpperText(state);
    if (upper.startsWith("ELSE")) {
        state.pos++; // consume ELSE
        const elseTrivia = consumeTrivia(state);
        const elseResult = parseStatementSequence(state, elseTrivia, ["END-IF"]);
        elseBody = elseResult.stmts;

        // If the ELSE body was terminated by a period, the whole IF is period-terminated —
        // no END-IF should be emitted.
        if (elseResult.periodTerminated) {
            return {
                kind: "IfStatement",
                conditionText,
                thenBody,
                elseBody,
                leadingTrivia,
                periodTerminated: true,
            };
        }
    }

    // Consume END-IF if present
    const endUpper = peekUpperText(state);
    if (endUpper.startsWith("END-IF")) {
        state.pos++;
    }

    return {
        kind: "IfStatement",
        conditionText,
        thenBody,
        elseBody,
        leadingTrivia,
        periodTerminated: false,
    };
}

function parseEvaluateStatement(state: ParserState, headerText: string, leadingTrivia: Trivia[]): EvaluateStatement {
    const subjectText = headerText;
    const whenBranches: WhenBranch[] = [];
    let periodTerminated = false;

    while (state.pos < state.lines.length && !isAtDivisionHeader(state)) {
        const trivia = consumeTrivia(state);
        const upper = peekUpperText(state);

        if (upper.startsWith("END-EVALUATE")) {
            state.pos++;
            break;
        }

        if (upper.startsWith("WHEN")) {
            const whenLine = state.lines[state.pos];
            const conditionText = whenLine.text.trim();
            state.pos++;

            const bodyTrivia = consumeTrivia(state);
            const bodyResult = parseStatementSequence(state, bodyTrivia, ["WHEN", "WHEN OTHER", "END-EVALUATE"]);

            whenBranches.push({
                kind: "WhenBranch",
                conditionText,
                body: bodyResult.stmts,
                leadingTrivia: trivia,
            });

            // A period inside a WHEN body closes the EVALUATE (legacy style,
            // no END-EVALUATE follows).
            if (bodyResult.periodTerminated) {
                periodTerminated = true;
                break;
            }
        } else if (!upper) {
            break;
        } else {
            // Unexpected content — stop at structural boundaries; otherwise skip.
            if (isParagraphName(state, upper) || /^\S+\s+SECTION\.?$/.test(upper)) {
                // Don't consume trivia — rewind so the outer parser picks it up.
                // (trivia was already consumed above, so we must put it back here
                //  as an exception; this path is rare error-recovery.)
                state.pos -= trivia.length;
                break;
            }
            state.pos++;
        }
    }

    return {
        kind: "EvaluateStatement",
        subjectText,
        whenBranches,
        leadingTrivia,
        periodTerminated,
    };
}

function parsePerformBlock(state: ParserState, headerText: string, leadingTrivia: Trivia[]): PerformBlock {
    // A PERFORM whose header ends with a period is complete on that line —
    // the out-of-line form (e.g. "PERFORM CALC-PARA UNTIL DONE = 1.").
    // It has no inline body and no END-PERFORM follows.
    if (headerText.trimEnd().endsWith(".")) {
        return {
            kind: "PerformBlock",
            clauseText: headerText,
            body: [],
            leadingTrivia,
            periodTerminated: true,
        };
    }

    const bodyTrivia = consumeTrivia(state);
    const bodyResult = parseStatementSequence(state, bodyTrivia, ["END-PERFORM"]);

    let periodTerminated = false;
    const endUpper = peekUpperText(state);
    if (endUpper.startsWith("END-PERFORM")) {
        state.pos++;
    } else if (bodyResult.periodTerminated) {
        // Legacy style: a period inside the body closed the PERFORM and
        // no END-PERFORM follows — don't invent one when printing.
        periodTerminated = true;
    }

    return {
        kind: "PerformBlock",
        clauseText: headerText,
        body: bodyResult.stmts,
        leadingTrivia,
        periodTerminated,
    };
}

function parseReadBlock(state: ParserState, headerText: string, leadingTrivia: Trivia[], endTerminator: string): ReadBlock {
    // Detect and strip any inline clause from the header line.
    // e.g. "READ file INVALID KEY" → cleanHeader="READ file", inlineClause="INVALID KEY"
    // Check NOT-forms first (more specific) to avoid mismatching "INVALID KEY" inside "NOT INVALID KEY".
    let cleanHeader = headerText;
    let inlineClause: string | null = null;
    const upperHeader = headerText.toUpperCase();

    for (const clause of ["NOT INVALID KEY", "NOT AT END", "INVALID KEY", "AT END"]) {
        const spaceClause = " " + clause;
        const idx = upperHeader.indexOf(spaceClause);
        if (idx >= 0) {
            // Only strip if nothing meaningful follows the clause keyword
            const afterClause = upperHeader.substring(idx + spaceClause.length).trim();
            if (!afterClause) {
                cleanHeader = headerText.substring(0, idx).trim();
                inlineClause = clause;
                break;
            }
        }
    }

    const readBlock: ReadBlock = {
        kind: "ReadBlock",
        headerText: cleanHeader,
        endTerminator,
        atEndBody: [],
        notAtEndBody: [],
        invalidKeyBody: [],
        notInvalidKeyBody: [],
        leadingTrivia,
    };

    // If the (cleaned) header ends with a period the statement is fully self-contained
    // on one line (e.g. "WRITE RIVI BEFORE PAGE." or "READ file INVALID KEY action.").
    // Nothing follows on subsequent lines — return immediately as period-terminated.
    if (cleanHeader.trimEnd().endsWith(".")) {
        readBlock.periodTerminated = true;
        return readBlock;
    }

    // If an inline clause was found in the header, parse the immediately following
    // statements into the corresponding clause body before entering the main loop.
    if (inlineClause) {
        const stoppers = [endTerminator, "AT END", "NOT AT END", "INVALID KEY", "NOT INVALID KEY"];
        const bodyTrivia = consumeTrivia(state);
        const r = parseStatementSequence(state, bodyTrivia, stoppers);
        switch (inlineClause) {
            case "INVALID KEY":     readBlock.invalidKeyBody = r.stmts; break;
            case "NOT INVALID KEY": readBlock.notInvalidKeyBody = r.stmts; break;
            case "AT END":          readBlock.atEndBody = r.stmts; break;
            case "NOT AT END":      readBlock.notAtEndBody = r.stmts; break;
        }
        if (r.periodTerminated) {
            readBlock.periodTerminated = true;
            return readBlock;
        }
    }

    while (state.pos < state.lines.length && !isAtDivisionHeader(state)) {
        // Peek ahead to decide whether to stop before consuming trivia
        const peek = peekPastTrivia(state);
        if (!peek.nextUpper) break;

        if (peek.nextUpper.startsWith(endTerminator)) {
            // Consume trivia + the END-xxx line
            consumeTrivia(state);
            state.pos++;
            break;
        }

        // Stop at structural boundaries — don't consume trivia
        if (isParagraphName(state, peek.nextUpper) || /^\S+\s+SECTION\.?$/.test(peek.nextUpper) || peek.nextUpper.startsWith("END DECLARATIVES")) {
            break;
        }

        const trivia = consumeTrivia(state);
        const upper = peekUpperText(state);

        if (upper.startsWith("NOT AT END")) {
            state.pos++;
            const bodyTrivia = consumeTrivia(state);
            const r = parseStatementSequence(state, bodyTrivia, [endTerminator, "NOT AT END", "AT END", "INVALID KEY", "NOT INVALID KEY"]);
            readBlock.notAtEndBody = r.stmts;
            if (r.periodTerminated) { readBlock.periodTerminated = true; break; }
        } else if (upper.startsWith("AT END")) {
            state.pos++;
            const bodyTrivia = consumeTrivia(state);
            const r = parseStatementSequence(state, bodyTrivia, [endTerminator, "NOT AT END", "INVALID KEY", "NOT INVALID KEY"]);
            readBlock.atEndBody = r.stmts;
            if (r.periodTerminated) { readBlock.periodTerminated = true; break; }
        } else if (upper.startsWith("NOT INVALID KEY")) {
            state.pos++;
            const bodyTrivia = consumeTrivia(state);
            const r = parseStatementSequence(state, bodyTrivia, [endTerminator]);
            readBlock.notInvalidKeyBody = r.stmts;
            if (r.periodTerminated) { readBlock.periodTerminated = true; break; }
        } else if (upper.startsWith("INVALID KEY")) {
            state.pos++;
            const bodyTrivia = consumeTrivia(state);
            const r = parseStatementSequence(state, bodyTrivia, [endTerminator, "NOT INVALID KEY"]);
            readBlock.invalidKeyBody = r.stmts;
            if (r.periodTerminated) { readBlock.periodTerminated = true; break; }
        } else if (!upper) {
            break;
        } else {
            // Unknown content (e.g. inline body after "READ file INVALID KEY" on the same
            // line, or after "REWRITE file INVALID KEY"). Parse rather than silently drop.
            const { stmts, periodTerminated } = parseStatementSequence(state, trivia, [endTerminator]);
            readBlock.invalidKeyBody.push(...stmts);
            if (periodTerminated) {
                readBlock.periodTerminated = true;
                break;
            }
        }
    }

    return readBlock;
}

// ─── Helpers ────────────────────────────────────────────────────────────

/**
 * Returns true if the line starts with a known COBOL procedure verb or scope terminator.
 * Used to decide whether a line is a continuation of the previous statement or a new one.
 */
function isKnownVerb(upper: string): boolean {
    const firstWord = upper.match(/^([A-Z][\w-]*)/)?.[1] ?? "";
    if (!firstWord) return false;
    // Scope terminators (END-IF, END-READ, etc.)
    if (INDENT_END_KEYWORDS.some(k => upper.startsWith(k))) return true;
    // Standard procedure verbs — match on first word of each verb entry
    if (PROCEDURE_VERBS.some(v => v.split(" ")[0] === firstWord)) return true;
    // Other structural keywords
    if (firstWord === "ELSE" || firstWord === "WHEN" || firstWord === "END") return true;
    return false;
}

function isParagraphName(state: ParserState, upper: string): boolean {
    // A paragraph name is a word followed by a period, that's not a known statement
    const match = upper.match(/^([A-Z0-9-]+)\.\s*$/);
    if (!match) return false;

    const name = match[1];
    // Exclude known statements and keywords
    if (AREA_B_STATEMENTS.some(s => s === name)) return false;
    if ([...INDENT_START_KEYWORDS, ...INDENT_END_KEYWORDS].some(k => k === name)) return false;
    if (name === "PERFORM" || name === "ELSE" || name === "WHEN") return false;

    return true;
}

function matchesTerminator(upper: string, terminators: string[]): boolean {
    return terminators.some(t => upper.startsWith(t));
}

function extractVerb(upper: string): string {
    const match = upper.match(/^([A-Z][\w-]*)/);
    return match ? match[1] : "";
}

function isBlockPerform(upper: string, rawText: string): boolean {
    const lineWithoutPeriod = upper.replace(/\.\s*$/, "");
    return upper.includes(" UNTIL ") ||
        upper.includes(" VARYING ") ||
        upper.includes(" TIMES ") ||
        lineWithoutPeriod.trim() === "PERFORM";
}
