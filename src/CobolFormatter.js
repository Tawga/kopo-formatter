/**
 * @file CobolFormatter.js
 * @description The main class that orchestrates the COBOL formatting process.
 */

const { analyzeForAlignment } = require("./alignmentAnalyzer");
const { formatLine } = require("./lineFormatter");

class CobolFormatter {
    constructor(options) {
        this.indentationSpaces = options.indentationSpaces || 3;
        this.addEmptyLineAfterExit = options.addEmptyLineAfterExit || false;
        this.evaluateIndentWhen = options.evaluateIndentWhen || false;
        this.alignPicClauses = options.alignPicClauses || false;

        // State managed during formatting
        this.controlIndentLevel = 0;
        this.paragraphBaseIndent = 0;
        this.dataLevelStack = [];
        this.inDataDivision = false;
        this.inProcedureDivision = false;
        this.inFileSystem = false;
        this.inWorkingStorageSection = false;
        this.inLinkageSection = false;
        this.lastDataTextStartColumn = 0;
        this.alignmentMap = new Map(); // Stores alignment columns for each indent level
        this.stringContinuationColumn = 0;
        this.isInEvaluateBlock = false;
        this.isFirstWhenInBlock = true;
    }

    /**
     * Formats the entire COBOL source text.
     * @param {string} text - The raw COBOL source code.
     * @returns {string} The formatted COBOL source code.
     */
    format = (text) => {
        const originalLines = text.split(/\r?\n/);

        // Pass 1: Analyze for PIC/VALUE alignment if the setting is enabled
        if (this.alignPicClauses) {
            this.alignmentMap = analyzeForAlignment(
                originalLines,
                this.indentationSpaces
            );
        }

        // Pass 2: Format all lines
        this.resetState();

        const finalLines = [];
        for (let i = 0; i < originalLines.length; i++) {
            const currentLine = originalLines[i];
            const formattedLine = formatLine(
                this,
                currentLine,
                i,
                originalLines
            );
            finalLines.push(formattedLine);

            if (
                this.addEmptyLineAfterExit &&
                formattedLine.trim().toUpperCase() === "EXIT."
            ) {
                const nextLine = originalLines[i + 1];
                if (nextLine !== undefined && nextLine.trim() !== "") {
                    finalLines.push("");
                }
            }
        }

        return finalLines.join("\n");
    };

    /**
     * Resets the formatter's state for a new formatting pass.
     */
    resetState = () => {
        this.controlIndentLevel = 0;
        this.paragraphBaseIndent = 0;
        this.dataLevelStack = [];
        this.inDataDivision = false;
        this.inProcedureDivision = false;
        this.inFileSystem = false;
        this.inWorkingStorageSection = false;
        this.inLinkageSection = false;
        this.lastDataTextStartColumn = 0;
        this.stringContinuationColumn = 0;
        this.isInEvaluateBlock = false;
        this.isFirstWhenInBlock = true;
    };
}

module.exports = CobolFormatter;
