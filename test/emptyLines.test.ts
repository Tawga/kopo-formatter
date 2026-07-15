import { describe, it, expect } from "vitest";
import { format } from "../src/core/index.js";

function fmt(source: string, options = {}) {
    return format(source, { sourceFormat: "fixed", ...options });
}

function lines(result: string): string[] {
    return result.split("\n");
}

// ─── addEmptyLineAfterDivision ──────────────────────────────────────────────

describe("addEmptyLineAfterDivision", () => {
    const source = [
        "       IDENTIFICATION DIVISION.",
        "       PROGRAM-ID. TEST1.",
        "       DATA DIVISION.",
        "       WORKING-STORAGE SECTION.",
        "       01  WS-A PIC X.",
        "       PROCEDURE DIVISION.",
        "       MAIN-PARA.",
        "           STOP RUN.",
    ].join("\n");

    it("inserts a blank line after each division when enabled", () => {
        const result = fmt(source, { addEmptyLineAfterDivision: true });
        const resultLines = lines(result);

        // Find the last line of each division's content, expect blank after it
        const progIdIdx = resultLines.findIndex(l => l.includes("PROGRAM-ID"));
        expect(progIdIdx).toBeGreaterThan(-1);
        expect(resultLines[progIdIdx + 1]).toBe("");

        // After DATA DIVISION content (before PROCEDURE)
        const procDivIdx = resultLines.findIndex(l => l.includes("PROCEDURE DIVISION"));
        expect(procDivIdx).toBeGreaterThan(-1);
        // The line before PROCEDURE DIVISION should be blank
        expect(resultLines[procDivIdx - 1]).toBe("");
    });

    it("does NOT insert blank lines when disabled", () => {
        const result = fmt(source, { addEmptyLineAfterDivision: false });
        const resultLines = lines(result);

        // No two consecutive blanks that weren't in the original
        const progIdIdx = resultLines.findIndex(l => l.includes("PROGRAM-ID"));
        expect(progIdIdx).toBeGreaterThan(-1);
        // Next non-blank line should be DATA DIVISION, with no blank between
        expect(resultLines[progIdIdx + 1]).toContain("DATA DIVISION");
    });
});

// ─── addEmptyLineAfterSection ───────────────────────────────────────────────

describe("addEmptyLineAfterSection", () => {
    const source = [
        "       DATA DIVISION.",
        "       FILE SECTION.",
        "       FD MY-FILE.",
        "       01  MY-RECORD PIC X(80).",
        "       WORKING-STORAGE SECTION.",
        "       01  WS-A PIC X.",
        "       PROCEDURE DIVISION.",
        "       MAIN-SECTION SECTION.",
        "       MAIN-PARA.",
        "           STOP RUN.",
    ].join("\n");

    it("inserts a blank line after each section when enabled", () => {
        const result = fmt(source, { addEmptyLineAfterSection: true });
        const resultLines = lines(result);

        // After FILE SECTION content (before WORKING-STORAGE)
        const wsIdx = resultLines.findIndex(l => l.includes("WORKING-STORAGE SECTION"));
        expect(wsIdx).toBeGreaterThan(-1);
        expect(resultLines[wsIdx - 1]).toBe("");

        // After WORKING-STORAGE content (before PROCEDURE)
        const procIdx = resultLines.findIndex(l => l.includes("PROCEDURE DIVISION"));
        expect(procIdx).toBeGreaterThan(-1);
        // There should be a blank before PROCEDURE (from section's trailing blank)
        const blankBeforeProc = resultLines.slice(wsIdx, procIdx).some(l => l.trim() === "");
        expect(blankBeforeProc).toBe(true);
    });

    it("does NOT insert blank lines between sections when disabled", () => {
        const result = fmt(source, { addEmptyLineAfterSection: false });
        const resultLines = lines(result);

        // After FILE SECTION's last data entry, no blank before WORKING-STORAGE
        const wsIdx = resultLines.findIndex(l => l.includes("WORKING-STORAGE SECTION"));
        expect(wsIdx).toBeGreaterThan(-1);
        expect(resultLines[wsIdx - 1].trim()).not.toBe("");
    });
});

// ─── Both options together ──────────────────────────────────────────────────

describe("addEmptyLineAfterDivision + addEmptyLineAfterSection combined", () => {
    const source = [
        "       IDENTIFICATION DIVISION.",
        "       PROGRAM-ID. COMBO.",
        "       ENVIRONMENT DIVISION.",
        "       CONFIGURATION SECTION.",
        "       SOURCE-COMPUTER. IBM-390.",
        "       DATA DIVISION.",
        "       WORKING-STORAGE SECTION.",
        "       01  WS-A PIC X.",
        "       LINKAGE SECTION.",
        "       01  LS-A PIC X.",
        "       PROCEDURE DIVISION.",
        "       MAIN-PARA.",
        "           STOP RUN.",
    ].join("\n");

    it("inserts blank lines after both divisions and sections", () => {
        const result = fmt(source, {
            addEmptyLineAfterDivision: true,
            addEmptyLineAfterSection: true,
        });
        const resultLines = lines(result);

        // After ID DIVISION content
        const envIdx = resultLines.findIndex(l => l.includes("ENVIRONMENT DIVISION"));
        expect(envIdx).toBeGreaterThan(-1);
        expect(resultLines[envIdx - 1]).toBe("");

        // After ENVIRONMENT DIVISION content
        const dataIdx = resultLines.findIndex(l => l.includes("DATA DIVISION"));
        expect(dataIdx).toBeGreaterThan(-1);
        expect(resultLines[dataIdx - 1]).toBe("");

        // After WORKING-STORAGE SECTION content (before LINKAGE)
        const linkIdx = resultLines.findIndex(l => l.includes("LINKAGE SECTION"));
        expect(linkIdx).toBeGreaterThan(-1);
        expect(resultLines[linkIdx - 1]).toBe("");
    });
});

// ─── Trivia (blank lines / comments) between divisions ──────────────────────

describe("trivia between divisions with addEmptyLineAfterDivision", () => {
    it("does not swallow blank lines between divisions when option is off", () => {
        const source = [
            "       IDENTIFICATION DIVISION.",
            "       PROGRAM-ID. TEST1.",
            "",
            "       DATA DIVISION.",
            "       WORKING-STORAGE SECTION.",
            "       01  WS-A PIC X.",
            "",
            "       PROCEDURE DIVISION.",
            "       MAIN-PARA.",
            "           STOP RUN.",
        ].join("\n");
        const result = fmt(source, { addEmptyLineAfterDivision: false });
        const resultLines = lines(result);
        // The original blank lines should be preserved
        const dataIdx = resultLines.findIndex(l => l.includes("DATA DIVISION"));
        expect(dataIdx).toBeGreaterThan(-1);
        // There should still be a blank line before DATA DIVISION
        expect(resultLines[dataIdx - 1]).toBe("");

        const procIdx = resultLines.findIndex(l => l.includes("PROCEDURE DIVISION"));
        expect(procIdx).toBeGreaterThan(-1);
        // There should still be a blank line before PROCEDURE DIVISION
        expect(resultLines[procIdx - 1]).toBe("");
    });

    it("does not swallow comments between divisions", () => {
        const source = [
            "       IDENTIFICATION DIVISION.",
            "       PROGRAM-ID. TEST1.",
            "      * Comment before Data Division",
            "       DATA DIVISION.",
            "       WORKING-STORAGE SECTION.",
            "       01  WS-A PIC X.",
        ].join("\n");
        const result = fmt(source);
        expect(result).toContain("Comment before Data Division");
    });

    it("preserves blank line between two data sections", () => {
        const source = [
            "       DATA DIVISION.",
            "       FILE SECTION.",
            "       FD MY-FILE.",
            "       01  MY-REC PIC X(80).",
            "",
            "       WORKING-STORAGE SECTION.",
            "       01  WS-A PIC X.",
        ].join("\n");
        const result = fmt(source, { addEmptyLineAfterSection: false });
        const resultLines = lines(result);
        const wsIdx = resultLines.findIndex(l => l.includes("WORKING-STORAGE SECTION"));
        expect(wsIdx).toBeGreaterThan(-1);
        // Original blank line should still be there
        expect(resultLines[wsIdx - 1]).toBe("");
    });
});

// ─── Division/section boundary detection after trivia ────────────────────────

describe("division boundary detection after blank lines", () => {
    it("does not eat the next division header when blank lines precede it", () => {
        // This tests a specific scenario: blank line between ID div content
        // and the next division header. The parser must recognize the division
        // boundary even when trivia separates them.
        const source = [
            "       IDENTIFICATION DIVISION.",
            "       PROGRAM-ID. TEST1.",
            "",
            "",
            "       ENVIRONMENT DIVISION.",
            "       CONFIGURATION SECTION.",
            "       SOURCE-COMPUTER. IBM-390.",
            "",
            "       DATA DIVISION.",
            "       WORKING-STORAGE SECTION.",
            "       01  WS-A PIC X.",
            "",
            "       PROCEDURE DIVISION.",
            "       MAIN-PARA.",
            "           STOP RUN.",
        ].join("\n");
        const result = fmt(source);
        const resultLines = lines(result);

        // All four division headers must appear in the output
        expect(resultLines.some(l => l.includes("IDENTIFICATION DIVISION"))).toBe(true);
        expect(resultLines.some(l => l.includes("ENVIRONMENT DIVISION"))).toBe(true);
        expect(resultLines.some(l => l.includes("DATA DIVISION"))).toBe(true);
        expect(resultLines.some(l => l.includes("PROCEDURE DIVISION"))).toBe(true);

        // ENVIRONMENT DIVISION must start at Area A (col 8)
        const envLine = resultLines.find(l => l.includes("ENVIRONMENT DIVISION"))!;
        expect(envLine.indexOf("E")).toBe(7); // 0-based col 7 = 1-based col 8
    });

    it("sections after blank lines are still recognized", () => {
        const source = [
            "       DATA DIVISION.",
            "       FILE SECTION.",
            "       FD MY-FILE.",
            "       01  MY-REC PIC X(80).",
            "",
            "",
            "       WORKING-STORAGE SECTION.",
            "       01  WS-A PIC X.",
            "",
            "       LINKAGE SECTION.",
            "       01  LS-A PIC X.",
        ].join("\n");
        const result = fmt(source, { addEmptyLineAfterSection: true });
        const resultLines = lines(result);

        // All three sections must be recognized and present
        expect(resultLines.some(l => l.includes("FILE SECTION"))).toBe(true);
        expect(resultLines.some(l => l.includes("WORKING-STORAGE SECTION"))).toBe(true);
        expect(resultLines.some(l => l.includes("LINKAGE SECTION"))).toBe(true);

        // Each section should have a blank line after its content
        const linkIdx = resultLines.findIndex(l => l.includes("LINKAGE SECTION"));
        // There must be a blank line between WS content and LINKAGE header
        expect(resultLines[linkIdx - 1]).toBe("");
    });
});

// ─── Division header not consumed as content ─────────────────────────────────

describe("division headers must not be consumed as division entries", () => {
    it("DATA DIVISION header is placed at Area A, not treated as ID div entry", () => {
        // When blank lines separate ID DIVISION content from DATA DIVISION,
        // the parser must not consume DATA DIVISION as a DivisionEntry child
        // of the Identification Division.
        const source = [
            "       IDENTIFICATION DIVISION.",
            "       PROGRAM-ID. TEST1.",
            "",
            "       DATA DIVISION.",
            "       WORKING-STORAGE SECTION.",
            "       01  WS-A PIC X.",
        ].join("\n");
        const result = fmt(source);
        const resultLines = lines(result);

        // DATA DIVISION must be at Area A col 8
        const dataLine = resultLines.find(l => l.includes("DATA DIVISION"));
        expect(dataLine).toBeDefined();
        expect(dataLine!.indexOf("DATA")).toBe(7); // 0-based 7 = col 8

        // WS-A must appear (it would be lost if DATA DIVISION was eaten)
        expect(resultLines.some(l => l.includes("WS-A"))).toBe(true);
    });

    it("PROCEDURE DIVISION after blanks is recognized as a division", () => {
        const source = [
            "       DATA DIVISION.",
            "       WORKING-STORAGE SECTION.",
            "       01  WS-A PIC X.",
            "",
            "",
            "       PROCEDURE DIVISION.",
            "       MAIN-PARA.",
            "           DISPLAY 'HELLO'.",
        ].join("\n");
        const result = fmt(source);
        const resultLines = lines(result);

        // PROCEDURE DIVISION must be at Area A
        const procLine = resultLines.find(l => l.includes("PROCEDURE DIVISION"));
        expect(procLine).toBeDefined();
        expect(procLine!.indexOf("PROCEDURE")).toBe(7);

        // DISPLAY must be present (not lost)
        expect(resultLines.some(l => l.includes("DISPLAY"))).toBe(true);
    });
});

// ─── Idempotency with blank-line options ─────────────────────────────────────

describe("idempotency with blank-line options", () => {
    const source = [
        "       IDENTIFICATION DIVISION.",
        "       PROGRAM-ID. IDEM.",
        "       DATA DIVISION.",
        "       WORKING-STORAGE SECTION.",
        "       01  WS-A PIC X.",
        "       PROCEDURE DIVISION.",
        "       MAIN-PARA.",
        "           STOP RUN.",
    ].join("\n");

    it("formatting twice with addEmptyLineAfterDivision preserves blank lines", () => {
        const opts = { sourceFormat: "fixed" as const, addEmptyLineAfterDivision: true };
        const once = format(source, opts);
        const twice = format(once, opts);
        // Count blank lines — should be the same between passes
        const onceBlankCount = lines(once).filter(l => l.trim() === "").length;
        const twiceBlankCount = lines(twice).filter(l => l.trim() === "").length;
        expect(twiceBlankCount).toBe(onceBlankCount);
    });

    it("formatting twice with addEmptyLineAfterSection preserves blank lines", () => {
        const opts = { sourceFormat: "fixed" as const, addEmptyLineAfterSection: true };
        const once = format(source, opts);
        const twice = format(once, opts);
        const onceBlankCount = lines(once).filter(l => l.trim() === "").length;
        const twiceBlankCount = lines(twice).filter(l => l.trim() === "").length;
        expect(twiceBlankCount).toBe(onceBlankCount);
    });
});
