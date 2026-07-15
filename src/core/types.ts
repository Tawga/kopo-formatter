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
    /** True when the block was closed by a period rather than END-IF */
    periodTerminated?: boolean;
}

export interface EvaluateStatement {
    kind: "EvaluateStatement";
    subjectText: string;
    whenBranches: WhenBranch[];
    leadingTrivia: Trivia[];
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
    /** True when the block was closed by a period rather than END-PERFORM */
    periodTerminated?: boolean;
}

export interface ReadBlock {
    kind: "ReadBlock";
    headerText: string;
    /** The END-xxx terminator to emit (e.g. "END-READ", "END-REWRITE") */
    endTerminator: string;
    /** True when the block was closed by a period rather than END-xxx */
    periodTerminated?: boolean;
    atEndBody: ProcedureStatement[];
    notAtEndBody: ProcedureStatement[];
    invalidKeyBody: ProcedureStatement[];
    notInvalidKeyBody: ProcedureStatement[];
    leadingTrivia: Trivia[];
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
    | ReadBlock
    | UnparsedLine;

export type SectionChild =
    | DataEntry
    | FdEntry
    | SelectEntry
    | CopyStatement
    | DivisionEntry
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
