/**
 * Parser for EXEC SQL / EXEC CICS ... END-EXEC blocks.
 *
 * The interior is foreign syntax (SQL, CICS commands) with its own layout,
 * so everything between the EXEC header and END-EXEC is captured verbatim —
 * original columns, casing, comments, and blank lines included.
 */

import { type ParserState, isDivisionHeaderText } from "../parser.js";
import { type ExecBlock, type ExecBodyLine, type Trivia } from "../types.js";

/**
 * True when `text` contains END-EXEC at a word boundary outside string literals.
 */
function containsEndExec(text: string): boolean {
    const upper = text.toUpperCase();
    let quote: string | null = null;
    for (let i = 0; i <= upper.length - 8; i++) {
        const ch = upper[i];
        if (quote) {
            if (ch === quote) quote = null;
            continue;
        }
        if (ch === '"' || ch === "'") {
            quote = ch;
            continue;
        }
        if (upper.startsWith("END-EXEC", i)
            && (i === 0 || /\s/.test(upper[i - 1]))
            && !/[\w-]/.test(upper[i + 8] ?? "")) {
            return true;
        }
    }
    return false;
}

/**
 * Parse an EXEC ... END-EXEC block. The header line has already been consumed
 * by the caller; `headerText` is its trimmed content.
 *
 * If END-EXEC never appears, everything up to the next division header (or
 * EOF) is kept verbatim in the body — the formatter must not lose or reshape
 * text it cannot delimit.
 */
export function parseExecBlock(
    state: ParserState,
    headerText: string,
    leadingTrivia: Trivia[],
): ExecBlock {
    // Single-line block: "EXEC SQL COMMIT END-EXEC."
    if (containsEndExec(headerText)) {
        return {
            kind: "ExecBlock",
            headerText,
            bodyLines: [],
            endText: "",
            leadingTrivia,
            periodTerminated: headerText.trimEnd().endsWith("."),
        };
    }

    const bodyLines: ExecBodyLine[] = [];
    let endText = "";
    let periodTerminated = false;

    while (state.pos < state.lines.length) {
        const line = state.lines[state.pos];

        if (line.isBlank) {
            bodyLines.push({ text: "", indicator: " " });
            state.pos++;
            continue;
        }

        const trimmedUpper = line.text.trim().toUpperCase();

        // The closing line: "END-EXEC." or "END-EXEC"
        if (trimmedUpper.startsWith("END-EXEC") && !line.isComment) {
            endText = line.text.trim();
            periodTerminated = endText.endsWith(".");
            state.pos++;
            break;
        }

        // Safety valve for a missing END-EXEC: never swallow the next division.
        if (!line.isComment && isDivisionHeaderText(trimmedUpper)) {
            break;
        }

        // SQL text ending with END-EXEC on the same line stays verbatim in the
        // body — the terminator is part of that line, nothing more follows.
        if (!line.isComment && containsEndExec(line.text)) {
            bodyLines.push({ text: line.text.trimEnd(), indicator: line.indicator });
            periodTerminated = line.text.trimEnd().endsWith(".");
            state.pos++;
            break;
        }

        bodyLines.push({ text: line.text.trimEnd(), indicator: line.indicator });
        state.pos++;
    }

    return {
        kind: "ExecBlock",
        headerText,
        bodyLines,
        endText,
        leadingTrivia,
        periodTerminated,
    };
}
