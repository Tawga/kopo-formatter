/**
 * @file alignmentAnalyzer.js
 * @description Analyzes the Data Division to determine alignment for PIC and VALUE clauses.
 */

const { AREA_A_START } = require('./constants');

const analyzeForAlignment = (lines, indentationSpaces) => {
    let maxEndColumn = 0;
    let inDataDivision = false;
    let inFileSystem = false;
    let inWorkingStorageSection = false;
    let inLinkageSection = false;
    const dataLevelStack = [];

    for (const line of lines) {
        const upperLine = line.toUpperCase().trim();
        if (upperLine.startsWith("DATA DIVISION")) inDataDivision = true;

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

                if (
                    (inFileSystem || inWorkingStorageSection || inLinkageSection) &&
                    picIndex > -1
                ) {
                    const preClausePart = line.substring(0, picIndex).trim();
                    const normalized = preClausePart.replace(/\s+/g, " ");
                    const endColumn = AREA_A_START - 1 + currentIndent + normalized.length;
                    maxEndColumn = Math.max(maxEndColumn, endColumn);
                }

                if ((level === 78 || level === 88) && valueIndex > -1) {
                    const preValuePartEnd = valueIndex;
                    const preValuePart = line.substring(0, preValuePartEnd).trim();
                    const normalized = preValuePart.replace(/\s+/g, " ");
                    const endColumn = AREA_A_START - 1 + currentIndent + normalized.length;
                    maxEndColumn = Math.max(maxEndColumn, endColumn);
                }
            }
        }
    }
    return maxEndColumn > 0 ? maxEndColumn + 4 : 0;
};

module.exports = { analyzeForAlignment };
