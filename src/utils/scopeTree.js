// ─────────────────────────────────────────────────────────────────────────────
//  scopeTree — the scope breakdown as a TREE of arbitrary depth.
//
//  A scope line's breakdown used to be one flat level of sub-items. It is now a
//  tree: an activity may have sub-items, or sub-groups that each have their own
//  sub-groups, with no depth limit. "Electrical Works → PV Module → Purchase
//  Order" is three levels and a real schedule goes deeper in places while other
//  branches stay shallow. Both have to work.
//
//  IDENTITY IS THE `id`, NOT THE NAME. Once nesting is allowed the same name
//  legitimately appears in different branches — a real schedule repeats
//  "Foundation", "Payment", "Receiving" and "Installation" under many parents —
//  so a name key would silently pool their progress and their money into one
//  bucket. Every node therefore carries a stable UUID, minted once and then
//  carried through every copy (template → lead → project) and every edit.
//  Consequences worth stating plainly, because they invert what used to be true:
//    • Renaming a node keeps its progress and its budget.
//    • Two nodes with the same name are two nodes.
//  A concatenated name-path ("Civil > Substation > Excavation") was considered
//  as the identity and rejected: it detaches history whenever any ancestor is
//  renamed.
//
//  THE WEIGHT RULE is unchanged and now applies at every level: a node's weight
//  is a share of ITS OWN PARENT, and one parent's children total 100% of that
//  parent — never of the whole scope. So breaking one branch down further cannot
//  disturb any other branch. Every group goes through utils/scopeWeights.js, the
//  same helpers the top level uses; there is one weight model, applied per
//  parent, all the way down.
//
//  Mirrored server-side in service/scope/ScopeSubItems.java — same tolerance,
//  same delta-to-largest rule, same per-parent validation order, so a save that
//  passes here cannot fail there.
// ─────────────────────────────────────────────────────────────────────────────
import {
  distributeWeights, resetWeights, setWeightAt, validateWeights, weightSum,
} from "./scopeWeights.js";

/** Browsers without crypto.randomUUID (older Safari) still need an id. */
const uuid = () => (
  typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      return (c === "x" ? r : ((r & 0x3) | 0x8)).toString(16);
    })
);

/** A new node. It gets its id here, at the moment it is created, and keeps it. */
export const blankNode = () => ({
  id: uuid(), name: "", description: "", unit: "", weightPct: "", weightManual: false, children: [],
});

/** Nodes with a real name — the only ones that are saved or counted. */
export const namedNodes = (nodes) => (nodes || []).filter((n) => (n.name || "").trim());

export const hasChildren = (node) => ((node && node.children) || []).length > 0;

/** Total number of nodes under this one, at every depth — for the collapsed summary. */
export const countDescendants = (node) =>
  ((node && node.children) || []).reduce((n, c) => n + 1 + countDescendants(c), 0);

/**
 * Server → editable state. Fills in anything missing and rebalances each group so a
 * breakdown saved before this editor existed still shows 100%.
 *
 * A node arriving without an id is given one here rather than being left keyed by its
 * name. That covers rows written before the migration and anything hand-built in an
 * import; the id then persists on the next save.
 */
export const hydrateTree = (raw) =>
  distributeWeights((raw || []).map((n) => ({
    id: n.id || uuid(),
    name: n.name || "",
    description: n.description || "",
    unit: n.unit || "",
    weightPct: n.weightPct != null ? Number(n.weightPct) : "",
    weightManual: n.weightManual === true,
    // Execution fields (progress, budget, dates, status) are carried through
    // untouched — the editor does not own them, but it must not drop them either.
    ...passThrough(n),
    children: hydrateTree(n.children),
  })));

/** Execution data the scope editor displays or ignores but must never discard. */
const PASS_THROUGH = [
  "status", "progressPercent", "plannedProgressPct", "plannedBudget",
  "startDate", "endDate", "startWeek", "endWeek",
  // A node's OWN span and how it divides for the items under it (per-node
  // scheduling). Missing here meant hydrateTree/treeForSave/mergeTree silently
  // stripped a parent's dates and Weekly/Monthly choice on every load, save and
  // re-suggest — its children then had no grid to resolve their own timelines
  // against, and the toggle looked like it reset on every reload.
  "plannedStartDate", "plannedEndDate", "planUnit",
];
const passThrough = (n) => {
  const out = {};
  PASS_THROUGH.forEach((k) => { if (n[k] !== undefined) out[k] = n[k]; });
  return out;
};

/** Editable state → what the API stores. Unnamed nodes are dropped, at every level. */
export const treeForSave = (nodes) =>
  namedNodes(nodes).map((n) => ({
    id: n.id,
    name: n.name.trim(),
    description: n.description || null,
    unit: n.unit || null,
    weightPct: n.weightPct === "" || n.weightPct == null ? null : Number(n.weightPct),
    weightManual: n.weightManual === true,
    ...passThrough(n),
    // Omitted for a leaf, so a leaf reads exactly as it did before nesting existed.
    ...(namedNodes(n.children).length ? { children: treeForSave(n.children) } : {}),
  }));

// ── Addressing ───────────────────────────────────────────────────────────────
//
// A node is addressed by its PATH: the array of child indices from the root, so
// [0, 2, 1] is "second child of the third child of the first activity". Paths are
// used only inside the editor, for the immutable update helpers below — never as
// an identity, which is always the id.

/** Replace the sibling group at `path` via `fn(list) => list`, immutably. */
export function updateGroup(nodes, path, fn) {
  if (!path || path.length === 0) return fn(nodes || []);
  const [i, ...rest] = path;
  return (nodes || []).map((n, idx) => (idx === i
    ? { ...n, children: updateGroup(n.children || [], rest, fn) }
    : n));
}

/** The node at `path`, or null. */
export function nodeAt(nodes, path) {
  let cur = { children: nodes || [] };
  for (const i of path || []) {
    const next = (cur.children || [])[i];
    if (!next) return null;
    cur = next;
  }
  return cur === undefined ? null : cur;
}

/** Add a child under the node at `path`, rebalancing that node's own group. */
export const addChild = (nodes, path) =>
  updateGroup(nodes, path, (group) => distributeWeights([...group, blankNode()]));

/** Add a sibling directly after the node at `path`. */
export function addSibling(nodes, path) {
  const parent = path.slice(0, -1);
  const i = path[path.length - 1];
  return updateGroup(nodes, parent, (group) => distributeWeights(
    [...group.slice(0, i + 1), blankNode(), ...group.slice(i + 1)],
  ));
}

/** Remove the node at `path` — and, with it, its whole subtree. */
export function removeNode(nodes, path) {
  const parent = path.slice(0, -1);
  const i = path[path.length - 1];
  return updateGroup(nodes, parent, (group) =>
    distributeWeights(group.filter((_, idx) => idx !== i)));
}

/**
 * Move the node at `path` one place up or down among its own siblings.
 *
 * Reordering deliberately does NOT touch weights: a weight belongs to the node, not
 * to the position, so moving a row must not silently re-split the group.
 */
export function moveNode(nodes, path, delta) {
  const parent = path.slice(0, -1);
  const i = path[path.length - 1];
  return updateGroup(nodes, parent, (group) => {
    const j = i + delta;
    if (j < 0 || j >= group.length) return group;
    const next = [...group];
    [next[i], next[j]] = [next[j], next[i]];
    return next;
  });
}

/** Set a field on the node at `path`. */
export const updateNode = (nodes, path, key, value) =>
  updateGroup(nodes, path.slice(0, -1), (group) => group.map((n, idx) =>
    (idx === path[path.length - 1] ? { ...n, [key]: value } : n)));

/** Apply a typed weight within the node's own sibling group (pins it, rebalances the rest). */
export const setNodeWeight = (nodes, path, raw) =>
  updateGroup(nodes, path.slice(0, -1), (group) =>
    setWeightAt(group, path[path.length - 1], raw));

/** Unpin and re-split the children of the node at `path` evenly. */
export const resetGroupWeights = (nodes, path) =>
  updateGroup(nodes, path, (group) => resetWeights(group));

// ── Validation ───────────────────────────────────────────────────────────────

/**
 * Validate every sibling group in the tree, each against 100% of its own parent.
 *
 * Returns `{ ok: true }`, or `{ ok: false, error }` naming the SPECIFIC branch —
 * "Under 'Electrical Works › PV Module': …". With a deep tree, "the weights are
 * wrong" is unusable: the user cannot find which of thirty groups it means. The
 * breadcrumb is a message only; it is never an identity.
 *
 * The outermost bad group is reported first, so the user fixes the cause rather
 * than a symptom several levels down.
 */
export function validateTree(nodes, pathLabel = "") {
  const named = namedNodes(nodes);
  if (named.length) {
    const res = validateWeights(named, (n) => n.name);
    if (!res.ok) {
      return {
        ok: false,
        error: pathLabel
          ? `Under "${pathLabel}": ${res.error.replace(/^Scope weights/, "Sub-item weights")}`
          : res.error,
      };
    }
  }
  for (const n of named) {
    const child = validateTree(n.children, pathLabel ? `${pathLabel} › ${n.name}` : n.name);
    if (!child.ok) return child;
  }
  return { ok: true };
}

/** True when this group and everything under it adds up. */
export const treeWeightsOk = (nodes) => validateTree(nodes).ok;

/** True when this one group adds up, ignoring depth — for the per-group banner. */
export const groupWeightsOk = (nodes) => {
  const named = namedNodes(nodes);
  return named.length === 0 || validateWeights(named, (n) => n.name).ok;
};

export const groupSum = (nodes) => weightSum(namedNodes(nodes));

// ── Re-suggest merge ─────────────────────────────────────────────────────────

/** Matching key for a name: trim + lowercase, the same normalisation the server uses. */
export const nameKey = (v) => (v || "").trim().toLowerCase();

/**
 * Fold an incoming (suggested) tree onto the one already on screen, keeping what
 * the existing nodes have accumulated. Mirrors
 * ScopeSubItems.mergePreservingExecutionData on the server.
 *
 * Matching happens WITHIN EACH PARENT and then recurses — never globally by name.
 * A global name match would pair the "Excavation" under Civil with the one under
 * Substation and move a year of progress into the wrong branch, which is precisely
 * what nesting makes possible and this rule prevents.
 *
 * Within a parent: match on `id` first, then fall back to the name among siblings
 * not already claimed. The name fallback is what carries pre-migration nodes and
 * anything typed by hand through their first merge; afterwards they have an id and
 * never depend on the name again. A matched node keeps its id, its stored spelling
 * and its execution data; an unmatched incoming node becomes a new node.
 */
export function mergeTree(existing, incoming) {
  const inc = incoming || [];
  if (!inc.length) return [];

  const byId = new Map();
  const byName = new Map();
  (existing || []).forEach((n) => {
    if (n.id && !byId.has(n.id)) byId.set(n.id, n);
    const k = nameKey(n.name);
    if (k && !byName.has(k)) byName.set(k, n);   // first wins, as on the server
  });

  const claimed = new Set();
  return hydrateTree(inc.map((n) => {
    let was = n.id ? byId.get(n.id) : null;
    if (!was || claimed.has(was)) {
      const byNm = byName.get(nameKey(n.name));
      was = byNm && !claimed.has(byNm) ? byNm : null;
    }
    if (!was) return { ...n, id: undefined, children: mergeTree([], n.children) };
    claimed.add(was);
    return {
      ...n,
      ...passThrough(was),          // progress, budget, dates — never re-derived here
      id: was.id,
      name: was.name,              // the stored spelling wins
      description: n.description || was.description,
      children: mergeTree(was.children, n.children),
    };
  }));
}

// ── Roll-up ──────────────────────────────────────────────────────────────────

/**
 * Roll a numeric field up the tree, bottom-up: a leaf contributes its own value, a
 * parent the weight-weighted average of its children — and those children may be
 * parents themselves, which is what makes the total correct at any depth.
 *
 * Mirrors ScopeSubItems.rollUp on the server so the screen and the stored headline
 * cannot disagree. Children with no positive weight are skipped rather than counted
 * as zero (an unweighted node would drag its whole branch down); if no child in a
 * group carries a weight the group falls back to a plain mean, which is what the
 * single-level version did.
 *
 * @param valueOf leaf → number, so the caller decides where a leaf's value comes
 *                from (a typed field in SIMPLE mode, the summed weekly cells in
 *                DETAILED mode) without this helper knowing about either.
 */
export function rollUp(nodes, valueOf) {
  const list = nodes || [];
  if (!list.length) return null;
  let acc = 0, wsum = 0, plain = 0, plainN = 0;
  for (const n of list) {
    const kids = n.children || [];
    const v = kids.length ? (rollUp(kids, valueOf) ?? 0) : Number(valueOf(n) || 0);
    plain += v; plainN += 1;
    const w = Number(n.weightPct) || 0;
    if (w <= 0) continue;
    acc += v * w; wsum += w;
  }
  if (wsum > 0) return acc / wsum;
  return plainN ? plain / plainN : null;
}

/**
 * Sum a field the way money adds up: a parent is the SUM of its children,
 * recursively, and only a leaf contributes a stored figure. Percentages average,
 * currency adds — keeping these apart is the difference between a project total and
 * nonsense.
 */
export function sumLeaves(nodes, valueOf) {
  let total = 0;
  for (const n of nodes || []) {
    const kids = n.children || [];
    total += kids.length ? sumLeaves(kids, valueOf) : Number(valueOf(n) || 0);
  }
  return total;
}

/** Every leaf in the tree, with its path — the rows progress is actually recorded on. */
export function leaves(nodes, path = []) {
  const out = [];
  (nodes || []).forEach((n, i) => {
    const p = [...path, i];
    if ((n.children || []).length) out.push(...leaves(n.children, p));
    else out.push({ node: n, path: p });
  });
  return out;
}

/** Every node, depth-first, with its path and depth — for flat renderings like Excel. */
export function flatten(nodes, path = [], depth = 1) {
  const out = [];
  (nodes || []).forEach((n, i) => {
    const p = [...path, i];
    out.push({ node: n, path: p, depth });
    out.push(...flatten(n.children, p, depth + 1));
  });
  return out;
}
