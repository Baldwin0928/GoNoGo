// Split from app.js - load/save/normalize state and undo/redo history
let state = loadState() || {
  objects: [],
  dependencies: [],
  layout: {}
};

window.onerror = function(message, source, lineno, colno, error) {
  const errDiv = document.getElementById("layoutWarnings");
  if (errDiv) {
    const errorDetails = error && error.stack ? error.stack : message;
    errDiv.textContent = `JS Error: ${message} at line ${lineno}\n${errorDetails}`;
    errDiv.classList.remove("is-hidden");
  }
};
let selectedObjectId = null;
let connectMode = false;
let connectSourceId = null;
let contextTargetId = null;
let graphZoom = 1;
let panX = 40;
let panY = 40;
let panState = null;
let pendingBlockPosition = null;
let dragState = null;
let undoStack = [];
let redoStack = [];
let activePage = "map";
let activeInspectorTab = "selected";
let selectedObjectIds = new Set();
let activeDocsObjectId = null;
let activeDocsSearch = "";
let activeDocsStatus = "all";
let activeDocToolTab = "actions";
let activeWorkOwner = "all";
let activeWorkStatus = "all";
let activeWorkSort = "updated-desc";
let mapFocusMode = false;
let mapInspectorCollapsed = false;

function loadState() {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (!saved) return normalizeSeed(seedState);
  try {
    const parsed = JSON.parse(saved);
    if (!Array.isArray(parsed.objects) || !Array.isArray(parsed.dependencies)) throw new Error("Bad state");
    return normalizeState(parsed);
  } catch {
    return normalizeSeed(seedState);
  }
}

function normalizeState(raw) {
  const fallbackProject = { ...project("GTPL Dependency Workspace", "GTPL", "Project Lead", "Default workspace for dependency maps."), id: DEFAULT_PROJECT_ID };
  const projects = Array.isArray(raw.projects) && raw.projects.length
    ? raw.projects.map((item, index) => ({
      ...item,
      id: Number(item.id) || index + 1,
      name: String(item.name || "Untitled project"),
      key: String(item.key || "Project"),
      owner: String(item.owner || ""),
      description: String(item.description || "")
    }))
    : [fallbackProject];
  const activeProjectId = raw.activeProjectId && projects.some((item) => item.id === Number(raw.activeProjectId)) ? Number(raw.activeProjectId) : projects[0].id;
  const objects = Array.isArray(raw.objects)
    ? raw.objects
      .filter((item) => item && Number.isFinite(Number(item.id)))
      .map((item) => ({
        ...item,
        id: Number(item.id),
        name: String(item.name || "Untitled block"),
        type: objectTypes.includes(item.type) ? item.type : "Task",
        status: statuses.includes(item.status) ? item.status : "Unknown",
        owner: String(item.owner || ""),
        description: String(item.description || ""),
        projectId: Number(item.projectId) || activeProjectId,
        updatedAt: item.updatedAt || item.createdAt || new Date().toISOString(),
        documentation: normalizeDocumentation(item.documentation)
      }))
    : [];
  const objectIds = new Set(objects.map((item) => item.id));
  const dependencies = Array.isArray(raw.dependencies)
    ? raw.dependencies
      .filter((link) => link && Number.isFinite(Number(link.parentId)) && Number.isFinite(Number(link.childId)))
      .filter((link) => objectIds.has(Number(link.parentId)) && objectIds.has(Number(link.childId)))
      .filter((link) => Number(link.parentId) !== Number(link.childId))
      .map((link, index) => ({
        ...link,
        id: Number(link.id) || index + 1,
        parentId: Number(link.parentId),
        childId: Number(link.childId),
        relationshipType: relationshipTypes.includes(link.relationshipType) ? link.relationshipType : "requires",
        notes: String(link.notes || "")
      }))
    : [];
  return {
    ...raw,
    projects,
    activeProjectId,
    members: Array.isArray(raw.members) ? raw.members : [],
    pings: Array.isArray(raw.pings) ? raw.pings : [],
    activity: Array.isArray(raw.activity) ? raw.activity : [],
    objects,
    dependencies,
    layout: raw.layout || {}
  };
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  updateHistoryButtons();
}

function touchObject(item) {
  if (item) item.updatedAt = new Date().toISOString();
}

function ensureDocumentation(item) {
  if (!item) return emptyDocumentation();
  item.documentation = normalizeDocumentation(item.documentation);
  return item.documentation;
}

function nextDocId(list) {
  return list.reduce((max, item) => Math.max(max, Number(item.id) || 0), 0) + 1;
}

function logActivity(objectId, action, details = "") {
  const item = byId(objectId);
  state.activity = Array.isArray(state.activity) ? state.activity : [];
  state.activity.unshift({
    id: Date.now(),
    objectId: Number(objectId) || null,
    objectName: item?.name || "",
    action,
    details,
    owner: item?.owner || "",
    createdAt: new Date().toISOString()
  });
  state.activity = state.activity.slice(0, 120);
}

function formatDate(value) {
  if (!value) return "Never";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown";
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function daysSince(value) {
  const date = new Date(value || 0);
  if (Number.isNaN(date.getTime())) return Infinity;
  return Math.floor((Date.now() - date.getTime()) / 86400000);
}

function isStale(item) {
  return !readyStatuses.has(item.status) && daysSince(item.updatedAt || item.createdAt) >= STALE_DAYS;
}

function markdownLite(value) {
  const lines = String(value || "").split(/\r?\n/);
  if (!lines.some((line) => line.trim())) return `<div class="empty-card">No engineering notes yet.</div>`;
  return lines.map((line) => {
    const trimmed = line.trim();
    if (!trimmed) return "<br>";
    if (trimmed.startsWith("## ")) return `<h4>${escapeHtml(trimmed.slice(3))}</h4>`;
    if (trimmed.startsWith("- ")) return `<p class="doc-bullet">${escapeHtml(trimmed.slice(2))}</p>`;
    return `<p>${escapeHtml(line)}</p>`;
  }).join("");
}

function documentationCompleteness(item) {
  const docs = ensureDocumentation(item);
  let score = 0;
  if (docs.summary.trim()) score++;
  if (docs.body.trim()) score++;
  if (docs.links.length) score++;
  if (docs.updates.length) score++;
  if (docs.actionItems.length) score++;
  return score;
}

function cloneState(value = state) {
  return JSON.parse(JSON.stringify(value));
}

function rememberState() {
  undoStack.push(cloneState());
  if (undoStack.length > 80) undoStack.shift();
  redoStack = [];
  updateHistoryButtons();
}

function restoreState(snapshot) {
  state = { ...cloneState(snapshot), layout: snapshot.layout || {} };
  selectedObjectId = byId(selectedObjectId) ? selectedObjectId : state.objects[0]?.id || null;
  selectedObjectIds = selectedObjectId ? new Set([selectedObjectId]) : new Set();
  connectMode = false;
  connectSourceId = null;
  pendingBlockPosition = null;
  saveState();
  renderAll();
}

function undo() {
  if (!undoStack.length) return;
  redoStack.push(cloneState());
  restoreState(undoStack.pop());
}

function redo() {
  if (!redoStack.length) return;
  undoStack.push(cloneState());
  restoreState(redoStack.pop());
}

