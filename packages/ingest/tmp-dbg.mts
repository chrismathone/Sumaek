import { readFileSync } from "node:fs";
import { extractPage } from "./src/segment";
import { RPM_2022 } from "./src/profiles/rpm-2022";
import type { SourceDump, Run } from "./src/types";
const [file, pageArg, ...want] = process.argv.slice(2);
const dump = JSON.parse(readFileSync(file!, "utf8")) as SourceDump;
const page = dump.pages.find((p) => p.page === Number(pageArg))!;
const render = (runs: Run[]): string =>
  runs.map((r) => (r.kind === "text" ? r.text : `$${r.latex}$`)).join("");
for (const q of extractPage(page, RPM_2022).questions) {
  if (want.length > 0 && !want.includes(q.printedNumber)) continue;
  console.log(`── ${q.printedNumber} ── ${render(q.stem).slice(0, 220)}`);
}
