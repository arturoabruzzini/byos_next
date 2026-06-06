// Registers the "@/" alias resolver hook (scripts/alias-resolver.mjs) for the
// node:test runner. Used via `node --import ./scripts/register-aliases.mjs`.
// Named to avoid node:test's default "test-*"/"*.test.*" discovery globs so it
// is not itself picked up and run as a (no-op) test file.
import { register } from "node:module";
register("./alias-resolver.mjs", import.meta.url);
