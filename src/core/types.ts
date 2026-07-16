/**
 * AST node types for the COBOL formatter.
 *
 * The tree models COBOL at formatting-relevant granularity:
 * SourceFile → Division[] → Section[] → entries/paragraphs → statements
 */

// ─── Trivia (preserved comments, blank lines) ───────────────────────────

export interface Trivia {
    kind: "Comment" | "BlankLine" | "CompilerDirective";
    text: string;
    /** Indicator character for fixed-form comments (* or /) */
    indicator?: string;
    originalLine: number;
}

// ─── Source File (root) ─────────────────────────────────────────────────

export interface SourceFile {
    kind: "SourceFile";
    format: "fixed" | "free";
    children: TopLevelNode[];
    trailingTrivia: Trivia[];
    diagnostics: Diagnostic[];
}

// ─── Division ───────────────────────────────────────────────────────────

export type DivisionKind =
    | "IdentificationDivision"
    | "EnvironmentDivision"
    | "DataDivision"
    | "ProcedureDivision";

export interface Division {
    kind: "Division";
    divisionType: DivisionKind;
    headerText: string;
    leadingTrivia: Trivia[];
    children: DivisionChild[];
}

// ─── Section ────────────────────────────────────────────────────────────

export interface Section {
    kind: "Section";
    name: string;
    headerText: string;
    leadingTrivia: Trivia[];
    children: SectionChild[];
}

// ─── Data Division nodes ────────────────────────────────────────────────

export interface DataEntry {
    kind: "DataEntry";
    level: number;
    name: string;
    /** Raw clause texts (e.g., "PIC X(10)", "VALUE SPACES") */
    clauses: DataClause[];
    /** The full original text of this entry (all tokens joined) */
    rawText: string;
    children: DataEntry[];
    leadingTrivia: Trivia[];
}

export interface DataClause {
    kind: "PicClause" | "ValueClause" | "OccursClause" | "RedefinesClause" | "GenericClause";
    text: string;
}

export interface FdEntry {
    kind: "FdEntry";
    name: string;
    rawText: string;
    records: DataEntry[];
    leadingTrivia: Trivia[];
}

export interface SelectEntry {
    kind: "SelectEntry";
    rawText: string;
    leadingTrivia: Trivia[];
}

export interface CopyStatement {
    kind: "CopyStatement";
    rawText: string;
    leadingTrivia: Trivia[];
}

// ─── Identification / Environment division entries ──────────────────────

export interface DivisionEntry {
    kind: "DivisionEntry";
    rawText: string;
    leadingTrivia: Trivia[];
}

// ─── Procedure Division nodes ───────────────────────────────────────────

export interface ProcedureSection {
    kind: "ProcedureSection";
    name: string;
    headerText: string;
    leadingTrivia: Trivia[];
    paragraphs: Paragraph[];
}

export interface Paragraph {
    kind: "Paragraph";
    name: string;
    leadingTrivia: Trivia[];
    statements: ProcedureStatement[];
}

/** A simple (non-block) statement */
export interface SimpleStatement {
    kind: "SimpleStatement";
    verb: string;
    rawText: string;
    /** Subsequent lines that belong to the same multi-line statement (e.g. DISPLAY options) */
    continuationLines?: string[];
    leadingTrivia: Trivia[];
}

export interface IfStatement {
    kind: "IfStatement";
    conditionText: string;
    thenBody: ProcedureStatement[];
    elseBody: ProcedureStatement[];
    leadingTrivia: Trivia[];
    /** Comments/blank lines immediately before the ELSE line */
    elseLeadingTrivia?: Trivia[];
    /** Comments/blank lines immediately before the END-IF line */
    endTerminatorTrivia?: Trivia[];
    /** True when the block was closed by a period rather than END-IF */
    periodTerminated?: boolean;
}

export interface EvaluateStatement {
    kind: "EvaluateStatement";
    subjectText: string;
    whenBranches: WhenBranch[];
    leadingTrivia: Trivia[];
    /** Comments/blank lines immediately before the END-EVALUATE line */
    endTerminatorTrivia?: Trivia[];
    /** True when the block was closed by a period rather than END-EVALUATE */
    periodTerminated?: boolean;
}

export interface WhenBranch {
    kind: "WhenBranch";
    conditionText: string;
    body: ProcedureStatement[];
    leadingTrivia: Trivia[];
}

export interface PerformBlock {
    kind: "PerformBlock";
    clauseText: string;
    body: ProcedureStatement[];
    leadingTrivia: Trivia[];
    /** Comments/blank lines immediately before the END-PERFORM line */
    endTerminatorTrivia?: Trivia[];
    /** True when the block was closed by a period rather than END-PERFORM */
    periodTerminated?: boolean;
}

/** One conditional clause of a ConditionalBlock (AT END, ON SIZE ERROR, WHEN ..., etc.) */
export interface ConditionalClause {
    kind: "ConditionalClause";
    /** The clause line as written, e.g. "AT END", "NOT ON SIZE ERROR",
     *  "WHEN TAU-NIMI (IND) = HAKU", or "INVALID KEY GO TO VIRHE." */
    text: string;
    body: ProcedureStatement[];
    leadingTrivia: Trivia[];
}

/**
 * A statement whose verb can carry conditional clauses and an END-xxx scope
 * terminator: READ/WRITE/REWRITE/DELETE/START, SEARCH, arithmetic verbs with
 * ON SIZE ERROR, CALL/ACCEPT with ON EXCEPTION, STRING/UNSTRING with
 * ON OVERFLOW. Configured via CONDITIONAL_VERBS in constants.ts.
 */
export interface ConditionalBlock {
    kind: "ConditionalBlock";
    /** The statement verb, e.g. "READ", "CALL", "COMPUTE" */
    verb: string;
    /** Header text up to (not including) the first inline clause */
    headerText: string;
    /** Subsequent lines that belong to the statement header (e.g. extra CALL USING arguments) */
    continuationLines?: string[];
    /** The END-xxx terminator to emit (e.g. "END-READ", "END-CALL") */
    endTerminator: string;
    /** Conditional clauses in source order */
    clauses: ConditionalClause[];
    /** Comments/blank lines that appeared immediately before the END-xxx line */
    endTerminatorTrivia?: Trivia[];
    /** True when the block was closed by a period rather than END-xxx */
    periodTerminated?: boolean;
    leadingTrivia: Trivia[];
}

/** DECLARATIVES ... END DECLARATIVES region at the start of the Procedure Division */
export interface Declaratives {
    kind: "Declaratives";
    /** The DECLARATIVES header line as written (e.g. "DECLARATIVES.") */
    headerText: string;
    /** The END DECLARATIVES line as written, or "" if missing in the source */
    endText: string;
    sections: ProcedureSection[];
    leadingTrivia: Trivia[];
    /** Comments/blank lines immediately before the END DECLARATIVES line */
    endLeadingTrivia: Trivia[];
}

/** One verbatim interior line of an EXEC block (original columns preserved) */
export interface ExecBodyLine {
    /** Text area content exactly as scanned (cols 8-72), including leading spaces */
    text: string;
    /** Indicator character (col 7): " " for code, "*" or "/" for comments */
    indicator: string;
}

/**
 * An EXEC SQL / EXEC CICS ... END-EXEC block. The interior is foreign syntax
 * with its own layout, so it is passed through completely verbatim — no case
 * normalization, no whitespace collapsing, no re-indentation. Only the EXEC
 * header and END-EXEC frame participate in COBOL indentation.
 */
export interface ExecBlock {
    kind: "ExecBlock";
    /** The EXEC line as written (trimmed), e.g. "EXEC SQL" — may already
     *  contain the whole statement incl. END-EXEC for single-line blocks */
    headerText: string;
    /** Interior lines, verbatim */
    bodyLines: ExecBodyLine[];
    /** The END-EXEC line as written (trimmed), "" when inline in the header or missing */
    endText: string;
    leadingTrivia: Trivia[];
    /** True when the sentence ended with a period (on END-EXEC or the single line) */
    periodTerminated?: boolean;
}

/** Fallback for lines the parser cannot understand */
export interface UnparsedLine {
    kind: "UnparsedLine";
    rawText: string;
    originalLine: number;
    leadingTrivia: Trivia[];
}

// ─── Union types ────────────────────────────────────────────────────────

export type ProcedureStatement =
    | SimpleStatement
    | IfStatement
    | EvaluateStatement
    | PerformBlock
    | ConditionalBlock
    | ExecBlock
    | UnparsedLine;

export type SectionChild =
    | DataEntry
    | FdEntry
    | SelectEntry
    | CopyStatement
    | DivisionEntry
    | ExecBlock
    | UnparsedLine;

export type DivisionChild =
    | Section
    | DataEntry
    | FdEntry
    | SelectEntry
    | CopyStatement
    | DivisionEntry
    | Paragraph
    | ProcedureSection
    | Declaratives
    | ExecBlock
    | UnparsedLine;

export type TopLevelNode =
    | Division
    | UnparsedLine;

// ─── Diagnostics ────────────────────────────────────────────────────────

export interface Diagnostic {
    /** Severity of the diagnostic */
    severity: "warning" | "info";
    /** Human-readable message */
    message: string;
    /** 1-based line number in the original source */
    line: number;
}
