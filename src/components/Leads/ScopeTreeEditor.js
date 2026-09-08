// ─────────────────────────────────────────────────────────────────────────────
//  ScopeTreeEditor — the breakdown under one scope line, at any depth.
//
//  This replaces ScopeSubItemsEditor, which could only render one flat level of
//  sub-items. It is the SINGLE editor for all three screens that author scope —
//  the templates admin page, the lead's Technical Scope tab and the project's
//  Scope/Plan tab — which previously carried three hand-maintained copies of the
//  same table that had already drifted apart (two different weight tolerances
//  between them). Nesting has to behave identically on all three, and writing the
//  recursion three times would guarantee it did not.
//
//  Keeps the `ssi-*` CSS namespace and stylesheet of the editor it grew out of,
//  so a host page can drop it in without its own table styles colliding (see
//  memory: ld-/custd- CSS namespace split), plus a few `ssi-tree-*` additions for
//  indentation and the row controls.
//
//  THE WEIGHT RULE, at every level: a node's weight is a share of ITS OWN PARENT
//  and each group totals 100 within that parent, never a share of the whole
//  scope. Pinning, rebalancing and the rounding tolerance all come from
//  utils/scopeWeights.js via utils/scopeTree.js — one model, applied per parent,
//  all the way down.
//
//  IDENTITY IS THE `id`. A node keeps its UUID through renames and moves, and its
//  progress and budget hang off that id, so renaming is safe and two nodes that
//  share a name in different branches stay separate. See utils/scopeTree.js.
// ─────────────────────────────────────────────────────────────────────────────
import React from "react";
import {
  Plus, Trash2, RefreshCw, ChevronDown, ChevronRight, CornerDownRight, ChevronUp,
} from "lucide-react";
import UnitSelectCell from "../Dropdowns/UnitSelectCell.js";
import ActivityNameSelect from "./ActivityNameSelect.js";
import { fmtWeight } from "../../utils/scopeWeights.js";
import {
  blankNode, namedNodes, hasChildren, countDescendants,
  addChild, addSibling, removeNode, moveNode, updateNode, setNodeWeight, resetGroupWeights,
  nodeAt, groupWeightsOk, groupSum, treeWeightsOk,
} from "../../utils/scopeTree.js";
import "./ScopeSubItemsEditor.css";
import "./ScopeTreeEditor.css";

// Re-exported so the three host screens import their tree helpers from one place.
export { blankNode, namedNodes, treeWeightsOk };
export { hydrateTree, treeForSave, validateTree } from "../../utils/scopeTree.js";

/**
 * The collapsed one-line summary, rendered by the host inside its own row so a
 * closed branch is never mistaken for a leaf.
 */
export function SubItemsSummary({ subs, onExpand }) {
  const named = namedNodes(subs);
  if (!(subs || []).length) return null;
  const ok = treeWeightsOk(subs);
  const deep = (subs || []).reduce((n, c) => n + countDescendants(c), 0);
  return (
    <div className="ssi-summary">
      <button type="button" className="ssi-linkish" onClick={onExpand}>
        {subs.length} sub-item{subs.length === 1 ? "" : "s"}
        {deep > 0 && <span className="ssi-hint"> (+{deep} nested)</span>}
      </button>
      <span className="ssi-hint"> — {named.map((n) => n.name).join(", ") || "unnamed"}</span>
      {!ok && <span className="ssi-bad"> · weights don’t add up</span>}
    </div>
  );
}

/** The expand/collapse control, so the host's row-number cell can carry it. */
export function SubItemsToggle({ open, count, onToggle }) {
  return (
    <button
      type="button" className="ssi-toggle" onClick={onToggle}
      title={open ? "Hide the breakdown" : count ? `Show ${count} sub-item(s)` : "Add a breakdown"}
    >
      {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
    </button>
  );
}

/** "1.2.3" — the position of a node in the tree, for orientation only. */
const numbering = (path) => path.map((i) => i + 1).join(".");

/**
 * @param subs        the breakdown tree (array of nodes)
 * @param onChange    (nextTree) => void — always the whole tree
 * @param parentName  shown in the heading and the sub-total, for orientation
 * @param options / register  from useActivityNames()
 * @param disabled    read-only mode (mirrors the host's canEdit)
 * @param renderExtra optional (node, ctx) => ReactNode, appended as extra cells, where
 *                    ctx is `{ path, depth, parent, isLeaf }`. `parent` is null at the
 *                    top level. The host gets the PARENT because scheduling is
 *                    relative to it — a child is placed on its parent's period grid,
 *                    and a leaf's dates are bounded by its parent's span. Scheduling
 *                    deliberately stays out of this editor: a template has no calendar,
 *                    which is why the templates page passes no renderExtra at all —
 *                    how the project screen adds its progress and budget columns
 *                    without a second copy of this table existing.
 */
export default function ScopeTreeEditor({
  subs, onChange, parentName, options, register, disabled = false, renderExtra,
}) {
  const rows = subs || [];
  // Collapsed state is keyed by node id, so it survives reordering and renaming —
  // an index key would follow the position and collapse the wrong branch.
  const [collapsed, setCollapsed] = React.useState(() => new Set());
  const toggle = (id) => setCollapsed((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const ok = groupWeightsOk(rows);
  const total = groupSum(rows);

  const confirmRemove = (path) => {
    const node = nodeAt(rows, path);
    const n = node ? countDescendants(node) : 0;
    if (n > 0) {
      const label = (node.name || "").trim() || "this item";
      // Removing a branch removes everything under it, including any progress and
      // budget recorded against those nodes. That is not recoverable from this
      // screen, so it is never silent.
      const msg = `Remove "${label}" and everything under it?\n\n`
        + `${n} nested item${n === 1 ? "" : "s"} will be removed too, `
        + "along with any progress and budget recorded against them.";
      if (!window.confirm(msg)) return;
    }
    onChange(removeNode(rows, path));
  };

  return (
    <div className="ssi-wrap">
      <div className="ssi-head">
        <span className="ssi-hint">
          Sub-items under <b>{(parentName || "").trim() || "this activity"}</b> — each is a
          share of <b>this activity</b>, so they add up to 100% of it, not of the scope.
          Break any of them down further with <b>+ Sub</b>.
        </span>
        {!disabled && (
          <>
            <button type="button" className="ssi-btn ssi-right"
              onClick={() => onChange(resetGroupWeights(rows, []))}
              disabled={rows.length === 0}
              title="Unpin these sub-weights and split them evenly again">
              <RefreshCw size={12} /> Reset
            </button>
            <button type="button" className="ssi-btn" onClick={() => onChange([...rows, blankNode()])}>
              <Plus size={12} /> Add sub-item
            </button>
          </>
        )}
      </div>

      {rows.length === 0 ? (
        <div className="ssi-empty">
          No breakdown.{disabled ? "" : " “Add sub-item” to break this activity down."}
        </div>
      ) : (
        <table className="ssi-table ssi-tree">
          <thead>
            <tr>
              <th className="ssi-c-no" />
              <th>Sub-item</th>
              <th>Description</th>
              <th className="ssi-c-unit">Unit</th>
              <th className="ssi-c-weight">Weight %</th>
              {renderExtra && <th className="ssi-c-extra" />}
              {!disabled && <th className="ssi-c-act" />}
            </tr>
          </thead>
          <tbody>
            <Rows
              nodes={rows} path={[]} depth={0}
              collapsed={collapsed} toggle={toggle}
              disabled={disabled} options={options} register={register}
              renderExtra={renderExtra}
              onChange={onChange} tree={rows} onRemove={confirmRemove}
            />
          </tbody>
        </table>
      )}

      {rows.length > 0 && (
        <div className={`ssi-total${ok ? " ssi-total--ok" : " ssi-total--err"}`}>
          <span>Sub-total: <b>{fmtWeight(total)}%</b> of {(parentName || "").trim() || "this activity"}</span>
          <span className="ssi-hint">
            {ok ? "Adds up." : "Must add up to 100% of the activity before this can be saved."}
          </span>
        </div>
      )}
    </div>
  );
}

/**
 * One sibling group and everything under it.
 *
 * Rendered as flat <tr>s inside the one table rather than a nested table per level:
 * a nested table re-starts its own column widths, so at three levels deep the
 * columns no longer line up with the ones above and the grid stops being readable.
 * Depth is shown by indenting the first cell instead.
 */
function Rows({
  nodes, path, depth, collapsed, toggle, disabled, options, register,
  renderExtra, onChange, tree, onRemove, parent = null,
}) {
  return (nodes || []).map((n, i) => {
    const p = [...path, i];
    const kids = n.children || [];
    const open = !collapsed.has(n.id);
    const groupOk = groupWeightsOk(kids);

    return (
      <React.Fragment key={n.id}>
        <tr className={depth > 0 ? "ssi-tr--child" : undefined}>
          <td className="ssi-c-no">
            <span className="ssi-tree-no" style={{ paddingLeft: depth * 16 }}>
              {depth > 0 && <CornerDownRight size={11} className="ssi-tree-elbow" />}
              {hasChildren(n) ? (
                <button type="button" className="ssi-toggle" onClick={() => toggle(n.id)}
                  title={open ? "Collapse this branch" : `Show ${countDescendants(n)} nested item(s)`}>
                  {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                </button>
              ) : <span className="ssi-tree-spacer" />}
              {numbering(p)}
            </span>
          </td>
          <td>
            <ActivityNameSelect
              className="ssi-inp" value={n.name}
              onChange={(v) => onChange(updateNode(tree, p, "name", v))}
              options={options} register={register}
              placeholder={depth > 0 ? "Select item…" : "Select sub-item…"}
            />
          </td>
          <td>
            <input className="ssi-inp" value={n.description} disabled={disabled}
              placeholder="Optional"
              onChange={(e) => onChange(updateNode(tree, p, "description", e.target.value))} />
          </td>
          <td className="ssi-c-unit">
            <UnitSelectCell className="ssi-inp" value={n.unit}
              onChange={(v) => onChange(updateNode(tree, p, "unit", v))} />
          </td>
          <td className="ssi-c-weight">
            <input
              className={`ssi-inp ssi-inp--w${n.weightManual ? " ssi-pinned" : ""}`}
              type="number" min="0" max="100" step="0.01" value={n.weightPct}
              disabled={disabled}
              onChange={(e) => onChange(setNodeWeight(tree, p, e.target.value))}
              title={n.weightManual
                ? "Set by you — this weight holds while the others rebalance around it."
                : "Calculated automatically. Type a value to hold it."} />
          </td>
          {renderExtra && (
            <td className="ssi-c-extra">
              {renderExtra(n, { path: p, depth, parent, isLeaf: !hasChildren(n) })}
            </td>
          )}
          {!disabled && (
            <td className="ssi-c-act">
              <div className="ssi-tree-acts">
                <button type="button" className="ssi-iconbtn"
                  onClick={() => onChange(moveNode(tree, p, -1))}
                  disabled={i === 0} title="Move up">
                  <ChevronUp size={12} />
                </button>
                <button type="button" className="ssi-iconbtn"
                  onClick={() => onChange(moveNode(tree, p, 1))}
                  disabled={i === nodes.length - 1} title="Move down">
                  <ChevronDown size={12} />
                </button>
                <button type="button" className="ssi-iconbtn"
                  onClick={() => onChange(addSibling(tree, p))}
                  title="Add another item at this level">
                  <Plus size={12} />
                </button>
                <button type="button" className="ssi-iconbtn ssi-iconbtn--sub"
                  onClick={() => onChange(addChild(tree, p))}
                  title={`Break "${(n.name || "this item").trim()}" down further`}>
                  <CornerDownRight size={12} /> Sub
                </button>
                <button type="button" className="ssi-del" onClick={() => onRemove(p)}
                  title={hasChildren(n)
                    ? "Remove this item and everything under it"
                    : "Remove this item"}>
                  <Trash2 size={13} />
                </button>
              </div>
            </td>
          )}
        </tr>

        {hasChildren(n) && open && (
          <Rows
            nodes={kids} path={p} depth={depth + 1}
            collapsed={collapsed} toggle={toggle}
            disabled={disabled} options={options} register={register}
            renderExtra={renderExtra}
            onChange={onChange} tree={tree} onRemove={onRemove}
            parent={n}
          />
        )}

        {/* Per-group footer: a branch that does not add up has to say so where the
            user is working, not only when they try to save. */}
        {hasChildren(n) && open && (
          <tr className="ssi-tr--child">
            <td />
            <td colSpan={99}>
              <div className={`ssi-tree-groupfoot${groupOk ? "" : " ssi-total--err"}`}>
                <span className="ssi-hint">
                  {namedNodes(kids).length} under <b>{(n.name || "this item").trim()}</b>:{" "}
                  <b>{fmtWeight(groupSum(kids))}%</b>
                  {groupOk ? " — adds up." : " — must total 100% of this item."}
                </span>
                {!disabled && (
                  <button type="button" className="ssi-btn"
                    onClick={() => onChange(resetGroupWeights(tree, p))}
                    title="Unpin these weights and split them evenly again">
                    <RefreshCw size={11} /> Reset
                  </button>
                )}
              </div>
            </td>
          </tr>
        )}
      </React.Fragment>
    );
  });
}
