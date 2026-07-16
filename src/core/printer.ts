/**
 * Main printer: walks the AST and produces formatted COBOL text.
 */

import { type FormatterOptions } from "./options.js";
import { type SourceFormat } from "./formatDetector.js";
import {
    type SourceFile,
    type Division,
    type DivisionChild,
    type DataEntry,
    type Trivia,
} from "./types.js";
import { buildLine } from "./layout.js";
import { applyCase } from "./caseNormalizer.js";
import {
    computeAlignment,
    printDataEntry,
    printDataSection,
    printFdEntry,
    printCopyStatement,
    printTrivia,
} from "./printer/dataPrinter.js";
import {
    printProcedureSection,
    printParagraph,
} from "./printer/procedurePrinter.js";
import { printExecBlock } from "./printer/execPrinter.js";

// ─── Line wrapping ────────────────────────────────────────────────────────────

const FIXED_MAX_COL = 72;
const FIXED_PREFIX_LEN = 7; // 6 seq area chars + 1 indicator char
const FIXED_CONTENT_MAX = FIXED_MAX_COL - FIXED_PREFIX_LEN; // 65 chars

/** Multi-word COBOL verbs that should not be split across lines. */
const MULTI_WORD_VERBS = ["XML GENERATE", "XML PARSE", "JSON GENERATE", "JSON PARSE", "GO TO"];

/**
 * Compute how many spaces to place after the "      -" continuation marker.
 *
 * For data entries that begin with a COBOL level number (all digits, e.g. "01", "05"),
 * the continuation aligns with the *second* token (the data name), not the level
 * number itself — so "EXCEPTION-VALUE" lines up with "PUSH-BUTTON".
 * For multi-word verbs (XML GENERATE, JSON PARSE, GO TO), the continuation aligns
 * after the full verb phrase, not after the first word.
 * For single-word procedure verbs, the continuation aligns with the first token.
 * Minimum is 3 spaces after the dash.
 */
function findContinuationIndent(content: string): number {
    const m = content.match(/^(\s*)(\S+)(\s+)(\S+)/);
    if (m) {
        const [, leading, first, gap, second] = m;
        if (/^\d+$/.test(first)) {
            // Level number: align with the data name that follows it
            return leading.length + first.length + gap.length;
        }
        // Check for multi-word verbs — align after the full verb phrase
        const twoWordVerb = (first + " " + second).toUpperCase();
        if (MULTI_WORD_VERBS.some(v => twoWordVerb.startsWith(v))) {
            const verbEnd = leading.length + first.length + gap.length + second.length;
            // Find next space after the second word to align with the argument
            const afterVerb = content.substring(verbEnd);
            const nextGap = afterVerb.match(/^(\s+)/);
            return Math.max(3, verbEnd + (nextGap ? nextGap[1].length : 1));
        }
        // Single-word verb: align with the first token
        return Math.max(3, leading.length);
    }
    const firstPos = content.search(/\S/);
    return Math.max(3, firstPos >= 0 ? firstPos : 3);
}

/**
 * Wrap a single fixed-form line that exceeds column 72 using continuation markers.
 * Comment lines and blank lines are passed through unchanged.
 *
 * The continuation prefix is computed dynamically: it aligns the continuation
 * content with the first non-space token in the original line's content area,
 * so "EXCEPTION-VALUE" lines up with "PUSH-BUTTON", DISPLAY options line up
 * with the DISPLAY verb, etc.  Minimum padding is 3 spaces after the indicator.
 *
 * When `useDash` is false, the indicator in col 7 is a space instead of "-",
 * so continuation lines look like normal lines (omitContinuationLines mode).
 */
function wrapFixedLine(line: string, useDash: boolean = true): string[] {
    if (line.length <= FIXED_MAX_COL) return [line];
    if (!line.trim()) return [line];

    const indicator = line.length > 6 ? line[6] : " ";
    if (indicator === "*" || indicator === "/") return [line];

    // Extract content after the 7-char prefix (seq area + indicator) and compute
    // the appropriate continuation indent for this line type.
    const content = line.substring(FIXED_PREFIX_LEN);
    const continuationSpaces = findContinuationIndent(content);
    const contIndicator = useDash ? "-" : " ";
    // Guard: if the computed continuation indent is too wide to fit any content,
    // fall back to the minimum 3-space indent after the indicator.
    const effectiveSpaces = (FIXED_PREFIX_LEN + continuationSpaces) >= (FIXED_MAX_COL - 1)
        ? 3
        : continuationSpaces;
    const contPfx = "      " + contIndicator + " ".repeat(effectiveSpaces);

    const splitAt = findSplitPoint(content, FIXED_CONTENT_MAX);
    if (splitAt <= 0) return [line]; // Can't split safely

    const prefix = line.substring(0, FIXED_PREFIX_LEN);
    const firstPart = content.substring(0, splitAt);
    const rest = content.substring(splitAt).trimStart();

    const continuationLine = contPfx + rest;
    // Guard: if the continuation is still too long, recurse
    if (continuationLine.length > FIXED_MAX_COL) {
        return [prefix + firstPart, ...wrapFixedLine(continuationLine, useDash)];
    }
    return [prefix + firstPart, continuationLine];
}

/**
 * Find the last space in `text` at or before `maxLen` that is not inside a string literal.
 * Prefers a split point whose next token is NOT a string literal (so quoted values
 * don't end up alone on a continuation line). Falls back to any space if needed.
 * Avoids splitting level numbers from their data names (e.g. "05 MY-FIELD").
 * Returns -1 if no safe split point found.
 */
function findSplitPoint(text: string, maxLen: number): number {
    let inString = false;
    let quoteChar = "";
    let lastSpace = -1;       // any valid space
    let lastSafeSpace = -1;   // space whose successor is not a quote

    // Determine the minimum split position: don't split between a level number
    // and its data name (e.g. "05 MY-FIELD" should not become "05\n MY-FIELD").
    let minSplit = 0;
    const levelMatch = text.match(/^(\s*\d{2}\s+\S+)/);
    if (levelMatch) {
        minSplit = levelMatch[1].length;
    }
    // Also protect multi-word verbs from being split
    const trimmedUpper = text.trimStart().toUpperCase();
    const leadingSpaces = text.length - text.trimStart().length;
    for (const verb of MULTI_WORD_VERBS) {
        if (trimmedUpper.startsWith(verb)) {
            minSplit = Math.max(minSplit, leadingSpaces + verb.length);
            break;
        }
    }
    // Never split inside the leading indent: the continuation would carry the
    // entire content and wrapFixedLine would recurse on an identical line.
    minSplit = Math.max(minSplit, leadingSpaces + 1);

    for (let i = 0; i < Math.min(text.length, maxLen); i++) {
        const ch = text[i];
        if (!inString && (ch === '"' || ch === "'")) {
            inString = true;
            quoteChar = ch;
        } else if (inString && ch === quoteChar) {
            inString = false;
        } else if (!inString && ch === " " && i >= minSplit) {
            lastSpace = i;
            const next = text[i + 1];
            if (next !== '"' && next !== "'") {
                lastSafeSpace = i;
            }
        }
    }

    // Prefer a split that doesn't strand a string literal at the start of the continuation
    return lastSafeSpace >= 0 ? lastSafeSpace : lastSpace;
}

// ─── Print ────────────────────────────────────────────────────────────────────

/**
 * Print a SourceFile AST to formatted COBOL text.
 */
export function print(ast: SourceFile, options: FormatterOptions): string {
    const lines: string[] = [];
    const format = ast.format;

    for (const node of ast.children) {
        if (node.kind === "Division") {
            lines.push(...printDivision(node, options, format));
        } else if (node.kind === "UnparsedLine") {
            lines.push(...printTrivia(node.leadingTrivia, format));
            lines.push(buildLine(format, { areaA: true, content: node.rawText }));
        }
    }

    // Trailing trivia
    lines.push(...printTrivia(ast.trailingTrivia, format));

    // Collapse consecutive blank lines (e.g. addEmptyLineAfterExit + preserved trivia blank)
    const deduped = lines.filter((line, i) => !(line === "" && i > 0 && lines[i - 1] === ""));

    // Wrap long lines for fixed-form output.
    // When omitContinuationLines is on, wrap using a space indicator instead of "-"
    // so continuation lines look like normal indented lines (no dash in col 7).
    const wrapped = (format === "fixed" && options.wrapLongLines)
        ? deduped.flatMap(line => wrapFixedLine(line, !options.omitContinuationLines))
        : deduped;

    return wrapped.join("\n");
}

function printDivision(
    division: Division,
    options: FormatterOptions,
    format: SourceFormat,
): string[] {
    const lines: string[] = [];

    lines.push(...printTrivia(division.leadingTrivia, format));
    // Fragment files (copybooks) are parsed into a synthetic division with no
    // header line — print only the content.
    if (division.headerText) {
        lines.push(buildLine(format, { areaA: true, content: applyCase(division.headerText, options) }));
    }

    switch (division.divisionType) {
        case "DataDivision":
            lines.push(...printDataDivisionChildren(division.children, options, format));
            break;
        case "ProcedureDivision":
            lines.push(...printProcedureDivisionChildren(division.children, options, format));
            break;
        default:
            lines.push(...printGenericDivisionChildren(division.children, options, format));
            break;
    }

    // Blank line placed AFTER the division's content ends (before the next division)
    if (options.addEmptyLineAfterDivision) lines.push("");

    return lines;
}

function printDataDivisionChildren(
    children: DivisionChild[],
    options: FormatterOptions,
    format: SourceFormat,
): string[] {
    // Pre-pass: compute alignment across all data entries
    const allDataEntries = collectAllDataEntries(children);
    const alignment = options.alignPicClauses
        ? computeAlignment(allDataEntries, options, 0)
        : { picAlignment: new Map<number, number>() };

    const lines: string[] = [];

    for (const child of children) {
        switch (child.kind) {
            case "Section":
                lines.push(...printDataSection(child, options, format, alignment));
                break;
            case "DataEntry":
                // Entries directly under the division (typical for copybook
                // fragments) align like working-storage entries.
                lines.push(...printDataEntry(child, 0, options, format, alignment, "WORKING-STORAGE"));
                break;
            case "FdEntry":
                lines.push(...printFdEntry(child, options, format, alignment));
                break;
            case "CopyStatement":
                lines.push(...printCopyStatement(child, 0, options, format));
                break;
            case "ExecBlock":
                lines.push(...printExecBlock(child, 0, options, format));
                break;
            case "UnparsedLine":
                lines.push(...printTrivia(child.leadingTrivia, format));
                lines.push(buildLine(format, { areaA: true, content: child.rawText }));
                break;
            default:
                lines.push(...printGenericChild(child, format, options));
                break;
        }
    }

    return lines;
}

function printProcedureDivisionChildren(
    children: DivisionChild[],
    options: FormatterOptions,
    format: SourceFormat,
): string[] {
    const lines: string[] = [];

    for (const child of children) {
        switch (child.kind) {
            case "ProcedureSection":
                lines.push(...printProcedureSection(child, options, format));
                break;
            case "Paragraph":
                lines.push(...printParagraph(child, options, format));
                break;
            case "Declaratives":
                lines.push(...printTrivia(child.leadingTrivia, format));
                lines.push(buildLine(format, { areaA: true, content: applyCase(child.headerText, options) }));
                for (const section of child.sections) {
                    if (section.headerText === "") {
                        // Anonymous recovery section — print only its content
                        for (const para of section.paragraphs) {
                            lines.push(...printParagraph(para, options, format));
                        }
                    } else {
                        lines.push(...printProcedureSection(section, options, format));
                    }
                }
                lines.push(...printTrivia(child.endLeadingTrivia, format));
                if (child.endText) {
                    lines.push(buildLine(format, { areaA: true, content: applyCase(child.endText, options) }));
                }
                break;
            case "UnparsedLine": {
                lines.push(...printTrivia(child.leadingTrivia, format));
                // DECLARATIVES and END DECLARATIVES are Area A structural markers
                const upperRaw = child.rawText.trimStart().toUpperCase();
                const isAreaA = upperRaw.startsWith("DECLARATIVES") || upperRaw.startsWith("END DECLARATIVES");
                lines.push(buildLine(format, { areaA: isAreaA, content: applyCase(child.rawText, options) }));
                break;
            }
            default:
                lines.push(...printGenericChild(child, format, options));
                break;
        }
    }

    return lines;
}

function printGenericDivisionChildren(
    children: DivisionChild[],
    options: FormatterOptions,
    format: SourceFormat,
): string[] {
    const lines: string[] = [];

    for (const child of children) {
        switch (child.kind) {
            case "Section":
                lines.push(...printTrivia(child.leadingTrivia, format));
                lines.push(buildLine(format, { areaA: true, content: applyCase(child.headerText, options) }));
                for (const subChild of child.children) {
                    if (subChild.kind === "CopyStatement") {
                        // COPY statements inside FILE-CONTROL / environment sections
                        // are printed at Area B (indented under the section header)
                        lines.push(...printTrivia(subChild.leadingTrivia, format));
                        lines.push(buildLine(format, { areaA: false, indent: 0, content: applyCase(subChild.rawText, options) }));
                    } else {
                        lines.push(...printGenericChild(subChild, format, options));
                    }
                }
                // Blank AFTER the section's content ends
                if (options.addEmptyLineAfterSection) lines.push("");
                break;
            case "SelectEntry":
                lines.push(...printTrivia(child.leadingTrivia, format));
                lines.push(buildLine(format, { areaA: true, content: applyCase(child.rawText, options) }));
                break;
            default:
                lines.push(...printGenericChild(child, format, options));
                break;
        }
    }

    return lines;
}

function printGenericChild(child: DivisionChild, format: SourceFormat, options?: FormatterOptions): string[] {
    const lines: string[] = [];
    if ("leadingTrivia" in child && Array.isArray(child.leadingTrivia)) {
        lines.push(...printTrivia(child.leadingTrivia as Trivia[], format));
    }
    if ("rawText" in child && typeof child.rawText === "string") {
        const text = options ? applyCase(child.rawText, options) : child.rawText;
        lines.push(buildLine(format, { areaA: true, content: text }));
    } else if ("headerText" in child && typeof child.headerText === "string") {
        const text = options ? applyCase(child.headerText, options) : child.headerText;
        lines.push(buildLine(format, { areaA: true, content: text }));
    }
    return lines;
}

/**
 * Collect all DataEntry nodes from division children (for alignment pre-pass).
 */
function collectAllDataEntries(children: DivisionChild[]): DataEntry[] {
    const entries: DataEntry[] = [];

    for (const child of children) {
        if (child.kind === "DataEntry") {
            entries.push(child);
        } else if (child.kind === "Section") {
            for (const subChild of child.children) {
                if (subChild.kind === "DataEntry") {
                    entries.push(subChild);
                } else if (subChild.kind === "FdEntry") {
                    entries.push(...subChild.records);
                }
            }
        } else if (child.kind === "FdEntry") {
            entries.push(...child.records);
        }
    }

    return entries;
}
