import { describe, it, expect, vi } from "vitest";

// Force the printer to produce lossy output so the fallback path is exercised.
vi.mock("../src/core/printer.js", async (importOriginal) => {
    const mod = await importOriginal<typeof import("../src/core/printer.js")>();
    return {
        ...mod,
        print: (ast: Parameters<typeof mod.print>[0], opts: Parameters<typeof mod.print>[1]) =>
            mod.print(ast, opts).replace(/WS-SECRET\S*/g, ""),
    };
});

import { format, formatWithDiagnostics } from "../src/core/index.js";

const SOURCE = [
    "       PROCEDURE DIVISION.",
    "       PARA-1.",
    "           MOVE WS-SECRET-VALUE TO WS-TARGET.",
].join("\n");

describe("fallback when the printer loses tokens", () => {
    it("returns the original text unchanged with an error diagnostic", () => {
        const r = formatWithDiagnostics(SOURCE, { sourceFormat: "fixed" });
        expect(r.text).toBe(SOURCE);
        const errors = r.diagnostics.filter(d => d.severity === "error");
        expect(errors.length).toBeGreaterThan(0);
        expect(errors[0].message).toContain("WS-SECRET");
    });

    it("format() also returns the original and never throws", () => {
        expect(format(SOURCE, { sourceFormat: "fixed" })).toBe(SOURCE);
    });
});
