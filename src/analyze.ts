import "server-only";

import { getLuauLsp, type LspDiagnostic } from "./lsp";
import { parseNotations } from "./notations";

export interface TwoslashHoverInfo {
	line: number;
	character: number;
	length: number;
	/** the hover signature, e.g. `local part: BasePart` */
	text: string;
	/** trailing prose docs, if any */
	docs?: string;
}

export interface TwoslashErrorInfo {
	line: number;
	character: number;
	endLine: number;
	endCharacter: number;
	message: string;
}

export interface TwoslashQueryInfo {
	line: number;
	text: string;
	docs?: string;
}

export interface TwoslashAnalysis {
	displayCode: string;
	hovers: TwoslashHoverInfo[];
	errors: TwoslashErrorInfo[];
	queries: TwoslashQueryInfo[];
}

const KEYWORDS = new Set([
	"and", "break", "do", "else", "elseif", "end", "false", "for", "function",
	"if", "in", "local", "nil", "not", "or", "repeat", "return", "then", "true",
	"until", "while", "continue", "export", "type",
]);

const MAX_HOVER_TARGETS = 300;

interface Ident {
	line: number;
	character: number;
	length: number;
}

/** Collect identifier positions, skipping strings and comments. */
function scanIdentifiers(code: string): Ident[] {
	const idents: Ident[] = [];
	const lines = code.split("\n");

	for (let line = 0; line < lines.length; line++) {
		const text = lines[line];
		let i = 0;
		while (i < text.length) {
			const rest = text.slice(i);

			// line comment — rest of line
			if (rest.startsWith("--")) break;

			// string literals
			const quote = text[i];
			if (quote === '"' || quote === "'" || quote === "`") {
				i++;
				while (i < text.length && text[i] !== quote) {
					if (text[i] === "\\") i++;
					i++;
				}
				i++;
				continue;
			}

			const idMatch = rest.match(/^[A-Za-z_][A-Za-z0-9_]*/);
			if (idMatch) {
				const word = idMatch[0];
				if (!KEYWORDS.has(word)) {
					idents.push({ line, character: i, length: word.length });
				}
				i += word.length;
				continue;
			}

			i++;
		}
	}

	return idents;
}

/** `\`\`\`luau\n<sig>\n\`\`\`\n----\n<docs>` -> { text, docs } */
function parseHoverMarkdown(value: string): { text: string; docs?: string } {
	const fence = value.match(/```(?:luau|lua)?\n([\s\S]*?)\n```/);
	if (!fence) {
		const trimmed = value.trim();
		return trimmed ? { text: trimmed } : { text: "" };
	}
	const text = fence[1].trim();
	let docs = value.replace(fence[0], "").trim();
	docs = docs
		.replace(/^-{3,}\s*/m, "")
		.replace(/```[\s\S]*?```/g, "")
		.replace(/\n{3,}/g, "\n\n")
		.trim();
	return docs ? { text, docs } : { text };
}

function isTypeError(diagnostic: LspDiagnostic): boolean {
	// severity 1 = Error. Luau lint warnings are severity 2+.
	return diagnostic.severity === 1;
}

/**
 * Type-check a `luau twoslash` snippet and return everything the renderer needs,
 * in *display-code* coordinates (notations + cut regions already removed).
 */
export async function analyzeLuau(
	rawCode: string,
): Promise<TwoslashAnalysis> {
	const { analysisCode, displayCode, displayLineOffset, queries } =
		parseNotations(rawCode);

	const displayLineCount = displayCode.split("\n").length;
	const toDisplayLine = (analysisLine: number) =>
		analysisLine - displayLineOffset;
	const inDisplay = (analysisLine: number) =>
		analysisLine >= displayLineOffset &&
		analysisLine < displayLineOffset + displayLineCount;

	// Identifier positions are found in display coords, then shifted into
	// analysis coords for the LSP.
	const displayIdents = scanIdentifiers(displayCode).slice(0, MAX_HOVER_TARGETS);
	const hoverTargets = displayIdents.map((id) => ({
		line: id.line + displayLineOffset,
		character: id.character,
	}));

	// `-- ^?` queries, in analysis coords
	const queryTargets = queries.map((q) => ({
		line: q.line + displayLineOffset,
		character: q.character,
	}));

	const { hovers, diagnostics } = await getLuauLsp().analyze(analysisCode, [
		...hoverTargets,
		...queryTargets,
	]);

	const identHovers = hovers.slice(0, hoverTargets.length);
	const queryHovers = hovers.slice(hoverTargets.length);

	const resultHovers: TwoslashHoverInfo[] = [];
	displayIdents.forEach((ident, index) => {
		const hover = identHovers[index];
		if (!hover?.contents?.value) return;
		const { text, docs } = parseHoverMarkdown(hover.contents.value);
		if (!text) return;
		resultHovers.push({ ...ident, text, docs });
	});

	const resultQueries: TwoslashQueryInfo[] = [];
	queries.forEach((query, index) => {
		const hover = queryHovers[index];
		if (!hover?.contents?.value) return;
		const { text, docs } = parseHoverMarkdown(hover.contents.value);
		if (!text) return;
		resultQueries.push({ line: query.line, text, docs });
	});

	const resultErrors: TwoslashErrorInfo[] = [];
	for (const diagnostic of diagnostics) {
		if (!isTypeError(diagnostic)) continue;
		if (!inDisplay(diagnostic.range.start.line)) continue;
		resultErrors.push({
			line: toDisplayLine(diagnostic.range.start.line),
			character: diagnostic.range.start.character,
			endLine: inDisplay(diagnostic.range.end.line)
				? toDisplayLine(diagnostic.range.end.line)
				: toDisplayLine(diagnostic.range.start.line),
			endCharacter: diagnostic.range.end.character,
			message: diagnostic.message,
		});
	}

	return {
		displayCode,
		hovers: resultHovers,
		errors: resultErrors,
		queries: resultQueries,
	};
}
