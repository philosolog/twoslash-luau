import "server-only";

import type { Element, ElementContent, Root, Text } from "hast";
import { visit } from "unist-util-visit";
import { analyzeLuau } from "./analyze";
import { highlightLuauSignature } from "./highlight";
import { hasLuauLsp } from "./paths";

interface StoredHover {
	line: number;
	character: number;
	length: number;
	signature: ElementContent[];
	docs?: string;
}

interface StoredQuery {
	line: number;
	signature: ElementContent[];
}

interface StoredError {
	line: number;
	endLine: number;
	message: string;
}

interface StoredAnalysis {
	hovers: StoredHover[];
	queries: StoredQuery[];
	errors: StoredError[];
}

const PENDING = new Map<string, StoredAnalysis>();

function makeId(): string {
	return Math.random().toString(36).slice(2, 12);
}

function isElement(node: unknown, tagName?: string): node is Element {
	return (
		!!node &&
		typeof node === "object" &&
		(node as Element).type === "element" &&
		(!tagName || (node as Element).tagName === tagName)
	);
}

function classList(node: Element): string[] {
	const value: unknown = node.properties?.className;
	if (Array.isArray(value)) return value.map((entry) => String(entry));
	if (typeof value === "string") return value.split(/\s+/).filter(Boolean);
	return [];
}

/**
 * Pass 1 (before rehype-pretty-code): type-check every ```luau twoslash``` block,
 * stash the analysis, and replace the fenced source with the display code so the
 * highlighter never sees the `-- ^?` / `---cut---` notations.
 */
export function rehypeLuauTwoslashExtract() {
	return async (tree: Root) => {
		const jobs: Promise<void>[] = [];

		visit(tree, "element", (node) => {
			if (node.tagName !== "pre") return;
			const code = node.children.find((child) =>
				isElement(child, "code"),
			) as Element | undefined;
			if (!code) return;
			if (!classList(code).includes("language-luau")) return;

			const meta = String(
				(code.data as { meta?: unknown } | undefined)?.meta ?? "",
			);
			if (!/\btwoslash\b/.test(meta)) return;

			const textNode = code.children.find(
				(child): child is Text => child.type === "text",
			);
			if (!textNode) return;
			const rawCode = textNode.value.replace(/\n$/, "");

			if (!hasLuauLsp()) {
				console.warn(
					"[luau-twoslash] luau-lsp is not installed — run `npm run setup-luau-lsp`. Rendering plain highlighting.",
				);
				(code.data as { meta?: string }).meta = meta
					.replace(/\btwoslash\b/, "")
					.trim();
				return;
			}

			const id = makeId();
			node.properties = node.properties ?? {};
			node.properties.dataLuauTwoslash = id;
			(code.data as { meta?: string }).meta = meta
				.replace(/\b(twoslash|plain)\b/g, "")
				.trim();

			jobs.push(
				analyzeLuau(rawCode)
					.then(async (analysis) => {
						const sigCache = new Map<string, ElementContent[]>();
						const highlight = async (text: string) => {
							let cached = sigCache.get(text);
							if (!cached) {
								cached = await highlightLuauSignature(text);
								sigCache.set(text, cached);
							}
							return structuredClone(cached);
						};

						PENDING.set(id, {
							hovers: await Promise.all(
								analysis.hovers.map(async (hover) => ({
									line: hover.line,
									character: hover.character,
									length: hover.length,
									signature: await highlight(hover.text),
									docs: hover.docs,
								})),
							),
							queries: await Promise.all(
								analysis.queries.map(async (query) => ({
									line: query.line,
									signature: await highlight(query.text),
								})),
							),
							errors: analysis.errors.map((error) => ({
								line: error.line,
								endLine: error.endLine,
								message: error.message,
							})),
						});
						textNode.value = analysis.displayCode + "\n";
					})
					.catch((error) => {
						console.warn(
							`[luau-twoslash] analysis failed: ${
								error instanceof Error ? error.message : error
							}`,
						);
						delete node.properties?.dataLuauTwoslash;
					}),
			);
		});

		await Promise.all(jobs);
	};
}

interface Char {
	ch: string;
	props: Element["properties"];
}

function lineChars(line: Element): Char[] {
	const chars: Char[] = [];
	const walk = (node: ElementContent, props: Element["properties"]) => {
		if (node.type === "text") {
			for (const ch of node.value) chars.push({ ch, props });
		} else if (node.type === "element") {
			const merged = node.tagName === "span" ? node.properties : props;
			for (const child of node.children) walk(child, merged);
		}
	};
	for (const child of line.children) walk(child, line.properties);
	return chars;
}

function sameProps(a: Element["properties"], b: Element["properties"]): boolean {
	return JSON.stringify(a ?? {}) === JSON.stringify(b ?? {});
}

interface HoverRange {
	start: number;
	end: number;
	signature: ElementContent[];
	docs?: string;
}

/** Rebuild one line's inline content, wrapping hovered ranges. */
function renderLine(line: Element, hovers: HoverRange[]): void {
	const chars = lineChars(line);
	if (chars.length === 0) return;

	const hoverAt = (index: number): HoverRange | undefined =>
		hovers.find((h) => index >= h.start && index < h.end);

	const out: ElementContent[] = [];
	let i = 0;
	while (i < chars.length) {
		const props = chars[i].props;
		const hover = hoverAt(i);
		let text = "";
		while (
			i < chars.length &&
			sameProps(chars[i].props, props) &&
			hoverAt(i) === hover
		) {
			text += chars[i].ch;
			i++;
		}
		const span: Element = {
			type: "element",
			tagName: "span",
			properties: props ? structuredClone(props) : {},
			children: [{ type: "text", value: text }],
		};
		out.push(hover ? hoverWrapper(span, hover) : span);
	}

	line.children = out;
}

function popupNode(
	signature: ElementContent[],
	docs?: string,
): Element {
	const children: ElementContent[] = [
		{
			type: "element",
			tagName: "code",
			properties: { className: ["twoslash-popup-type"] },
			children: signature,
		},
	];
	if (docs) {
		children.push({
			type: "element",
			tagName: "span",
			properties: { className: ["twoslash-popup-docs"] },
			children: [{ type: "text", value: docs }],
		});
	}
	return {
		type: "element",
		tagName: "span",
		properties: { className: ["twoslash-popup"] },
		children,
	};
}

function hoverWrapper(inner: Element, hover: HoverRange): Element {
	return {
		type: "element",
		tagName: "span",
		properties: { className: ["twoslash-hover"] },
		children: [popupNode(hover.signature, hover.docs), inner],
	};
}

function metaLine(
	className: string,
	children: ElementContent[],
): ElementContent[] {
	return [
		{
			type: "element",
			tagName: "span",
			properties: {
				className: ["line", "twoslash-meta", className],
				"data-line": "",
			},
			children,
		},
		{ type: "text", value: "\n" },
	];
}

/**
 * Pass 2 (after rehype-pretty-code): decorate the highlighted markup with the
 * stashed analysis — hover popups, inline `^?` query results, error lines.
 */
export function rehypeLuauTwoslashRender() {
	return (tree: Root) => {
		visit(tree, "element", (figure) => {
			if (figure.tagName !== "figure") return;
			const id = figure.properties?.dataLuauTwoslash;
			if (typeof id !== "string") return;
			delete figure.properties?.dataLuauTwoslash;

			const analysis = PENDING.get(id);
			PENDING.delete(id);
			if (!analysis) return;

			figure.properties = figure.properties ?? {};
			figure.properties.className = [...classList(figure), "has-twoslash"];

			const pre = figure.children.find((c) => isElement(c, "pre")) as
				| Element
				| undefined;
			const code = pre?.children.find((c) => isElement(c, "code")) as
				| Element
				| undefined;
			if (!code) return;

			const lineEls = code.children.filter((c): c is Element =>
				isElement(c, "span"),
			);

			// hover popups
			lineEls.forEach((lineEl, lineIndex) => {
				const hovers: HoverRange[] = analysis.hovers
					.filter((h) => h.line === lineIndex)
					.map((h) => ({
						start: h.character,
						end: h.character + h.length,
						signature: h.signature,
						docs: h.docs,
					}));
				if (hovers.length) renderLine(lineEl, hovers);
			});

			// error line classes
			for (const error of analysis.errors) {
				for (let l = error.line; l <= error.endLine; l++) {
					const lineEl = lineEls[l];
					if (!lineEl) continue;
					lineEl.properties = lineEl.properties ?? {};
					lineEl.properties.className = [
						...classList(lineEl),
						"twoslash-errored",
					];
				}
			}

			// meta lines (queries + errors) after their anchor lines
			const inserts: { after: Element; nodes: ElementContent[] }[] = [];
			for (const query of analysis.queries) {
				const anchor = lineEls[query.line];
				if (!anchor) continue;
				inserts.push({
					after: anchor,
					nodes: metaLine("twoslash-query", [
						{
							type: "element",
							tagName: "code",
							properties: { className: ["twoslash-popup-type"] },
							children: query.signature,
						},
					]),
				});
			}
			for (const error of analysis.errors) {
				const anchor = lineEls[error.endLine];
				if (!anchor) continue;
				inserts.push({
					after: anchor,
					nodes: metaLine("twoslash-error", [
						{ type: "text", value: error.message },
					]),
				});
			}

			for (const { after, nodes } of inserts) {
				const at = code.children.indexOf(after);
				if (at === -1) continue;
				code.children.splice(at + 1, 0, ...nodes);
			}
		});
	};
}
