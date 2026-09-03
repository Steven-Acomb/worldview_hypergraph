// Copy the repository's LICENSE next to package.json so `npm pack` / `npm publish`
// ship it (npm's "files" cannot reach outside the package directory).  The copy is
// git-ignored; the file of record stays at the repository root.
import { copyFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
copyFileSync(path.resolve(here, "../../../LICENSE"), path.resolve(here, "../LICENSE"));
