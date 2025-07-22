/**
 * @file alignmentAnalyzer.js
 * @description Analyzes the Data Division to determine alignment for PIC and VALUE clauses.
 */

const { AREA_A_START, AREA_A_KEYWORDS } = require("./constants");

/**
 * First pass: Analyzes the Data Division to determine the optimal start column for PIC and VALUE clauses for each indentation level.
 * @param {string[]} lines - The array of original lines from the file.
 * @param {number} indentationSpaces - The number of spaces for indentation.
 * @returns {Map<number, number>} A map where the key is the indentation level and the value is the column number.
 */
const analyzeForAlignment = (lines, indentationSpaces) => {
    const maxEndColumns = new Map();
    let inDataDivision = false;
    let inFileSystem = false;
    let inWorkingStorageSection = false;
    let inLinkageSection = false;
    const dataLevelStack = [];

    for (const originalLine of lines) {
        // Convert tabs to spaces for the entire line before any processing
        const line = originalLine.replace(/\t/g, " ");
        const upperLine = line.toUpperCase().trim();

        if (upperLine.startsWith("DATA DIVISION")) inDataDivision = true;

        // Reset stack on new sections to match the formatter's behavior
        if (AREA_A_KEYWORDS.some((keyword) => upperLine.startsWith(keyword))) {
            if (
                upperLine.includes("SECTION") ||
                upperLine.includes("DIVISION")
            ) {
                dataLevelStack.length = 0;
            }
        }

        if (upperLine.startsWith("FILE SECTION")) {
            inFileSystem = true;
            inWorkingStorageSection = false;
            inLinkageSection = false;
        } else if (upperLine.startsWith("WORKING-STORAGE SECTION")) {
            inFileSystem = false;
            inWorkingStorageSection = true;
            inLinkageSection = false;
        } else if (upperLine.startsWith("LINKAGE SECTION")) {
            inFileSystem = false;
            inWorkingStorageSection = false;
            inLinkageSection = true;
        } else if (
            upperLine.startsWith("SCREEN SECTION") ||
            upperLine.startsWith("PROCEDURE DIVISION")
        ) {
            inFileSystem = false;
            inWorkingStorageSection = false;
            inLinkageSection = false;
            if (upperLine.startsWith("PROCEDURE DIVISION")) break;
        }

        if (inDataDivision) {
            const levelMatch = upperLine.match(/^(\d{2})\s+/);
            if (levelMatch) {
                const level = parseInt(levelMatch[1], 10);
                const parentIndent =
                    dataLevelStack.length > 0
                        ? (dataLevelStack.length - 1) * indentationSpaces
                        : 0;
                let currentIndent = 0;

                if (level === 1 || level === 77 || level === 78) {
                    dataLevelStack.length = 0;
                } else {
                    while (
                        dataLevelStack.length > 0 &&
                        level <= dataLevelStack[dataLevelStack.length - 1]
                    ) {
                        dataLevelStack.pop();
                    }
                }
                currentIndent = dataLevelStack.length * indentationSpaces;
                dataLevelStack.push(level);

                const picIndex = upperLine.indexOf(" PIC ");
                const valueIndex = upperLine.indexOf(" VALUE ");
                let endColumn = 0;
                let preClausePart = "";

                if (
                    (inFileSystem ||
                        inWorkingStorageSection ||
                        inLinkageSection) &&
                    picIndex > -1
                ) {
                    preClausePart = line
                        .substring(0, line.toUpperCase().indexOf(" PIC "))
                        .trim();
                } else if ((level === 78 || level === 88) && valueIndex > -1) {
                    preClausePart = line
                        .substring(0, line.toUpperCase().indexOf(" VALUE "))
                        .trim();
                }

                if (preClausePart) {
                    const normalized = preClausePart.replace(/\s+/g, " ");
                    endColumn =
                        AREA_A_START - 1 + currentIndent + normalized.length;

                    // Level 88 items should align with their parent's indentation group
                    const keyIndent =
                        level === 88 ? parentIndent : currentIndent;

                    const currentMax = maxEndColumns.get(keyIndent) || 0;
                    maxEndColumns.set(
                        keyIndent,
                        Math.max(currentMax, endColumn)
                    );
                }
            }
        }
    }

    // Add padding to all calculated maximums
    for (const [key, value] of maxEndColumns.entries()) {
        maxEndColumns.set(key, value + 4);
    }

    return maxEndColumns;
};

module.exports = { analyzeForAlignment };
