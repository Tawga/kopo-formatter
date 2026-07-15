/**
 * Format-aware scanner that converts raw COBOL source into logical source lines.
 *
 * The scanner handles:
 * - Fixed-form column structure (cols 1-6 seq, col 7 indicator, cols 8-72 text, cols 73-80 id)
 * - Free-form source (entire line is program text)
 * - Comment detection
 * - Continuation line joining
 * - Tab-to-space conversion
 */

import { type SourceLine } from "./tokens.js";
import { type SourceFormat } from "./formatDetector.js";
import { SEQ_NUMBER_END, PROGRAM_TEXT_END } from "./constants.js";

/**
 * Expand tabs using 8-column tab stops (standard for fixed-form COBOL).
 */
function expandTabs(line: string): string {
    let result = "";
    let col = 0;
    for (const ch of line) {
        if (ch === "\t") {
            const spaces = 8 - (col % 8);
            result += " ".repeat(spaces);
            col += spaces;
        } else {
            result += ch;
            col++;
        }
    }
    return result;
}

/**
 * Scan raw source text into logical source lines.
 */
export function scan(source: string, format: SourceFormat): SourceLine[] {
    const rawLines = source.split(/\r?\n/);

    if (format === "fixed") {
        return scanFixedForm(rawLines);
    } else {
        return scanFreeForm(rawLines);
    }
}

/** Length of the program-text area of a fixed-form line (cols 8-72). */
const TEXT_AREA_LEN = PROGRAM_TEXT_END - (SEQ_NUMBER_END + 1);

/**
 * Detect whether a fixed-form file uses the identification area (cols 73-80),
 * i.e. classic punched-card layout with sequence numbers / tags on the right.
 *
 * True when no line exceeds 80 columns and at least one line has non-blank
 * content past column 72. Lines longer than 80 columns can only come from
 * already-formatted output with line wrapping disabled (joined logical lines),
 * so their presence disables truncation for the whole file.
 */
function hasIdentificationArea(lines: string[]): boolean {
    let hasIdContent = false;
    for (const raw of lines) {
        const line = expandTabs(raw).trimEnd();
        if (line.length > 80) return false;
        if (line.length > PROGRAM_TEXT_END && line.substring(PROGRAM_TEXT_END).trim()) {
            hasIdContent = true;
        }
    }
    return hasIdContent;
}

/**
 * Return the quote character of an unterminated string literal in `text`,
 * or null if all literals are closed. Doubled quotes ("" or '') inside a
 * literal toggle out and back in, which yields the correct open/closed state.
 */
function openLiteralQuote(text: string): string | null {
    let quote: string | null = null;
    for (const ch of text) {
        if (quote) {
            if (ch === quote) quote = null;
        } else if (ch === '"' || ch === "'") {
            quote = ch;
        }
    }
    return quote;
}

function scanFixedForm(rawLines: string[]): SourceLine[] {
    const result: SourceLine[] = [];
    const truncateIdArea = hasIdentificationArea(rawLines);

    for (let i = 0; i < rawLines.length; i++) {
        const expanded = expandTabs(rawLines[i]);
        const original = truncateIdArea ? expanded.substring(0, PROGRAM_TEXT_END) : expanded;
        const originalText = rawLines[i];

        // Blank line
        if (!original.trim()) {
            result.push({
                text: "",
                originalLine: i,
                isComment: false,
                isBlank: true,
                indicator: " ",
                originalText,
            });
            continue;
        }

        // Extract indicator (col 7, 0-based index 6)
        const indicator = original.length > SEQ_NUMBER_END ? original.charAt(SEQ_NUMBER_END) : " ";

        // Comment lines (* or / in col 7)
        if (indicator === "*" || indicator === "/") {
            result.push({
                text: original.length > SEQ_NUMBER_END + 1 ? original.substring(SEQ_NUMBER_END + 1) : "",
                originalLine: i,
                isComment: true,
                isBlank: false,
                indicator,
                originalText,
            });
            continue;
        }

        // Debug lines (D in col 7) - treat as comments for formatting
        if (indicator === "D" || indicator === "d") {
            result.push({
                text: original.length > SEQ_NUMBER_END + 1 ? original.substring(SEQ_NUMBER_END + 1) : "",
                originalLine: i,
                isComment: true,
                isBlank: false,
                indicator,
                originalText,
            });
            continue;
        }

        // Continuation line (- in col 7)
        if (indicator === "-") {
            // Continuation: append to previous non-blank, non-comment line
            const programText = original.length > SEQ_NUMBER_END + 1
                ? original.substring(SEQ_NUMBER_END + 1)
                : "";

            // Find the last non-comment, non-blank line to append to
            if (result.length > 0) {
                for (let j = result.length - 1; j >= 0; j--) {
                    if (!result[j].isComment && !result[j].isBlank) {
                        const prev = result[j];
                        const quote = openLiteralQuote(prev.text);
                        const contTrimmed = programText.trimStart();
                        if (quote && contTrimmed.startsWith(quote)) {
                            // Continued string literal: the previous line's text is part
                            // of the literal through col 72 (short lines are space-padded,
                            // as on punched cards), and the literal resumes with the
                            // character right after the quote — no space is inserted.
                            prev.text = prev.text.padEnd(TEXT_AREA_LEN, " ") + contTrimmed.substring(1);
                        } else {
                            // Word continuation: trim and join with a single space
                            prev.text = prev.text.trimEnd() + " " + programText.trim();
                        }
                        break;
                    }
                }
            }
            // Don't add a new source line for continuations - they're merged
            continue;
        }

        // Normal program line: extract cols 8 onward (no upper limit — formatter
        // output may exceed col 72 for long logical lines joined from continuations)
        const programText = original.length > SEQ_NUMBER_END + 1
            ? original.substring(SEQ_NUMBER_END + 1)
            : "";

        result.push({
            text: programText,
            originalLine: i,
            isComment: false,
            isBlank: false,
            indicator: " ",
            originalText,
        });
    }

    return result;
}

function scanFreeForm(rawLines: string[]): SourceLine[] {
    const result: SourceLine[] = [];

    for (let i = 0; i < rawLines.length; i++) {
        const original = expandTabs(rawLines[i]);
        const originalText = rawLines[i];

        if (!original.trim()) {
            result.push({
                text: "",
                originalLine: i,
                isComment: false,
                isBlank: true,
                indicator: " ",
                originalText,
            });
            continue;
        }

        const trimmed = original.trim();

        // Free-form comment: line starting with *>
        if (trimmed.startsWith("*>")) {
            result.push({
                text: trimmed,
                originalLine: i,
                isComment: true,
                isBlank: false,
                indicator: "*",
                originalText,
            });
            continue;
        }

        result.push({
            text: trimmed,
            originalLine: i,
            isComment: false,
            isBlank: false,
            indicator: " ",
            originalText,
        });
    }

    return result;
}
