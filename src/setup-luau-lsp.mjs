#!/usr/bin/env node

import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import {
	DOWNLOAD_SHA256,
	INSTALL_DIR,
	LUAU_LSP_BINARY_PATH,
	LUAU_LSP_VERSION,
	RELEASE_ASSETS,
	ROBLOX_DEFS_PATH,
	ROOT_DIR,
} from "./config.mjs";

function verifyChecksum(filePath, key) {
	const expected = DOWNLOAD_SHA256[key];
	if (!expected) {
		throw new Error(
			`No pinned SHA-256 for "${key}". Refusing to use an unverified download. ` +
				`Add its hash to DOWNLOAD_SHA256 in config.mjs.`,
		);
	}
	const actual = createHash("sha256")
		.update(fs.readFileSync(filePath))
		.digest("hex");
	if (actual !== expected) {
		throw new Error(
			`Checksum mismatch for "${key}":\n  expected ${expected}\n  got      ${actual}`,
		);
	}
}

function installedVersion() {
	if (!fs.existsSync(LUAU_LSP_BINARY_PATH)) return null;
	const result = spawnSync(LUAU_LSP_BINARY_PATH, ["--version"], {
		encoding: "utf8",
	});
	return result.status === 0
		? (result.stdout.match(/\d+\.\d+\.\d+/)?.[0] ?? null)
		: null;
}

function findBinary(directory) {
	const wanted = process.platform === "win32" ? "luau-lsp.exe" : "luau-lsp";
	for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
		const entryPath = path.join(directory, entry.name);
		if (entry.isDirectory()) {
			const found = findBinary(entryPath);
			if (found) return found;
		} else if (entry.name === wanted) {
			return entryPath;
		}
	}
	return null;
}

async function download(url, destination) {
	const response = await fetch(url);
	if (!response.ok) {
		throw new Error(`Download failed (${response.status}): ${url}`);
	}
	fs.writeFileSync(destination, Buffer.from(await response.arrayBuffer()));
}

async function main() {
	const asset = RELEASE_ASSETS[`${process.platform}-${process.arch}`];
	if (!asset) {
		throw new Error(
			`Unsupported luau-lsp platform: ${process.platform}-${process.arch}`,
		);
	}

	fs.mkdirSync(INSTALL_DIR, { recursive: true });

	if (installedVersion() === LUAU_LSP_VERSION && fs.existsSync(ROBLOX_DEFS_PATH)) {
		console.log(`luau-lsp ${LUAU_LSP_VERSION} already installed.`);
		return;
	}

	const base = `https://github.com/JohnnyMorganz/luau-lsp/releases/download/${LUAU_LSP_VERSION}`;
	const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "luau-lsp-"));

	try {
		console.log(`Downloading luau-lsp ${LUAU_LSP_VERSION} (${asset})...`);
		const archivePath = path.join(tmp, asset);
		await download(`${base}/${asset}`, archivePath);
		verifyChecksum(archivePath, asset);

		const extractDir = path.join(tmp, "extract");
		fs.mkdirSync(extractDir);
		const unzip = spawnSync(
			"unzip",
			["-o", archivePath, "-d", extractDir],
			{ stdio: "inherit" },
		);
		if (unzip.status !== 0) throw new Error("Could not extract luau-lsp archive.");

		const binary = findBinary(extractDir);
		if (!binary) throw new Error("luau-lsp binary missing from archive.");
		fs.copyFileSync(binary, LUAU_LSP_BINARY_PATH);
		if (process.platform !== "win32") fs.chmodSync(LUAU_LSP_BINARY_PATH, 0o755);

		console.log("Downloading Roblox global type definitions...");
		const defsTmp = path.join(tmp, "globalTypes.None.d.luau");
		await download(
			`https://raw.githubusercontent.com/JohnnyMorganz/luau-lsp/${LUAU_LSP_VERSION}/scripts/globalTypes.None.d.luau`,
			defsTmp,
		);
		verifyChecksum(defsTmp, "globalTypes.None.d.luau");
		fs.copyFileSync(defsTmp, ROBLOX_DEFS_PATH);

		console.log(
			`Installed luau-lsp ${installedVersion()} at ${path.relative(
				ROOT_DIR,
				LUAU_LSP_BINARY_PATH,
			)}.`,
		);
	} finally {
		fs.rmSync(tmp, { recursive: true, force: true });
	}
}

await main();
