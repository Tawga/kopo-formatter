/**
 * Parser for Procedure Division: paragraphs, sections, and block statements.
 */

import { type ParserState, consumeTrivia, isAtDivisionHeader, isDivisionHeaderText, peekUpperText, peekPastTrivia } from "../parser.js";
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
    type ConditionalBlock,
    type ConditionalClause,
    type Declaratives,
    type Trivia,
    type UnparsedLine,
} from "../types.js";
import {
    AREA_B_STATEMENTS,
    INDENT_START_KEYWORDS,
    INDENT_END_KEYWORDS,
    PROCEDURE_VERBS,
    CONDITIONAL_VERBS,
    type ConditionalVerbConfig,
} from "../constants.js";
import { parseExecBlock } from "./execBlockParser.js";

/**
 * Parse children of the Procedure Division.
 */
export function parseProcedureDivisionChildren(state: ParserState): DivisionChild[] {
    const children: DivisionChild[] = [];

    while (state.pos < state.lines.length && !isAtDivisionHeader(state)) {
        // Peek first: trivia in front of the next division header must stay
        // unconsumed so it becomes that division's leading trivia.
        const peek = peekPastTrivia(state);
        if (!peek.nextUpper || isDivisionHeaderText(peek.nextUpper)) break;

        const trivia = consumeTrivia(state);
        const upper = peekUpperText(state);

        // DECLARATIVES must be checked before the paragraph-name rule:
        // "DECLARATIVES." would otherwise match as a paragraph header.
        if (upper.startsWith("DECLARATIVES")) {
            children.push(parseDeclaratives(state, trivia));
        } else if (/^\S+\s+SECTION\.?$/.test(upper)) {
            // SECTION header (e.g., "MAIN-SECTION SECTION.")
            const section = parseProcSection(state, trivia);
            children.push(section);
        } else if (isParagraphName(upper)) {
            const para = parseParagraph(state, trivia);
            children.push(para);
        } else if (upper.startsWith("END DECLARATIVES")) {
            // Stray END DECLARATIVES without a matching header — pass through
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
        if (!peek.nextUpper || isDivisionHeaderText(peek.nextUpper)) break;

        // Stop at next SECTION or END DECLARATIVES — don't consume trivia
        if (/^\S+\s+SECTION\.?$/.test(peek.nextUpper) || peek.nextUpper.startsWith("END DECLARATIVES")) {
            break;
        }

        // Now consume trivia since we're staying in this section
        const trivia = consumeTrivia(state);
        const upper = peekUpperText(state);

        if (isParagraphName(upper)) {
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

/**
 * Parse a DECLARATIVES ... END DECLARATIVES region into a structured node.
 * The region contains USE sections, each parsed as a normal procedure section
 * (parseProcSection already stops at END DECLARATIVES).
 */
function parseDeclaratives(state: ParserState, leadingTrivia: Trivia[]): Declaratives {
    const headerLine = state.lines[state.pos];
    state.pos++;

    const decl: Declaratives = {
        kind: "Declaratives",
        headerText: headerLine.text.trim(),
        endText: "",
        sections: [],
        leadingTrivia,
        endLeadingTrivia: [],
    };

    while (state.pos < state.lines.length && !isAtDivisionHeader(state)) {
        const peek = peekPastTrivia(state);
        if (!peek.nextUpper || isDivisionHeaderText(peek.nextUpper)) break;

        if (peek.nextUpper.startsWith("END DECLARATIVES")) {
            decl.endLeadingTrivia = consumeTrivia(state);
            decl.endText = state.lines[state.pos].text.trim();
            state.pos++;
            break;
        }

        const trivia = consumeTrivia(state);
        const upper = peekUpperText(state);

        if (/^\S+\s+SECTION\b/.test(upper)) {
            decl.sections.push(parseProcSection(state, trivia));
        } else {
            // Malformed content (declaratives must contain sections) — wrap
            // whatever we find in an anonymous section so nothing is lost.
            const { stmts } = parseStatementSequence(state, trivia, ["END DECLARATIVES"]);
            if (stmts.length > 0) {
                decl.sections.push({
                    kind: "ProcedureSection",
                    name: "",
                    headerText: "",
                    leadingTrivia: [],
                    paragraphs: [{ kind: "Paragraph", name: "", leadingTrivia: [], statements: stmts }],
                });
            } else {
                break; // no progress — bail rather than loop forever
            }
        }
    }

    return decl;
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
        if (!peek.nextUpper || isDivisionHeaderText(peek.nextUpper)) break;

        // Stop at next paragraph, section, or END DECLARATIVES — don't consume trivia
        if (isParagraphName(peek.nextUpper) || /^\S+\s+SECTION\.?$/.test(peek.nextUpper) || peek.nextUpper.startsWith("END DECLARATIVES")) {
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
        // Decide from a non-consuming peek whether the sequence continues.
        // Trivia before a terminator or boundary is left in the stream so the
        // enclosing construct can attach it (e.g. a comment before END-IF).
        const peek = peekPastTrivia(state);
        if (!peek.nextUpper || isDivisionHeaderText(peek.nextUpper)) break;

        // Check terminators
        if (terminators.length > 0 && matchesTerminator(peek.nextUpper, terminators)) {
            break;
        }

        // Check for paragraph/section boundary or END DECLARATIVES
        if (isParagraphName(peek.nextUpper) || /^\S+\s+SECTION\.?$/.test(peek.nextUpper) || peek.nextUpper.startsWith("END DECLARATIVES")) {
            break;
        }

        // The next real line belongs to this sequence — now consume its trivia.
        currentTrivia = [...currentTrivia, ...consumeTrivia(state)];

        const line = state.lines[state.pos];
        const upper = peekUpperText(state);
        const rawText = line.text.trim();
        const verb = extractVerb(upper);
        state.pos++;

        // Handle block statements
        if (verb === "IF") {
            const stmt = parseIfStatement(state, rawText, currentTrivia);
            stmts.push(stmt);
            currentTrivia = [];
            if (stmt.periodTerminated || stmt.endTerminatorPeriod) return { stmts, periodTerminated: true };
        } else if (verb === "EVALUATE") {
            const stmt = parseEvaluateStatement(state, rawText, currentTrivia);
            stmts.push(stmt);
            currentTrivia = [];
            if (stmt.periodTerminated || stmt.endTerminatorPeriod) return { stmts, periodTerminated: true };
        } else if (verb === "PERFORM" && isBlockPerform(upper)) {
            const stmt = parsePerformBlock(state, rawText, currentTrivia);
            stmts.push(stmt);
            currentTrivia = [];
            if (stmt.periodTerminated || stmt.endTerminatorPeriod) return { stmts, periodTerminated: true };
        } else if (verb === "EXEC") {
            const stmt = parseExecBlock(state, rawText, currentTrivia);
            stmts.push(stmt);
            currentTrivia = [];
            if (stmt.periodTerminated) return { stmts, periodTerminated: true };
        } else if (CONDITIONAL_VERBS[verb]) {
            const result = parseConditionalStatement(state, rawText, currentTrivia, verb, CONDITIONAL_VERBS[verb], terminators);
            stmts.push(result.stmt);
            currentTrivia = [];
            if (result.periodTerminated) return { stmts, periodTerminated: true };
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

            const cont = collectContinuationLines(state, rawText, terminators, []);
            if (cont.lines.length > 0) {
                stmt.continuationLines = cont.lines;
            }
            stmts.push(stmt);
            if (cont.endedWithPeriod) {
                return { stmts, periodTerminated: true };
            }
        }
    }

    return { stmts, periodTerminated: false };
}

/** Result of collecting a statement's continuation lines. */
interface ContinuationResult {
    lines: string[];
    /** True when the last collected line (or the header) ended the sentence with a period */
    endedWithPeriod: boolean;
}

/**
 * Collect continuation lines of a multi-line statement: subsequent lines that
 * don't start with a known COBOL verb. This handles multi-line statements like
 * DISPLAY FLOATING WINDOW where LINES/SYSTEM MENU/TITLE/POP-UP follow as
 * option lines, and multi-line argument lists like CALL ... USING a, b, c
 * where the final argument(s) appear on their own line(s).
 *
 * A line ending with AND/OR is a boolean connector: the following line
 * continues the same logical expression, so collection keeps going and
 * multi-line conditions spanning 3+ lines are fully gathered.
 *
 * `clauseStoppers` are conditional-clause keywords (and the END-xxx
 * terminator) that end collection for conditional verbs — e.g. an
 * "ON EXCEPTION" line after CALL arguments belongs to the block structure,
 * not to the argument list.
 */
function collectContinuationLines(
    state: ParserState,
    headerText: string,
    terminators: string[],
    clauseStoppers: readonly string[],
): ContinuationResult {
    let lastContinuedLine = headerText;
    const lines: string[] = [];

    while (state.pos < state.lines.length && !isAtDivisionHeader(state)) {
        const nextLine = state.lines[state.pos];
        if (nextLine.isBlank || nextLine.isComment) break;
        const nextUpper = nextLine.text.trim().toUpperCase();
        // Only treat as a paragraph boundary when the previous line is "complete"
        // (not ending with a comma, which signals an incomplete argument list).
        if (isParagraphName(nextUpper) && !lastContinuedLine.trimEnd().endsWith(",")) break;
        if (/^\S+\s+SECTION\.?$/.test(nextUpper)) break;
        if (nextUpper.startsWith("END DECLARATIVES")) break;
        if (terminators.length > 0 && matchesTerminator(nextUpper, terminators)) break;
        if (clauseStoppers.length > 0 && matchClauseStart(nextUpper, clauseStoppers)) break;
        if (isKnownVerb(nextUpper)) break;

        const contText = nextLine.text.trim();
        lines.push(contText);
        lastContinuedLine = contText;
        state.pos++;
        if (contText.trimEnd().endsWith(".")) break;
    }

    return {
        lines,
        endedWithPeriod: lines.length > 0 && lines[lines.length - 1].trimEnd().endsWith("."),
    };
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

    // Check if we hit ELSE (peeking past any comments before it)
    let elseLeadingTrivia: Trivia[] | undefined;
    const elsePeek = peekPastTrivia(state);
    if (elsePeek.nextUpper.startsWith("ELSE")) {
        const trivia = consumeTrivia(state);
        if (trivia.length > 0) elseLeadingTrivia = trivia;
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
                elseLeadingTrivia,
                periodTerminated: true,
            };
        }
    }

    // Consume END-IF if present (peeking past any comments before it)
    let endTerminatorTrivia: Trivia[] | undefined;
    let endTerminatorPeriod = false;
    const endPeek = peekPastTrivia(state);
    if (endPeek.nextUpper.startsWith("END-IF")) {
        const trivia = consumeTrivia(state);
        if (trivia.length > 0) endTerminatorTrivia = trivia;
        endTerminatorPeriod = state.lines[state.pos].text.trimEnd().endsWith(".");
        state.pos++;
    }

    return {
        kind: "IfStatement",
        conditionText,
        thenBody,
        elseBody,
        leadingTrivia,
        elseLeadingTrivia,
        endTerminatorTrivia,
        periodTerminated: false,
        endTerminatorPeriod,
    };
}

function parseEvaluateStatement(state: ParserState, headerText: string, leadingTrivia: Trivia[]): EvaluateStatement {
    let subjectText = headerText;
    const whenBranches: WhenBranch[] = [];
    let periodTerminated = false;
    let endTerminatorTrivia: Trivia[] | undefined;
    let endTerminatorPeriod = false;
    // Trivia consumed alongside a subject continuation line, waiting for the
    // next construct (WHEN branch / END-EVALUATE) to attach to.
    let carriedTrivia: Trivia[] = [];

    while (state.pos < state.lines.length && !isAtDivisionHeader(state)) {
        const trivia = consumeTrivia(state);
        const upper = peekUpperText(state);

        if (upper.startsWith("END-EVALUATE")) {
            const endTrivia = [...carriedTrivia, ...trivia];
            if (endTrivia.length > 0) endTerminatorTrivia = endTrivia;
            carriedTrivia = [];
            endTerminatorPeriod = state.lines[state.pos].text.trimEnd().endsWith(".");
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
                leadingTrivia: [...carriedTrivia, ...trivia],
            });
            carriedTrivia = [];

            // A period inside a WHEN body closes the EVALUATE (legacy style,
            // no END-EVALUATE follows).
            if (bodyResult.periodTerminated) {
                periodTerminated = true;
                break;
            }
        } else if (!upper) {
            break;
        } else {
            // Unexpected content — stop at structural boundaries; otherwise
            // keep the line rather than dropping it.
            if (isParagraphName(upper) || /^\S+\s+SECTION\.?$/.test(upper)
                || upper.startsWith("END DECLARATIVES") || isDivisionHeaderText(upper)) {
                // Don't consume trivia — rewind so the outer parser picks it up.
                // (trivia was already consumed above, so we must put it back here
                //  as an exception; this path is rare error-recovery.)
                state.pos -= trivia.length;
                break;
            }

            if (whenBranches.length > 0) {
                // Content resuming the last WHEN body (e.g. after an
                // interrupting comment) — parse it into that body.
                const last = whenBranches[whenBranches.length - 1];
                const merged = [...carriedTrivia, ...trivia];
                carriedTrivia = [];
                const posBefore = state.pos;
                const r = parseStatementSequence(state, merged, ["WHEN", "WHEN OTHER", "END-EVALUATE"]);
                last.body.push(...r.stmts);
                if (r.periodTerminated) {
                    periodTerminated = true;
                    break;
                }
                if (state.pos === posBefore) {
                    // Defensive: no progress — keep the line as passthrough
                    const line = state.lines[state.pos];
                    state.diagnostics.push({
                        severity: "warning",
                        message: `Unrecognized line inside EVALUATE kept as-is: "${line.text.trim().substring(0, 40)}"`,
                        line: line.originalLine + 1,
                    });
                    last.body.push({
                        kind: "UnparsedLine",
                        rawText: line.text.trim(),
                        originalLine: line.originalLine,
                        leadingTrivia: r.stmts.length === 0 ? merged : [],
                    } satisfies UnparsedLine);
                    state.pos++;
                }
            } else {
                // Between EVALUATE and the first WHEN — treat as a subject
                // continuation; its trivia rides along to the next construct.
                const line = state.lines[state.pos];
                state.diagnostics.push({
                    severity: "warning",
                    message: `Line before first WHEN joined to EVALUATE subject: "${line.text.trim().substring(0, 40)}"`,
                    line: line.originalLine + 1,
                });
                subjectText += " " + line.text.trim();
                carriedTrivia.push(...trivia);
                state.pos++;
            }
        }
    }

    // Trivia still carried at loop end (e.g. EOF without END-EVALUATE)
    if (carriedTrivia.length > 0) {
        endTerminatorTrivia = [...(endTerminatorTrivia ?? []), ...carriedTrivia];
    }

    return {
        kind: "EvaluateStatement",
        subjectText,
        whenBranches,
        leadingTrivia,
        endTerminatorTrivia,
        periodTerminated,
        endTerminatorPeriod,
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
    let endTerminatorTrivia: Trivia[] | undefined;
    let endTerminatorPeriod = false;
    const endPeek = peekPastTrivia(state);
    if (endPeek.nextUpper.startsWith("END-PERFORM")) {
        const trivia = consumeTrivia(state);
        if (trivia.length > 0) endTerminatorTrivia = trivia;
        endTerminatorPeriod = state.lines[state.pos].text.trimEnd().endsWith(".");
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
        endTerminatorTrivia,
        periodTerminated,
        endTerminatorPeriod,
    };
}

// ─── Conditional blocks (READ, CALL, COMPUTE, SEARCH, ...) ──────────────

/** Cache of compiled clause-keyword regexes. */
const clauseStartRegexCache = new Map<string, RegExp>();
const clauseInlineRegexCache = new Map<string, RegExp>();

/**
 * Regex matching a clause keyword at the start of a line, at a word boundary.
 * A following hyphen does not match, so "AT END" never matches "AT END-OF-PAGE"
 * and "WHEN" never matches the paragraph name "WHEN-X".
 */
function clauseStartRegex(keyword: string): RegExp {
    let re = clauseStartRegexCache.get(keyword);
    if (!re) {
        re = new RegExp("^" + keyword.split(" ").join("\\s+") + "(?![\\w-])");
        clauseStartRegexCache.set(keyword, re);
    }
    return re;
}

/** Regex finding a clause keyword mid-line (preceded by whitespace), word-bounded. */
function clauseInlineRegex(keyword: string): RegExp {
    let re = clauseInlineRegexCache.get(keyword);
    if (!re) {
        re = new RegExp("(?:^|\\s)(" + keyword.split(" ").join("\\s+") + ")(?![\\w-])", "g");
        clauseInlineRegexCache.set(keyword, re);
    }
    return re;
}

/** Return the clause keyword that starts the line, or null. */
function matchClauseStart(upper: string, clauses: readonly string[]): string | null {
    for (const kw of clauses) {
        if (clauseStartRegex(kw).test(upper)) return kw;
    }
    return null;
}

/** Mark which character positions of `text` lie inside a string literal. */
function literalMask(text: string): boolean[] {
    const mask: boolean[] = [];
    let quote: string | null = null;
    for (const ch of text) {
        if (quote) {
            mask.push(true);
            if (ch === quote) quote = null;
        } else if (ch === '"' || ch === "'") {
            mask.push(true);
            quote = ch;
        } else {
            mask.push(false);
        }
    }
    return mask;
}

/**
 * Find the earliest clause keyword in `text` that lies outside string literals.
 * `fromIndex` skips a prefix (used when splitting successive inline clauses).
 */
function findInlineClause(
    text: string,
    clauses: readonly string[],
    fromIndex: number = 0,
): { index: number; keyword: string } | null {
    const upper = text.toUpperCase();
    const mask = literalMask(text);
    let best: { index: number; keyword: string } | null = null;

    for (const kw of clauses) {
        const re = clauseInlineRegex(kw);
        re.lastIndex = fromIndex;
        let m: RegExpExecArray | null;
        while ((m = re.exec(upper)) !== null) {
            const idx = m.index + m[0].length - m[1].length; // start of the keyword itself
            if (mask[idx]) continue; // inside a literal — keep scanning
            // NOT-forms and longer keywords are listed first, so on an index
            // tie the earlier-listed keyword wins (strict <).
            if (best === null || idx < best.index) best = { index: idx, keyword: kw };
            break;
        }
    }
    return best;
}

interface ConditionalResult {
    stmt: ProcedureStatement;
    periodTerminated: boolean;
}

/**
 * Parse a statement whose verb accepts conditional clauses (per
 * CONDITIONAL_VERBS). Returns a ConditionalBlock when clauses are actually
 * present — inline in the header or on following lines — and a plain
 * SimpleStatement otherwise, so "ADD 1 TO X." stays flat.
 */
function parseConditionalStatement(
    state: ParserState,
    headerText: string,
    leadingTrivia: Trivia[],
    verb: string,
    cfg: ConditionalVerbConfig,
    terminators: string[],
): ConditionalResult {
    // Inline clause on the header line → definitely a block.
    const inline = findInlineClause(headerText, cfg.clauses);
    if (inline) {
        return parseInlineConditionalBlock(state, headerText, inline, leadingTrivia, verb, cfg, terminators);
    }

    // Header is a complete sentence → plain statement.
    if (headerText.trimEnd().endsWith(".")) {
        return {
            stmt: { kind: "SimpleStatement", verb, rawText: headerText, leadingTrivia },
            periodTerminated: true,
        };
    }

    // Collect header continuations (e.g. CALL USING arguments on their own
    // lines), stopping at clause keywords and the END-xxx terminator.
    const stoppers = [...cfg.clauses, cfg.endTerminator];
    const cont = collectContinuationLines(state, headerText, terminators, stoppers);

    // Block mode only when a clause or the END-xxx actually follows.
    const peek = peekPastTrivia(state);
    const blockFollows = !cont.endedWithPeriod && peek.nextUpper !== "" &&
        (matchClauseStart(peek.nextUpper, cfg.clauses) !== null ||
            clauseStartRegex(cfg.endTerminator).test(peek.nextUpper));

    if (blockFollows) {
        const block: ConditionalBlock = {
            kind: "ConditionalBlock",
            verb,
            headerText,
            continuationLines: cont.lines.length > 0 ? cont.lines : undefined,
            endTerminator: cfg.endTerminator,
            clauses: [],
            leadingTrivia,
        };
        parseClauseLines(state, block, cfg, terminators);
        return { stmt: block, periodTerminated: block.periodTerminated === true || block.endTerminatorPeriod === true };
    }

    const stmt: SimpleStatement = { kind: "SimpleStatement", verb, rawText: headerText, leadingTrivia };
    if (cont.lines.length > 0) stmt.continuationLines = cont.lines;
    return { stmt, periodTerminated: cont.endedWithPeriod };
}

/**
 * Parse a conditional block whose header line already contains one or more
 * inline clauses, e.g. "READ TUO-FILE INVALID KEY" or
 * "COMPUTE X = A / B ON SIZE ERROR MOVE 0 TO X.".
 *
 * The header keeps everything before the first clause; each inline clause
 * segment (keyword plus any imperative text up to the next clause) becomes a
 * ConditionalClause whose following lines are parsed as its body.
 */
function parseInlineConditionalBlock(
    state: ParserState,
    headerText: string,
    firstClause: { index: number; keyword: string },
    leadingTrivia: Trivia[],
    verb: string,
    cfg: ConditionalVerbConfig,
    terminators: string[],
): ConditionalResult {
    const block: ConditionalBlock = {
        kind: "ConditionalBlock",
        verb,
        headerText: headerText.substring(0, firstClause.index).trim(),
        endTerminator: cfg.endTerminator,
        clauses: [],
        leadingTrivia,
    };

    // Split the rest of the line into successive clause segments.
    let pos = firstClause.index;
    while (pos < headerText.length) {
        const next = findInlineClause(headerText, cfg.clauses, pos + 1);
        const end = next ? next.index : headerText.length;
        block.clauses.push({
            kind: "ConditionalClause",
            text: headerText.substring(pos, end).trim(),
            body: [],
            leadingTrivia: [],
        });
        pos = end;
    }

    const lastClause = block.clauses[block.clauses.length - 1];
    if (lastClause.text.trimEnd().endsWith(".")) {
        // The sentence ended on the header line — the block is complete.
        block.periodTerminated = true;
        return { stmt: block, periodTerminated: true };
    }

    // Following lines belong to the last inline clause's body, then the
    // regular clause-line loop takes over for further clauses / END-xxx.
    const bodyTrivia = consumeTrivia(state);
    const r = parseStatementSequence(state, bodyTrivia, [block.endTerminator, ...cfg.clauses]);
    lastClause.body = r.stmts;
    if (r.periodTerminated) {
        block.periodTerminated = true;
        return { stmt: block, periodTerminated: true };
    }

    parseClauseLines(state, block, cfg, terminators);
    return { stmt: block, periodTerminated: block.periodTerminated === true || block.endTerminatorPeriod === true };
}

/**
 * Parse clause lines (AT END, ON SIZE ERROR, WHEN ..., etc.) and their bodies
 * until the END-xxx terminator, a closing period, or a structural boundary.
 */
function parseClauseLines(
    state: ParserState,
    block: ConditionalBlock,
    cfg: ConditionalVerbConfig,
    terminators: string[],
): void {
    while (state.pos < state.lines.length && !isAtDivisionHeader(state)) {
        // Decide everything from a non-consuming peek so trivia stays with
        // whatever construct actually owns it.
        const peek = peekPastTrivia(state);
        if (!peek.nextUpper || isDivisionHeaderText(peek.nextUpper)) break;

        if (clauseStartRegex(block.endTerminator).test(peek.nextUpper)) {
            const endTrivia = consumeTrivia(state);
            if (endTrivia.length > 0) block.endTerminatorTrivia = endTrivia;
            block.endTerminatorPeriod = state.lines[state.pos].text.trimEnd().endsWith(".");
            state.pos++;
            break;
        }

        // Structural boundaries and enclosing-block terminators end the block
        // without consuming anything.
        if (isParagraphName(peek.nextUpper) || /^\S+\s+SECTION\.?$/.test(peek.nextUpper) || peek.nextUpper.startsWith("END DECLARATIVES")) {
            break;
        }
        if (terminators.length > 0 && matchesTerminator(peek.nextUpper, terminators)) {
            break;
        }

        const posBefore = state.pos;
        const kw = matchClauseStart(peek.nextUpper, cfg.clauses);

        if (kw) {
            const trivia = consumeTrivia(state);
            const clauseLine = state.lines[state.pos];
            state.pos++;
            const clause: ConditionalClause = {
                kind: "ConditionalClause",
                text: clauseLine.text.trim(),
                body: [],
                leadingTrivia: trivia,
            };
            block.clauses.push(clause);

            if (clause.text.trimEnd().endsWith(".")) {
                block.periodTerminated = true;
                break;
            }

            const bodyTrivia = consumeTrivia(state);
            const r = parseStatementSequence(state, bodyTrivia, [block.endTerminator, ...cfg.clauses]);
            clause.body = r.stmts;
            if (r.periodTerminated) {
                block.periodTerminated = true;
                break;
            }
        } else if (block.clauses.length > 0) {
            // Content that belongs to the previous clause's body (e.g. after a
            // comment interrupted the body). Parse rather than silently drop.
            const trivia = consumeTrivia(state);
            const r = parseStatementSequence(state, trivia, [block.endTerminator, ...cfg.clauses]);
            block.clauses[block.clauses.length - 1].body.push(...r.stmts);
            if (r.periodTerminated) {
                block.periodTerminated = true;
                break;
            }
        } else {
            break;
        }

        // Safety: never loop without progress — keep the stuck line rather
        // than dropping it. (Only reachable from the clause-body arm above,
        // so the current line is non-trivia and a clause exists.)
        if (state.pos === posBefore) {
            const stuck = state.lines[state.pos];
            if (stuck && !stuck.isComment && !stuck.isBlank && block.clauses.length > 0) {
                state.diagnostics.push({
                    severity: "warning",
                    message: `Unrecognized line inside ${block.verb} block kept as-is: "${stuck.text.trim().substring(0, 40)}"`,
                    line: stuck.originalLine + 1,
                });
                block.clauses[block.clauses.length - 1].body.push({
                    kind: "UnparsedLine",
                    rawText: stuck.text.trim(),
                    originalLine: stuck.originalLine,
                    leadingTrivia: [],
                } satisfies UnparsedLine);
                state.pos++;
            } else {
                break;
            }
        }
    }
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

function isParagraphName(upper: string): boolean {
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
    // Word-boundary match: "WHEN" must not match "WHEN-X." (a paragraph name),
    // and "END-IF" must not match "END-IFX". A following hyphen is treated as
    // part of the word because COBOL identifiers are hyphenated.
    return terminators.some(t => clauseStartRegex(t).test(upper));
}

function extractVerb(upper: string): string {
    const match = upper.match(/^([A-Z][\w-]*)/);
    return match ? match[1] : "";
}

function isBlockPerform(upper: string): boolean {
    const lineWithoutPeriod = upper.replace(/\.\s*$/, "");
    return upper.includes(" UNTIL ") ||
        upper.includes(" VARYING ") ||
        upper.includes(" TIMES ") ||
        lineWithoutPeriod.trim() === "PERFORM";
}
