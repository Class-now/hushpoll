// Copy the compiled contract (managed/) and the witnesses from ../contract so the
// deploy package resolves @midnight-ntwrk/compact-runtime from its own node_modules.
import { cpSync, rmSync, readFileSync, writeFileSync, existsSync } from "node:fs";

const src = "../contract/src/managed";
if (!existsSync(src)) {
  console.error("Compile the contract first: cd ../contract && npm run compact");
  process.exit(1);
}
rmSync("managed", { recursive: true, force: true });
cpSync(src, "managed", { recursive: true });
const w = readFileSync("../contract/src/witnesses.ts", "utf8").replace(
  "./managed/hushpoll/contract/index.js",
  "../managed/hushpoll/contract/index.js",
);
writeFileSync("src/witnesses.ts", w);
console.log("synced managed/ and src/witnesses.ts from ../contract");
