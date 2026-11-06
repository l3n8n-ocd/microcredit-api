"""Re-run every Prompt Ladder measurement from the committed raw outputs.

Usage (from the repository root, after `npm install`):

    python3 -I docs/prompt-ladder/harness/measure.py

For each run in docs/prompt-ladder/run-*.md it:
  1. extracts the code exactly as the model wrote it (Run 4: decodes the JSON strings),
  2. type-checks it with this repo's TypeScript and strict flags,
  3. counts patterns (any, export default, throw, `/ 100`, classes, lifecycle states named),
  4. runs the model's own Vitest file (if it wrote one) plus our behavior probe from ./probes.

It only writes inside a fresh temporary directory and never modifies the repository.
"""

import json
import os
import re
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
RUNS = ROOT / "docs" / "prompt-ladder"
PROBES = Path(__file__).resolve().parent / "probes"
TSC = ROOT / "node_modules" / ".bin" / "tsc"
VITEST = ROOT / "node_modules" / ".bin" / "vitest"

STATES = ["APPLIED", "UNDER_REVIEW", "APPROVED", "DISBURSED", "REPAYING",
          "SETTLED", "DELINQUENT", "DEFAULTED", "REJECTED", "CANCELLED"]
STRICT = {"target": "es2023", "lib": ["ES2023", "DOM"], "module": "esnext", "moduleResolution": "bundler",
          "noEmit": True, "skipLibCheck": True, "strict": True, "noImplicitAny": True, "strictNullChecks": True,
          "noUncheckedIndexedAccess": True, "noImplicitReturns": True, "exactOptionalPropertyTypes": True,
          "noFallthroughCasesInSwitch": True, "types": []}


def extract(md_text: str) -> tuple[dict[str, str], str]:
    """Returns ({filename: code}, prose) for one raw run file."""
    body = md_text.split("\n---\n", 1)[1]
    as_json = re.search(r"```json\n(.*?)```", body, re.S)
    if as_json:
        obj = json.loads(as_json.group(1))
        files = {"types.ts": obj["typesCode"], "stateMachine.ts": obj["stateMachineCode"], "ledger.ts": obj["ledgerCode"]}
        return files, obj.get("complexityAnalysis", "")
    named = re.findall(r"### `([\w.\-]+)`\s*\n+```(?:ts|typescript)\n(.*?)\n```", body, re.S)
    if named:  # Run 0 control: the model attached named files
        return {name: code + "\n" for name, code in named}, body.split("\n### `", 1)[0]
    blocks = re.findall(r"```(?:ts|typescript)\n(.*?)```", body, re.S)
    tests = [b for b in blocks if "from 'vitest'" in b]
    impl = [b for b in blocks if b not in tests]
    impl_name = "loanStateMachine.ts" if any("from './loanStateMachine'" in t for t in tests) else "impl.ts"
    files = {impl_name: "\n".join(impl)}
    files.update({f"model-{i}.test.ts": t for i, t in enumerate(tests)})
    return files, re.sub(r"```.*?```", "", body, flags=re.S)


def vitest_summary(out: str) -> str:
    match = re.search(r"Tests\s+(.+)", out)
    return match.group(1).strip() if match else "did not run"


def measure(run_md: Path, work: Path) -> dict[str, object]:
    files, prose = extract(run_md.read_text(encoding="utf-8"))
    d = work / run_md.stem
    d.mkdir(parents=True)
    for name, code in files.items():
        (d / name).write_text(code, encoding="utf-8")
    impl = {n: c for n, c in files.items() if not n.endswith(".test.ts")}
    code = "\n".join(impl.values())

    (d / "tsconfig.json").write_text(json.dumps({"compilerOptions": STRICT, "include": sorted(impl)}), encoding="utf-8")
    tsc = subprocess.run([str(TSC), "-p", str(d / "tsconfig.json")], capture_output=True, text=True)

    probe = PROBES / f"{run_md.stem}.test.ts"
    vitest_files = [n for n, c in files.items() if n.endswith(".test.ts") and "from 'vitest'" in c]
    node_tests = [n for n, c in files.items() if n.endswith(".test.ts") and "node:test" in c]
    results = []
    if node_tests:  # model wrote node:test tests: emit with plain `strict` (its own claim) and run them
        emit = {"compilerOptions": {"target": "es2023", "lib": ["ES2023"], "module": "nodenext",
                                    "moduleResolution": "nodenext", "strict": True, "skipLibCheck": True,
                                    "types": ["node"], "typeRoots": [str(ROOT / "node_modules" / "@types")],
                                    "outDir": "out"}, "include": sorted(files)}
        (d / "tsconfig.emit.json").write_text(json.dumps(emit), encoding="utf-8")
        built = subprocess.run([str(TSC), "-p", str(d / "tsconfig.emit.json")], capture_output=True, text=True)
        out = [str(d / "out" / n.replace(".ts", ".js")) for n in node_tests]
        ran = subprocess.run(["node", "--test", *out], capture_output=True, text=True)
        passed = re.search(r"^# pass (\d+)", ran.stdout, re.M)
        total = re.search(r"^# tests (\d+)", ran.stdout, re.M)
        plain = sum(1 for line in built.stdout.splitlines() if "error TS" in line)
        results.append(f"node:test {passed.group(1) if passed else '?'}/{total.group(1) if total else '?'} "
                       f"(plain-strict tsc errors: {plain})")
    if probe.exists() or vitest_files:
        if probe.exists():
            (d / "probe.test.ts").write_text(probe.read_text(encoding="utf-8"), encoding="utf-8")
        os.symlink(ROOT / "node_modules", d / "node_modules")
        include = json.dumps(vitest_files + (["probe.test.ts"] if probe.exists() else []))
        (d / "vitest.config.mjs").write_text(
            f"export default {{ test: {{ include: {include}, environment: 'node' }} }}\n", encoding="utf-8")
        run = subprocess.run([str(VITEST), "run", "--root", str(d)], capture_output=True, text=True, cwd=ROOT)
        results.append(vitest_summary(run.stdout + run.stderr))
    tests = "; ".join(results) if results else "—"

    return {
        "Run": run_md.stem,
        "Code lines": sum(c.count("\n") + 1 for c in impl.values()),
        "Longest line": max(len(line) for c in impl.values() for line in c.splitlines()),
        "Strict tsc errors": sum(1 for line in tsc.stdout.splitlines() if "error TS" in line),
        "`any`": len(re.findall(r":\s*any\b|<any>|\bas any\b", code)),
        "`export default`": code.count("export default"),
        "`throw`": len(re.findall(r"\bthrow\b", code)),
        "`/ 100`": len(re.findall(r"/\s*100\b", code)),
        "Classes": len(re.findall(r"\bclass\s+\w+", code)),
        "Our 10 states named": sum(1 for s in STATES if re.search(rf"['\"]{s}['\"]", code)),
        "Model's own tests": sum(1 for n in files if n.endswith(".test.ts")),
        "Prose words": len(re.sub(r"[#>*|`-]", " ", prose).split()),
        "Tests run (model's own + our probe)": tests,
    }


def main() -> None:
    if not TSC.exists():
        sys.exit("Run `npm install` in the repository root first.")
    with tempfile.TemporaryDirectory(prefix="prompt-ladder-") as tmp:
        rows = [measure(p, Path(tmp)) for p in sorted(RUNS.glob("run-*.md"))]
    headers = list(rows[0])
    print("| " + " | ".join(headers) + " |")
    print("| " + " | ".join("---" for _ in headers) + " |")
    for row in rows:
        print("| " + " | ".join(str(row[h]) for h in headers) + " |")


if __name__ == "__main__":
    main()
