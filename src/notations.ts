export interface TwoslashQuery {
	/** display-code line index of the line being queried */
	line: number;
	character: number;
}

export interface TwoslashHighlight {
	line: number;
	character: number;
	length: number;
}

export interface ParsedNotations {
	/** every non-notation line — what the type-checker sees */
	analysisCode: string;
	/** analysisCode minus lines hidden by `---cut---` / `---cut-after---` */
	displayCode: string;
	/** analysis-line index of displayCode's first line */
	displayLineOffset: number;
	queries: TwoslashQuery[];
	highlights: TwoslashHighlight[];
}

const RE_QUERY = /^\s*--\s*(\^)[?|]/;
const RE_HIGHLIGHT = /^\s*--\s*(\^{3,})\s*$/;
const RE_CUT_BEFORE = /^\s*(?:--\s*)?---cut(?:-before)?---\s*$/;
const RE_CUT_AFTER = /^\s*(?:--\s*)?---cut-after---\s*$/;
const RE_ERRORS = /^\s*--\s*@errors\b/;

export function parseNotations(rawCode: string): ParsedNotations {
	const lines = rawCode.split("\n");

	const analysisLines: string[] = [];
	const queriesByAnalysisLine: TwoslashQuery[] = [];
	const highlightsByAnalysisLine: TwoslashHighlight[] = [];
	let cutBeforeAnalysisIndex: number | null = null;
	let cutAfterAnalysisIndex: number | null = null;

	for (const line of lines) {
		if (RE_ERRORS.test(line)) continue;

		if (RE_CUT_BEFORE.test(line)) {
			cutBeforeAnalysisIndex = analysisLines.length;
			continue;
		}
		if (RE_CUT_AFTER.test(line)) {
			cutAfterAnalysisIndex = analysisLines.length;
			continue;
		}

		const queryMatch = line.match(RE_QUERY);
		if (queryMatch) {
			queriesByAnalysisLine.push({
				line: analysisLines.length - 1,
				character: line.indexOf("^"),
			});
			continue;
		}

		const highlightMatch = line.match(RE_HIGHLIGHT);
		if (highlightMatch) {
			highlightsByAnalysisLine.push({
				line: analysisLines.length - 1,
				character: line.indexOf("^"),
				length: highlightMatch[1].length,
			});
			continue;
		}

		analysisLines.push(line);
	}

	const start = cutBeforeAnalysisIndex ?? 0;
	const end = cutAfterAnalysisIndex ?? analysisLines.length;
	const displayLines = analysisLines.slice(start, end);

	const inDisplay = (analysisLine: number) =>
		analysisLine >= start && analysisLine < end;
	const toDisplay = (analysisLine: number) => analysisLine - start;

	return {
		analysisCode: analysisLines.join("\n"),
		displayCode: displayLines.join("\n"),
		displayLineOffset: start,
		queries: queriesByAnalysisLine
			.filter((q) => inDisplay(q.line))
			.map((q) => ({ ...q, line: toDisplay(q.line) })),
		highlights: highlightsByAnalysisLine
			.filter((h) => inDisplay(h.line))
			.map((h) => ({ ...h, line: toDisplay(h.line) })),
	};
}
