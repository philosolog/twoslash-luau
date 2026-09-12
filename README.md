# twoslash-luau

Twoslash-style annotation pipeline for Luau (Linear [TAS-162](https://linear.app/philosolog/issue/TAS-162)). Type-checks ` ```luau twoslash ` code blocks against a real `luau-lsp` process and decorates the rendered HTML with hover types, `-- ^?` query results, and diagnostics — so documentation examples show compiler-derived type info instead of hand-maintained comments.

## How it works

Two rehype passes bracket your syntax highlighter (e.g. `rehype-pretty-code`):

1. `rehypeLuauTwoslashExtract` — before highlighting. Finds every `luau twoslash` fenced block, strips the directive lines, type-checks the remaining source via `luau-lsp`, and stashes the analysis (hovers, `^?` queries, diagnostics) keyed by an id on the `<pre>` node.
2. `rehypeLuauTwoslashRender` — after highlighting. Looks up the stashed analysis by id and decorates the now-highlighted markup: wraps hovered identifier ranges in `.twoslash-hover` spans with a `.twoslash-popup`, inserts `.twoslash-query` / `.twoslash-error` meta lines, and marks errored lines `.twoslash-errored`.

## Directive syntax

```luau twoslash
local part = workspace:FindFirstChild("Part") :: BasePart
--       ^?
```

- `-- ^?` on the line after an expression — query its type.
- `---cut---` / `---cut-after---` — hide setup code above/below from the rendered example (it's still type-checked).
- `-- @errors` — the line is analyzed but never rendered.
- ` ```luau twoslash plain ` — opt out of analysis, render plain highlighting.

## Integrating into a consumer app

1. Install peer deps: `shiki`, `vscode-jsonrpc`, `unist-util-visit`, `server-only`, `@types/hast`.
2. Run `npm run setup-luau-lsp` (or wire it into your own postinstall) — downloads a pinned, checksum-verified `luau-lsp` binary + Roblox type defs into `.luau-lsp/` at your app's `process.cwd()`.
3. Wire both passes into your MDX/rehype pipeline, in this order relative to your highlighter:

   ```ts
   rehypePlugins: [
     rehypeLuauTwoslashExtract,
     [rehypePrettyCode, options],
     rehypeLuauTwoslashRender,
   ]
   ```

4. Style the output — `.twoslash-hover`, `.twoslash-popup`, `.twoslash-popup-type`, `.twoslash-popup-docs`, `.twoslash-query`, `.twoslash-error`, `.twoslash-errored`, `.has-twoslash` (on the `<figure>`) — the module ships no CSS, since presentation belongs to the consumer.

## As a git submodule

This repo is meant to be added as a submodule inside a consumer app (e.g. `git submodule add <this repo url> vendor/twoslash-luau`) and imported by relative path — no publish step needed, since `paths.ts`/`config.mjs` resolve `.luau-lsp` off `process.cwd()` (the consumer's root), and everything else is plain relative imports that resolve peer deps from the consumer's own `node_modules`.
