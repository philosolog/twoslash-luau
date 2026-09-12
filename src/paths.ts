import "server-only";

import fs from "node:fs";
import path from "node:path";

const ROOT_DIR = path.resolve(process.cwd());
const INSTALL_DIR = path.join(ROOT_DIR, ".luau-lsp");

export const LUAU_LSP_BINARY_PATH = path.join(
	INSTALL_DIR,
	process.platform === "win32" ? "luau-lsp.exe" : "luau-lsp",
);

export const ROBLOX_DEFS_PATH = path.join(
	INSTALL_DIR,
	"globalTypes.None.d.luau",
);

/** Whether `npm run setup-luau-lsp` has run and the binary is present. */
export function hasLuauLsp(): boolean {
	return fs.existsSync(LUAU_LSP_BINARY_PATH);
}

export function hasRobloxDefs(): boolean {
	return fs.existsSync(ROBLOX_DEFS_PATH);
}
