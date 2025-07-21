/**
 * @file constants.js
 * @description COBOL formatting constants and keywords.
 */

const constants = {
    SEQ_NUMBER_END: 6,
    INDICATOR_COL: 7,
    AREA_A_START: 8,
    AREA_A_END: 11,
    AREA_B_START: 12,

    AREA_A_KEYWORDS: [
        "IDENTIFICATION DIVISION",
        "ID DIVISION",
        "PROGRAM-ID",
        "ENVIRONMENT DIVISION",
        "CONFIGURATION SECTION",
        "INPUT-OUTPUT SECTION",
        "FILE-CONTROL",
        "DATA DIVISION",
        "FILE SECTION",
        "WORKING-STORAGE SECTION",
        "LOCAL-STORAGE SECTION",
        "LINKAGE SECTION",
        "SCREEN SECTION",
        "PROCEDURE DIVISION",
        "DECLARATIVES",
        "END DECLARATIVES",
        "END PROGRAM",
        "SELECT",
        "SPECIAL-NAMES",
        "AUTHOR",
        "DATE-WRITTEN",
        "DATE-COMPILED",
        "FD",
    ],

    AREA_B_STATEMENTS: [
        "EXIT",
        "STOP",
        "GOBACK",
        "DISPLAY",
        "COMPUTE",
        "MOVE",
        "ADD",
        "SUBTRACT",
        "MULTIPLY",
        "DIVIDE",
        "COPY",
    ],

    INDENT_START_KEYWORDS: ["IF", "READ", "EVALUATE", "STRING"],

    INDENT_END_KEYWORDS: ["END-IF", "END-PERFORM", "END-READ", "END-EVALUATE"],

    INDENT_ELSE_KEYWORDS: [
        "ELSE",
        "WHEN OTHER",
        "WHEN",
        "NOT AT END",
        "NOT INVALID KEY",
    ],
};

module.exports = constants;
