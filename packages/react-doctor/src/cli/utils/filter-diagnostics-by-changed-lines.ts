import {
  createChangedLineMatcher,
  type ChangedFileLineRanges,
  type Diagnostic,
} from "@react-doctor/core";

interface FilterDiagnosticsByChangedLinesInput {
  readonly contextual?: boolean;
  readonly directory: string;
  readonly diagnostics: ReadonlyArray<Diagnostic>;
  readonly changedLineRanges: ReadonlyArray<ChangedFileLineRanges>;
}

export const filterDiagnosticsByChangedLines = (
  input: FilterDiagnosticsByChangedLinesInput,
): ReadonlyArray<Diagnostic> => {
  return input.diagnostics.filter(createChangedLineMatcher(input));
};
