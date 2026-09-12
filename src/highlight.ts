import "server-only";

import type { ElementContent } from "hast";
import { createHighlighter, type Highlighter } from "shiki";

let highlighterPromise: Promise<Highlighter> | null = null;

function getHighlighter(): Promise<Highlighter> {
	highlighterPromise ??= createHighlighter({
		themes: ["github-light", "github-dark"],
		langs: ["luau"],
	});
	return highlighterPromise;
}

/**
 * Syntax-highlight a short Luau signature (from an LSP hover) into dual-theme
 * token spans — same `--shiki-light` / `--shiki-dark` markup as the code blocks,
 * so a consumer's code CSS colours them for free.
 */
export async function highlightLuauSignature(
	text: string,
): Promise<ElementContent[]> {
	const highlighter = await getHighlighter();
	const root = highlighter.codeToHast(text, {
		lang: "luau",
		themes: { light: "github-light", dark: "github-dark" },
		defaultColor: false,
	});

	const pre = root.children.find(
		(child): child is import("hast").Element =>
			child.type === "element" && child.tagName === "pre",
	);
	const code = pre?.children.find(
		(child): child is import("hast").Element =>
			child.type === "element" && child.tagName === "code",
	);
	if (!code) return [{ type: "text", value: text }];

	const lines = code.children.filter(
		(child): child is import("hast").Element =>
			child.type === "element" && child.tagName === "span",
	);

	const out: ElementContent[] = [];
	lines.forEach((line, index) => {
		if (index > 0) out.push({ type: "text", value: "\n" });
		out.push(...line.children);
	});
	return out;
}
