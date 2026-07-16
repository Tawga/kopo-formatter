import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { formatWithDiagnostics, verifyNoTokenLoss } from "../src/core/index.js";
import { scan } from "../src/core/scanner.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MATERIAL_DIR = path.join(__dirname, "test_material");

/** Build a fixed-form line: 6-char sequence area + indicator + content. */
function fx(content: string, indicator = " "): string {
    return "      " + indicator + content;
}

/** Format and assert both: no error-severity diagnostic (no fallback) and
 *  independent token verification of the produced output. */
function expectLossless(source: string): string {
    const r = formatWithDiagnostics(source, { sourceFormat: "fixed" });
    expect(r.diagnostics.filter(d => d.severity === "error")).toEqual([]);
    const v = verifyNoTokenLoss(source, r.text, "fixed");
    expect(v.diagnostics).toEqual([]);
    return r.text;
}

describe("former silent-drop sites keep every token", () => {
    it("site 1: stray line between EVALUATE and first WHEN", () => {
        const out = expectLossless([
            fx("PROCEDURE DIVISION."),
            fx("PARA-1."),
            fx("    EVALUATE WS-X"),
            fx("       ALSO WS-STRAY-SUBJECT"),
            fx("       WHEN 1"),
            fx("          MOVE 1 TO WS-Y"),
            fx("    END-EVALUATE."),
        ].join("\n"));
        expect(out).toContain("WS-STRAY-SUBJECT");
    });

    it("site 1b: stray content after a WHEN body interrupted by a comment", () => {
        const out = expectLossless([
            fx("PROCEDURE DIVISION."),
            fx("PARA-1."),
            fx("    EVALUATE WS-X"),
            fx("       WHEN 1"),
            fx("          MOVE 1 TO WS-Y"),
            fx("KEEP-THIS-COMMENT", "*"),
            fx("          MOVE 2 TO WS-Z"),
            fx("    END-EVALUATE."),
        ].join("\n"));
        expect(out).toContain("WS-Z");
        expect(out).toContain("KEEP-THIS-COMMENT");
    });

    it("site 2: conditional block with clause bodies and stray content", () => {
        const out = expectLossless([
            fx("PROCEDURE DIVISION."),
            fx("PARA-1."),
            fx("    READ TUO-FILE"),
            fx("       AT END"),
            fx("          MOVE 1 TO WS-EOF"),
            fx("KEEP-COMMENT", "*"),
            fx("          MOVE 2 TO WS-AFTER"),
            fx("    END-READ."),
        ].join("\n"));
        expect(out).toContain("WS-AFTER");
        expect(out).toContain("KEEP-COMMENT");
    });

    it("site 3: non-level line after a period-terminated data entry", () => {
        const out = expectLossless([
            fx("WORKING-STORAGE SECTION."),
            fx("01 WS-A PIC X."),
            fx("   ORPHAN-CONTINUATION HERE"),
            fx("01 WS-B PIC X."),
        ].join("\n"));
        expect(out).toContain("ORPHAN-CONTINUATION");
        expect(out).toContain("WS-B");
    });

    it("site 4: malformed data entry (level number without a name)", () => {
        const out = expectLossless([
            fx("WORKING-STORAGE SECTION."),
            fx("01"),
            fx("77 WS-B PIC X."),
        ].join("\n"));
        expect(out).toContain("01");
        expect(out).toContain("WS-B");
    });

    it("site 5: continuation line with no preceding code line", () => {
        const source = [
            fx("ONLY A COMMENT BEFORE", "*"),
            fx("    'ORPHAN-CONT-LITERAL'", "-"),
            fx("01 WS-A PIC X."),
        ].join("\n");
        const out = expectLossless(source);
        expect(out).toContain("'ORPHAN-CONT-LITERAL'");
    });

    it("site 6: spaces inside a VALUE literal survive", () => {
        const out = expectLossless([
            fx("WORKING-STORAGE SECTION."),
            fx("01 WS-A PIC XX VALUE 'A  B'."),
        ].join("\n"));
        expect(out).toContain("'A  B'");
    });

    it("explicit scope terminator keeps its sentence period", () => {
        const out = expectLossless([
            fx("PROCEDURE DIVISION."),
            fx("PARA-1."),
            fx("    IF WS-X = 1"),
            fx("       MOVE 1 TO WS-Y"),
            fx("    END-IF."),
            fx("    MOVE 2 TO WS-Z."),
        ].join("\n"));
        expect(out).toContain("END-IF.");
    });
});

describe("scanner losslessness (independent of the verifier)", () => {
    const FILES = fs.readdirSync(MATERIAL_DIR).filter(f => /\.(cbl|cob|cpy)$/i.test(f));

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

    it.each(FILES)("every raw code token of %s survives scan()", (filename) => {
        const source = fs.readFileSync(path.join(MATERIAL_DIR, filename), "utf8");
        const rawLines = source.split(/\r?\n/).map(expandTabs);
        const hasIdArea = rawLines.every(l => l.trimEnd().length <= 80)
            && rawLines.some(l => l.trimEnd().length > 72 && l.substring(72).trim());

        // Concatenated program text as the scanner sees it
        const scanned = scan(source, "fixed")
            .filter(l => !l.isComment && !l.isBlank)
            .map(l => l.text)
            .join(" ");

        for (let i = 0; i < rawLines.length; i++) {
            const line = hasIdArea ? rawLines[i].substring(0, 72) : rawLines[i];
            const indicator = line.length > 6 ? line[6] : " ";
            // Skip non-code lines and continuation groups (joins may re-space
            // or pad literals; covered by dedicated continuation tests)
            if (["*", "/", "$", "D", "d", "-"].includes(indicator)) continue;
            if (!line.trim()) continue;
            const next = rawLines[i + 1];
            const nextExpanded = next !== undefined && next.length > 6 ? next[6] : " ";
            if (nextExpanded === "-") continue;

            const text = line.substring(7);
            // Lines with open literals participate in literal continuation padding
            const quotes = (text.match(/['"]/g) ?? []).length;
            if (quotes % 2 !== 0) continue;

            let searchFrom = scanned.indexOf(text.trim());
            expect(
                searchFrom,
                `line ${i + 1} of ${filename} missing from scan output: "${text.trim()}"`,
            ).toBeGreaterThanOrEqual(0);
        }
    });
});
