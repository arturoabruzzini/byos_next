// ESM resolver hook for `node --test`: resolve the project's "@/..." tsconfig
// path alias to the repo root, with .ts/.tsx/index fallbacks. Keeps unit-test
// imports working without adding a test-runner dependency. Registered via
// scripts/register-aliases.mjs in the "test" npm script.
import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

const rootHref = pathToFileURL(`${process.cwd()}/`).href;

export async function resolve(specifier, context, nextResolve) {
	if (specifier.startsWith("@/")) {
		const base = new URL(specifier.slice(2), rootHref);
		const candidates = [
			base.href,
			`${base.href}.ts`,
			`${base.href}.tsx`,
			`${base.href}/index.ts`,
			`${base.href}/index.tsx`,
		];
		for (const href of candidates) {
			if (existsSync(fileURLToPath(href))) {
				return nextResolve(href, context);
			}
		}
	}
	return nextResolve(specifier, context);
}
