/**
 * Printer for Data Division: handles data entry indentation and PIC/VALUE alignment.
 */

import { type FormatterOptions } from "../options.js";
import { type SourceFormat } from "../formatDetector.js";
import {
    type DataEntry,
    type FdEntry,
    type CopyStatement,
    type Section,
    type Trivia,
    type UnparsedLine,
} from "../types.js";
import { AREA_A_START } from "../constants.js";
import { buildLine } from "../layout.js";
import { applyCase, applyKeywordCase, normalizeSpaces } from "../caseNormalizer.js";
import { printExecBlock } from "./execPrinter.js";

export interface AlignmentMap {
    /** Maps indent depth (in spaces) to the column where PIC/VALUE should start */
    picAlignment: Map<number, number>;
}

/**
 * Upper bound for the PIC/VALUE alignment column. A single outlier entry
 * (e.g. a long REDEFINES) must not drag the whole group's PIC column so far
 * right that ordinary clauses wrap past column 72; outliers simply get the
 * minimum 2-space padding instead.
 */
const MAX_PIC_ALIGNMENT_COLUMN = 49;

/**
 * Compute alignment columns for PIC and VALUE clauses.
 * Pre-pass over all data entries to find maximum name+indent widths.
 */
export function computeAlignment(
    entries: DataEntry[],
    options: FormatterOptions,
    depth: number = 0,
): AlignmentMap {
    const picAlignment = new Map<number, number>();
    collectAlignmentInfo(entries, options, depth, picAlignment);

    // Add padding to all maximums, capped so outliers can't push the whole
    // group into line-wrapping territory
    for (const [key, value] of picAlignment.entries()) {
        picAlignment.set(key, Math.min(value + 4, MAX_PIC_ALIGNMENT_COLUMN));
    }

    return { picAlignment };
}

function collectAlignmentInfo(
    entries: (DataEntry | UnparsedLine)[],
    options: FormatterOptions,
    depth: number,
    picAlignment: Map<number, number>,
): void {
    for (const entry of entries) {
        if (entry.kind === "UnparsedLine") continue;
        const indent = depth * options.indentationSpaces;
        const normalized = normalizeDataLine(entry);

        const hasPic = entry.clauses.some(c => c.kind === "PicClause");
        const hasValue = entry.clauses.some(c => c.kind === "ValueClause");

        if (hasPic || ((entry.level === 78 || entry.level === 88) && hasValue)) {
            // Compute the length of the pre-clause part
            let preClausePart: string;
            if ((entry.level === 78 || entry.level === 88) && hasValue && !hasPic) {
                // VALUE alignment for 78/88
                const rawUpper = entry.rawText.toUpperCase();
                const valueIdx = rawUpper.indexOf(" VALUE ");
                preClausePart = valueIdx >= 0 ? entry.rawText.substring(0, valueIdx).trim() : normalized;
            } else {
                // PIC alignment
                const rawUpper = entry.rawText.toUpperCase();
                const picIdx = rawUpper.indexOf(" PIC ");
                preClausePart = picIdx >= 0 ? entry.rawText.substring(0, picIdx).trim() : normalized;
            }

            // Safe non-literal-aware collapse: text before PIC/VALUE cannot contain literals
            const normalizedPre = preClausePart.replace(/\s+/g, " ");
            const endColumn = (AREA_A_START - 1) + indent + normalizedPre.length;

            // Level 88 aligns with parent's indent group
            const parentDepth = depth > 0 ? (depth - 1) * options.indentationSpaces : 0;
            const keyIndent = entry.level === 88 ? parentDepth : indent;

            const currentMax = picAlignment.get(keyIndent) ?? 0;
            picAlignment.set(keyIndent, Math.max(currentMax, endColumn));
        }

        // Recurse into children
        if (entry.children.length > 0) {
            collectAlignmentInfo(entry.children, options, depth + 1, picAlignment);
        }
    }
}

/**
 * Print a data entry and its children.
 */
export function printDataEntry(
    entry: DataEntry,
    depth: number,
    options: FormatterOptions,
    format: SourceFormat,
    alignment: AlignmentMap,
    sectionName: string,
): string[] {
    const lines: string[] = [];

    // Print leading trivia
    lines.push(...printTrivia(entry.leadingTrivia, format));

    const indent = depth * options.indentationSpaces;

    // Try to align PIC/VALUE clauses
    const aligned = tryAlignEntry(entry, indent, depth, options, alignment, sectionName);

    if (aligned) {
        lines.push(buildLine(format, { areaA: true, indent: 0, content: applyKeywordCase(aligned, options) }));
    } else {
        // No alignment — normalizeDataLine already collapses spaces, applyCase handles case
        const normalized = normalizeDataLine(entry);
        const content = " ".repeat(indent) + normalized;
        lines.push(buildLine(format, { areaA: true, indent: 0, content: applyCase(content, options) }));
    }

    // Print children
    for (const child of entry.children) {
        if (child.kind === "UnparsedLine") {
            lines.push(...printTrivia(child.leadingTrivia, format));
            lines.push(buildLine(format, { areaA: true, content: child.rawText }));
        } else {
            lines.push(...printDataEntry(child, depth + 1, options, format, alignment, sectionName));
        }
    }

    return lines;
}

function tryAlignEntry(
    entry: DataEntry,
    indent: number,
    depth: number,
    options: FormatterOptions,
    alignment: AlignmentMap,
    sectionName: string,
): string | null {
    if (!options.alignPicClauses) return null;

    const hasPic = entry.clauses.some(c => c.kind === "PicClause");
    const hasValue = entry.clauses.some(c => c.kind === "ValueClause");

    // Determine alignment key
    const parentDepth = depth > 0 ? (depth - 1) * options.indentationSpaces : 0;
    const alignmentKey = entry.level === 88 ? parentDepth : indent;
    const alignmentColumn = alignment.picAlignment.get(alignmentKey);

    if (!alignmentColumn) return null;

    const isAlignableSection = ["FILE", "WORKING-STORAGE", "LINKAGE"].includes(sectionName);

    if ((entry.level === 78 || entry.level === 88) && hasValue) {
        return alignClause(entry, indent, alignmentColumn, " VALUE ");
    } else if (isAlignableSection && hasPic) {
        return alignClause(entry, indent, alignmentColumn, " PIC ");
    }

    return null;
}

function alignClause(
    entry: DataEntry,
    indent: number,
    alignmentColumn: number,
    clauseMarker: string,
): string | null {
    const rawUpper = entry.rawText.toUpperCase();
    const clauseIdx = rawUpper.indexOf(clauseMarker);
    if (clauseIdx < 0) return null;

    const preClausePart = entry.rawText.substring(0, clauseIdx).trim();
    // Collapse interior runs of spaces (literal-aware) so the printed width is
    // deterministic — raw multi-space runs would flip line-wrap decisions
    // between passes once a rejoin collapses them.
    const postClausePart = normalizeSpaces(entry.rawText.substring(clauseIdx).trim());
    // Safe non-literal-aware collapse: text before PIC/VALUE cannot contain literals
    const normalizedPre = preClausePart.replace(/\s+/g, " ");

    const lineStart = " ".repeat(indent) + normalizedPre;
    const currentLength = (AREA_A_START - 1) + lineStart.length;
    const paddingSize = alignmentColumn - currentLength;
    const padding = " ".repeat(Math.max(2, paddingSize));

    return lineStart + padding + postClausePart;
}

/**
 * Print an FD entry and its records.
 */
export function printFdEntry(
    fd: FdEntry,
    options: FormatterOptions,
    format: SourceFormat,
    alignment: AlignmentMap,
): string[] {
    const lines: string[] = [];
    lines.push(...printTrivia(fd.leadingTrivia, format));
    lines.push(buildLine(format, { areaA: true, content: applyCase(fd.rawText, options) }));

    for (const record of fd.records) {
        if (record.kind === "UnparsedLine") {
            lines.push(...printTrivia(record.leadingTrivia, format));
            lines.push(buildLine(format, { areaA: true, content: record.rawText }));
        } else {
            lines.push(...printDataEntry(record, 0, options, format, alignment, "FILE"));
        }
    }

    return lines;
}

/**
 * Print a COPY statement.
 */
export function printCopyStatement(
    copy: CopyStatement,
    depth: number,
    options: FormatterOptions,
    format: SourceFormat,
): string[] {
    const lines: string[] = [];
    lines.push(...printTrivia(copy.leadingTrivia, format));
    const indent = depth * options.indentationSpaces;
    lines.push(buildLine(format, { areaA: false, indent, content: applyCase(copy.rawText, options) }));
    return lines;
}

/**
 * Print a data section (WORKING-STORAGE, FILE, LINKAGE, etc.)
 */
export function printDataSection(
    section: Section,
    options: FormatterOptions,
    format: SourceFormat,
    alignment: AlignmentMap,
): string[] {
    const lines: string[] = [];
    lines.push(...printTrivia(section.leadingTrivia, format));
    lines.push(buildLine(format, { areaA: true, content: applyCase(section.headerText, options) }));

    const sectionName = section.name;

    for (const child of section.children) {
        switch (child.kind) {
            case "DataEntry":
                lines.push(...printDataEntry(child, 0, options, format, alignment, sectionName));
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
                // DivisionEntry, SelectEntry, etc.
                if ("leadingTrivia" in child && Array.isArray(child.leadingTrivia)) {
                    lines.push(...printTrivia(child.leadingTrivia, format));
                }
                if ("rawText" in child && typeof child.rawText === "string") {
                    lines.push(buildLine(format, { areaA: true, content: child.rawText }));
                }
                break;
        }
    }

    // Blank AFTER the section's content ends (before the next section)
    if (options.addEmptyLineAfterSection) lines.push("");

    return lines;
}

function normalizeDataLine(entry: DataEntry): string {
    // Literal-aware: spaces inside '...'/"..." (e.g. VALUE 'A  B') must survive
    return normalizeSpaces(entry.rawText.trim());
}

export function printTrivia(trivia: Trivia[], format: SourceFormat): string[] {
    const lines: string[] = [];
    for (const t of trivia) {
        if (t.kind === "BlankLine") {
            lines.push("");
        } else if (t.kind === "Comment") {
            lines.push(buildLine(format, { indicator: t.indicator ?? "*", content: t.text }));
        } else {
            lines.push(buildLine(format, { areaA: true, content: t.text }));
        }
    }
    return lines;
}
