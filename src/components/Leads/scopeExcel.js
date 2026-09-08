// ─────────────────────────────────────────────────────────────────────────────
//  scopeExcel — the Excel shape for a template's scope lines and the breakdown
//  tree under each one.
//
//  ONE sheet, not two. A scope arrives as a numbered list ("3. Civil Works,
//  3.1 Excavation, 3.1.1 Marking"), and that is what people already have in a
//  file; a Level column keeps that reading order intact, so a large scope is one
//  paste. Two sheets would force whoever fills it in to split a list they already
//  hold in order, and to repeat the parent name on every child.
//
//  LEVEL IS A NUMBER, and that is the whole format. It used to be a Parent/Sub
//  FLAG, which could only ever describe two levels — the scope is now a tree of
//  any depth, so the file has to say how deep each row is: 1 is an activity, 2 is
//  a sub-item of the activity above it, 3 is a sub-item of THAT, and so on with no
//  limit. The depth is carried explicitly rather than inferred, because inferring
//  it is exactly where a 200-row import silently puts work under the wrong parent.
//
//  A hand-made file usually marks the hierarchy in its numbering rather than in a
//  column, so a blank Level falls back to the shape of the Activity cell —
//  "3.1.1" is level 3, an indent of six spaces is level 3, "- " is one level down.
//  The old "Parent"/"Sub" words are still read, as levels 1 and 2, so a file
//  written against the previous template still imports.
//
//  Weights are exported but NOT required on import: left blank they are split
//  evenly within their own parent by the same rules the on-screen editor uses,
//  which is nearly always what a freshly typed scope wants.
// ─────────────────────────────────────────────────────────────────────────────
import { downloadStyledWorkbook, readSheetRows, cell } from "./bomExcel.js";
import { blankNode, flatten } from "../../utils/scopeTree.js";

export const SCOPE_COLUMNS = [
  { header: "Level", width: 8 },
  { header: "No.", width: 10 },
  { header: "Activity", width: 34 },
  { header: "Category", width: 14 },
  { header: "Specification", width: 30 },
  { header: "Unit", width: 10 },
  { header: "Weight %", width: 11 },
  { header: "Notes", width: 26 },
];

/**
 * The blank template carries a worked example — an activity, a sub-item and a
 * sub-sub-item — because the Level convention, and above all the fact that it can
 * go deeper than two, is the one thing a column header cannot explain.
 *
 * Examples in a template come back in the import, so each is tagged with
 * SAMPLE_NOTE in its Notes cell and the parser drops rows still carrying it. That
 * is why the marker is a full sentence rather than something a real note could
 * collide with: it has to be text nobody would type by accident.
 */
export const SAMPLE_NOTE = "Example row — delete me";
const SCOPE_SAMPLE_ROWS = [
  [1, "1",     "Civil Works",  "EPC", "Foundations and trenching", "Lot", "", SAMPLE_NOTE],
  [2, "1.1",   "Excavation",   "",    "To 1.5 m depth",            "Lot", "", SAMPLE_NOTE],
  [3, "1.1.1", "Marking",      "",    "Setting out",               "Lot", "", SAMPLE_NOTE],
];

export function downloadScopeTemplate() {
  downloadStyledWorkbook(
    [{ name: "Scope", columns: SCOPE_COLUMNS, rows: SCOPE_SAMPLE_ROWS, sampleRows: SCOPE_SAMPLE_ROWS.length }],
    "lead_scope_lines_template.xlsx",
  );
}

/**
 * Export the scope exactly as it reads on screen: each activity followed by its own
 * breakdown, to full depth, in reading order. The file it produces is also a valid
 * import file, so "export, edit in Excel, import back" is the round trip — which is
 * the point of having both buttons rather than only a blank template.
 */
export function exportScope(scopeLines, projectType) {
  const safe = String(projectType || "template").replace(/[^\w.-]+/g, "_");
  downloadStyledWorkbook(
    [{ name: "Scope", columns: SCOPE_COLUMNS, rows: scopeRows(scopeLines) }],
    `scope_lines_${safe}.xlsx`,
  );
}

/** Current scope lines (with their trees) → a flat, ordered, depth-tagged row list. */
export function scopeRows(scopeLines) {
  const rows = [];
  const num = (v) => (v === "" || v == null ? "" : Number(v));
  (scopeLines || []).forEach((r, i) => {
    rows.push([
      1, String(i + 1), r.activity || "", r.category || "", r.specification || "",
      r.unit || "", num(r.weightPct), r.notes || "",
    ]);
    // flatten() walks the tree depth-first in reading order and hands back each
    // node's depth and its path, so the numbering and the Level column agree with
    // what the editor shows — the two cannot drift apart.
    flatten(r.subItems || []).forEach(({ node, path, depth }) => {
      rows.push([
        depth + 1,
        [i + 1, ...path.map((p) => p + 1)].join("."),
        node.name || "", "", node.description || "",
        node.unit || "", num(node.weightPct), "",
      ]);
    });
  });
  return rows;
}

// A row's depth comes from the Level column when it has one. "Parent"/"Sub" are
// still understood, as levels 1 and 2, so a file written against the old two-level
// template still imports.
const LEVEL_WORD_1 = /^(parent|activity|p|main|1)$/i;
const LEVEL_WORD_2 = /^(sub|child|s|sub[- ]?item|2)$/i;

/** "3.1.1" → 3, "  - x" → 3, "- x" → 2. Null when the cell claims nothing. */
function depthFromActivityCell(raw) {
  const s = String(raw || "");
  const dotted = s.match(/^\s*(\d+(?:\.\d+)+)[.)]?\s+/);
  if (dotted) return dotted[1].split(".").length;
  const indent = s.match(/^( +)/);
  if (indent) return Math.floor(indent[1].length / 2) + 1;
  if (/^\s*[-–—•>*]\s/.test(s)) return 2;
  return null;
}

function parseLevel(levelCell, activityRaw) {
  const t = String(levelCell || "").trim();
  if (t) {
    if (LEVEL_WORD_1.test(t)) return 1;
    if (LEVEL_WORD_2.test(t)) return 2;
    const n = Number(t);
    if (Number.isInteger(n) && n >= 1) return n;
    return null;                 // a Level cell that says something unreadable
  }
  return depthFromActivityCell(activityRaw) || 1;
}

const stripMarker = (s) => String(s)
  .replace(/^\s*\d+(\.\d+)*[.)]?\s*/, "")   // "3.1.1 " / "3.1) " / "3. "
  .replace(/^\s*[-–—•>*]\s*/, "")           // "- " / "• "
  .trim();

/**
 * Read an uploaded scope file into `{ lines, errors }`.
 *
 * `lines` are ready to drop into the editor's state (`blankScope()`-shaped, with a
 * full `subItems` tree); `errors` name their own row so a 200-row file says which
 * row is wrong rather than just refusing.
 *
 * A row whose level has no valid parent above it — a level 3 directly after a
 * level 1, or a sub-item before any activity — is an ERROR rather than a silently
 * promoted or re-parented row. It means the file's own numbering disagrees with
 * itself, and guessing would put work under the wrong activity, which is the one
 * failure mode a deep import must never have.
 */
export async function parseScopeWorkbook(file, blankScope) {
  const raw = await readSheetRows(file);
  const lines = [];
  const errors = [];
  // stack[d] is the node most recently seen at depth d+1, so a row at level N
  // attaches to stack[N-2]. Truncated on the way back up.
  let stack = [];

  raw.forEach((r, i) => {
    const rowNo = i + 2; // +1 for the header, +1 because spreadsheets are 1-based
    const levelCell = String(cell(r, "Level", "Type", "Depth")).trim();
    // An example row the user never replaced is not scope. Dropped silently rather
    // than reported: leaving the examples in place is the default, not a mistake
    // worth an error message.
    if (String(cell(r, "Notes", "Remarks")).trim() === SAMPLE_NOTE) return;
    const activityRaw = String(cell(r, "Activity", "Scope", "Item", "Name", "Description of work"));
    if (!activityRaw.trim() && !levelCell) return;             // blank spacer row

    const level = parseLevel(levelCell, activityRaw);
    if (level === null) {
      errors.push(`Row ${rowNo}: "${levelCell}" is not a level — use 1 for an activity, `
        + "2 for a sub-item, 3 for a sub-item of that, and so on.");
      return;
    }

    const name = stripMarker(activityRaw);
    if (!name) { errors.push(`Row ${rowNo}: no activity name.`); return; }

    const weightRaw = cell(r, "Weight %", "Weight", "Weightage");
    const weight = weightRaw === "" ? "" : Number(weightRaw);
    if (weightRaw !== "" && !Number.isFinite(weight)) {
      errors.push(`Row ${rowNo} ("${name}"): weight "${weightRaw}" is not a number.`);
      return;
    }
    // A weight read from a file is a number the user chose, so it is pinned — the
    // same as typing it in. Blank stays auto and gets an even split in its group.
    const weightManual = weightRaw !== "";
    const spec = String(cell(r, "Specification", "Specifications", "Description")).trim();
    const unit = String(cell(r, "Unit", "Units")).trim();

    if (level === 1) {
      const line = {
        ...blankScope(),
        activity: name,
        category: String(cell(r, "Category")).trim(),
        specification: spec,
        unit,
        weightPct: weight,
        weightManual,
        notes: String(cell(r, "Notes", "Remarks")).trim(),
        subItems: [],
      };
      lines.push(line);
      stack = [line];
      return;
    }

    const parent = stack[level - 2];
    if (!parent) {
      errors.push(`Row ${rowNo} ("${name}"): it is level ${level}, but there is no level `
        + `${level - 1} row above it for it to sit under.`);
      return;
    }

    const node = {
      ...blankNode(),
      name,
      description: spec,
      unit,
      weightPct: weight,
      weightManual,
    };
    // A level-1 row keeps its children in `subItems`; every deeper node in
    // `children`. That asymmetry is the storage shape, not a quirk of the parser.
    if (level === 2) parent.subItems.push(node);
    else parent.children.push(node);
    stack = [...stack.slice(0, level - 1), node];
  });

  return { lines, errors };
}
