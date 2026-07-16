import { describe, it, expect } from "vitest";
import { tokenizeLine, extractComparableTokens, verifyNoTokenLoss } from "../src/core/verifier.js";
import { format } from "../src/core/index.js";

/** Build a fixed-form line: 6-char sequence area + indicator + content. */
function fx(content: string, indicator = " "): string {
    return "      " + indicator + content;
}

describe("tokenizeLine", () => {
    it("splits words on whitespace and uppercases them", () => {
        const tokens = tokenizeLine("   MOVE ws-x TO WS-Y.", 0);
        expect(tokens.map(t => t.text)).toEqual(["MOVE", "WS-X", "TO", "WS-Y."]);
    });

    it("keeps string literals verbatim and case-sensitive", () => {
        const tokens = tokenizeLine("DISPLAY 'Hello  World'", 0);
        expect(tokens.map(t => t.text)).toEqual(["DISPLAY", "'Hello  World'"]);
        expect(tokens[1].isLiteral).toBe(true);
    });

    it("treats doubled quotes as staying inside the literal", () => {
        const tokens = tokenizeLine("MOVE 'DON''T  STOP' TO X", 0);
        expect(tokens.map(t => t.text)).toEqual(["MOVE", "'DON''T  STOP'", "TO", "X"]);
    });

    it("consumes an unterminated literal to end of line", () => {
        const tokens = tokenizeLine("MOVE 'OPEN LITERAL", 0);
        expect(tokens.map(t => t.text)).toEqual(["MOVE", "'OPEN LITERAL"]);
        expect(tokens[1].isLiteral).toBe(true);
    });

    it("keeps pseudo-text delimiters as plain words", () => {
        const tokens = tokenizeLine("COPY X REPLACING ==A== BY ==B==.", 0);
        expect(tokens.map(t => t.text)).toEqual(["COPY", "X", "REPLACING", "==A==", "BY", "==B==."]);
    });

    it("splits a word from an adjacent literal", () => {
        const tokens = tokenizeLine("MOVE X'FF' TO Y", 0);
        expect(tokens.map(t => t.text)).toEqual(["MOVE", "X", "'FF'", "TO", "Y"]);
    });
});

describe("extractComparableTokens", () => {
    it("separates code, comments, and drops blanks", () => {
        const src = [
            fx("COMMENT ONE", "*"),
            "",
            fx(" MOVE A TO B."),
        ].join("\n");
        const { code, comments } = extractComparableTokens(src, "fixed");
        expect(code.map(t => t.text)).toEqual(["MOVE", "A", "TO", "B."]);
        expect(comments.length).toBe(1);
        expect(comments[0].text).toBe("COMMENT ONE");
    });

    it("joins continuation lines like the pipeline does", () => {
        const src = [
            fx(" MOVE LONG-NAME"),
            fx("   TO OTHER-NAME.", "-"),
        ].join("\n");
        const { code } = extractComparableTokens(src, "fixed");
        expect(code.map(t => t.text)).toEqual(["MOVE", "LONG-NAME", "TO", "OTHER-NAME."]);
    });
});

describe("verifyNoTokenLoss — legitimate transformations pass", () => {
    it("re-indentation and space collapsing", () => {
        const input = fx("    MOVE    A   TO   B.");
        const output = fx(" MOVE A TO B.");
        expect(verifyNoTokenLoss(input, output, "fixed").ok).toBe(true);
    });

    it("keyword case changes", () => {
        const input = fx(" move a to b.");
        const output = fx(" MOVE A TO B.");
        expect(verifyNoTokenLoss(input, output, "fixed").ok).toBe(true);
    });

    it("blank line collapsing", () => {
        const input = [fx(" MOVE A TO B."), "", "", "", fx(" MOVE C TO D.")].join("\n");
        const output = [fx(" MOVE A TO B."), "", fx(" MOVE C TO D.")].join("\n");
        expect(verifyNoTokenLoss(input, output, "fixed").ok).toBe(true);
    });

    it("inserted scope terminators (subsequence, not equality)", () => {
        const input = [fx(" IF A = 1"), fx("    MOVE 1 TO B")].join("\n");
        const output = [fx(" IF A = 1"), fx("    MOVE 1 TO B"), fx(" END-IF")].join("\n");
        expect(verifyNoTokenLoss(input, output, "fixed").ok).toBe(true);
    });

    it("line wrapping with continuation markers round-trips", () => {
        const longStmt = " MOVE VERY-LONG-DATA-NAME-NUMBER-ONE TO ANOTHER-VERY-LONG-TARGET-NAME-X.";
        const input = fx(longStmt);
        const output = format(input, { sourceFormat: "fixed" });
        expect(verifyNoTokenLoss(input, output, "fixed").ok).toBe(true);
    });
});

describe("verifyNoTokenLoss — losses are detected", () => {
    it("a dropped word fails", () => {
        const input = fx(" MOVE A B C.");
        const output = fx(" MOVE A B.");
        const v = verifyNoTokenLoss(input, output, "fixed");
        expect(v.ok).toBe(false);
        expect(v.diagnostics[0].severity).toBe("error");
        expect(v.diagnostics[0].message).toContain("C.");
    });

    it("collapsed spaces inside a literal fail", () => {
        const input = fx(" MOVE 'A  B' TO X.");
        const output = fx(" MOVE 'A B' TO X.");
        expect(verifyNoTokenLoss(input, output, "fixed").ok).toBe(false);
    });

    it("case change inside a literal fails", () => {
        const input = fx(" MOVE 'Ab' TO X.");
        const output = fx(" MOVE 'AB' TO X.");
        expect(verifyNoTokenLoss(input, output, "fixed").ok).toBe(false);
    });

    it("a dropped comment fails", () => {
        const input = [fx("KEEP ME", "*"), fx(" MOVE A TO B.")].join("\n");
        const output = fx(" MOVE A TO B.");
        const v = verifyNoTokenLoss(input, output, "fixed");
        expect(v.ok).toBe(false);
        expect(v.diagnostics[0].message).toContain("comment");
    });

    it("a reordered pair of statements fails (order matters)", () => {
        const input = [fx(" MOVE A TO B."), fx(" MOVE C TO D.")].join("\n");
        const output = [fx(" MOVE C TO D."), fx(" MOVE A TO B.")].join("\n");
        expect(verifyNoTokenLoss(input, output, "fixed").ok).toBe(false);
    });
});
