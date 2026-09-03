#!/usr/bin/env node
// Executable shim for the worldview-core CLI.  Node-only; the library
// itself (dist/index.js) has no Node dependencies.
let cli;
try {
  cli = await import("../dist/cli.js");
} catch (e) {
  if (e && e.code === "ERR_MODULE_NOT_FOUND") {
    process.stderr.write("worldview: dist/ is not built; run `npm run build` in sdk/typescript first\n");
    process.exit(2);
  }
  throw e;
}
process.exitCode = cli.main(process.argv.slice(2));
