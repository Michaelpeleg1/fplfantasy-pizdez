// PIL-243 acceptance tests for the tie-split prize engine.
// Extracts computePrizes() from index.html so the tested code IS the shipped code.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const html = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "index.html"), "utf-8");
const m = html.match(/function computePrizes[\s\S]*?\n}/);
if (!m) throw new Error("computePrizes not found in index.html");
const computePrizes = new Function("return " + m[0])();

const PRIZES = [3600, 2100, 1300];
const row = (name, total) => ({ name, total });
let failures = 0;
function check(desc, rows, expected) {
  const got = computePrizes(rows, PRIZES);
  const ok = JSON.stringify(got) === JSON.stringify(expected);
  console.log((ok ? "PASS" : "FAIL") + " — " + desc, ok ? "" : `\n  got:      ${JSON.stringify(got)}\n  expected: ${JSON.stringify(expected)}`);
  if (!ok) failures++;
}

check("no ties: straight 1-2-3",
  [row("A", 100), row("B", 90), row("C", 80), row("D", 70)],
  { A: 3600, B: 2100, C: 1300 });

check("2-way tie for 1st: split 3600+2100",
  [row("A", 100), row("B", 100), row("C", 80), row("D", 70)],
  { A: 2850, B: 2850, C: 1300 });

check("3-way tie for 3rd: split 1300 only (positions 4-5 carry 0)",
  [row("A", 100), row("B", 90), row("C", 80), row("D", 80), row("E", 80)],
  { A: 3600, B: 2100, C: 1300 / 3, D: 1300 / 3, E: 1300 / 3 });

check("2-way tie for 2nd: split 2100+1300",
  [row("A", 100), row("B", 90), row("C", 90), row("D", 70)],
  { A: 3600, B: 1700, C: 1700 });

check("4-way tie for 1st across all prize positions",
  [row("A", 100), row("B", 100), row("C", 100), row("D", 100), row("E", 50)],
  { A: 1750, B: 1750, C: 1750, D: 1750 });

check("tie entirely below prize positions: nobody gets anything extra",
  [row("A", 100), row("B", 90), row("C", 80), row("D", 70), row("E", 70)],
  { A: 3600, B: 2100, C: 1300 });

if (failures) { console.error(failures + " test(s) failed"); process.exit(1); }
console.log("All prize-engine tests passed.");
