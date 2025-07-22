/**
 * @file lineFormatter.js
 * @description Contains the logic for formatting a single line of COBOL code.
 */

/**
 * @typedef {import('./CobolFormatter')} CobolFormatter
 */

const {
    SEQ_NUMBER_END,
    INDICATOR_COL,
    AREA_A_START,
    AREA_A_END,
    AREA_B_START,
    AREA_A_KEYWORDS,
    AREA_B_STATEMENTS,
    INDENT_START_KEYWORDS,
    INDENT_END_KEYWORDS,
    INDENT_ELSE_KEYWORDS,
    INDENT_SUB_CLAUSES,
} = require("./constants");

/**
 * Formats a single line of COBOL code. This function acts as a dispatcher.
 * @param {CobolFormatter} formatterContext - The instance of the CobolFormatter class (provides state).
 * @param {string} line - The original line of text.
 * @param {number} index - The line's index in the file.
 * @param {string[]} allLines - All lines in the file.
 * @returns {string} The formatted line.
 */
const formatLine = (formatterContext, line, index, allLines) => {
    const originalLine = line;
    const seqArea = " ".repeat(SEQ_NUMBER_END);

    if (
        originalLine.length >= INDICATOR_COL &&
        (originalLine.charAt(INDICATOR_COL - 1) === "*" ||
            originalLine.charAt(INDICATOR_COL - 1) === "/")
    ) {
        const indicator = originalLine.charAt(INDICATOR_COL - 1);
        const commentText = originalLine.substring(INDICATOR_COL);
        const fullLine = `${seqArea}${indicator}${commentText}`;
        return fullLine.trimEnd();
    }

    let processedLine = line.trim().replace(/\t/g, " ");

    if (!processedLine) {
        return "";
    }

    const upperCaseLine = processedLine.toUpperCase();
    updateContext(formatterContext, upperCaseLine);

    let currentIndent = 0;
    let isAreaAKeyword = false;
    let areaA = "";
    let areaB = "";

    // --- High-level dispatcher to determine line type and formatting ---

    if (AREA_A_KEYWORDS.some((keyword) => upperCaseLine.startsWith(keyword))) {
        isAreaAKeyword = true;
        formatterContext.dataLevelStack = [];
        currentIndent = 0;
    } else if (
        formatterContext.inProcedureDivision &&
        upperCaseLine.match(/^\S+\s+SECTION\./)
    ) {
        isAreaAKeyword = true;
        formatterContext.paragraphBaseIndent = 0;
        formatterContext.controlIndentLevel = 0;
        currentIndent = 0;
    } else if (formatterContext.inDataDivision) {
        const isCopyStatement = upperCaseLine.startsWith("COPY ");
        const levelMatch = processedLine.match(/^(\d{2})\s+/);

        if (isCopyStatement) {
            isAreaAKeyword = false;
            currentIndent =
                formatterContext.dataLevelStack.length *
                formatterContext.indentationSpaces;
        } else if (levelMatch) {
            const formatted = formatDataDescriptionLine(
                formatterContext,
                processedLine,
                levelMatch
            );
            areaA = formatted.areaA;
            isAreaAKeyword = true;
        } else {
            const formatted = formatDataContinuationLine(
                formatterContext,
                processedLine
            );
            areaA = formatted.areaA;
            areaB = formatted.areaB;
            isAreaAKeyword = true;
        }
    } else if (formatterContext.inProcedureDivision) {
        const formatResult = formatProcedureLine(
            formatterContext,
            processedLine,
            upperCaseLine,
            index,
            allLines
        );
        isAreaAKeyword = formatResult.isAreaAKeyword;
        currentIndent = formatResult.currentIndent;
        processedLine = formatResult.processedLine; // The line may be modified with alignment
    }

    // --- Final line construction ---
    if (isAreaAKeyword) {
        if (!areaA) {
            areaA = " ".repeat(currentIndent) + processedLine;
        }
    } else {
        areaA = "".padEnd(AREA_A_END - AREA_A_START + 1);
        areaB = " ".repeat(currentIndent) + processedLine;
    }

    const fullLine = `${seqArea} ${areaA}${areaB}`;
    return fullLine.trimEnd();
};

/**
 * Updates the formatter's context based on the current line.
 * @param {CobolFormatter} ctx - The formatter context.
 * @param {string} upperCaseLine - The uppercase, trimmed line.
 */
const updateContext = (ctx, upperCaseLine) => {
    if (
        upperCaseLine.startsWith("IDENTIFICATION DIVISION") ||
        upperCaseLine.startsWith("ENVIRONMENT DIVISION")
    ) {
        ctx.inDataDivision = false;
        ctx.inProcedureDivision = false;
    } else if (upperCaseLine.startsWith("DATA DIVISION")) {
        ctx.inDataDivision = true;
        ctx.inProcedureDivision = false;
        ctx.dataLevelStack = [];
    } else if (upperCaseLine.startsWith("PROCEDURE DIVISION")) {
        ctx.inDataDivision = false;
        ctx.inProcedureDivision = true;
        ctx.lastDataTextStartColumn = 0;
    }

    if (ctx.inDataDivision) {
        if (upperCaseLine.startsWith("FILE SECTION")) {
            ctx.inFileSystem = true;
            ctx.inWorkingStorageSection = false;
            ctx.inLinkageSection = false;
        } else if (upperCaseLine.startsWith("WORKING-STORAGE SECTION")) {
            ctx.inFileSystem = false;
            ctx.inWorkingStorageSection = true;
            ctx.inLinkageSection = false;
        } else if (upperCaseLine.startsWith("LINKAGE SECTION")) {
            ctx.inFileSystem = false;
            ctx.inWorkingStorageSection = false;
            ctx.inLinkageSection = true;
        } else if (upperCaseLine.startsWith("SCREEN SECTION")) {
            ctx.inFileSystem = false;
            ctx.inWorkingStorageSection = false;
            ctx.inLinkageSection = false;
        }
    }

    if (ctx.inProcedureDivision) {
        ctx.inFileSystem = false;
        ctx.inWorkingStorageSection = false;
        ctx.inLinkageSection = false;
    }
};

/**
 * Formats a data description line (e.g., "01 WS-VAR PIC X.").
 * @param {CobolFormatter} ctx - The formatter context.
 * @param {string} processedLine - The trimmed line.
 * @param {RegExpMatchArray} levelMatch - The result of matching the level number.
 * @returns {{areaA: string}} The formatted Area A string.
 */
const formatDataDescriptionLine = (ctx, processedLine, levelMatch) => {
    const level = parseInt(levelMatch[1], 10);
    let currentIndent = 0;

    if (level === 1 || level === 77 || level === 78) {
        ctx.dataLevelStack = [];
    } else {
        while (
            ctx.dataLevelStack.length > 0 &&
            level <= ctx.dataLevelStack[ctx.dataLevelStack.length - 1]
        ) {
            ctx.dataLevelStack.pop();
        }
    }
    currentIndent = ctx.dataLevelStack.length * ctx.indentationSpaces;
    ctx.dataLevelStack.push(level);

    const dataNameStartIndex = processedLine.search(/[a-zA-Z-]/);
    if (dataNameStartIndex > -1) {
        ctx.lastDataTextStartColumn =
            AREA_A_START + currentIndent + dataNameStartIndex;
    } else {
        ctx.lastDataTextStartColumn =
            AREA_A_START + currentIndent + ctx.indentationSpaces;
    }

    const upperProcessedLine = processedLine.toUpperCase();
    const picIndex = upperProcessedLine.indexOf(" PIC ");
    const valueIndex = upperProcessedLine.indexOf(" VALUE ");
    let areaA = "";
    let aligned = false;

    let parentIndent =
        ctx.dataLevelStack.length > 1
            ? (ctx.dataLevelStack.length - 2) * ctx.indentationSpaces
            : 0;
    const alignmentKey = level === 88 ? parentIndent : currentIndent;
    const alignmentColumn = ctx.alignmentMap.get(alignmentKey);

    if (alignmentColumn) {
        if ((level === 78 || level === 88) && valueIndex > -1) {
            const preValuePart = processedLine.substring(0, valueIndex);
            const postValuePart = processedLine.substring(valueIndex).trim();
            const normalizedPreValue = preValuePart.replace(/\s+/g, " ");
            let lineStart = " ".repeat(currentIndent) + normalizedPreValue;
            const currentLength = AREA_A_START - 1 + lineStart.length;
            const paddingSize = alignmentColumn - currentLength;
            const padding = " ".repeat(Math.max(2, paddingSize));
            areaA = lineStart + padding + postValuePart;
            aligned = true;
        } else if (
            (ctx.inFileSystem ||
                ctx.inWorkingStorageSection ||
                ctx.inLinkageSection) &&
            picIndex > -1
        ) {
            const prePicPart = processedLine.substring(0, picIndex);
            const postPicPart = processedLine.substring(picIndex).trim();
            const normalizedPrePic = prePicPart.replace(/\s+/g, " ");
            let lineStart = " ".repeat(currentIndent) + normalizedPrePic;
            const currentLength = AREA_A_START - 1 + lineStart.length;
            const paddingSize = alignmentColumn - currentLength;
            const padding = " ".repeat(Math.max(2, paddingSize));
            areaA = lineStart + padding + postPicPart;
            aligned = true;
        }
    }

    if (!aligned) {
        areaA = " ".repeat(currentIndent) + processedLine.replace(/\s+/g, " ");
    }

    return { areaA };
};

/**
 * Formats a data continuation line.
 * @param {CobolFormatter} ctx - The formatter context.
 * @param {string} processedLine - The trimmed line.
 * @returns {{areaA: string, areaB: string}} The formatted Area A and B strings.
 */
const formatDataContinuationLine = (ctx, processedLine) => {
    const continuationIndent =
        ctx.lastDataTextStartColumn > 0
            ? ctx.lastDataTextStartColumn - AREA_A_START
            : ctx.indentationSpaces;
    const areaA = " ".repeat(Math.max(0, continuationIndent)) + processedLine;
    const areaB = "";
    return { areaA, areaB };
};

/**
 * Checks if a line starts with any keyword from a given list.
 * @param {string} line - The uppercase line to check.
 * @param {string[]} keywords - The list of keywords.
 * @returns {string|null} The keyword that was found, or null.
 */
const findKeyword = (line, keywords) => {
    const sortedKeywords = [...keywords].sort((a, b) => b.length - a.length);
    for (const keyword of sortedKeywords) {
        if (
            line.startsWith(keyword + " ") ||
            line.startsWith(keyword + ".") ||
            line === keyword
        ) {
            return keyword;
        }
    }
    return null;
};

/**
 * Formats a line within the Procedure Division.
 * @param {CobolFormatter} ctx - The formatter context.
 * @param {string} processedLine - The trimmed line.
 * @param {string} upperCaseLine - The uppercase, trimmed line.
 * @param {number} index - The line's index.
 * @param {string[]} allLines - All lines in the file.
 * @returns {{isAreaAKeyword: boolean, currentIndent: number, processedLine: string}} Formatting result.
 */
const formatProcedureLine = (
    ctx,
    processedLine,
    upperCaseLine,
    index,
    allLines
) => {
    let isAreaAKeyword = false;
    let isStatementTerminator =
        !isAreaAKeyword && processedLine.trim().endsWith(".");

    let prevLineIndex = index - 1;
    let prevLine = null;
    while (prevLineIndex >= 0) {
        const tempLine = allLines[prevLineIndex].trim();
        if (
            tempLine &&
            !tempLine.startsWith("*") &&
            !tempLine.startsWith("/")
        ) {
            prevLine = tempLine;
            break;
        }
        prevLineIndex--;
    }
    const isContinuation = prevLine && !prevLine.endsWith(".");

    if (!isContinuation) {
        ctx.stringContinuationColumn = 0;
    }

    const startKeyword = findKeyword(upperCaseLine, INDENT_START_KEYWORDS);
    const endKeyword = findKeyword(upperCaseLine, INDENT_END_KEYWORDS);
    const elseKeyword = findKeyword(upperCaseLine, INDENT_ELSE_KEYWORDS);
    const subClauseKeyword = findKeyword(upperCaseLine, INDENT_SUB_CLAUSES);
    const isWhenClause = findKeyword(upperCaseLine, ["WHEN", "WHEN OTHER"]);

    if (startKeyword === "EVALUATE") {
        ctx.isInEvaluateBlock = true;
    }

    if (endKeyword) {
        ctx.controlIndentLevel = Math.max(
            ctx.paragraphBaseIndent,
            ctx.controlIndentLevel - 1
        );
    } else if (elseKeyword) {
        if (isWhenClause) {
            if (ctx.isInEvaluateBlock && !ctx.isFirstWhenInBlock) {
                ctx.controlIndentLevel = Math.max(
                    ctx.paragraphBaseIndent,
                    ctx.controlIndentLevel - 1
                );
            }
        } else {
            ctx.controlIndentLevel = Math.max(
                ctx.paragraphBaseIndent,
                ctx.controlIndentLevel - 1
            );
        }
    }

    const paragraphMatch = processedLine.match(/^([A-Za-z0-9-]+)\.\s*/);
    if (paragraphMatch && !isAreaAKeyword && !isContinuation) {
        const paragraphName = paragraphMatch[1].toUpperCase();
        if (
            !AREA_B_STATEMENTS.includes(paragraphName) &&
            !startKeyword &&
            !endKeyword &&
            !elseKeyword &&
            !subClauseKeyword &&
            !findKeyword(upperCaseLine, ["PERFORM"])
        ) {
            isAreaAKeyword = true;
            ctx.paragraphBaseIndent = 0;
            ctx.controlIndentLevel = 0;
            isStatementTerminator = false;
        }
    }

    let currentIndent = ctx.controlIndentLevel * ctx.indentationSpaces;

    if (startKeyword) {
        ctx.controlIndentLevel++;
    } else if (elseKeyword || subClauseKeyword) {
        ctx.controlIndentLevel++;
    } else if (findKeyword(upperCaseLine, ["PERFORM"])) {
        const lineWithoutPeriod = upperCaseLine.replace(/\.\s*$/, "");
        const isBlockStarterPerform =
            upperCaseLine.includes(" UNTIL ") ||
            upperCaseLine.includes(" VARYING ") ||
            upperCaseLine.includes(" TIMES ") ||
            lineWithoutPeriod.trim() === "PERFORM";
        if (isBlockStarterPerform) {
            ctx.controlIndentLevel++;
        }
    }

    if (isWhenClause) {
        ctx.isFirstWhenInBlock = false;
    }

    if (isStatementTerminator) {
        ctx.controlIndentLevel = ctx.paragraphBaseIndent;
        ctx.isInEvaluateBlock = false;
    }

    if (endKeyword === "END-EVALUATE") {
        ctx.isInEvaluateBlock = false;
    }

    return { isAreaAKeyword, currentIndent, processedLine };
};

module.exports = { formatLine };
