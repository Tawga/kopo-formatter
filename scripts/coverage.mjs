/**
 * Coverage report: unparsed-line ratio on the test corpus.
 *
 * Bundles the formatter core on the fly, parses every file in
 * test/test_material, and reports how many AST nodes fell back to
 * UnparsedLine versus the total number of code lines. This is the
 * KPI tracked by the roadmap (doc/roadmap.md): each feature-breadth
 * release should lower the ratio.
 *
 * Usage: node scripts/coverage.mjs
 */

import { execSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { fileURLToPath, pathToFileURL } from "url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const bundlePath = path.join(os.tmpdir(), `kopo-core-${Date.now()}.mjs`);

execSync(
    `npx esbuild src/core/index.ts --bundle --format=esm --log-level=silent --outfile="${bundlePath}"`,
    { cwd: root, stdio: "inherit" },
);

const { parseSource } = await import(pathToFileURL(bundlePath).href);

/** Recursively count UnparsedLine nodes in any AST subtree. */
function countUnparsed(node) {
    if (node === null || typeof node !== "object") return 0;
    if (Array.isArray(node)) return node.reduce((sum, n) => sum + countUnparsed(n), 0);
    let count = node.kind === "UnparsedLine" ? 1 : 0;
    for (const [key, value] of Object.entries(node)) {
        if (key === "leadingTrivia" || key === "trailingTrivia") continue;
        if (typeof value === "object") count += countUnparsed(value);
    }
    return count;
}

/** Count code lines: non-blank, non-comment fixed-form lines. */
function countCodeLines(source) {
    let count = 0;
    for (const line of source.split(/\r?\n/)) {
        if (!line.trim()) continue;
        const indicator = line.length > 6 ? line[6] : " ";
        if (indicator === "*" || indicator === "/") continue;
        count++;
    }
    return count;
}

const materialDir = path.join(root, "test", "test_material");
const files = fs.readdirSync(materialDir).filter(f => /\.(cbl|cob|cpy)$/i.test(f));

let totalUnparsed = 0;
let totalLines = 0;

console.log("File            Unparsed   Code lines   Ratio");
console.log("─".repeat(48));
for (const file of files) {
    const source = fs.readFileSync(path.join(materialDir, file), "utf8");
    const ast = parseSource(source, { sourceFormat: "fixed" });
    const unparsed = countUnparsed(ast.children) + countUnparsed(ast.trailingTrivia ? [] : []);
    const codeLines = countCodeLines(source);
    totalUnparsed += unparsed;
    totalLines += codeLines;
    const ratio = codeLines ? ((unparsed / codeLines) * 100).toFixed(2) : "0.00";
    console.log(`${file.padEnd(16)}${String(unparsed).padStart(8)}${String(codeLines).padStart(13)}${ratio.padStart(7)} %`);
}
console.log("─".repeat(48));
const totalRatio = totalLines ? ((totalUnparsed / totalLines) * 100).toFixed(2) : "0.00";
console.log(`${"TOTAL".padEnd(16)}${String(totalUnparsed).padStart(8)}${String(totalLines).padStart(13)}${totalRatio.padStart(7)} %`);

fs.unlinkSync(bundlePath);
