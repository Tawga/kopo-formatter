import { describe, it, expect } from "vitest";
import { format, parseSource } from "../src/core/index.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmt(source: string, options = {}) {
    return format(source, { sourceFormat: "fixed", ...options });
}

function lines(result: string): string[] {
    return result.split("\n");
}

function fixed(sourceLines: string[]): string {
    return sourceLines.map(l => "      " + l).join("\n");
}

function proc(bodyLines: string[]): string {
    return fixed([" PROCEDURE DIVISION.", " MAIN-PARA.", ...bodyLines]);
}

function findLine(result: string, needle: string): string {
    const found = lines(result).find(l => l.includes(needle));
    expect(found, `expected a line containing "${needle}"`).toBeDefined();
    return found!;
}

// ─── EXEC SQL blocks ──────────────────────────────────────────────────────────

describe("EXEC SQL blocks in the procedure division", () => {
    const source = proc([
        "     EXEC SQL",
        "        SELECT  laji,   summa",
        "          INTO :WS-LAJI, :WS-SUMMA",
        "          FROM tapahtumat",
        "         WHERE tunnus = :WS-TUNNUS",
        "     END-EXEC.",
        "     MOVE WS-LAJI TO OUT-LAJI.",
    ]);

    it("passes the SQL interior through verbatim", () => {
        const result = fmt(source);
        // Original columns and internal spacing preserved exactly
        expect(result).toContain("        SELECT  laji,   summa");
        expect(result).toContain("          INTO :WS-LAJI, :WS-SUMMA");
    });

    it("never case-normalizes SQL text even with keywordCase upper", () => {
        const result = fmt(source, { keywordCase: "upper" });
        expect(result).toContain("SELECT  laji,   summa");
        expect(result).toContain("FROM tapahtumat");
        // COBOL around it IS normalized
        expect(findLine(result, "MOVE WS-LAJI").trim()).toContain("MOVE WS-LAJI TO OUT-LAJI.");
    });

    it("does not swallow statements after END-EXEC", () => {
        const result = fmt(source);
        const header = findLine(result, "EXEC SQL");
        const move = findLine(result, "MOVE WS-LAJI");
        expect(move.search(/\S/)).toBe(header.search(/\S/));
    });

    it("does not treat SQL DELETE as a COBOL conditional block", () => {
        const result = fmt(proc([
            "     EXEC SQL",
            "        DELETE FROM tapahtumat",
            "         WHERE tunnus = :WS-TUNNUS",
            "     END-EXEC.",
        ]));
        expect(result).not.toContain("END-DELETE");
        expect(result).toContain("DELETE FROM tapahtumat");
    });

    it("handles a single-line EXEC block", () => {
        const result = fmt(proc([
            "     EXEC SQL COMMIT END-EXEC.",
            "     MOVE A TO B.",
        ]));
        expect(result).toContain("EXEC SQL COMMIT END-EXEC.");
        const exec = findLine(result, "EXEC SQL COMMIT");
        const move = findLine(result, "MOVE A TO B.");
        expect(move.search(/\S/)).toBe(exec.search(/\S/));
    });

    it("preserves comment lines inside the block", () => {
        const result = fmt(proc([
            "     EXEC SQL",
            "        UPDATE tapahtumat",
            "*          sql-kommentti",
            "           SET summa = 0",
            "     END-EXEC.",
        ]));
        expect(result).toContain("sql-kommentti");
    });

    it("indents the frame at statement depth inside blocks", () => {
        const result = fmt(proc([
            "     IF TILA = 1",
            "        EXEC SQL",
            "           ROLLBACK",
            "        END-EXEC",
            "     END-IF.",
        ]));
        const ifLine = findLine(result, "IF TILA");
        const exec = findLine(result, "EXEC SQL");
        const endExec = findLine(result, "END-EXEC");
        expect(exec.search(/\S/)).toBe(ifLine.search(/\S/) + 3);
        expect(endExec.search(/\S/)).toBe(exec.search(/\S/));
    });
});

describe("EXEC SQL blocks in the data division", () => {
    it("handles INCLUDE SQLCA in working-storage", () => {
        const result = fmt(fixed([
            " DATA DIVISION.",
            " WORKING-STORAGE SECTION.",
            "     EXEC SQL INCLUDE SQLCA END-EXEC.",
            " 01  WS-A PIC X.",
        ]));
        expect(result).toContain("EXEC SQL INCLUDE SQLCA END-EXEC.");
        expect(result).toContain("WS-A");
    });

    it("handles a multi-line DECLARE in working-storage verbatim", () => {
        const result = fmt(fixed([
            " DATA DIVISION.",
            " WORKING-STORAGE SECTION.",
            "     EXEC SQL DECLARE C1 CURSOR FOR",
            "        SELECT laji,  summa",
            "          FROM tapahtumat",
            "     END-EXEC.",
            " 01  WS-A PIC X.",
        ]), { keywordCase: "upper" });
        expect(result).toContain("SELECT laji,  summa");
        expect(result).toContain("FROM tapahtumat");
    });
});

// ─── Copybook fragments ───────────────────────────────────────────────────────

describe("copybook fragment formatting", () => {
    it("formats a data copybook with hierarchy and PIC alignment", () => {
        const source = fixed([
            " 01  TUO-TIETUE.",
            "     05 TUO-AVAIN PIC X(10).",
            "     05 TUO-SUMMA PIC S9(7)V99.",
            "     05 TUO-PITKA-NIMI PIC X(30).",
        ]);
        const result = fmt(source);
        const l01 = findLine(result, "01 TUO-TIETUE");
        const l05 = findLine(result, "05 TUO-AVAIN");
        // Hierarchy: 05 nested one level under 01
        expect(l05.search(/\S/)).toBe(l01.search(/\S/) + 3);
        // PIC alignment: both PICs start at the same column
        const picCols = lines(result)
            .filter(l => l.includes("PIC "))
            .map(l => l.indexOf("PIC "));
        expect(new Set(picCols).size).toBe(1);
        // No division header invented
        expect(result).not.toContain("DIVISION");
    });

    it("produces no diagnostics for a data copybook", () => {
        const ast = parseSource(fixed([
            " 01  TUO-TIETUE.",
            "     05 TUO-AVAIN PIC X(10).",
        ]), { sourceFormat: "fixed" });
        expect(ast.diagnostics).toEqual([]);
        expect(JSON.stringify(ast)).not.toContain("UnparsedLine");
    });

    it("formats a SELECT copybook as environment content", () => {
        const source = fixed([
            " SELECT TUO-FILE",
            "     ASSIGN TO DISK TUO-FNIMI",
            "     ORGANIZATION IS INDEXED",
            "     RECORD KEY IS TUO-AVAIN.",
        ]);
        const result = fmt(source);
        // Joined into one logical SELECT entry (may be re-wrapped with a
        // continuation marker, which reads as " - " after collapsing)
        const collapsed = result.replace(/\s+/g, " ").replace(/ - /g, " ");
        expect(collapsed).toContain(
            "SELECT TUO-FILE ASSIGN TO DISK TUO-FNIMI ORGANIZATION IS INDEXED RECORD KEY IS TUO-AVAIN.",
        );
        expect(result).not.toContain("DIVISION");
    });

    it("formats a procedure copybook with block indentation", () => {
        const source = fixed([
            " APU-PARA.",
            "     IF TILA = 1",
            "        MOVE 1 TO X",
            "     END-IF.",
        ]);
        const result = fmt(source);
        const para = findLine(result, "APU-PARA.");
        expect(para.search(/\S/)).toBe(7); // Area A
        const ifLine = findLine(result, "IF TILA");
        const move = findLine(result, "MOVE 1 TO X");
        expect(move.search(/\S/)).toBe(ifLine.search(/\S/) + 3);
        expect(result).not.toContain("DIVISION");
    });

    it("keeps leading comments of a fragment", () => {
        const source = fixed([
            "* kopiokirjan kommentti",
            " 01  TUO-TIETUE PIC X.",
        ]);
        const result = fmt(source);
        expect(result).toContain("kopiokirjan kommentti");
    });
});

// ─── COPY ... REPLACING ───────────────────────────────────────────────────────

describe("multi-line COPY REPLACING", () => {
    it("joins the statement into one logical unit in working-storage", () => {
        const source = fixed([
            " DATA DIVISION.",
            " WORKING-STORAGE SECTION.",
            '     COPY "TUOTE"',
            "        REPLACING ==:ETU:== BY ==TUO==.",
            " 01  WS-A PIC X.",
        ]);
        const result = fmt(source);
        expect(result.replace(/\s+/g, " ")).toContain(
            'COPY "TUOTE" REPLACING ==:ETU:== BY ==TUO==.',
        );
    });

    it("joins REPLACING in FILE-CONTROL", () => {
        const source = fixed([
            " ENVIRONMENT DIVISION.",
            " INPUT-OUTPUT SECTION.",
            " FILE-CONTROL.",
            '     COPY "SEL003"',
            "        REPLACING ==XX== BY ==YY==.",
        ]);
        const result = fmt(source);
        expect(result.replace(/\s+/g, " ")).toContain(
            'COPY "SEL003" REPLACING ==XX== BY ==YY==.',
        );
    });

    it("leaves single-line COPY untouched", () => {
        const source = fixed([
            " DATA DIVISION.",
            " WORKING-STORAGE SECTION.",
            '     COPY "TUOTE".',
            " 01  WS-A PIC X.",
        ]);
        const result = fmt(source);
        expect(result).toContain('COPY "TUOTE".');
        expect(result).toContain("WS-A");
    });
});

// ─── Compiler directives and alignment outliers ───────────────────────────────

describe("$ compiler directives", () => {
    it("preserves $XFD lines verbatim including the $ indicator", () => {
        const source = [
            "      $XFD FILE=MPTBI003",
            "      " + " FD  TUO-FILE.",
            "      " + " 01  TUO-TIETUE PIC X(10).",
        ].join("\n");
        const result = fmt(source);
        expect(result).toContain("$XFD FILE=MPTBI003");
        // The $ stays in column 7
        const xfd = findLine(result, "XFD");
        expect(xfd[6]).toBe("$");
    });
});

describe("PIC alignment outlier cap", () => {
    it("does not let one long REDEFINES entry push the group's PIC past col 49", () => {
        const source = fixed([
            " 01  TUO-TIETUE.",
            "     03 TUO-LYHYT PIC X(10).",
            "     03 TUO-VAARALLISUUS9 REDEFINES TUO-VAARALLISUUS-PITKA PIC 9(6).",
        ]);
        const result = fmt(source);
        const short = findLine(result, "TUO-LYHYT");
        // The cap allows at most 49 characters before PIC (starts ≤ col 50)
        expect(short.indexOf("PIC ")).toBeLessThanOrEqual(49);
        // And the short entry's line does not wrap
        expect(short.length).toBeLessThanOrEqual(72);
    });
});

// ─── Idempotency ──────────────────────────────────────────────────────────────

describe("idempotency of v0.6 features", () => {
    const cases: Array<[string, string, object?]> = [
        ["multi-line EXEC SQL", proc([
            "     EXEC SQL",
            "        SELECT laji INTO :WS-LAJI",
            "          FROM tapahtumat",
            "     END-EXEC.",
        ])],
        ["EXEC SQL with keywordCase upper", proc([
            "     EXEC SQL",
            "        select laji into :WS-LAJI from tapahtumat",
            "     END-EXEC.",
        ]), { keywordCase: "upper" }],
        ["data fragment", fixed([
            " 01  TUO-TIETUE.",
            "     05 TUO-AVAIN PIC X(10).",
        ])],
        ["select fragment", fixed([
            " SELECT TUO-FILE ASSIGN TO DISK TUO-FNIMI.",
        ])],
        ["procedure fragment", fixed([
            " APU-PARA.",
            "     MOVE 1 TO X.",
        ])],
        ["COPY REPLACING", fixed([
            " DATA DIVISION.",
            " WORKING-STORAGE SECTION.",
            '     COPY "TUOTE" REPLACING ==:ETU:== BY ==TUO==.',
        ])],
    ];

    for (const [name, source, options] of cases) {
        it(`formats ${name} idempotently`, () => {
            const once = fmt(source, options ?? {});
            const twice = fmt(once, options ?? {});
            expect(twice).toBe(once);
        });
    }
});
