/**
 * No-code-loss verifier: proves that formatter output contains every
 * meaningful token of the input.
 *
 * Both input and output are run through scan() so that continuation joining
 * and fixed-form column extraction are handled identically on both sides.
 * The scanned lines are tokenized into two streams:
 *
 * - code tokens: string literals verbatim (case-sensitive, quotes included),
 *   all other words uppercased (keyword-casing options only change case)
 * - comment lines (incl. $ directives and D debug lines): text verbatim,
 *   trailing whitespace ignored
 *
 * Each input stream must be an ordered subsequence of the corresponding
 * output stream. Subsequence — not equality — because the printer may
 * legitimately insert tokens (synthesized END-IF/END-EVALUATE/END-PERFORM).
 * Blank lines are excluded entirely (collapsing/insertion is legitimate).
 *
 * Known limitation: true mid-word fixed-form continuations (a word split
 * across lines without a hyphenated join) get a space inserted by the
 * scanner join on BOTH sides, so scan-based verification cannot detect that
 * corruption. This predates the verifier and is a scanner semantics issue.
 */

import { scan } from "./scanner.js";
import { type SourceFormat } from "./formatDetector.js";
import { type Diagnostic } from "./types.js";

export interface VToken {
    /** Uppercased for words; verbatim (including quotes) for literals */
    text: string;
    /** 0-based original line the token came from */
    line: number;
    isLiteral: boolean;
}

export interface VerifyResult {
    ok: boolean;
    /** Empty when ok */
    diagnostics: Diagnostic[];
}

/**
 * Tokenize one scanned line's program text.
 * Exported for tests.
 */
export function tokenizeLine(text: string, line: number): VToken[] {
    const tokens: VToken[] = [];
    let i = 0;

    while (i < text.length) {
        const ch = text[i];

        if (ch === " ") {
            i++;
            continue;
        }

        if (ch === "'" || ch === '"') {
            // String literal: verbatim through the matching close quote.
            // A doubled quote ('' or "") stays inside the literal.
            const quote = ch;
            const start = i;
            i++;
            while (i < text.length) {
                if (text[i] === quote) {
                    if (text[i + 1] === quote) {
                        i += 2; // doubled quote — still inside
                        continue;
                    }
                    i++; // closing quote
                    break;
                }
                i++;
            }
            tokens.push({ text: text.substring(start, i), line, isLiteral: true });
            continue;
        }

        // Word: maximal run of non-space, non-quote characters
        const start = i;
        while (i < text.length && text[i] !== " " && text[i] !== "'" && text[i] !== '"') {
            i++;
        }
        tokens.push({ text: text.substring(start, i).toUpperCase(), line, isLiteral: false });
    }

    return tokens;
}

/**
 * Extract the comparable token streams of a source text.
 * Exported for tests.
 */
export function extractComparableTokens(
    source: string,
    format: SourceFormat,
    opts: { stripIdArea?: boolean } = {},
): { code: VToken[]; comments: VToken[] } {
    const lines = scan(source, format, { stripIdArea: opts.stripIdArea });
    const code: VToken[] = [];
    const comments: VToken[] = [];

    for (const line of lines) {
        if (line.isBlank) continue;
        if (line.isComment) {
            comments.push({ text: line.text.trimEnd(), line: line.originalLine, isLiteral: false });
        } else {
            code.push(...tokenizeLine(line.text, line.originalLine));
        }
    }

    return { code, comments };
}

/**
 * Two-pointer ordered-subsequence check; returns the unmatched needle tokens.
 * On a miss the haystack pointer stays where it was, so later tokens can
 * still match after the gap.
 */
function missingFromSubsequence(needle: VToken[], haystack: VToken[]): VToken[] {
    const missing: VToken[] = [];
    let h = 0;
    for (const tok of needle) {
        let j = h;
        while (j < haystack.length && haystack[j].text !== tok.text) j++;
        if (j < haystack.length) {
            h = j + 1;
        } else {
            missing.push(tok);
        }
    }
    return missing;
}

/**
 * Verify that every meaningful token of `input` survives in `output`.
 * `format` must be the SAME resolved source format the pipeline used —
 * never re-detected from the output.
 */
export function verifyNoTokenLoss(
    input: string,
    output: string,
    format: SourceFormat,
): VerifyResult {
    const inputStreams = extractComparableTokens(input, format);
    // Never truncate cols 73-80 of our own output on rescan
    const outputStreams = extractComparableTokens(output, format, { stripIdArea: false });

    const missingCode = missingFromSubsequence(inputStreams.code, outputStreams.code);
    const missingComments = missingFromSubsequence(inputStreams.comments, outputStreams.comments);

    const diagnostics: Diagnostic[] = [];

    if (missingCode.length > 0) {
        const samples = missingCode
            .slice(0, 5)
            .map(t => `"${t.text.length > 40 ? t.text.substring(0, 40) + "…" : t.text}" (line ${t.line + 1})`)
            .join(", ");
        diagnostics.push({
            severity: "error",
            message: `No-loss verification failed: ${missingCode.length} code token(s) would be lost: ${samples}. Original text returned unchanged.`,
            line: missingCode[0].line + 1,
        });
    }

    if (missingComments.length > 0) {
        const samples = missingComments
            .slice(0, 3)
            .map(t => `line ${t.line + 1}`)
            .join(", ");
        diagnostics.push({
            severity: "error",
            message: `No-loss verification failed: ${missingComments.length} comment line(s) would be lost (${samples}). Original text returned unchanged.`,
            line: missingComments[0].line + 1,
        });
    }

    return { ok: diagnostics.length === 0, diagnostics };
}
