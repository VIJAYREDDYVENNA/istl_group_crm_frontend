// ─────────────────────────────────────────────────────────────────────────────
//  scopeExcel — the Excel shape for a template's scope lines, including the
//  sub-item breakdown under each one.
//
//  ONE sheet, not two. A scope arrives as a numbered list ("3. Civil Works,
//  3.1 Excavation, 3.2 PCC"), and that is what people already have in a file;
//  a Level column keeps that reading order intact, so a large scope is one
//  paste. Two sheets would force whoever fills it in to split a list they
//  already hold in order, and to repeat the parent name on every child.
//
//  A row's level is read from the Level column, and — because a hand-made file
//  usually marks the hierarchy in the numbering rather than in a column — it
//  falls back to the shape of the Activity cell: "3.1", a leading dash or an
//  indent all mean "sub-item of the row above".
//
//  Weights are exported but NOT required on import: left blank they are split
//  evenly by the same rules the on-screen editor uses, which is nearly always
//  what a freshly typed scope wants.
// ─────────────────────────────────────────────────────────────────────────────
import { downloadStyledWorkbook, readSheetRows, cell } from "./bomExcel.js";

export const SCOPE_COLUMNS = [
  { header: "Level", width: 10 },
  { header: "Activity", width: 34 },
  { header: "Category", width: 14 },
  { header: "Specification", width: 30 },
  { header: "Unit", width: 10 },
  { header: "Weight %", width: 11 },
  { header: "Notes", width: 26 },
];

/**
 * The blank template carries a worked example — a parent with one sub-item —
 * because the Level convention is the one thing a column header cannot explain.
 *
 * Examples in a template come back in the import, so each is tagged with
 * SAMPLE_NOTE in its Notes cell and the parser drops rows still carrying it.
 * That is why the marker is a full sentence rather than something a real note
 * could collide with: it has to be text nobody would type by accident.
 */
export const SAMPLE_NOTE = "Example row — delete me";
const SCOPE_SAMPLE_ROWS = [
  ["Parent", "Civil Works", "EPC", "Foundations and trenching", "Lot", "", SAMPLE_NOTE],
  ["Sub", "Excavation", "", "To 1.5 m depth", "Lot", "", SAMPLE_NOTE],
];

export function downloadScopeTemplate() {
  downloadStyledWorkbook(
    [{ name: "Scope", columns: SCOPE_COLUMNS, rows: SCOPE_SAMPLE_ROWS, sampleRows: SCOPE_SAMPLE_ROWS.length }],
    "lead_scope_lines_template.xlsx",
  );
}

/**
 * Export the scope exactly as it reads on screen: each activity followed by its
 * own sub-items. The file it produces is also a valid import file, so "export,
 * edit in Excel, import back" is the round trip — which is the point of having
 * both buttons rather than only a blank template.
 */
export function exportScope(scopeLines, projectType) {
  const safe = String(projectType || "template").replace(/[^w.-]+/g, "_");
  downloadStyledWorkbook(
    [{ name: "Scope", columns: SCOPE_COLUMNS, rows: scopeRows(scopeLines) }],
    `scope_lines_${safe}.xlsx`,
  );
}

/** Current scope lines (with their sub-items) → a flat, ordered row list. */
export function scopeRows(scopeLines) {
  const rows = [];
  (scopeLines || []).forEach(r => {
    rows.push([
      "Parent", r.activity || "", r.category || "", r.specification || "",
      r.unit || "", r.weightPct === "" || r.weightPct == null ? "" : Number(r.weightPct),
      r.notes || "",
    ]);
    (r.subItems || []).forEach(si => {
      rows.push([
        "Sub", si.name || "", "", si.description || "",
        si.unit || "", si.weightPct === "" || si.weightPct == null ? "" : Number(si.weightPct),
        "",
      ]);
    });
  });
  return rows;
}

// A row is a sub-item when it says so, or when its Activity cell is written like
// one. "1.2" is a sub of "1"; a leading -, •, > or two spaces is the same claim
// made visually. A bare "Sub"/"Child"/"S" in Level is the explicit form.
const LEVEL_IS_SUB = /^(sub|child|s|2|sub[- ]?item)$/i;
const ACTIVITY_LOOKS_SUB = /^(\s{2,}|[-–—•>*]\s|\d+\.\d)/;

const stripMarker = (s) => String(s)
  .replace(/^\s*\d+(\.\d+)*[.)]?\s*/, "")   // "3.1 " / "3.1) " / "3. "
  .replace(/^\s*[-–—•>*]\s*/, "")           // "- " / "• "
  .trim();

/**
 * Read an uploaded scope file into `{ lines, errors }`.
 *
 * `lines` are ready to drop into the editor's state (`blankScope()`-shaped, with
 * `subItems`); `errors` name their own row so a 200-row file says which row is
 * wrong rather than just refusing. A sub-item before any parent is an error
 * rather than a silently promoted parent — it means the file's own numbering
 * disagrees with itself, and guessing would put work under the wrong activity.
 */
export async function parseScopeWorkbook(file, blankScope) {
  const raw = await readSheetRows(file);
  const lines = [];
  const errors = [];

  raw.forEach((r, i) => {
    const rowNo = i + 2; // +1 for the header, +1 because spreadsheets are 1-based
    const levelCell = String(cell(r, "Level", "Type")).trim();
    // An example row the user never replaced is not scope. Dropped silently
    // rather than reported: leaving the examples in place is the default, not a
    // mistake worth an error message.
    if (String(cell(r, "Notes", "Remarks")).trim() === SAMPLE_NOTE) return;
    const activityRaw = String(cell(r, "Activity", "Scope", "Item", "Name", "Description of work"));
    if (!activityRaw.trim() && !levelCell) return;             // blank spacer row

    const isSub = LEVEL_IS_SUB.test(levelCell) || (!levelCell && ACTIVITY_LOOKS_SUB.test(activityRaw));
    const name = stripMarker(activityRaw);
    if (!name) { errors.push(`Row ${rowNo}: no activity name.`); return; }

    const weightRaw = cell(r, "Weight %", "Weight", "Weightage");
    const weight = weightRaw === "" ? "" : Number(weightRaw);
    if (weightRaw !== "" && !Number.isFinite(weight)) {
      errors.push(`Row ${rowNo} ("${name}"): weight "${weightRaw}" is not a number.`);
      return;
    }

    if (isSub) {
      if (!lines.length) {
        errors.push(`Row ${rowNo} ("${name}"): it is a sub-item, but no activity comes before it.`);
        return;
      }
      lines[lines.length - 1].subItems.push({
        name,
        description: String(cell(r, "Specification", "Specifications", "Description")).trim(),
        unit: String(cell(r, "Unit", "Units")).trim(),
        weightPct: weight,
        // A weight read from a file is a number the user chose, so it is pinned —
        // the same as typing it in. Blank stays auto and gets an even split.
        weightManual: weightRaw !== "",
      });
      return;
    }

    lines.push({
      ...blankScope(),
      activity: name,
      category: String(cell(r, "Category")).trim(),
      specification: String(cell(r, "Specification", "Specifications", "Description")).trim(),
      unit: String(cell(r, "Unit", "Units")).trim(),
      weightPct: weight,
      weightManual: weightRaw !== "",
      notes: String(cell(r, "Notes", "Remarks")).trim(),
      subItems: [],
    });
  });

  return { lines, errors };
}
