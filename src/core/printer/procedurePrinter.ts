/**
 * Printer for Procedure Division: handles block indentation and statement formatting.
 */

import { type FormatterOptions } from "../options.js";
import { type SourceFormat } from "../formatDetector.js";
import {
    type Paragraph,
    type ProcedureSection,
    type ProcedureStatement,
    type IfStatement,
    type EvaluateStatement,
    type PerformBlock,
    type ReadBlock,
    type SimpleStatement,
    type UnparsedLine,
    type Trivia,
} from "../types.js";
import { buildLine } from "../layout.js";
import { printTrivia } from "./dataPrinter.js";
import { applyCase } from "../caseNormalizer.js";

/** Shorthand: apply case normalization to a content string. */
function c(text: string, options: FormatterOptions): string {
    return applyCase(text, options);
}

/**
 * Print a procedure section.
 */
export function printProcedureSection(
    section: ProcedureSection,
    options: FormatterOptions,
    format: SourceFormat,
): string[] {
    const lines: string[] = [];
    lines.push(...printTrivia(section.leadingTrivia, format));
    // Section header goes in Area A; optionally uppercase the user-defined section name
    const sectionHeader = options.uppercaseProcedureNames
        ? section.headerText.replace(section.name, section.name.toUpperCase())
        : section.headerText;
    lines.push(buildLine(format, { areaA: true, content: c(sectionHeader, options) }));

    for (const para of section.paragraphs) {
        lines.push(...printParagraph(para, options, format));
    }

    // Blank AFTER the section's content ends (before the next section)
    if (options.addEmptyLineAfterSection) lines.push("");

    return lines;
}

/**
 * Print a paragraph.
 */
export function printParagraph(
    para: Paragraph,
    options: FormatterOptions,
    format: SourceFormat,
): string[] {
    const lines: string[] = [];
    lines.push(...printTrivia(para.leadingTrivia, format));

    // Paragraph name in Area A (if it has a name); optionally uppercase
    if (para.name) {
        const paraName = options.uppercaseProcedureNames ? para.name.toUpperCase() : para.name;
        lines.push(buildLine(format, { areaA: true, content: paraName + "." }));
    }

    // Print statements at base indent level (0)
    for (const stmt of para.statements) {
        lines.push(...printStatement(stmt, 0, options, format));
    }

    return lines;
}

/**
 * Print a statement at the given indent depth.
 */
export function printStatement(
    stmt: ProcedureStatement,
    depth: number,
    options: FormatterOptions,
    format: SourceFormat,
): string[] {
    switch (stmt.kind) {
        case "SimpleStatement":
            return printSimpleStatement(stmt, depth, options, format);
        case "IfStatement":
            return printIfStatement(stmt, depth, options, format);
        case "EvaluateStatement":
            return printEvaluateStatement(stmt, depth, options, format);
        case "PerformBlock":
            return printPerformBlock(stmt, depth, options, format);
        case "ReadBlock":
            return printReadBlock(stmt, depth, options, format);
        case "UnparsedLine":
            return printUnparsedStatement(stmt, depth, options, format);
        default:
            return [];
    }
}

/**
 * Align DELIMITED BY clauses in a STRING/UNSTRING statement so that all data names
 * start at the same column and all DELIMITED BY keywords line up.
 *
 * Returns updated rawText, continuationLines, and the continuation indent to use
 * (which equals the offset of the first data name after the verb keyword).
 */
function buildDelimitedByAlignment(
    rawText: string,
    continuationLines: string[],
    depth: number,
    options: FormatterOptions,
): { rawText: string; continuationLines: string[]; continuationIndent: number } {
    const verbMatch = rawText.match(/^(STRING|UNSTRING)\s+/i);
    if (!verbMatch) {
        return { rawText, continuationLines, continuationIndent: depth * options.indentationSpaces + options.indentationSpaces };
    }

    const verbPrefix = verbMatch[0]; // e.g. "STRING " — length is the data-name column offset
    const continuationIndent = depth * options.indentationSpaces + verbPrefix.length;

    // All logical lines: the part after the verb on line 1, then each continuation line
    const allDataLines = [rawText.substring(verbPrefix.length), ...continuationLines];

    // Split each line into [data-name part] and [DELIMITED BY …] if present
    const parts = allDataLines.map(line => {
        const m = line.match(/\bDELIMITED\s+BY\b/i);
        if (m && m.index !== undefined) {
            return { dataPart: line.substring(0, m.index).trimEnd(), delimPart: line.substring(m.index), hasDelim: true };
        }
        return { dataPart: line, delimPart: "", hasDelim: false };
    });

    // Pad every data-name part to the same width so DELIMITED BY aligns
    const maxDataLen = parts.filter(p => p.hasDelim).reduce((mx, p) => Math.max(mx, p.dataPart.length), 0);

    const rebuilt = parts.map(p => {
        if (!p.hasDelim) return p.dataPart;
        const padding = " ".repeat(maxDataLen - p.dataPart.length + 1);
        return p.dataPart + padding + p.delimPart;
    });

    return {
        rawText: verbPrefix + rebuilt[0],
        continuationLines: rebuilt.slice(1),
        continuationIndent,
    };
}

function printSimpleStatement(
    stmt: SimpleStatement,
    depth: number,
    options: FormatterOptions,
    format: SourceFormat,
): string[] {
    const lines: string[] = [];
    lines.push(...printTrivia(stmt.leadingTrivia, format));
    const indent = depth * options.indentationSpaces;
    const contLines = stmt.continuationLines ?? [];

    if (options.alignDelimitedBy && (stmt.verb === "STRING" || stmt.verb === "UNSTRING")) {
        // Normalize case/whitespace first, then align
        const normalizedRaw = c(stmt.rawText, options);
        const normalizedCont = contLines.map(l => c(l, options));
        const aligned = buildDelimitedByAlignment(normalizedRaw, normalizedCont, depth, options);
        lines.push(buildLine(format, { areaA: false, indent, content: aligned.rawText }));
        for (const contLine of aligned.continuationLines) {
            lines.push(buildLine(format, { areaA: false, indent: aligned.continuationIndent, content: contLine }));
        }
    } else {
        lines.push(buildLine(format, { areaA: false, indent, content: c(stmt.rawText, options) }));
        for (const contLine of contLines) {
            lines.push(buildLine(format, { areaA: false, indent: indent + options.indentationSpaces, content: c(contLine, options) }));
        }
    }

    // Add empty line after EXIT if option enabled
    if (options.addEmptyLineAfterExit && stmt.verb === "EXIT" && stmt.rawText.trim().toUpperCase().endsWith("EXIT.")) {
        lines.push("");
    }

    return lines;
}

function printIfStatement(
    stmt: IfStatement,
    depth: number,
    options: FormatterOptions,
    format: SourceFormat,
): string[] {
    const lines: string[] = [];
    const indent = depth * options.indentationSpaces;

    lines.push(...printTrivia(stmt.leadingTrivia, format));
    lines.push(buildLine(format, { areaA: false, indent, content: c(stmt.conditionText, options) }));

    // Then body at depth + 1
    for (const child of stmt.thenBody) {
        lines.push(...printStatement(child, depth + 1, options, format));
    }

    // Else clause: print whenever elseBody is present.
    // (An IF whose ELSE body ended with a period is still period-terminated overall,
    //  so we do NOT guard this on !periodTerminated — the ELSE must still be emitted.)
    if (stmt.elseBody.length > 0) {
        lines.push(buildLine(format, { areaA: false, indent, content: c("ELSE", options) }));
        for (const child of stmt.elseBody) {
            lines.push(...printStatement(child, depth + 1, options, format));
        }
    }

    // END-IF only when block-structured (not period-terminated by either branch)
    if (!stmt.periodTerminated) {
        lines.push(buildLine(format, { areaA: false, indent, content: c("END-IF", options) }));
    }

    return lines;
}

function printEvaluateStatement(
    stmt: EvaluateStatement,
    depth: number,
    options: FormatterOptions,
    format: SourceFormat,
): string[] {
    const lines: string[] = [];
    const indent = depth * options.indentationSpaces;

    lines.push(...printTrivia(stmt.leadingTrivia, format));
    lines.push(buildLine(format, { areaA: false, indent, content: c(stmt.subjectText, options) }));

    for (const branch of stmt.whenBranches) {
        lines.push(...printTrivia(branch.leadingTrivia, format));

        // WHEN clause indent depends on evaluateIndentWhen option
        const whenDepth = options.evaluateIndentWhen ? depth + 1 : depth;
        const whenIndent = whenDepth * options.indentationSpaces;
        lines.push(buildLine(format, { areaA: false, indent: whenIndent, content: c(branch.conditionText, options) }));

        // WHEN body at whenDepth + 1
        for (const child of branch.body) {
            lines.push(...printStatement(child, whenDepth + 1, options, format));
        }
    }

    // END-EVALUATE only when block-structured (not closed by a period)
    if (!stmt.periodTerminated) {
        lines.push(buildLine(format, { areaA: false, indent, content: c("END-EVALUATE", options) }));
    }

    return lines;
}

function printPerformBlock(
    stmt: PerformBlock,
    depth: number,
    options: FormatterOptions,
    format: SourceFormat,
): string[] {
    const lines: string[] = [];
    const indent = depth * options.indentationSpaces;

    lines.push(...printTrivia(stmt.leadingTrivia, format));
    lines.push(buildLine(format, { areaA: false, indent, content: c(stmt.clauseText, options) }));

    // Body at depth + 1
    for (const child of stmt.body) {
        lines.push(...printStatement(child, depth + 1, options, format));
    }

    // END-PERFORM only when block-structured (not closed by a period)
    if (!stmt.periodTerminated) {
        lines.push(buildLine(format, { areaA: false, indent, content: c("END-PERFORM", options) }));
    }

    return lines;
}

function printReadBlock(
    stmt: ReadBlock,
    depth: number,
    options: FormatterOptions,
    format: SourceFormat,
): string[] {
    const lines: string[] = [];
    const indent = depth * options.indentationSpaces;

    lines.push(...printTrivia(stmt.leadingTrivia, format));
    lines.push(buildLine(format, { areaA: false, indent, content: c(stmt.headerText, options) }));

    if (stmt.atEndBody.length > 0) {
        lines.push(buildLine(format, { areaA: false, indent: (depth + 1) * options.indentationSpaces, content: c("AT END", options) }));
        for (const child of stmt.atEndBody) {
            lines.push(...printStatement(child, depth + 2, options, format));
        }
    }

    if (stmt.notAtEndBody.length > 0) {
        lines.push(buildLine(format, { areaA: false, indent, content: c("NOT AT END", options) }));
        for (const child of stmt.notAtEndBody) {
            lines.push(...printStatement(child, depth + 1, options, format));
        }
    }

    if (stmt.invalidKeyBody.length > 0) {
        lines.push(buildLine(format, { areaA: false, indent: (depth + 1) * options.indentationSpaces, content: c("INVALID KEY", options) }));
        for (const child of stmt.invalidKeyBody) {
            lines.push(...printStatement(child, depth + 2, options, format));
        }
    }

    if (stmt.notInvalidKeyBody.length > 0) {
        lines.push(buildLine(format, { areaA: false, indent, content: c("NOT INVALID KEY", options) }));
        for (const child of stmt.notInvalidKeyBody) {
            lines.push(...printStatement(child, depth + 1, options, format));
        }
    }

    // Emit END-xxx only when the block was not already closed by a period
    if (!stmt.periodTerminated) {
        lines.push(buildLine(format, { areaA: false, indent, content: c(stmt.endTerminator, options) }));
    }

    return lines;
}

function printUnparsedStatement(
    stmt: UnparsedLine,
    depth: number,
    options: FormatterOptions,
    format: SourceFormat,
): string[] {
    const lines: string[] = [];
    lines.push(...printTrivia(stmt.leadingTrivia, format));
    const indent = depth * options.indentationSpaces;
    lines.push(buildLine(format, { areaA: false, indent, content: c(stmt.rawText, options) }));
    return lines;
}
