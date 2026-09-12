import "server-only";

import * as cp from "node:child_process";
import * as rpc from "vscode-jsonrpc/node.js";
import {
	LUAU_LSP_BINARY_PATH,
	ROBLOX_DEFS_PATH,
	hasRobloxDefs,
} from "./paths";

export interface LspPosition {
	line: number;
	character: number;
}

export interface LspRange {
	start: LspPosition;
	end: LspPosition;
}

export interface LspDiagnostic {
	range: LspRange;
	message: string;
	severity?: number;
	source?: string;
	code?: string | number;
}

export interface LspHover {
	contents: { kind: string; value: string };
	range?: LspRange;
}

/**
 * One persistent `luau-lsp` process for the whole build. Documents are opened
 * and closed per code block; requests can be issued concurrently.
 */
class LuauLsp {
	private connection: rpc.MessageConnection | null = null;
	private proc: cp.ChildProcess | null = null;
	private version = 1;
	private starting: Promise<void> | null = null;

	private async ensureStarted(): Promise<void> {
		if (this.connection) return;
		if (this.starting) return this.starting;

		this.starting = (async () => {
			const args = ["lsp", "--stdio"];
			if (hasRobloxDefs()) {
				args.push(`--definitions=${ROBLOX_DEFS_PATH}`);
			}

			const proc = cp.spawn(LUAU_LSP_BINARY_PATH, args, {
				stdio: ["pipe", "pipe", "pipe"],
			});
			// Let the build process exit once rendering is done without an
			// explicit teardown hook; the reffed stdio streams still keep the
			// loop alive for as long as a request is in flight.
			proc.unref();
			this.proc = proc;
			proc.on("exit", () => {
				this.connection = null;
				this.proc = null;
				this.starting = null;
			});
			process.once("exit", () => proc.kill());

			const connection = rpc.createMessageConnection(
				new rpc.StreamMessageReader(proc.stdout!),
				new rpc.StreamMessageWriter(proc.stdin!),
			);
			connection.listen();

			await connection.sendRequest("initialize", {
				processId: process.pid,
				rootUri: null,
				capabilities: {
					textDocument: {
						hover: { contentFormat: ["markdown", "plaintext"] },
						publishDiagnostics: {},
					},
				},
				trace: "off",
			});
			connection.sendNotification("initialized", {});
			this.connection = connection;
		})();

		try {
			await this.starting;
		} finally {
			this.starting = null;
		}
	}

	/** Analyse one snippet: returns hovers for the requested positions + diagnostics. */
	async analyze(
		code: string,
		positions: LspPosition[],
	): Promise<{ hovers: (LspHover | null)[]; diagnostics: LspDiagnostic[] }> {
		await this.ensureStarted();
		const connection = this.connection!;
		const uri = `file:///twoslash-${this.version}-${Math.random()
			.toString(36)
			.slice(2)}.luau`;

		connection.sendNotification("textDocument/didOpen", {
			textDocument: {
				uri,
				languageId: "luau",
				version: this.version++,
				text: code,
			},
		});

		try {
			const [hovers, diag] = await Promise.all([
				Promise.all(
					positions.map((position) =>
						connection
							.sendRequest("textDocument/hover", {
								textDocument: { uri },
								position,
							})
							.then((result) => (result as LspHover | null) ?? null)
							.catch(() => null),
					),
				),
				connection
					.sendRequest("textDocument/diagnostic", {
						textDocument: { uri },
					})
					.then(
						(result) =>
							((result as { items?: LspDiagnostic[] }).items ??
								[]) as LspDiagnostic[],
					)
					.catch(() => [] as LspDiagnostic[]),
			]);
			return { hovers, diagnostics: diag };
		} finally {
			connection.sendNotification("textDocument/didClose", {
				textDocument: { uri },
			});
		}
	}

	stop(): void {
		this.connection?.dispose();
		this.proc?.kill();
		this.connection = null;
		this.proc = null;
	}
}

// Reuse across the whole build. Node tears the process (and this child) down
// on exit, so no explicit cleanup hook is needed.
const globalKey = Symbol.for("twoslash-luau.luau-lsp");
type GlobalWithLsp = typeof globalThis & { [globalKey]?: LuauLsp };
const store = globalThis as GlobalWithLsp;

export function getLuauLsp(): LuauLsp {
	store[globalKey] ??= new LuauLsp();
	return store[globalKey];
}
