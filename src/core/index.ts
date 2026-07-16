/**
 * Public API for the COBOL formatter core.
 * This module has zero dependency on VS Code.
 */

import { type FormatterOptions, resolveOptions } from "./options.js";
import { detectFormat } from "./formatDetector.js";
import { scan } from "./scanner.js";
import { parse } from "./parser.js";
import { print } from "./printer.js";
import { verifyNoTokenLoss } from "./verifier.js";
import { type Diagnostic } from "./types.js";

export { type FormatterOptions, DEFAULT_OPTIONS, resolveOptions } from "./options.js";
export { type SourceFormat } from "./formatDetector.js";
export { type SourceFile, type Diagnostic } from "./types.js";
export { verifyNoTokenLoss, extractComparableTokens } from "./verifier.js";

/**
 * Format COBOL source code.
 *
 * If the no-loss verification fails (the formatted output would be missing
 * tokens present in the input), the ORIGINAL source is returned unchanged.
 *
 * @param source - Raw COBOL source text
 * @param options - Partial formatter options (unset values use defaults)
 * @returns Formatted COBOL source text
 */
export function format(source: string, options: Partial<FormatterOptions> = {}): string {
    return formatWithDiagnostics(source, options).text;
}

export interface FormatResult {
    text: string;
    diagnostics: Diagnostic[];
}

/**
 * Format COBOL source code and return diagnostics alongside the result.
 *
 * If the no-loss verification fails, `text` is the original source unchanged
 * and `diagnostics` contains an "error"-severity entry describing the loss.
 */
export function formatWithDiagnostics(source: string, options: Partial<FormatterOptions> = {}): FormatResult {
    const resolved = resolveOptions(options);
    const sourceFormat = detectFormat(source, resolved.sourceFormat);
    const scanDiagnostics: Diagnostic[] = [];
    const lines = scan(source, sourceFormat, { diagnostics: scanDiagnostics });
    const ast = parse(lines, sourceFormat);
    const output = print(ast, resolved);
    const diagnostics = [...scanDiagnostics, ...ast.diagnostics];

    const verification = verifyNoTokenLoss(source, output, sourceFormat);
    if (!verification.ok) {
        return { text: source, diagnostics: [...diagnostics, ...verification.diagnostics] };
    }

    return { text: output, diagnostics };
}

/**
 * Parse COBOL source into an AST (for advanced use / inspection).
 */
export function parseSource(source: string, options: Partial<FormatterOptions> = {}) {
    const resolved = resolveOptions(options);
    const sourceFormat = detectFormat(source, resolved.sourceFormat);
    const lines = scan(source, sourceFormat);
    return parse(lines, sourceFormat);
}
