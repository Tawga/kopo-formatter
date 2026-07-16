/**
 * Printer for EXEC SQL / EXEC CICS blocks.
 *
 * The EXEC header and END-EXEC frame are indented like normal statements;
 * the interior is emitted verbatim in its original columns, with no case
 * normalization and no whitespace collapsing.
 */

import { type FormatterOptions } from "../options.js";
import { type SourceFormat } from "../formatDetector.js";
import { type ExecBlock } from "../types.js";
import { buildLine, buildFixedFormLine } from "../layout.js";
import { printTrivia } from "./dataPrinter.js";

export function printExecBlock(
    stmt: ExecBlock,
    depth: number,
    options: FormatterOptions,
    format: SourceFormat,
): string[] {
    const lines: string[] = [];
    const indent = depth * options.indentationSpaces;

    lines.push(...printTrivia(stmt.leadingTrivia, format));

    // Header may itself contain SQL — never case-normalize it.
    lines.push(buildLine(format, { areaA: false, indent, content: stmt.headerText }));

    for (const body of stmt.bodyLines) {
        if (!body.text) {
            lines.push("");
        } else if (format === "fixed") {
            // Verbatim: original text-area columns, original indicator.
            lines.push(buildFixedFormLine(body.indicator, body.text));
        } else {
            lines.push(body.text.trimEnd());
        }
    }

    if (stmt.endText) {
        lines.push(buildLine(format, { areaA: false, indent, content: stmt.endText }));
    }

    return lines;
}
