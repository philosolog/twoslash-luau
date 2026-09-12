import path from "node:path";

// Matches paths.ts: the install directory lives under the *consumer's* cwd
// (the app that `require`s this module), not this package's own location —
// so this stays correct however deep a consumer nests it (npm dep, git
// submodule, monorepo package, ...).
export const ROOT_DIR = path.resolve(process.cwd());

// https://github.com/JohnnyMorganz/luau-lsp/releases
export const LUAU_LSP_VERSION = "1.69.0";

export const INSTALL_DIR = path.join(ROOT_DIR, ".luau-lsp");

export const LUAU_LSP_BINARY_PATH = path.join(
	INSTALL_DIR,
	process.platform === "win32" ? "luau-lsp.exe" : "luau-lsp",
);

// Roblox global type definitions ("None" security level = what a normal
// script/plugin sees). Downloaded alongside the binary. Blocks opt out with
// ```luau twoslash plain```.
export const ROBLOX_DEFS_PATH = path.join(INSTALL_DIR, "globalTypes.None.d.luau");

// GitHub release asset name per platform.
export const RELEASE_ASSETS = {
	"darwin-x64": "luau-lsp-macos.zip",
	"darwin-arm64": "luau-lsp-macos.zip",
	"linux-x64": "luau-lsp-linux-x86_64.zip",
	"linux-arm64": "luau-lsp-linux-arm64.zip",
	"win32-x64": "luau-lsp-win64.zip",
};

// SHA-256 of each downloaded file. The setup script refuses anything not listed.
// On a version bump, refresh the release-asset hashes from the GitHub API:
//   curl -s https://api.github.com/repos/JohnnyMorganz/luau-lsp/releases/tags/<VERSION> \
//     | grep -E '"name"|"digest"'
// and the type-defs hash with:
//   curl -sL https://raw.githubusercontent.com/JohnnyMorganz/luau-lsp/<VERSION>/scripts/globalTypes.None.d.luau | shasum -a 256
export const DOWNLOAD_SHA256 = Object.freeze({
	"luau-lsp-macos.zip":
		"4e93204901d892b227a4de15c9d4742176c15e9461d208cadafa1bcd58ec1ae3",
	"luau-lsp-linux-x86_64.zip":
		"4457aeb690d3c22e04567f38c6259ac259a1673ec022758b9cb81af2a0e66c41",
	"luau-lsp-linux-arm64.zip":
		"b0c78fe40defe71b9fa6381390a590f2040897980a0cf31f0a23c165ad27ebbb",
	"luau-lsp-win64.zip":
		"faea1b177f4761e4c34e0dab72009a2fdd00f21d61f3f7b7c1fe1ac3f38a05d2",
	"globalTypes.None.d.luau":
		"12cc962e8387c6b66e57b356cfecae6a0957e5cc14376e0b17a661ddf1493c1d",
});
