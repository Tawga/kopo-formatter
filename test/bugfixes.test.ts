import { describe, it, expect } from "vitest";
import { format } from "../src/core/index.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmt(source: string, options = {}) {
    return format(source, { sourceFormat: "fixed", ...options });
}

function lines(result: string): string[] {
    return result.split("\n");
}

/** Prefix a bare statement with the 6-char sequence area + indicator space. */
function fixed(sourceLines: string[]): string {
    return sourceLines.map(l => "      " + l).join("\n");
}

// ─── Period-terminated PERFORM ────────────────────────────────────────────────

describe("out-of-line PERFORM", () => {
    it("does not invent END-PERFORM for out-of-line PERFORM ... UNTIL", () => {
        const source = fixed([
            " PROCEDURE DIVISION.",
            " MAIN-PARA.",
            "     PERFORM CALC-PARA UNTIL DONE = 1.",
            "     MOVE 1 TO X.",
            "     STOP RUN.",
        ]);
        const result = fmt(source);
        expect(result).not.toContain("END-PERFORM");
    });

    it("does not swallow following statements into a phantom body", () => {
        const source = fixed([
            " PROCEDURE DIVISION.",
            " MAIN-PARA.",
            "     PERFORM CALC-PARA UNTIL DONE = 1.",
            "     MOVE 1 TO X.",
        ]);
        const result = fmt(source);
        const performLine = lines(result).find(l => l.includes("PERFORM CALC-PARA"));
        const moveLine = lines(result).find(l => l.includes("MOVE 1 TO X"));
        expect(performLine).toBeDefined();
        expect(moveLine).toBeDefined();
        // Both statements sit at the same indent level
        expect(moveLine!.search(/\S/)).toBe(performLine!.search(/\S/));
    });

    it("still formats inline PERFORM UNTIL ... END-PERFORM as a block", () => {
        const source = fixed([
            " PROCEDURE DIVISION.",
            " MAIN-PARA.",
            "     PERFORM UNTIL DONE = 1",
            "        MOVE 1 TO X",
            "     END-PERFORM.",
        ]);
        const result = fmt(source);
        expect(result).toContain("END-PERFORM");
        const performLine = lines(result).find(l => l.trim().startsWith("PERFORM"));
        const moveLine = lines(result).find(l => l.includes("MOVE 1 TO X"));
        expect(moveLine!.search(/\S/)).toBeGreaterThan(performLine!.search(/\S/));
    });

    it("does not invent END-PERFORM when an inline body is closed by a period", () => {
        const source = fixed([
            " PROCEDURE DIVISION.",
            " MAIN-PARA.",
            "     PERFORM UNTIL DONE = 1",
            "        MOVE 1 TO X.",
            " NEXT-PARA.",
            "     STOP RUN.",
        ]);
        const result = fmt(source);
        expect(result).not.toContain("END-PERFORM");
    });
});

// ─── Period-terminated EVALUATE ───────────────────────────────────────────────

describe("period-terminated EVALUATE", () => {
    it("does not invent END-EVALUATE after a closing period", () => {
        const source = fixed([
            " PROCEDURE DIVISION.",
            " MAIN-PARA.",
            "     EVALUATE WS-CODE",
            "        WHEN 1",
            "           MOVE 1 TO X",
            "        WHEN OTHER",
            "           MOVE 2 TO X.",
            " NEXT-PARA.",
            "     STOP RUN.",
        ]);
        const result = fmt(source);
        expect(result).not.toContain("END-EVALUATE");
        // The following paragraph is still recognized (Area A, col 8)
        const nextPara = lines(result).find(l => l.includes("NEXT-PARA"));
        expect(nextPara).toBeDefined();
        expect(nextPara!.search(/\S/)).toBe(7); // 0-based index 7 = column 8
    });

    it("still emits END-EVALUATE for block-structured EVALUATE", () => {
        const source = fixed([
            " PROCEDURE DIVISION.",
            " MAIN-PARA.",
            "     EVALUATE WS-CODE",
            "        WHEN 1",
            "           MOVE 1 TO X",
            "     END-EVALUATE.",
        ]);
        const result = fmt(source);
        expect(result).toContain("END-EVALUATE");
    });
});

// ─── Continued string literals ────────────────────────────────────────────────

describe("continued string literals", () => {
    it("splices a continued literal at the resume quote without inserting a space", () => {
        const source = fixed([
            " PROCEDURE DIVISION.",
            " MAIN-PARA.",
            '     MOVE "ABCDEF',
            '-        "GHIJKL" TO WS-X.',
        ]);
        const result = fmt(source, { wrapLongLines: false });
        // The literal must contain exactly one opening and one closing quote,
        // with ABCDEF space-padded to col 72 (punched-card semantics), then GHIJKL.
        const literalMatch = result.match(/"([^"]*)"/);
        expect(literalMatch).toBeDefined();
        expect(literalMatch![1]).toMatch(/^ABCDEF +GHIJKL$/);
        // The corrupted form would contain a stray quote pairing
        expect(result).not.toContain('"ABCDEF "GHIJKL"');
    });

    it("keeps joining non-literal continuations with a single space", () => {
        const source = fixed([
            " PROCEDURE DIVISION.",
            " MAIN-PARA.",
            "     MOVE LONG-FIELD-A",
            "-        TO LONG-FIELD-B.",
        ]);
        const result = fmt(source);
        expect(result).toContain("MOVE LONG-FIELD-A TO LONG-FIELD-B.");
    });
});

// ─── Identification area (cols 73-80) ─────────────────────────────────────────

describe("identification area handling", () => {
    it("strips cols 73-80 when the file uses punched-card layout", () => {
        const stmt = "      " + "     MOVE FIELD-A TO FIELD-B.";
        const source = [
            "      " + " PROCEDURE DIVISION.",
            "      " + " MAIN-PARA.",
            stmt.padEnd(72, " ") + "SEQ00010",
        ].join("\n");
        const result = fmt(source);
        expect(result).toContain("MOVE FIELD-A TO FIELD-B.");
        expect(result).not.toContain("SEQ00010");
    });

    it("leaves long lines intact when the file has no card layout (>80 col lines)", () => {
        const longTail = "LONG-DATA-NAME-THAT-PUSHES-THE-LINE-WELL-PAST-EIGHTY-COLUMNS";
        const source = fixed([
            " PROCEDURE DIVISION.",
            " MAIN-PARA.",
            `     MOVE FIELD-A TO ${longTail}.`,
        ]);
        const result = fmt(source, { wrapLongLines: false });
        expect(result).toContain(longTail);
    });
});

// ─── Line wrapping safety ─────────────────────────────────────────────────────

describe("line wrapping safety", () => {
    it("splits an unbreakable long literal as a literal continuation", () => {
        const longLiteral = '"' + "X".repeat(70) + '"';
        const source = fixed([
            " PROCEDURE DIVISION.",
            " MAIN-PARA.",
            `     MOVE ${longLiteral} TO WS-X.`,
        ]);
        // Must terminate (no infinite recursion) and preserve the literal
        const result = fmt(source);
        // The literal is split with COBOL literal continuation: the head fills
        // to col 72 and the continuation re-opens with the quote after "-".
        expect(result).toMatch(/\n {6}-\s+"X+/);
        // All X's survive across the split (70 in the literal + 1 in WS-X)
        expect((result.match(/X/g) ?? []).length).toBe(71);
        // No emitted line exceeds col 72 (an over-72 line within 80 cols would
        // make a rescan misdetect an identification area and truncate it)
        for (const line of lines(result)) {
            expect(line.length).toBeLessThanOrEqual(72);
            // No output line consists solely of indent (garbage split inside the indent)
            if (line.length > 7) {
                expect(line.substring(7).trim().length).toBeGreaterThan(0);
            }
        }
        // The split round-trips: reformatting reproduces the same text
        expect(fmt(result)).toBe(result);
    });
});

// ─── Division headers preceded by comments ────────────────────────────────────

describe("division headers behind comments", () => {
    const source = [
        "      " + " IDENTIFICATION DIVISION.",
        "      " + " PROGRAM-ID. TESTI.",
        "      " + "* kommentti ennen environment-divisionia",
        "      " + " ENVIRONMENT DIVISION.",
        "      " + " INPUT-OUTPUT SECTION.",
        "      " + " FILE-CONTROL.",
        "      " + '     COPY "SEL003".',
        "      " + "* kommentti ennen data-divisionia",
        "      " + " DATA DIVISION.",
        "      " + " WORKING-STORAGE SECTION.",
        "      " + " 01  WS-A PIC X.",
        "      " + "* kommentti ennen procedure-divisionia",
        "      " + " PROCEDURE DIVISION.",
        "      " + " MAIN-PARA.",
        "      " + "     STOP RUN.",
    ].join("\n");

    it("recognizes every division even when comments precede the header", async () => {
        const { parseSource } = await import("../src/core/index.js");
        const ast = parseSource(source, { sourceFormat: "fixed" });
        const kinds = ast.children
            .filter(c => c.kind === "Division")
            .map(c => (c as { divisionType: string }).divisionType);
        expect(kinds).toEqual([
            "IdentificationDivision",
            "EnvironmentDivision",
            "DataDivision",
            "ProcedureDivision",
        ]);
    });

    it("keeps the comments and formats the divisions' content", () => {
        const result = fmt(source);
        expect(result).toContain("kommentti ennen environment-divisionia");
        expect(result).toContain("kommentti ennen data-divisionia");
        expect(result).toContain("kommentti ennen procedure-divisionia");
        // COPY inside FILE-CONTROL lands in Area B (col 12), proving the
        // environment division parser actually ran
        const copyLine = lines(result).find(l => l.includes('COPY "SEL003"'))!;
        expect(copyLine.search(/\S/)).toBe(11);
    });

    it("is idempotent", () => {
        const once = fmt(source);
        expect(fmt(once)).toBe(once);
    });
});

// ─── Idempotency of the fixed cases ───────────────────────────────────────────

describe("idempotency of bugfix cases", () => {
    const cases: Array<[string, string]> = [
        ["out-of-line PERFORM", fixed([
            " PROCEDURE DIVISION.",
            " MAIN-PARA.",
            "     PERFORM CALC-PARA UNTIL DONE = 1.",
            "     MOVE 1 TO X.",
        ])],
        ["period-terminated EVALUATE", fixed([
            " PROCEDURE DIVISION.",
            " MAIN-PARA.",
            "     EVALUATE WS-CODE",
            "        WHEN 1",
            "           MOVE 1 TO X.",
        ])],
        ["continued literal", fixed([
            " PROCEDURE DIVISION.",
            " MAIN-PARA.",
            '     MOVE "ABCDEF',
            '-        "GHIJKL" TO WS-X.',
        ])],
    ];

    for (const [name, source] of cases) {
        it(`formats ${name} idempotently`, () => {
            const once = fmt(source);
            const twice = fmt(once);
            expect(twice).toBe(once);
        });
    }
});
