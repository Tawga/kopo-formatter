import { describe, it, expect } from "vitest";
import { format } from "../src/core/index.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmt(source: string, options = {}) {
    return format(source, { sourceFormat: "fixed", ...options });
}

function lines(result: string): string[] {
    return result.split("\n");
}

// Fixed-form column helpers
function col(line: string, c: number): string {
    return line.charAt(c - 1); // 1-based column
}

function contentStartCol(line: string): number {
    for (let i = 7; i < line.length; i++) {
        if (line[i] !== " ") return i + 1; // 1-based
    }
    return -1;
}

// ─── Column structure ─────────────────────────────────────────────────────────

describe("fixed-form column structure", () => {
    it("places sequence area (cols 1-6) as spaces", () => {
        const result = fmt("       IDENTIFICATION DIVISION.");
        for (const line of lines(result)) {
            if (!line.trim()) continue;
            expect(line.substring(0, 6)).toBe("      ");
        }
    });

    it("places col 7 indicator as space for normal lines", () => {
        const result = fmt("       IDENTIFICATION DIVISION.");
        const nonEmpty = lines(result).filter(l => l.trim());
        for (const line of nonEmpty) {
            expect(col(line, 7)).toBe(" ");
        }
    });

    it("preserves comment line indicator in col 7", () => {
        const source = "      * This is a comment\n       IDENTIFICATION DIVISION.";
        const result = fmt(source);
        const commentLine = lines(result).find(l => l.includes("This is a comment"));
        expect(commentLine).toBeDefined();
        expect(col(commentLine!, 7)).toBe("*");
    });
});

// ─── Division & section placement (Area A) ───────────────────────────────────

describe("Area A placement", () => {
    it("places IDENTIFICATION DIVISION at col 8", () => {
        const result = fmt("       IDENTIFICATION DIVISION.");
        const divLine = lines(result).find(l => l.includes("IDENTIFICATION DIVISION"));
        expect(divLine).toBeDefined();
        expect(contentStartCol(divLine!)).toBe(8);
    });

    it("places WORKING-STORAGE SECTION at col 8", () => {
        const source = [
            "       DATA DIVISION.",
            "       WORKING-STORAGE SECTION.",
        ].join("\n");
        const result = fmt(source);
        const sectionLine = lines(result).find(l => l.includes("WORKING-STORAGE SECTION"));
        expect(sectionLine).toBeDefined();
        expect(contentStartCol(sectionLine!)).toBe(8);
    });

    it("places PROCEDURE DIVISION at col 8", () => {
        const result = fmt("       PROCEDURE DIVISION.");
        const divLine = lines(result).find(l => l.includes("PROCEDURE DIVISION"));
        expect(divLine).toBeDefined();
        expect(contentStartCol(divLine!)).toBe(8);
    });
});

// ─── Data division indentation ───────────────────────────────────────────────

describe("data division indentation", () => {
    const source = [
        "       DATA DIVISION.",
        "       WORKING-STORAGE SECTION.",
        "       01  WS-RECORD.",
        "       05  WS-FIELD PIC X(10).",
        "       10  WS-NESTED PIC 9(5).",
    ].join("\n");

    it("places 01-level at col 8 (indent 0)", () => {
        const result = fmt(source);
        const lvl01 = lines(result).find(l => l.includes("WS-RECORD"));
        expect(lvl01).toBeDefined();
        expect(contentStartCol(lvl01!)).toBe(8);
    });

    it("indents 05-level by indentationSpaces", () => {
        const result = fmt(source, { indentationSpaces: 3 });
        const lvl05 = lines(result).find(l => l.includes("WS-FIELD"));
        expect(lvl05).toBeDefined();
        // 01 is at col 8, 05 should be at col 8 + 3 = 11
        expect(contentStartCol(lvl05!)).toBe(11);
    });

    it("indents 10-level two levels deep", () => {
        const result = fmt(source, { indentationSpaces: 3 });
        const lvl10 = lines(result).find(l => l.includes("WS-NESTED"));
        expect(lvl10).toBeDefined();
        // 10 should be at col 8 + 6 = 14
        expect(contentStartCol(lvl10!)).toBe(14);
    });
});

// ─── Procedure division indentation ──────────────────────────────────────────

describe("procedure division indentation", () => {
    it("places paragraph name in Area A", () => {
        const source = [
            "       PROCEDURE DIVISION.",
            "       MAIN-PARA.",
            "           MOVE 1 TO WS-A.",
        ].join("\n");
        const result = fmt(source);
        const paraLine = lines(result).find(l => l.includes("MAIN-PARA."));
        expect(paraLine).toBeDefined();
        expect(contentStartCol(paraLine!)).toBe(8);
    });

    it("places statements in Area B (col 12+)", () => {
        const source = [
            "       PROCEDURE DIVISION.",
            "       MAIN-PARA.",
            "       MOVE 1 TO WS-A.",
        ].join("\n");
        const result = fmt(source);
        const moveLine = lines(result).find(l => l.includes("MOVE 1 TO WS-A"));
        expect(moveLine).toBeDefined();
        expect(contentStartCol(moveLine!)).toBeGreaterThanOrEqual(12);
    });

    it("indents IF body", () => {
        const source = [
            "       PROCEDURE DIVISION.",
            "       MAIN-PARA.",
            "           IF WS-A > 0",
            "               MOVE 1 TO WS-B",
            "           END-IF.",
        ].join("\n");
        const result = fmt(source);
        const bodyLine = lines(result).find(l => l.includes("MOVE 1 TO WS-B"));
        const ifLine = lines(result).find(l => l.includes("IF WS-A"));
        expect(bodyLine).toBeDefined();
        expect(ifLine).toBeDefined();
        // IF body should be indented more than IF keyword
        expect(contentStartCol(bodyLine!)).toBeGreaterThan(contentStartCol(ifLine!));
    });

    it("END-IF aligns with IF", () => {
        const source = [
            "       PROCEDURE DIVISION.",
            "       MAIN-PARA.",
            "           IF WS-A > 0",
            "               MOVE 1 TO WS-B",
            "           END-IF.",
        ].join("\n");
        const result = fmt(source);
        const ifLine = lines(result).find(l => l.includes("IF WS-A"));
        const endIfLine = lines(result).find(l => l.includes("END-IF"));
        expect(ifLine).toBeDefined();
        expect(endIfLine).toBeDefined();
        expect(contentStartCol(ifLine!)).toBe(contentStartCol(endIfLine!));
    });
});

// ─── Idempotency ──────────────────────────────────────────────────────────────

describe("idempotency", () => {
    const SAMPLE = [
        "       IDENTIFICATION DIVISION.",
        "       PROGRAM-ID. MYPROGRAM.",
        "       DATA DIVISION.",
        "       WORKING-STORAGE SECTION.",
        "       01  WS-COUNTER          PIC 9(5)    VALUE ZEROS.",
        "       01  WS-NAME             PIC X(30).",
        "       PROCEDURE DIVISION.",
        "       MAIN-PARA.",
        "           MOVE ZEROS TO WS-COUNTER.",
        "           STOP RUN.",
    ].join("\n");

    it("formatting twice gives same result as formatting once", () => {
        const once = format(SAMPLE, { sourceFormat: "fixed" });
        const twice = format(once, { sourceFormat: "fixed" });
        expect(twice).toBe(once);
    });
});

// ─── Comment preservation ─────────────────────────────────────────────────────

describe("comment preservation", () => {
    it("preserves comment content", () => {
        const source = [
            "      * This comment must survive",
            "       IDENTIFICATION DIVISION.",
        ].join("\n");
        const result = fmt(source);
        expect(result).toContain("This comment must survive");
    });

    it("blank lines are preserved", () => {
        const source = [
            "       IDENTIFICATION DIVISION.",
            "",
            "       PROGRAM-ID. TEST.",
        ].join("\n");
        const result = fmt(source);
        expect(result).toContain("\n\n");
    });
});

// ─── EXIT with blank line ─────────────────────────────────────────────────────

describe("addEmptyLineAfterExit", () => {
    const source = [
        "       PROCEDURE DIVISION.",
        "       MAIN-PARA.",
        "           EXIT.",
        "           STOP RUN.",
    ].join("\n");

    it("inserts blank line after EXIT when option is true", () => {
        const result = format(source, { sourceFormat: "fixed", addEmptyLineAfterExit: true });
        const resultLines = lines(result);
        const exitIdx = resultLines.findIndex(l => l.trim().toUpperCase() === "EXIT.");
        if (exitIdx >= 0 && exitIdx + 1 < resultLines.length) {
            expect(resultLines[exitIdx + 1].trim()).toBe("");
        }
    });
});
