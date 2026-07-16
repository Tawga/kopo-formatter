import { describe, it, expect } from "vitest";
import { format } from "../src/core/index.js";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MATERIAL_DIR = path.join(__dirname, "test_material");
const OUTPUT_DIR = path.join(__dirname, "test_output");

// Every COBOL source dropped into test_material/ is picked up automatically
const FILES = fs.readdirSync(MATERIAL_DIR).filter(f => /\.(cbl|cob|cpy)$/i.test(f));

// Space=normal, *=comment, /=comment+eject, -=continuation, D=debug line,
// $=compiler directive (ACUCOBOL $XFD etc.)
const VALID_INDICATORS = new Set([" ", "*", "/", "-", "D", "$"]);

describe.each(FILES)("material file: %s", (filename) => {
    it("formats without error and writes output", () => {
        const source = fs.readFileSync(
            path.join(MATERIAL_DIR, filename),
            "utf8",
        );
        const output = format(source, { sourceFormat: "fixed" });
        expect(output.length).toBeGreaterThan(0);

        fs.mkdirSync(OUTPUT_DIR, { recursive: true });
        fs.writeFileSync(path.join(OUTPUT_DIR, filename), output, "utf8");
    });

    it("is idempotent", () => {
        const source = fs.readFileSync(
            path.join(MATERIAL_DIR, filename),
            "utf8",
        );
        const once = format(source, { sourceFormat: "fixed" });
        const twice = format(once, { sourceFormat: "fixed" });
        expect(twice).toBe(once);
    });

    it("respects fixed-form column structure", () => {
        const source = fs.readFileSync(
            path.join(MATERIAL_DIR, filename),
            "utf8",
        );
        const output = format(source, { sourceFormat: "fixed" });

        for (const line of output.split("\n")) {
            if (!line.trim()) continue;
            // Cols 1-6 must be spaces
            expect(line.substring(0, 6)).toBe("      ");
            // Col 7 must be a valid indicator
            const indicator = line.length > 6 ? line[6] : " ";
            expect(VALID_INDICATORS.has(indicator)).toBe(true);
        }
    });
});
