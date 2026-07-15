import { describe, it, expect } from "vitest";
import { format } from "../src/core/index.js";

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

function indentOf(line: string): number {
    return line.search(/\S/);
}

function findLine(result: string, needle: string): string {
    const found = lines(result).find(l => l.includes(needle));
    expect(found, `expected a line containing "${needle}"`).toBeDefined();
    return found!;
}

// ─── SEARCH ───────────────────────────────────────────────────────────────────

describe("SEARCH blocks", () => {
    it("indents AT END and multiple WHEN branches uniformly", () => {
        const result = fmt(proc([
            "     SET IND TO 1",
            "     SEARCH TAU-ALKIO",
            "        AT END",
            "           MOVE 0 TO LOYTYI",
            "        WHEN TAU-NIMI (IND) = HAKU",
            "           MOVE 1 TO LOYTYI",
            "        WHEN TAU-NIMI (IND) = TOINEN",
            "           MOVE 2 TO LOYTYI",
            "     END-SEARCH.",
        ]));
        const header = findLine(result, "SEARCH TAU-ALKIO");
        const atEnd = findLine(result, "AT END");
        const when1 = findLine(result, "WHEN TAU-NIMI (IND) = HAKU");
        const when2 = findLine(result, "WHEN TAU-NIMI (IND) = TOINEN");
        const body = findLine(result, "MOVE 1 TO LOYTYI");
        const end = findLine(result, "END-SEARCH");

        expect(indentOf(atEnd)).toBe(indentOf(header) + 3);
        expect(indentOf(when1)).toBe(indentOf(atEnd));
        expect(indentOf(when2)).toBe(indentOf(atEnd));
        expect(indentOf(body)).toBe(indentOf(when1) + 3);
        expect(indentOf(end)).toBe(indentOf(header));
    });

    it("does not invent END-SEARCH for a period-terminated SEARCH", () => {
        const result = fmt(proc([
            "     SEARCH TAU-ALKIO",
            "        AT END",
            "           MOVE 0 TO LOYTYI",
            "        WHEN TAU-NIMI (IND) = HAKU",
            "           MOVE 1 TO LOYTYI.",
            " NEXT-PARA.",
            "     STOP RUN.",
        ]));
        expect(result).not.toContain("END-SEARCH");
    });

    it("does not treat the paragraph name WHEN-X as a WHEN clause", () => {
        const result = fmt(proc([
            "     SEARCH TAU-ALKIO",
            "        WHEN TAU-NIMI (IND) = HAKU",
            "           MOVE 1 TO LOYTYI",
            "     END-SEARCH.",
            " WHEN-X.",
            "     STOP RUN.",
        ]));
        // WHEN-X. stays a paragraph header in Area A (col 8)
        const para = findLine(result, "WHEN-X.");
        expect(indentOf(para)).toBe(7);
    });
});

// ─── START ────────────────────────────────────────────────────────────────────

describe("START blocks", () => {
    it("formats INVALID KEY as a block with END-START", () => {
        const result = fmt(proc([
            "     START HIN-FILE KEY NOT < HIN-AVAIN",
            "        INVALID KEY",
            "           MOVE 1 TO VIRHE",
            "     END-START.",
        ]));
        const header = findLine(result, "START HIN-FILE");
        const clause = findLine(result, "INVALID KEY");
        expect(indentOf(clause)).toBe(indentOf(header) + 3);
        expect(result).toContain("END-START");
    });
});

// ─── Arithmetic ON SIZE ERROR ─────────────────────────────────────────────────

describe("arithmetic ON SIZE ERROR blocks", () => {
    it("formats COMPUTE with ON SIZE ERROR / NOT ON SIZE ERROR", () => {
        const result = fmt(proc([
            "     COMPUTE TULOS = SUMMA / MAARA",
            "        ON SIZE ERROR",
            "           MOVE 0 TO TULOS",
            "        NOT ON SIZE ERROR",
            "           ADD 1 TO OK-MAARA",
            "     END-COMPUTE.",
        ]));
        const header = findLine(result, "COMPUTE TULOS");
        const onSize = findLine(result, "ON SIZE ERROR");
        const notOnSize = findLine(result, "NOT ON SIZE ERROR");
        expect(indentOf(onSize)).toBe(indentOf(header) + 3);
        expect(indentOf(notOnSize)).toBe(indentOf(header) + 3);
        expect(result).toContain("END-COMPUTE");
    });

    it("keeps a plain arithmetic statement flat", () => {
        const result = fmt(proc([
            "     ADD 1 TO LASKURI.",
            "     MOVE A TO B.",
        ]));
        expect(result).not.toContain("END-ADD");
        const add = findLine(result, "ADD 1 TO LASKURI.");
        const move = findLine(result, "MOVE A TO B.");
        expect(indentOf(move)).toBe(indentOf(add));
    });

    it("supports the ON-less SIZE ERROR form", () => {
        const result = fmt(proc([
            "     DIVIDE SUMMA BY MAARA GIVING TULOS",
            "        SIZE ERROR",
            "           MOVE 0 TO TULOS",
            "     END-DIVIDE.",
        ]));
        const header = findLine(result, "DIVIDE SUMMA");
        const clause = findLine(result, "SIZE ERROR");
        expect(indentOf(clause)).toBe(indentOf(header) + 3);
    });

    it("does not mistake the data name SIZE-ERROR-FLAG for a clause", () => {
        const result = fmt(proc([
            "     ADD 1 TO SIZE-ERROR-FLAG.",
            "     MOVE A TO B.",
        ]));
        expect(result).not.toContain("END-ADD");
        expect(indentOf(findLine(result, "MOVE A TO B."))).toBe(indentOf(findLine(result, "ADD 1 TO")));
    });
});

// ─── CALL ─────────────────────────────────────────────────────────────────────

describe("CALL blocks", () => {
    it("formats ON EXCEPTION with END-CALL", () => {
        const result = fmt(proc([
            '     CALL "ALIOHJELMA" USING PARAM-1',
            "        ON EXCEPTION",
            '           DISPLAY "VIRHE"',
            "     END-CALL.",
        ]));
        const header = findLine(result, 'CALL "ALIOHJELMA"');
        const clause = findLine(result, "ON EXCEPTION");
        expect(indentOf(clause)).toBe(indentOf(header) + 3);
        expect(result).toContain("END-CALL");
    });

    it("keeps multi-line USING arguments before the clause", () => {
        const result = fmt(proc([
            '     CALL "ALIOHJELMA" USING PARAM-1,',
            "                             PARAM-2",
            "        ON EXCEPTION",
            '           DISPLAY "VIRHE"',
            "     END-CALL.",
        ]));
        const header = findLine(result, 'CALL "ALIOHJELMA"');
        const arg = findLine(result, "PARAM-2");
        const clause = findLine(result, "ON EXCEPTION");
        expect(indentOf(arg)).toBeGreaterThan(indentOf(header));
        expect(indentOf(clause)).toBe(indentOf(header) + 3);
    });

    it("splits an inline clause with imperative and closing period", () => {
        const result = fmt(proc([
            '     CALL "ALIOHJELMA" ON EXCEPTION MOVE 1 TO VIRHE.',
            "     MOVE A TO B.",
        ]));
        // No END-CALL invented after the period
        expect(result).not.toContain("END-CALL");
        const header = findLine(result, 'CALL "ALIOHJELMA"');
        const clause = findLine(result, "ON EXCEPTION MOVE 1 TO VIRHE.");
        expect(indentOf(clause)).toBe(indentOf(header) + 3);
        // Following statement not swallowed
        const move = findLine(result, "MOVE A TO B.");
        expect(indentOf(move)).toBe(indentOf(header));
    });

    it("does not treat a clause keyword inside a string literal as a clause", () => {
        const result = fmt(proc([
            '     CALL "ON EXCEPTION" USING PARAM-1.',
            "     MOVE A TO B.",
        ]));
        expect(result).not.toContain("END-CALL");
        expect(result).toContain('CALL "ON EXCEPTION" USING PARAM-1.');
    });
});

// ─── STRING / UNSTRING ────────────────────────────────────────────────────────

describe("STRING/UNSTRING blocks", () => {
    it("formats STRING with ON OVERFLOW", () => {
        const result = fmt(proc([
            '     STRING ETU DELIMITED BY " "',
            '            SUKU DELIMITED BY SIZE',
            "            INTO KOKO-NIMI",
            "        ON OVERFLOW",
            "           MOVE 1 TO VIRHE",
            "     END-STRING.",
        ]));
        const header = findLine(result, "STRING ETU");
        const clause = findLine(result, "ON OVERFLOW");
        expect(indentOf(clause)).toBe(indentOf(header) + 3);
        expect(result).toContain("END-STRING");
    });
});

// ─── ACCEPT (ACUCOBOL) ────────────────────────────────────────────────────────

describe("ACCEPT blocks", () => {
    it("formats ON ESCAPE as a block", () => {
        const result = fmt(proc([
            "     ACCEPT RUUTU",
            "        ON ESCAPE",
            "           GO TO LOPPU",
            "     END-ACCEPT.",
        ]));
        const header = findLine(result, "ACCEPT RUUTU");
        const clause = findLine(result, "ON ESCAPE");
        expect(indentOf(clause)).toBe(indentOf(header) + 3);
        expect(result).toContain("END-ACCEPT");
    });

    it("handles the corpus pattern: inline ON ESCAPE with body on following lines", () => {
        const result = fmt(proc([
            "     ACCEPT RUUTU ON ESCAPE",
            "        GO TO LOPPU",
            "     END-ACCEPT.",
        ]));
        const header = findLine(result, "ACCEPT RUUTU");
        expect(header.trim()).toBe("ACCEPT RUUTU");
        const clause = findLine(result, "ON ESCAPE");
        const body = findLine(result, "GO TO LOPPU");
        expect(indentOf(clause)).toBe(indentOf(header) + 3);
        expect(indentOf(body)).toBe(indentOf(clause) + 3);
    });

    it("keeps a plain ACCEPT flat", () => {
        const result = fmt(proc([
            "     ACCEPT WS-PVM FROM DATE.",
            "     MOVE A TO B.",
        ]));
        expect(result).not.toContain("END-ACCEPT");
    });
});

// ─── READ (regression: still works after generalization) ────────────────────

describe("READ blocks (regression)", () => {
    it("formats the corpus pattern: inline INVALID KEY", () => {
        const result = fmt(proc([
            "     READ TUO-FILE INVALID KEY",
            "        MOVE 1 TO VIRHE",
            "     END-READ.",
        ]));
        const header = findLine(result, "READ TUO-FILE");
        expect(header.trim()).toBe("READ TUO-FILE");
        const clause = findLine(result, "INVALID KEY");
        const body = findLine(result, "MOVE 1 TO VIRHE");
        expect(indentOf(clause)).toBe(indentOf(header) + 3);
        expect(indentOf(body)).toBe(indentOf(clause) + 3);
        expect(result).toContain("END-READ");
    });

    it("formats AT END / NOT AT END at the same clause indent", () => {
        const result = fmt(proc([
            "     READ TUO-FILE NEXT RECORD",
            "        AT END",
            "           MOVE 1 TO LOPPU",
            "        NOT AT END",
            "           ADD 1 TO MAARA",
            "     END-READ.",
        ]));
        const atEnd = lines(result).find(l => /^\s+AT END\s*$/.test(l))!;
        const notAtEnd = findLine(result, "NOT AT END");
        expect(indentOf(atEnd)).toBe(indentOf(notAtEnd));
    });

    it("keeps comments that precede END-READ", () => {
        const result = fmt(proc([
            "     READ TUO-FILE INVALID KEY",
            "        MOVE 1 TO VIRHE",
            "*       kommentti ennen terminaattoria",
            "     END-READ.",
        ]));
        expect(result).toContain("kommentti ennen terminaattoria");
    });

    it("leaves a clause-less READ flat and does not swallow the next statement", () => {
        const result = fmt(proc([
            "     READ TUO-FILE",
            "     MOVE A TO B.",
        ]));
        expect(result).not.toContain("END-READ");
        const read = findLine(result, "READ TUO-FILE");
        const move = findLine(result, "MOVE A TO B.");
        expect(indentOf(move)).toBe(indentOf(read));
    });
});

// ─── DECLARATIVES ─────────────────────────────────────────────────────────────

describe("DECLARATIVES", () => {
    const source = fixed([
        " PROCEDURE DIVISION.",
        " DECLARATIVES.",
        " VIRHE-SEC SECTION.",
        "     USE AFTER STANDARD ERROR PROCEDURE ON TUO-FILE.",
        " VIRHE-PARA.",
        '     DISPLAY "IO-VIRHE".',
        " END DECLARATIVES.",
        " MAIN-SEC SECTION.",
        " MAIN-PARA.",
        "     STOP RUN.",
    ]);

    it("preserves both markers in Area A and the sections between them", () => {
        const result = fmt(source);
        const decl = findLine(result, "DECLARATIVES.");
        const endDecl = findLine(result, "END DECLARATIVES.");
        expect(indentOf(decl)).toBe(7);
        expect(indentOf(endDecl)).toBe(7);
        const sec = findLine(result, "VIRHE-SEC SECTION.");
        expect(indentOf(sec)).toBe(7);
        const use = findLine(result, "USE AFTER STANDARD ERROR");
        expect(indentOf(use)).toBe(11);
        // Order: DECLARATIVES < section < END DECLARATIVES < MAIN-SEC
        const ls = lines(result);
        expect(ls.findIndex(l => l.includes("DECLARATIVES."))).toBeLessThan(ls.findIndex(l => l.includes("VIRHE-SEC")));
        expect(ls.findIndex(l => l.includes("VIRHE-PARA"))).toBeLessThan(ls.findIndex(l => l.includes("END DECLARATIVES")));
        expect(ls.findIndex(l => l.includes("END DECLARATIVES"))).toBeLessThan(ls.findIndex(l => l.includes("MAIN-SEC")));
    });

    it("produces no unparsed-line diagnostics for the markers", async () => {
        const { parseSource } = await import("../src/core/index.js");
        const ast = parseSource(source, { sourceFormat: "fixed" });
        const json = JSON.stringify(ast);
        expect(json).not.toContain("UnparsedLine");
    });
});

// ─── Comment preservation around block terminators ────────────────────────────

describe("comments before block terminators", () => {
    it("keeps a comment before END-IF", () => {
        const result = fmt(proc([
            "     IF TILA = 1",
            "        MOVE 1 TO X",
            "*       kommentti ennen end-if",
            "     END-IF.",
        ]));
        expect(result).toContain("kommentti ennen end-if");
    });

    it("keeps a comment before ELSE", () => {
        const result = fmt(proc([
            "     IF TILA = 1",
            "        MOVE 1 TO X",
            "*       kommentti ennen else",
            "     ELSE",
            "        MOVE 2 TO X",
            "     END-IF.",
        ]));
        expect(result).toContain("kommentti ennen else");
        // Comment stays between the bodies, before the ELSE line
        const ls = lines(result);
        expect(ls.findIndex(l => l.includes("kommentti"))).toBeLessThan(ls.findIndex(l => l.trim() === "ELSE"));
    });

    it("keeps a comment before END-EVALUATE", () => {
        const result = fmt(proc([
            "     EVALUATE TILA",
            "        WHEN 1",
            "           MOVE 1 TO X",
            "*       kommentti ennen end-evaluate",
            "     END-EVALUATE.",
        ]));
        expect(result).toContain("kommentti ennen end-evaluate");
    });

    it("keeps a comment before END-PERFORM", () => {
        const result = fmt(proc([
            "     PERFORM UNTIL TILA = 1",
            "        MOVE 1 TO X",
            "*       kommentti ennen end-perform",
            "     END-PERFORM.",
        ]));
        expect(result).toContain("kommentti ennen end-perform");
    });
});

// ─── Idempotency ──────────────────────────────────────────────────────────────

describe("idempotency of conditional blocks", () => {
    const cases: Array<[string, string]> = [
        ["SEARCH", proc([
            "     SEARCH TAU-ALKIO",
            "        AT END",
            "           MOVE 0 TO LOYTYI",
            "        WHEN TAU-NIMI (IND) = HAKU",
            "           MOVE 1 TO LOYTYI",
            "     END-SEARCH.",
        ])],
        ["COMPUTE ON SIZE ERROR", proc([
            "     COMPUTE TULOS = SUMMA / MAARA",
            "        ON SIZE ERROR",
            "           MOVE 0 TO TULOS",
            "     END-COMPUTE.",
        ])],
        ["CALL inline ON EXCEPTION", proc([
            '     CALL "ALIOHJELMA" ON EXCEPTION MOVE 1 TO VIRHE.',
        ])],
        ["ACCEPT ON ESCAPE inline", proc([
            "     ACCEPT RUUTU ON ESCAPE",
            "        GO TO LOPPU",
            "     END-ACCEPT.",
        ])],
        ["nested READ in IF", proc([
            "     IF TILA = 1",
            "        READ TUO-FILE INVALID KEY",
            "           MOVE 1 TO VIRHE",
            "        END-READ",
            "     END-IF.",
        ])],
        ["DECLARATIVES", fixed([
            " PROCEDURE DIVISION.",
            " DECLARATIVES.",
            " VIRHE-SEC SECTION.",
            "     USE AFTER STANDARD ERROR PROCEDURE ON TUO-FILE.",
            " END DECLARATIVES.",
            " MAIN-PARA.",
            "     STOP RUN.",
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
