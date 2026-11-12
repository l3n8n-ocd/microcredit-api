# SentinelScout triage brief

Generated 2026-11-12T20:15:20.356Z. Draft for Lenon's sign-off; nothing here was applied.

## 1. Verdict

**NOT_AFFECTED**. No installed version is in the vulnerable range.

## 2. Advisory

Source: **osv**, fetched 2026-11-12T20:15:14.350Z.

- **GHSA-2464-fhr4-w9xw**, severity **critical** (from the advisory's severity field)
  - CVSS: `CVSS:4.0/AV:N/AC:L/AT:P/PR:N/UI:N/VC:H/VI:H/VA:H/SC:H/SI:H/SA:H`
  - Title, as written by the advisory author: "Next.js: Unauthenticated Remote Code Execution in Image Optimization API when SVG files are used"
  - https://github.com/advisories/GHSA-2464-fhr4-w9xw

## 3. Exposure

Checked against `package-lock.json` (372 packages).

| Package | Vulnerable range | Installed | Direct | In range |
| --- | --- | --- | --- | --- |
| `next` | `>=10.0.0 <15.5.28\|\|>=16.0.0 <16.4.1` | 16.4.5 | yes | **no** |

Imported in: `src/app/health/page.tsx`, `src/app/layout.tsx`, `src/app/page.tsx`, `src/app/portfolio/page.tsx`, `src/components/Navbar.tsx`.

## 4. Invariants

- Regex audit of `src/features` (30 files, CLAUDE.md §11 rule 2): **PASS**, 0 floating-point money lines.
- `Idempotency-Key` required: yes. `If-Match` required: yes.
- Type check and unit tests: typecheck pass, tests pass (Tests  257 passed (257)).

A regex audit, not a proof: it finds the known patterns, not every way to do float math.

## 5. For Lenon

- Nothing to change. Confirm the range comparison in section 3 and sign off.

Sign-off stays with Lenon (FL-01). SentinelScout does not apply diffs, commit, push or publish.
