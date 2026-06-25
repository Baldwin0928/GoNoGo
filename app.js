const STORAGE_KEY = "gtpl-readiness-v1";

const objectTypes = ["Project", "Campaign", "Hardware", "Document", "Review", "Task", "Test", "Person/Team"];
const statuses = ["Not Started", "In Progress", "Blocked", "Ready", "Complete", "Needs Review", "Invalidated", "Unknown"];
const relationshipTypes = ["requires", "blocks", "invalidates", "owns", "verifies", "depends_on", "derived_from", "replaces", "supersedes", "affects"];
const readyStatuses = new Set(["Ready", "Complete"]);
const SNAP_GRID = 24;
const SNAP_DISTANCE = 14;
const DEFAULT_PROJECT_ID = 1;
const NODE_WIDTH = 200;
const NODE_HEIGHT = 90;
const NODE_CENTER_Y = 45;
const NODE_PAD_X = 14;
const NODE_TITLE_Y = 50;
const NODE_META_Y = 73;
const NODE_DOT_CY = 70;
const NODE_ROW_GAP = 98;
const NODE_COLUMN_GAP = 232;
const MAX_LANE_ROWS = 5;
const STALE_DAYS = 7;

const seedState = {
  objects: [
    object("Hotfire #5", "Campaign", "In Progress", "Prop Lead", "Top-level hotfire campaign readiness gate."),
    object("Engine Rev D", "Hardware", "Ready", "Engine Team", "Installed engine configuration for the campaign."),
    object("Injector Rev C", "Hardware", "Complete", "Injector Team", "Current injector revision used by Engine Rev D."),
    object("Tank Proof Test", "Test", "In Progress", "Structures", "Proof test needed before hotfire operations."),
    object("DAQ Validation", "Test", "In Progress", "Avionics", "Sensor, firmware, and sampling validation."),
    object("Safety Review", "Review", "Complete", "Safety Lead", "Campaign safety review package."),
    object("Leak Check", "Test", "Not Started", "Prop Lead", "Leak check after engine installation."),
    object("Test Procedure Rev C", "Document", "Complete", "Test Director", "Current hotfire run procedure."),
    object("Pressure Transducer Calibration", "Task", "Not Started", "Avionics", "Calibration status for pressure channels."),
    object("Igniter Test", "Test", "Ready", "Ignition", "Ignition subsystem checkout.")
  ],
  dependencies: []
};

seedState.dependencies = [
  dependency(1, 2, "requires", "Hotfire needs the campaign engine configuration."),
  dependency(1, 4, "requires", "Tank proof closes pressure vessel risk."),
  dependency(1, 5, "requires", "DAQ data must be trusted before firing."),
  dependency(1, 6, "requires", "Safety approval is a hard gate."),
  dependency(1, 7, "requires", "Leak check must occur after installation."),
  dependency(1, 8, "requires", "Test director needs final procedure."),
  dependency(2, 3, "requires", "Engine Rev D includes Injector Rev C."),
  dependency(5, 9, "requires", "DAQ validation requires calibrated sensors."),
  dependency(7, 2, "requires", "Leak check is on the installed engine."),
  dependency(1, 10, "requires", "Igniter must be checked before hotfire.")
];

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

function object(name, type, status, owner, description) {
  return {
    id: 0,
    name,
    type,
    status,
    owner,
    description,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
}

function dependency(parentId, childId, relationshipType, notes) {
  return {
    id: 0,
    parentId,
    childId,
    relationshipType,
    notes,
    createdAt: new Date().toISOString()
  };
}

function project(name, key, owner, description) {
  return {
    id: 0,
    name,
    key,
    owner,
    description,
    createdAt: new Date().toISOString()
  };
}

function member(email, name, role, discipline) {
  return {
    id: 0,
    email,
    name,
    role,
    discipline,
    status: "Invited",
    createdAt: new Date().toISOString()
  };
}

function pingRecord(objectId, recipient, message) {
  return {
    id: 0,
    objectId,
    recipient,
    message,
    status: "Queued locally",
    createdAt: new Date().toISOString()
  };
}

function emptyDocumentation() {
  return {
    summary: "",
    body: "",
    links: [],
    updates: [],
    actionItems: []
  };
}

function normalizeDocumentation(docs = {}) {
  return {
    summary: String(docs.summary || ""),
    body: String(docs.body || ""),
    links: Array.isArray(docs.links) ? docs.links.map((link, index) => ({
      id: Number(link.id) || Date.now() + index,
      label: String(link.label || "Link"),
      url: String(link.url || ""),
      createdAt: link.createdAt || new Date().toISOString()
    })) : [],
    updates: Array.isArray(docs.updates) ? docs.updates.map((update, index) => ({
      id: Number(update.id) || Date.now() + index,
      text: String(update.text || ""),
      author: String(update.author || ""),
      createdAt: update.createdAt || new Date().toISOString()
    })).filter((update) => update.text) : [],
    actionItems: Array.isArray(docs.actionItems) ? docs.actionItems.map((action, index) => ({
      id: Number(action.id) || Date.now() + index,
      text: String(action.text || ""),
      done: Boolean(action.done),
      createdAt: action.createdAt || new Date().toISOString(),
      completedAt: action.completedAt || ""
    })).filter((action) => action.text) : []
  };
}

function normalizeSeed(seed) {
  const defaultProject = { ...project("GTPL Dependency Workspace", "GTPL", "Project Lead", "Default workspace for dependency maps."), id: DEFAULT_PROJECT_ID };
  return {
    projects: [defaultProject],
    activeProjectId: DEFAULT_PROJECT_ID,
    members: [],
    pings: [],
    activity: [],
    objects: seed.objects.map((item, index) => ({ ...item, id: index + 1, projectId: DEFAULT_PROJECT_ID, documentation: normalizeDocumentation(item.documentation) })),
    dependencies: seed.dependencies.map((item, index) => ({ ...item, id: index + 1 })),
    layout: {}
  };
}

function blankBoard() {
  return {
    projects: [{ ...project("New Project", "NEW", "", "Blank project workspace."), id: DEFAULT_PROJECT_ID }],
    activeProjectId: DEFAULT_PROJECT_ID,
    members: [],
    pings: [],
    activity: [],
    objects: [
      {
        ...object("New Campaign", "Campaign", "In Progress", "", "Blank campaign readiness target."),
        id: 1,
        projectId: DEFAULT_PROJECT_ID,
        documentation: emptyDocumentation()
      }
    ],
    dependencies: [],
    layout: {}
  };
}

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

function updateHistoryButtons() {
  const undoButton = document.getElementById("undoBtn");
  const redoButton = document.getElementById("redoBtn");
  if (undoButton) undoButton.disabled = undoStack.length === 0;
  if (redoButton) redoButton.disabled = redoStack.length === 0;
}

function byId(id) {
  return state.objects.find((item) => item.id === Number(id));
}

function selectedObjects() {
  return Array.from(selectedObjectIds).map((id) => byId(id)).filter(Boolean);
}

function setPrimarySelection(id, append = false) {
  const objectId = Number(id);
  if (!byId(objectId)) return;
  if (append) {
    if (selectedObjectIds.has(objectId) && selectedObjectIds.size > 1) {
      selectedObjectIds.delete(objectId);
    } else {
      selectedObjectIds.add(objectId);
    }
  } else {
    selectedObjectIds = new Set([objectId]);
  }
  selectedObjectId = objectId;
  activeDocsObjectId = objectId;
}

function activeProject() {
  return state.projects.find((item) => item.id === Number(state.activeProjectId)) || state.projects[0];
}

function projectCampaigns(projectId = state.activeProjectId) {
  return state.objects.filter((item) => item.type === "Campaign" && item.projectId === Number(projectId));
}

function projectObjects(projectId = state.activeProjectId) {
  return state.objects.filter((item) => item.projectId === Number(projectId));
}

function statusClass(status) {
  return `status-${status.toLowerCase().replaceAll(" ", "-")}`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function nextId(items) {
  return items.reduce((max, item) => Math.max(max, item.id), 0) + 1;
}

function deleteObject(id) {
  const objectId = Number(id);
  const campaignId = Number(document.getElementById("campaignSelect").value);
  const item = byId(objectId);
  if (!item) return;
  if (item.type === "Campaign" && state.objects.filter((object) => object.type === "Campaign").length === 1) {
    window.alert("Keep at least one campaign on the board. Use Full board reset to start over.");
    return;
  }
  rememberState();
  state.objects = state.objects.filter((object) => object.id !== objectId);
  state.dependencies = state.dependencies.filter((link) => link.parentId !== objectId && link.childId !== objectId);
  if (state.layout) delete state.layout[objectId];
  if (selectedObjectId === objectId) selectedObjectId = byId(campaignId) ? campaignId : state.objects[0]?.id || null;
  selectedObjectIds.delete(objectId);
  if (selectedObjectId) selectedObjectIds.add(selectedObjectId);
  if (connectSourceId === objectId) connectSourceId = null;
  contextTargetId = null;
  saveState();
  renderAll();
}

function prepareAddBlock(parentId) {
  const target = byId(parentId) || byId(Number(document.getElementById("campaignSelect").value));
  if (!target) return;
  activeInspectorTab = "add";
  if (selectedObjectIds.size <= 1 || !selectedObjectIds.has(target.id)) {
    setPrimarySelection(target.id, false);
  } else {
    selectedObjectId = target.id;
  }
  renderAll();
  const nameInput = document.getElementById("objectName");
  nameInput?.focus();
  nameInput?.select();
}

function connectBlocks(blockerId, blockedId) {
  if (!blockerId || !blockedId || blockerId === blockedId) return;
  rememberState();
  addDependencyLink(blockedId, blockerId, "Created on map: blocker flows to blocked item.");
  saveState();
}

function addDependencyLink(blockedId, blockerId, notes) {
  if (!blockerId || !blockedId || Number(blockerId) === Number(blockedId)) return false;
  const duplicate = state.dependencies.some(
    (link) => link.parentId === Number(blockedId) && link.childId === Number(blockerId) && link.relationshipType === "requires"
  );
  if (duplicate) return false;
  const link = dependency(Number(blockedId), Number(blockerId), "requires", notes);
  link.id = nextId(state.dependencies);
  state.dependencies.push(link);
  return true;
}

function connectBlockToTargets(blockerId, targetIds) {
  const targets = targetIds.map(Number).filter((id) => id && id !== Number(blockerId));
  if (!targets.length) return;
  rememberState();
  let changed = false;
  targets.forEach((targetId) => {
    changed = addDependencyLink(targetId, blockerId, "Created on map: shared blocker flows to selected item.") || changed;
  });
  if (changed) saveState();
}

function graphPoint(event) {
  const graph = document.getElementById("graph");
  if (!graph) return null;
  const rect = graph.getBoundingClientRect();
  return {
    x: (event.clientX - rect.left - panX) / graphZoom,
    y: (event.clientY - rect.top - panY) / graphZoom
  };
}

function moveNode(nodeId, x, y) {
  state.layout = state.layout || {};
  state.layout[nodeId] = { x: Math.round(x), y: Math.max(8, Math.round(y)) };
}

function snapValue(value, guides) {
  const nearby = guides.find((guide) => Math.abs(guide - value) <= SNAP_DISTANCE);
  if (nearby !== undefined) return nearby;
  return Math.round(value / SNAP_GRID) * SNAP_GRID;
}

function snapPoint(nodeId, x, y) {
  const positions = Array.from(document.querySelectorAll("[data-node-id]"))
    .filter((node) => Number(node.dataset.nodeId) !== Number(nodeId))
    .map((node) => {
      const match = (node.getAttribute("transform") || "").match(/translate\(([-\d.]+),\s*([-\d.]+)\)/);
      return match ? { x: Number(match[1]), y: Number(match[2]) } : null;
    })
    .filter(Boolean);
  const xGuides = positions.flatMap((pos) => [pos.x, pos.x + 94, pos.x + 188]);
  const yGuides = positions.flatMap((pos) => [pos.y, pos.y + 38, pos.y + 76]);
  const snappedCenterX = snapValue(x + 94, xGuides);
  const snappedCenterY = snapValue(y + 38, yGuides);
  const snappedX = xGuides.includes(snappedCenterX) ? snappedCenterX - 94 : snapValue(x, positions.map((pos) => pos.x));
  const snappedY = yGuides.includes(snappedCenterY) ? snappedCenterY - 38 : snapValue(y, positions.map((pos) => pos.y));
  return { x: snappedX, y: Math.max(8, snappedY) };
}

function setZoom(nextZoom) {
  const graph = document.getElementById("graph");
  if (!graph) return;
  const rect = graph.getBoundingClientRect();
  const mouseX = rect.width / 2;
  const mouseY = rect.height / 2;
  const oldZoom = graphZoom;
  let newZoom = Math.min(5, Math.max(0.1, Number(nextZoom.toFixed(2))));
  
  panX = mouseX - (mouseX - panX) * (newZoom / oldZoom);
  panY = mouseY - (mouseY - panY) * (newZoom / oldZoom);
  graphZoom = newZoom;
  
  const group = document.getElementById("canvasGroup");
  const pattern = document.getElementById("dotGrid");
  if (group) group.setAttribute("transform", `translate(${panX}, ${panY}) scale(${graphZoom})`);
  if (pattern) pattern.setAttribute("patternTransform", `translate(${panX}, ${panY}) scale(${graphZoom})`);
  
  const zoomLabel = document.getElementById("zoomLabel");
  if (zoomLabel) zoomLabel.textContent = `${Math.round(graphZoom * 100)}%`;
}

function focusSelectedNode() {
  const graph = document.getElementById("graph");
  const node = graph.querySelector(`[data-node-id="${selectedObjectId}"]`);
  if (!node || !graph) return;
  
  const transform = node.getAttribute("transform") || "";
  const match = transform.match(/translate\(([-\d.]+),\s*([-\d.]+)\)/);
  if (!match) return;
  
  const nodeX = Number(match[1]) + NODE_WIDTH / 2;
  const nodeY = Number(match[2]) + NODE_HEIGHT / 2;
  
  const rect = graph.getBoundingClientRect();
  panX = rect.width / 2 - nodeX * graphZoom;
  panY = rect.height / 2 - nodeY * graphZoom;
  renderAll();
}

function showPage(page) {
  activePage = page;
  if (page !== "map" && mapFocusMode) setMapFocusMode(false);
  document.querySelectorAll(".page-view").forEach((view) => view.classList.toggle("is-hidden", view.id !== `${page}Page`));
  document.querySelectorAll("[data-page]").forEach((link) => link.classList.toggle("active", link.dataset.page === page));
  const title = document.getElementById("pageTitle");
  if (title) {
    const titles = { projects: "Projects", teams: "Teams", docs: "Documentation", work: "My work", map: "Dependency map" };
    title.textContent = titles[page] || "Dependency map";
  }
}

function syncMapFocusMode() {
  document.body.classList.toggle("map-focus-mode", mapFocusMode);
  document.body.classList.toggle("map-focus-inspector-collapsed", mapFocusMode && mapInspectorCollapsed);
  const focusButton = document.getElementById("mapFocusModeBtn");
  if (focusButton) {
    focusButton.textContent = mapFocusMode ? "Exit focus" : "Full screen";
    focusButton.title = mapFocusMode ? "Exit focused map workspace" : "Open focused map workspace";
    focusButton.setAttribute("aria-pressed", String(mapFocusMode));
  }
  const drawerButton = document.getElementById("inspectorDrawerToggle");
  if (drawerButton) {
    drawerButton.textContent = mapInspectorCollapsed ? "Show tools" : "Hide tools";
    drawerButton.setAttribute("aria-expanded", String(!mapInspectorCollapsed));
  }
}

function setMapFocusMode(enabled) {
  mapFocusMode = Boolean(enabled);
  if (!mapFocusMode) mapInspectorCollapsed = false;
  syncMapFocusMode();
  closeCustomSelects();
}

function showInspectorTab(tab) {
  activeInspectorTab = tab;
  document.querySelectorAll("[data-inspector-tab]").forEach((button) => button.classList.toggle("active", button.dataset.inspectorTab === tab));
  document.querySelectorAll("[data-inspector-panel]").forEach((panel) => panel.classList.toggle("is-hidden", panel.dataset.inspectorPanel !== tab));
}

function renderMemberOptions() {
  const datalist = document.getElementById("memberOwnerOptions");
  if (!datalist) return;
  datalist.innerHTML = state.members
    .flatMap((item) => [item.name, item.email, item.discipline].filter(Boolean))
    .filter((value, index, values) => values.indexOf(value) === index)
    .map((value) => `<option value="${escapeHtml(value)}"></option>`)
    .join("");
}

function findMemberForOwner(owner) {
  const value = String(owner || "").trim().toLowerCase();
  if (!value) return null;
  return state.members.find((item) => [item.email, item.name, item.discipline].some((candidate) => String(candidate || "").toLowerCase() === value));
}

function pingOwner(objectId) {
  const item = byId(objectId);
  if (!item) return;
  const recipient = findMemberForOwner(item.owner) || { email: item.owner, name: item.owner };
  if (!recipient.email && !recipient.name) {
    window.alert("Assign an owner first, or add the owner on the Teams page.");
    return;
  }
  rememberState();
  const ping = pingRecord(item.id, recipient.email || recipient.name, `${item.name} needs your attention.`);
  ping.id = nextId(state.pings);
  state.pings.push(ping);
  saveState();
  renderAll();
  window.alert(`Ping queued for ${recipient.email || recipient.name}. Online, this would send an email notification.`);
}

function directDependencies(parentId) {
  return state.dependencies.filter((link) => link.parentId === Number(parentId));
}

function collectDependencies(rootId) {
  const result = [];
  const seen = new Set();

  function visit(parentId, depth) {
    for (const link of directDependencies(parentId)) {
      const child = byId(link.childId);
      if (!child) continue;
      const edgeKey = `${link.parentId}:${link.childId}`;
      result.push({ object: child, link, depth });
      if (seen.has(edgeKey)) continue;
      seen.add(edgeKey);
      visit(child.id, depth + 1);
    }
  }

  visit(Number(rootId), 1);
  const unique = [];
  const usedObjects = new Set();
  for (const item of result) {
    if (usedObjects.has(item.object.id)) continue;
    usedObjects.add(item.object.id);
    unique.push(item);
  }
  return unique;
}

function calculateReadiness(rootId) {
  const dependencies = collectDependencies(rootId);
  const ready = dependencies.filter((item) => readyStatuses.has(item.object.status));
  const blockers = dependencies.filter((item) => !readyStatuses.has(item.object.status));
  const score = dependencies.length ? ready.length / dependencies.length : 1;
  return { dependencies, ready, blockers, score, isReady: blockers.length === 0 };
}

function populateSelect(select, options, valueMapper = (item) => item, labelMapper = (item) => item) {
  select.innerHTML = options.map((item) => `<option value="${escapeHtml(valueMapper(item))}">${escapeHtml(labelMapper(item))}</option>`).join("");
}

function populateObjectSelect(select, filter = () => true) {
  populateSelect(
    select,
    state.objects.filter(filter),
    (item) => item.id,
    (item) => `${item.name} (${item.type})`
  );
}

function syncCustomSelects() {
  document.querySelectorAll(".custom-select").forEach((custom) => custom.remove());
  document.querySelectorAll("select.native-select-hidden").forEach((select) => select.classList.remove("native-select-hidden"));
}

function closeCustomSelects(except = null) {
  document.querySelectorAll(".custom-select.is-open").forEach((custom) => {
    if (custom === except) return;
    custom.classList.remove("is-open");
    custom.querySelector(".custom-select-trigger")?.setAttribute("aria-expanded", "false");
  });
}

function openCustomSelect(custom) {
  const select = document.getElementById(custom.dataset.selectId);
  if (!select || select.disabled) return;
  closeCustomSelects(custom);
  custom.classList.add("is-open");
  custom.querySelector(".custom-select-trigger")?.setAttribute("aria-expanded", "true");
  const selected = custom.querySelector(".custom-select-option.is-selected:not(:disabled)") || custom.querySelector(".custom-select-option:not(:disabled)");
  selected?.focus({ preventScroll: true });
}

function closeCustomSelect(custom, returnFocus = true) {
  custom.classList.remove("is-open");
  const trigger = custom.querySelector(".custom-select-trigger");
  trigger?.setAttribute("aria-expanded", "false");
  if (returnFocus) trigger?.focus({ preventScroll: true });
}

function chooseCustomSelectOption(custom, optionButton) {
  const select = document.getElementById(custom.dataset.selectId);
  if (!select || !optionButton || optionButton.disabled) return;
  const option = select.options[Number(optionButton.dataset.optionIndex)];
  if (!option) return;
  select.value = option.value;
  closeCustomSelect(custom, true);
  select.dispatchEvent(new Event("change", { bubbles: true }));
}

function focusCustomSelectOption(custom, direction) {
  const options = Array.from(custom.querySelectorAll(".custom-select-option:not(:disabled)"));
  if (!options.length) return;
  const active = document.activeElement;
  const index = Math.max(0, options.indexOf(active));
  const nextIndex = direction === "up"
    ? (index - 1 + options.length) % options.length
    : (index + 1) % options.length;
  options[nextIndex].focus({ preventScroll: true });
}

function renderAll() {
  renderProjectOptions();
  renderCampaignOptions();
  renderObjectFormOptions();
  renderDependencyOptions();
  renderObjects();
  renderDependencies();
  renderReadiness();
  renderInspector();
  renderReport();
  renderProjectPage();
  renderTeamPage();
  renderDocumentationPage();
  renderWorkPage();
  renderMemberOptions();
  showInspectorTab(activeInspectorTab);
  syncMapFocusMode();
  syncCustomSelects();
  document.getElementById("dependencyCount").textContent = `${state.dependencies.length} dependencies`;
}

function renderProjectOptions() {
  const projectSelect = document.getElementById("projectSelect");
  const campaignProjectSelect = document.getElementById("campaignProjectSelect");
  if (!projectSelect) return;
  populateSelect(projectSelect, state.projects, (item) => item.id, (item) => `${item.name} (${item.key || "Project"})`);
  projectSelect.value = String(activeProject().id);
  if (campaignProjectSelect) {
    populateSelect(campaignProjectSelect, state.projects, (item) => item.id, (item) => `${item.name} (${item.key || "Project"})`);
    campaignProjectSelect.value = String(activeProject().id);
  }
}

function renderCampaignOptions() {
  const campaigns = projectCampaigns();
  const select = document.getElementById("campaignSelect");
  const current = select.value;
  populateObjectSelect(select, (item) => item.type === "Campaign" && item.projectId === Number(state.activeProjectId));
  if (campaigns.some((item) => String(item.id) === current)) select.value = current;
  if (!campaigns.some((item) => String(item.id) === select.value) && campaigns[0]) {
    select.value = String(campaigns[0].id);
    selectedObjectId = campaigns[0].id;
    selectedObjectIds = new Set([campaigns[0].id]);
  }
}

function renderObjectFormOptions() {
  populateSelect(document.getElementById("objectType"), objectTypes);
  populateSelect(document.getElementById("objectStatus"), statuses);
  document.getElementById("objectType").value = "Task";
}

function renderDependencyOptions() {
  const parentSelect = document.getElementById("parentSelect");
  const childSelect = document.getElementById("childSelect");
  const dependsOnSelect = document.getElementById("dependsOnSelect");
  const attachParentSelect = document.getElementById("attachParentSelect");
  const campaignId = Number(document.getElementById("campaignSelect").value);
  const parentCurrent = parentSelect.value;
  const childCurrent = childSelect.value;
  populateObjectSelect(parentSelect, (item) => item.projectId === Number(state.activeProjectId));
  populateObjectSelect(childSelect, (item) => item.projectId === Number(state.activeProjectId));
  populateObjectSelect(attachParentSelect, (item) => item.projectId === Number(state.activeProjectId));
  const attachTargetId = byId(selectedObjectId) ? selectedObjectId : campaignId;
  if (attachTargetId) attachParentSelect.value = String(attachTargetId);
  const attachTarget = byId(attachTargetId);
  const targets = selectedObjects();
  const multiTarget = targets.length > 1;
  document.getElementById("attachTargetLabel").textContent = multiTarget
    ? `Blocks ${targets.length} selected`
    : attachTarget ? `Blocks ${attachTarget.name}` : "Select target";
  document.getElementById("addBlockBtn").textContent = multiTarget
    ? `Add shared blocker for ${targets.length} blocks`
    : attachTarget ? `Add blocker for ${shorten(attachTarget.name, 16)}` : "Add connected block";
  document.getElementById("attachHint").textContent = multiTarget
    ? `The new block will sit upstream and block: ${targets.map((item) => item.name).join(", ")}.`
    : attachTarget
      ? `The new block will sit upstream and block ${attachTarget.name} until it is Ready or Complete.`
      : "Select a block on the map, then add the blocker that must be cleared first.";
  dependsOnSelect.innerHTML =
    `<option value="">Select existing item</option>` +
    state.objects
      .filter((item) => item.id !== campaignId && item.projectId === Number(state.activeProjectId))
      .map((item) => `<option value="${escapeHtml(item.id)}">${escapeHtml(`${item.name} (${item.type})`)}</option>`)
      .join("");
  if (state.objects.some((item) => String(item.id) === parentCurrent)) {
    parentSelect.value = parentCurrent;
  } else if (campaignId) {
    parentSelect.value = String(campaignId);
  }
  if (state.objects.some((item) => String(item.id) === childCurrent) && childCurrent !== parentSelect.value) {
    childSelect.value = childCurrent;
  } else {
    const child = state.objects.find((item) => item.id !== Number(parentSelect.value));
    if (child) childSelect.value = String(child.id);
  }
  if (dependsOnSelect) dependsOnSelect.value = "";
  populateSelect(document.getElementById("relationshipType"), relationshipTypes);
  document.getElementById("relationshipType").value = "requires";
}

function renderObjects() {
  const tbody = document.getElementById("objectsTable");
  const objects = projectObjects();
  document.getElementById("objectCount").textContent = `${objects.length} objects`;
  if (!objects.length) {
    tbody.innerHTML = document.getElementById("emptyState").innerHTML;
    return;
  }

  tbody.innerHTML = objects
    .map(
      (item) => `
        <tr>
          <td class="name-cell"><strong>${escapeHtml(item.name)}</strong><span>${escapeHtml(item.description || "No description")}</span></td>
          <td><span class="lozenge type-pill">${escapeHtml(item.type)}</span></td>
          <td>${statusSelect(item)}</td>
          <td>${ownerInput(item)}</td>
          <td><button class="row-action" data-delete-object="${item.id}">Delete</button></td>
        </tr>
      `
    )
    .join("");
}

function statusSelect(item) {
  return `
    <select class="inline-status" data-status-id="${item.id}">
      ${statuses.map((status) => `<option value="${escapeHtml(status)}" ${status === item.status ? "selected" : ""}>${escapeHtml(status)}</option>`).join("")}
    </select>
  `;
}

function ownerInput(item) {
  return `<input class="inline-owner" data-owner-id="${item.id}" list="memberOwnerOptions" value="${escapeHtml(item.owner || "")}" />`;
}

function renderDependencies() {
  const tbody = document.getElementById("dependenciesTable");
  const ledgerCount = document.getElementById("ledgerCount");
  if (ledgerCount) ledgerCount.textContent = `${state.dependencies.length} links`;
  if (!state.dependencies.length) {
    tbody.innerHTML = `<tr><td colspan="4" class="empty">No links yet.</td></tr>`;
    return;
  }

  tbody.innerHTML = state.dependencies
    .filter((link) => byId(link.parentId)?.projectId === Number(state.activeProjectId) && byId(link.childId)?.projectId === Number(state.activeProjectId))
    .map((link) => {
      const parent = byId(link.parentId);
      const child = byId(link.childId);
      return `
        <tr>
          <td>${escapeHtml(parent?.name || "Missing object")}</td>
          <td><span class="lozenge type-pill">${escapeHtml(link.relationshipType)}</span></td>
          <td>${escapeHtml(child?.name || "Missing object")}</td>
          <td><button class="row-action" data-delete-dependency="${link.id}">Delete</button></td>
        </tr>
      `;
    })
    .join("");
}

function renderProjectPage() {
  const projectCards = document.getElementById("projectCards");
  if (!projectCards) return;
  document.getElementById("projectCount").textContent = `${state.projects.length} project${state.projects.length === 1 ? "" : "s"}`;
  projectCards.innerHTML = state.projects
    .map((item) => {
      const campaigns = projectCampaigns(item.id);
      const objects = projectObjects(item.id);
      const active = Number(item.id) === Number(state.activeProjectId);
      return `
        <article class="entity-card ${active ? "active" : ""}">
          <div>
            <span class="lozenge type-pill">${escapeHtml(item.key || "Project")}</span>
            <h3>${escapeHtml(item.name)}</h3>
            <p>${escapeHtml(item.description || "No description yet.")}</p>
          </div>
          <dl>
            <div><dt>Maps</dt><dd>${campaigns.length}</dd></div>
            <div><dt>Blocks</dt><dd>${objects.length}</dd></div>
            <div><dt>Owner</dt><dd>${escapeHtml(item.owner || "Unassigned")}</dd></div>
          </dl>
          <button class="button secondary" type="button" data-open-project="${item.id}">${active ? "Current project" : "Open project"}</button>
        </article>
      `;
    })
    .join("");
}

function renderTeamPage() {
  const memberCards = document.getElementById("memberCards");
  if (!memberCards) return;
  document.getElementById("memberCount").textContent = `${state.members.length} member${state.members.length === 1 ? "" : "s"}`;
  if (!state.members.length) {
    memberCards.innerHTML = `<div class="empty-card">No teammates yet. Add email addresses here now; online this becomes invite flow.</div>`;
    return;
  }
  memberCards.innerHTML = state.members
    .map(
      (item) => `
        <article class="entity-card member-card">
          <div>
            <span class="lozenge type-pill">${escapeHtml(item.role)}</span>
            <h3>${escapeHtml(item.name || item.email)}</h3>
            <p>${escapeHtml(item.email)}</p>
          </div>
          <dl>
            <div><dt>Status</dt><dd>${escapeHtml(item.status)}</dd></div>
            <div><dt>Discipline</dt><dd>${escapeHtml(item.discipline || "Unassigned")}</dd></div>
            <div><dt>Pings</dt><dd>${state.pings.filter((ping) => ping.recipient === item.email || ping.recipient === item.name).length}</dd></div>
          </dl>
          <button class="row-action" type="button" data-delete-member="${item.id}">Remove</button>
        </article>
      `
    )
    .join("");
}

function renderDocumentationPage() {
  const select = document.getElementById("docsBlockSelect");
  if (!select) return;
  const objects = projectObjects().sort((a, b) => a.name.localeCompare(b.name));
  const filteredObjects = objects.filter((item) => {
    const matchesSearch = activeDocsSearch
      ? `${item.name} ${item.type} ${item.status} ${item.owner || ""}`.toLowerCase().includes(activeDocsSearch.toLowerCase())
      : true;
    const matchesStatus = activeDocsStatus === "all"
      || (activeDocsStatus === "needs-docs" ? documentationCompleteness(item) < 5 : item.status === activeDocsStatus);
    return matchesSearch && matchesStatus;
  });
  const searchInput = document.getElementById("docsSearchInput");
  if (searchInput && searchInput.value !== activeDocsSearch) searchInput.value = activeDocsSearch;
  const statusFilter = document.getElementById("docsStatusFilter");
  if (statusFilter) statusFilter.value = activeDocsStatus;
  document.getElementById("docsBlockCount").textContent = `${objects.length} block${objects.length === 1 ? "" : "s"}`;
  if (!activeDocsObjectId || !objects.some((item) => item.id === activeDocsObjectId)) {
    activeDocsObjectId = selectedObjectId && objects.some((item) => item.id === selectedObjectId) ? selectedObjectId : objects[0]?.id || null;
  }

  select.innerHTML = objects
    .map((item) => `<option value="${item.id}" ${item.id === activeDocsObjectId ? "selected" : ""}>${escapeHtml(item.name)} (${escapeHtml(item.type)})</option>`)
    .join("");

  const list = document.getElementById("docsBlockList");
  list.innerHTML = filteredObjects.length
    ? filteredObjects.map((item) => {
      const docs = ensureDocumentation(item);
      const openActions = docs.actionItems.filter((action) => !action.done).length;
      const active = item.id === activeDocsObjectId;
      return `
        <button class="doc-block-row ${active ? "active" : ""}" type="button" data-open-doc="${item.id}">
          <strong>${escapeHtml(item.name)}</strong>
          <span>${escapeHtml(item.owner || "Unassigned")} - ${escapeHtml(item.status)}</span>
          <small>${documentationCompleteness(item)}/5 docs ${openActions ? `- ${openActions} open` : ""}</small>
        </button>
      `;
    }).join("")
    : `<div class="empty-card">${objects.length ? "No blocks match that search." : "Create blocks on the map, then document them here."}</div>`;

  const item = byId(activeDocsObjectId);
  const title = document.getElementById("docsTitle");
  const type = document.getElementById("docsType");
  const meta = document.getElementById("docsMeta");
  const summary = document.getElementById("docsSummary");
  const body = document.getElementById("docsBody");
  const actionList = document.getElementById("docActionList");
  const linkList = document.getElementById("docLinkList");
  const updateList = document.getElementById("docUpdateList");
  if (!item) {
    title.textContent = "Select a block";
    type.textContent = "Block";
    meta.innerHTML = "";
    summary.value = "";
    body.value = "";
    actionList.innerHTML = "";
    linkList.innerHTML = "";
    updateList.innerHTML = "";
    return;
  }

  const docs = ensureDocumentation(item);
  const requires = state.dependencies.filter((link) => link.parentId === item.id).map((link) => byId(link.childId)).filter(Boolean);
  const requiredBy = state.dependencies.filter((link) => link.childId === item.id).map((link) => byId(link.parentId)).filter(Boolean);
  const openActions = docs.actionItems.filter((action) => !action.done);

  title.textContent = item.name;
  type.textContent = item.type;
  summary.value = docs.summary;
  body.value = docs.body;
  document.getElementById("docsActionCount").textContent = openActions.length;
  document.getElementById("docsLinkCount").textContent = docs.links.length;
  document.getElementById("docsUpdateCount").textContent = docs.updates.length;
  const savedState = document.getElementById("docsSaveState");
  if (savedState) savedState.textContent = `Saved - Last updated ${formatDate(item.updatedAt || item.createdAt)}`;
  document.querySelectorAll("[data-doc-tool-tab]").forEach((button) => button.classList.toggle("active", button.dataset.docToolTab === activeDocToolTab));
  document.querySelectorAll("[data-doc-tool-panel]").forEach((panel) => panel.classList.toggle("is-hidden", panel.dataset.docToolPanel !== activeDocToolTab));
  meta.innerHTML = `
    <span>${escapeHtml(item.status)}</span>
    <span>${escapeHtml(item.owner || "Unassigned")}</span>
    <span>Updated ${formatDate(item.updatedAt || item.createdAt)}</span>
    <span>${requires.length} blockers</span>
    <span>${requiredBy.length} downstream</span>
    ${isStale(item) ? `<span class="stale-chip">Stale</span>` : ""}
  `;

  actionList.innerHTML = docs.actionItems.length
    ? docs.actionItems.map((action) => `
      <article class="doc-list-item ${action.done ? "done" : ""}">
        <label class="checkline">
          <input type="checkbox" data-toggle-doc-action="${action.id}" ${action.done ? "checked" : ""} />
          <span>${escapeHtml(action.text)}</span>
        </label>
        <button class="row-action" type="button" data-delete-doc-action="${action.id}">Delete</button>
      </article>
    `).join("")
    : `<div class="empty-card">No action items yet.</div>`;

  linkList.innerHTML = docs.links.length
    ? docs.links.map((link) => `
      <article class="doc-list-item">
        <div>
          <strong>${escapeHtml(link.label)}</strong>
          <a href="${escapeHtml(link.url)}" target="_blank" rel="noreferrer">${escapeHtml(link.url)}</a>
        </div>
        <button class="row-action" type="button" data-delete-doc-link="${link.id}">Delete</button>
      </article>
    `).join("")
    : `<div class="empty-card">No links yet.</div>`;

  updateList.innerHTML = docs.updates.length
    ? docs.updates.map((update) => `
      <article class="doc-list-item update-item">
        <div>
          <strong>${formatDate(update.createdAt)}</strong>
          <p>${escapeHtml(update.text)}</p>
        </div>
        <button class="row-action" type="button" data-delete-doc-update="${update.id}">Delete</button>
      </article>
    `).join("")
    : `<div class="empty-card">No updates yet.</div>`;
}

function renderWorkPage() {
  const ownerSelect = document.getElementById("myOwnerSelect");
  if (!ownerSelect) return;
  const objects = projectObjects();
  const owners = Array.from(new Set(objects.map((item) => item.owner).filter(Boolean))).sort();
  ownerSelect.innerHTML = `<option value="all">All owners</option>` + owners.map((owner) => `<option value="${escapeHtml(owner)}">${escapeHtml(owner)}</option>`).join("");
  if (!owners.includes(activeWorkOwner) && activeWorkOwner !== "all") activeWorkOwner = "all";
  ownerSelect.value = activeWorkOwner;
  const statusSelect = document.getElementById("workStatusFilter");
  const sortSelect = document.getElementById("workSortSelect");
  if (statusSelect) statusSelect.value = activeWorkStatus;
  if (sortSelect) sortSelect.value = activeWorkSort;

  const scoped = activeWorkOwner === "all" ? objects : objects.filter((item) => item.owner === activeWorkOwner);
  const ownedOpen = scoped.filter((item) => !readyStatuses.has(item.status));
  const openActions = scoped.flatMap((item) => ensureDocumentation(item).actionItems.filter((action) => !action.done).map((action) => ({ item, action })));
  const stale = scoped.filter((item) => isStale(item) || item.status === "Blocked");
  const visibleOwned = scoped
    .filter((item) => activeWorkStatus === "all" || item.status === activeWorkStatus)
    .sort((a, b) => {
      if (activeWorkSort === "stale-first") return Number(isStale(b) || b.status === "Blocked") - Number(isStale(a) || a.status === "Blocked");
      if (activeWorkSort === "status") return a.status.localeCompare(b.status) || a.name.localeCompare(b.name);
      if (activeWorkSort === "owner") return (a.owner || "Unassigned").localeCompare(b.owner || "Unassigned") || a.name.localeCompare(b.name);
      return new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt);
    });

  document.getElementById("myOwnedCount").textContent = ownedOpen.length;
  document.getElementById("myActionCount").textContent = openActions.length;
  document.getElementById("myStaleCount").textContent = stale.length;
  document.getElementById("myWorkOwnerLabel").textContent = `${activeWorkOwner === "all" ? "All owners" : activeWorkOwner} - ${visibleOwned.length} shown`;

  document.getElementById("myWorkList").innerHTML = visibleOwned.length
    ? visibleOwned.map((item) => workCard(item)).join("")
    : `<div class="empty-card">No blocks match this owner.</div>`;

  document.getElementById("staleWorkList").innerHTML = stale.length
    ? stale.map((item) => workCard(item, true)).join("")
    : `<div class="empty-card">Nothing stale or blocked for this view.</div>`;

  const activity = Array.isArray(state.activity) ? state.activity.slice(0, 40) : [];
  document.getElementById("activityCount").textContent = `${activity.length} event${activity.length === 1 ? "" : "s"}`;
  document.getElementById("activityFeed").innerHTML = activity.length
    ? activity.map((event) => `
      <article class="activity-item">
        <strong>${escapeHtml(event.action)}</strong>
        <span>${escapeHtml(event.objectName || "Workspace")} ${event.details ? `- ${escapeHtml(event.details)}` : ""}</span>
        <small>${formatDate(event.createdAt)}${event.owner ? ` - ${escapeHtml(event.owner)}` : ""}</small>
      </article>
    `).join("")
    : `<div class="empty-card">Activity starts appearing as the team updates blocks.</div>`;
}

function workCard(item, attention = false) {
  const docs = ensureDocumentation(item);
  const openActions = docs.actionItems.filter((action) => !action.done).length;
  return `
    <article class="work-card ${attention ? "attention" : ""}">
      <div>
        <span class="lozenge type-pill">${escapeHtml(item.type)}</span>
        <h3>${escapeHtml(item.name)}</h3>
        <p>${escapeHtml(item.status)} - ${escapeHtml(item.owner || "Unassigned")}</p>
      </div>
      <dl>
        <div><dt>Updated</dt><dd>${formatDate(item.updatedAt || item.createdAt)}</dd></div>
        <div><dt>Docs</dt><dd>${documentationCompleteness(item)}/5</dd></div>
        <div><dt>Actions</dt><dd>${openActions}</dd></div>
      </dl>
      <button class="button secondary" type="button" data-open-doc="${item.id}">Open docs</button>
    </article>
  `;
}

function renderReadiness() {
  const campaignId = Number(document.getElementById("campaignSelect").value);
  const campaign = byId(campaignId);
  const table = document.getElementById("readinessTable");
  if (!campaign) {
    table.innerHTML = document.getElementById("emptyState").innerHTML;
    document.getElementById("readinessScore").textContent = "0%";
    document.getElementById("readinessBar").style.width = "0%";
    document.getElementById("readinessState").textContent = "No campaign";
    document.getElementById("readinessSubtext").textContent = "Create a campaign in this project to start mapping dependencies.";
    document.getElementById("blockerCount").textContent = "0";
    document.getElementById("campaignBadge").textContent = "Setup";
    document.getElementById("campaignHeadline").textContent = "Create a campaign to start.";
    document.getElementById("campaignSummary").textContent = "Use the Projects page to create one or more campaigns under this project.";
    document.getElementById("graph").innerHTML = `<div class="empty-map">No campaign in this project yet. Open Projects and create a campaign to start mapping.</div>`;
    document.getElementById("blockerList").innerHTML = "";
    document.getElementById("nextActions").innerHTML = "";
    return;
  }

  const readiness = calculateReadiness(campaignId);
  const percent = Math.round(readiness.score * 100);
  document.getElementById("readinessScore").textContent = `${percent}%`;
  document.getElementById("readinessBar").style.width = `${percent}%`;
  document.getElementById("readinessState").textContent = readiness.isReady ? "Ready" : "Not ready";
  document.getElementById("readinessSubtext").textContent = readiness.isReady
    ? `${campaign.name} has no open dependency blockers.`
    : `${campaign.name} has ${readiness.blockers.length} blocker${readiness.blockers.length === 1 ? "" : "s"}.`;
  document.getElementById("blockerCount").textContent = readiness.blockers.length;
  document.getElementById("blockerPanelCount").textContent = `${readiness.blockers.length} open`;
  document.getElementById("campaignBadge").textContent = readiness.isReady ? "Ready" : "Not ready";
  document.getElementById("campaignBadge").className = `lozenge ${readiness.isReady ? "status-ready" : "status-blocked"}`;
  document.getElementById("campaignHeadline").textContent = `${campaign.name} is ${readiness.isReady ? "ready." : "not ready."}`;
  document.getElementById("campaignSummary").textContent = readiness.isReady
    ? "All required items are Ready or Complete."
    : `${readiness.blockers.length} item${readiness.blockers.length === 1 ? "" : "s"} still need work before this can proceed.`;
  renderBlockers(readiness.blockers);
  renderNextActions(readiness.blockers);

  const filter = document.getElementById("statusFilter").value;
  let rows = readiness.dependencies;
  if (filter === "blockers") rows = readiness.blockers;
  if (filter === "ready") rows = readiness.ready;

  document.getElementById("queueCount").textContent = `${rows.length} items`;
  table.innerHTML = rows.length
    ? rows.map((item) => readinessRow(item)).join("")
    : `<tr><td colspan="5" class="empty">No dependency items match this view.</td></tr>`;

  renderGraph(campaign, readiness.dependencies);
  renderInspector();
}

function renderBlockers(blockers) {
  const list = document.getElementById("blockerList");
  if (!blockers.length) {
    list.innerHTML = `<div class="empty-card">No blockers. Keep the board updated through test day.</div>`;
    return;
  }

  list.innerHTML = blockers
    .map(
      (item) => `
        <article class="blocker-card">
          <div>
            <strong>${escapeHtml(item.object.name)}</strong>
            <span>${escapeHtml(item.object.type)} required by ${escapeHtml(byId(item.link.parentId)?.name || "Unknown")}</span>
          </div>
          ${statusSelect(item.object)}
          ${ownerInput(item.object)}
        </article>
      `
    )
    .join("");
}

function renderNextActions(blockers) {
  const list = document.getElementById("nextActions");
  if (!blockers.length) {
    list.innerHTML = `<li>Maintain readiness and watch for design or procedure changes.</li>`;
    return;
  }

  list.innerHTML = blockers
    .slice(0, 5)
    .map((item) => `<li>Move ${escapeHtml(item.object.name)} from ${escapeHtml(item.object.status)} to Ready or Complete.</li>`)
    .join("");
}

function readinessRow(item) {
  return `
    <tr>
      <td class="name-cell"><strong>${escapeHtml(item.object.name)}</strong><span>${escapeHtml(item.link.relationshipType)} via ${escapeHtml(byId(item.link.parentId)?.name || "Unknown")}</span></td>
      <td><span class="lozenge type-pill">${escapeHtml(item.object.type)}</span></td>
      <td>${statusSelect(item.object)}</td>
      <td>${ownerInput(item.object)}</td>
      <td>${item.depth === 1 ? "Direct" : `L${item.depth}`}</td>
    </tr>
  `;
}

/**
 * CUSTOM LIGHTWEIGHT SUGIYAMA-STYLE LAYOUT
 * Inspired by ELK Layered, but built natively with zero dependencies.
 * 
 * Missing features compared to full ELK.js:
 * - Full dummy-node insertion for long edge routing
 * - Advanced crossing minimization (e.g., ILP, prolonged sweep heuristics)
 * - Port constraints (explicit input/output attachment points)
 * - Compound nodes (nodes containing other nodes)
 * - Mature, collision-free orthogonal edge routing
 */
function calculateLayeredLayout(nodes, edges) {
  const startMs = performance.now();
  const metrics = { nodes: nodes.length, edges: edges.length, crossings: 0, layers: 0, maxWidth: 0, longEdges: 0, runtimeMs: 0 };
  
  // 1. Cycle Detection (DFS)
  const adj = new Map(nodes.map(n => [n.id, []]));
  const edgeMap = new Map();
  edges.forEach(e => {
    // Flow is from blocker (childId) to blocked (parentId)
    if (adj.has(e.childId) && adj.has(e.parentId)) {
      adj.get(e.childId).push(e.parentId);
      edgeMap.set(`${e.childId}->${e.parentId}`, e);
    }
  });
  
  const visited = new Set();
  const recStack = new Set();
  const cycles = [];
  const acyclicEdges = [];
  
  function dfs(v, path) {
    visited.add(v);
    recStack.add(v);
    for (const w of adj.get(v)) {
      if (!visited.has(w)) {
        dfs(w, [...path, w]);
        acyclicEdges.push({ source: v, target: w });
      } else if (recStack.has(w)) {
        cycles.push([...path, w]);
      } else {
        acyclicEdges.push({ source: v, target: w });
      }
    }
    recStack.delete(v);
  }
  
  nodes.forEach(n => {
    if (!visited.has(n.id)) dfs(n.id, [n.id]);
  });
  
  // 2. Layer Assignment (Longest Path to Root)
  const inDegree = new Map(nodes.map(n => [n.id, 0]));
  const outAdj = new Map(nodes.map(n => [n.id, []]));
  acyclicEdges.forEach(e => {
    inDegree.set(e.target, inDegree.get(e.target) + 1);
    outAdj.get(e.source).push(e.target);
  });
  
  // Topological sort to find longest path
  let queue = nodes.filter(n => inDegree.get(n.id) === 0).map(n => n.id);
  const topoOrder = [];
  while (queue.length > 0) {
    const u = queue.shift();
    topoOrder.push(u);
    outAdj.get(u).forEach(v => {
      inDegree.set(v, inDegree.get(v) - 1);
      if (inDegree.get(v) === 0) queue.push(v);
    });
  }
  
  const distToRoot = new Map();
  nodes.forEach(n => distToRoot.set(n.id, 0));
  
  // Reverse topological order to compute max distance to the end (root)
  for (let i = topoOrder.length - 1; i >= 0; i--) {
    const u = topoOrder[i];
    let maxDist = 0;
    outAdj.get(u).forEach(v => {
      maxDist = Math.max(maxDist, distToRoot.get(v) + 1);
    });
    distToRoot.set(u, maxDist);
  }
  
  const maxDepth = Math.max(0, ...Array.from(distToRoot.values()));
  const totalLayersCount = isNaN(maxDepth) || maxDepth < 0 ? 1 : maxDepth + 1;
  metrics.layers = totalLayersCount;
  
  // Group nodes by layer
  const layers = Array.from({length: totalLayersCount}, () => []);
  const layerMap = new Map();
  nodes.forEach(n => {
    // Distance to root determines column. Root is at maxDepth (rightmost).
    // Blockers are at lower columns (leftmost).
    let l = maxDepth - (distToRoot.get(n.id) || 0);
    if (isNaN(l) || l < 0) l = 0;
    if (l >= totalLayersCount) l = totalLayersCount - 1;
    layers[l].push(n);
    layerMap.set(n.id, l);
  });
  
  metrics.maxWidth = Math.max(0, ...layers.map(l => l.length));
  
  acyclicEdges.forEach(e => {
    const targetLayer = layerMap.get(e.target);
    const sourceLayer = layerMap.get(e.source);
    if (typeof targetLayer === 'number' && typeof sourceLayer === 'number' && (targetLayer - sourceLayer > 1)) {
      metrics.longEdges++;
    }
  });
  
  // 3. Crossing Reduction (Multiple Sweeps)
  layers.forEach(layer => layer.sort((a, b) => a.id - b.id)); // Deterministic initial sort
  
  function getCrossings(layerConfig) {
    let cross = 0;
    for (let i = 0; i < layerConfig.length - 1; i++) {
      const l1 = layerConfig[i];
      const l2 = layerConfig[i+1];
      const l1Pos = new Map(l1.map((n, idx) => [n.id, idx]));
      const l2Pos = new Map(l2.map((n, idx) => [n.id, idx]));
      const layerEdges = acyclicEdges.filter(e => l1Pos.has(e.source) && l2Pos.has(e.target));
      
      for (let j = 0; j < layerEdges.length; j++) {
        for (let k = j + 1; k < layerEdges.length; k++) {
          const e1 = layerEdges[j];
          const e2 = layerEdges[k];
          const s1 = l1Pos.get(e1.source), t1 = l2Pos.get(e1.target);
          const s2 = l1Pos.get(e2.source), t2 = l2Pos.get(e2.target);
          if ((s1 < s2 && t1 > t2) || (s1 > s2 && t1 < t2)) cross++;
        }
      }
    }
    return cross;
  }
  
  let bestCrossings = getCrossings(layers);
  let bestLayers = layers.map(l => [...l]);
  
  const MAX_SWEEPS = 8;
  for (let sweep = 0; sweep < MAX_SWEEPS; sweep++) {
    // Forward sweep
    for (let i = 1; i < layers.length; i++) {
      const prevPos = new Map(layers[i-1].map((n, idx) => [n.id, idx]));
      layers[i].forEach(n => {
        const parents = acyclicEdges.filter(e => e.target === n.id && prevPos.has(e.source)).map(e => prevPos.get(e.source));
        n._bary = parents.length ? parents.reduce((a,b)=>a+b,0)/parents.length : n.id * 0.0001;
      });
      layers[i].sort((a, b) => a._bary - b._bary);
    }
    
    // Backward sweep
    for (let i = layers.length - 2; i >= 0; i--) {
      const nextPos = new Map(layers[i+1].map((n, idx) => [n.id, idx]));
      layers[i].forEach(n => {
        const children = acyclicEdges.filter(e => e.source === n.id && nextPos.has(e.target)).map(e => nextPos.get(e.target));
        n._bary = children.length ? children.reduce((a,b)=>a+b,0)/children.length : n.id * 0.0001;
      });
      layers[i].sort((a, b) => a._bary - b._bary);
    }
    
    const currentCrossings = getCrossings(layers);
    if (currentCrossings < bestCrossings) {
      bestCrossings = currentCrossings;
      bestLayers = layers.map(l => [...l]);
    }
  }
  metrics.crossings = bestCrossings;
  
  // 4. Coordinate Assignment
  const positions = new Map();
  const centerY = 318;
  
  // Assign initial Y evenly to preserve crossing reduction order
  bestLayers.forEach(layer => {
    layer.forEach((n, idx) => {
      n._idealY = idx * NODE_ROW_GAP;
    });
    const avgY = (layer.length - 1) * NODE_ROW_GAP / 2;
    layer.forEach(n => n._idealY -= avgY);
  });
  
  function applyTargetY(nodes) {
    if (nodes.length === 0) return;
    nodes.forEach(n => n._idealY = n._targetY);
    nodes.sort((a,b) => a._idealY - b._idealY);
    
    // Resolve overlaps
    for (let j = 1; j < nodes.length; j++) {
      if (nodes[j]._idealY < nodes[j-1]._idealY + NODE_ROW_GAP) {
        nodes[j]._idealY = nodes[j-1]._idealY + NODE_ROW_GAP;
      }
    }
    
    // Shift block to maintain its target center of mass
    const currentSum = nodes.reduce((a,b) => a + b._idealY, 0);
    const targetSum = nodes.reduce((a,b) => a + b._targetY, 0);
    const drift = (currentSum - targetSum) / nodes.length;
    nodes.forEach(n => n._idealY -= drift);
  }
  
  // Resolve overlaps & align to parents and children (alternating sweeps)
  // We do backward sweep first so the root node (rightmost) acts as the anchor,
  // and the left nodes branch out from it, creating a perfect tree shape.
  for (let sweep = 0; sweep < 4; sweep++) {
    // Backward sweep (Right to Left)
    for (let i = bestLayers.length - 2; i >= 0; i--) {
      bestLayers[i].forEach(n => {
        const children = acyclicEdges.filter(e => e.source === n.id && bestLayers[i+1].find(c => c.id === e.target))
          .map(e => bestLayers[i+1].find(c => c.id === e.target)._idealY);
        if (children.length) {
          n._targetY = children.reduce((a,b)=>a+b,0)/children.length;
        } else {
          n._targetY = n._idealY;
        }
      });
      applyTargetY(bestLayers[i]);
    }
    
    // Forward sweep (Left to Right)
    for (let i = 1; i < bestLayers.length; i++) {
      bestLayers[i].forEach(n => {
        const parents = acyclicEdges.filter(e => e.target === n.id && bestLayers[i-1].find(p => p.id === e.source))
          .map(e => bestLayers[i-1].find(p => p.id === e.source)._idealY);
        if (parents.length) {
          n._targetY = parents.reduce((a,b)=>a+b,0)/parents.length;
        } else {
          n._targetY = n._idealY;
        }
      });
      applyTargetY(bestLayers[i]);
    }
  }

  // Add a final backward sweep to guarantee the leaf nodes branch out symmetrically from the root
  for (let i = bestLayers.length - 2; i >= 0; i--) {
    bestLayers[i].forEach(n => {
      const children = acyclicEdges.filter(e => e.source === n.id && bestLayers[i+1].find(c => c.id === e.target))
        .map(e => bestLayers[i+1].find(c => c.id === e.target)._idealY);
      if (children.length) {
        n._targetY = children.reduce((a,b)=>a+b,0)/children.length;
      } else {
        n._targetY = n._idealY;
      }
    });
    applyTargetY(bestLayers[i]);
  }
  // Calculate global center of mass of the root layer to avoid global drift
  const rootLayer = bestLayers[bestLayers.length - 1];
  const rootDrift = rootLayer && rootLayer.length ? rootLayer.reduce((a,b)=>a+b._idealY, 0) / rootLayer.length : 0;
  if (rootDrift !== 0) {
    bestLayers.forEach(layer => layer.forEach(n => n._idealY -= rootDrift));
  }
  
  const totalLayers = bestLayers.length;
  bestLayers.forEach((layer, layerIdx) => {
    // We want the highest layer index (roots) on the right
    const colIndex = layerIdx; 
    layer.forEach(n => {
      const x = 32 + colIndex * NODE_COLUMN_GAP;
      const y = centerY + (n._idealY || 0); // fallback to 0 if NaN just in case
      positions.set(n.id, { x, y });
    });
  });

  // Propagate alignment from the campaign side back to the blockers.
  // This is intentionally edge-local: unrelated branches in the same column should
  // not shove each other around. Nodes with the same downstream target set are
  // centered as a group around that target-set centroid.
  const outgoingTargets = acyclicEdges.reduce((groups, edge) => {
    if (!positions.has(edge.source) || !positions.has(edge.target)) return groups;
    const list = groups.get(edge.source) || [];
    list.push(edge.target);
    groups.set(edge.source, list);
    return groups;
  }, new Map());
  const layersByIndex = Array.from({ length: totalLayers }, () => []);
  positions.forEach((pos, id) => {
    const layerIndex = layerMap.get(id);
    if (typeof layerIndex === "number") layersByIndex[layerIndex].push(id);
  });
  for (let layerIndex = totalLayers - 2; layerIndex >= 0; layerIndex--) {
    const groups = new Map();
    layersByIndex[layerIndex].forEach((nodeId) => {
      const targets = Array.from(new Set(outgoingTargets.get(nodeId) || [])).sort((a, b) => a - b);
      if (!targets.length) return;
      const key = targets.join("|");
      const group = groups.get(key) || { targets, nodes: [] };
      group.nodes.push(nodeId);
      groups.set(key, group);
    });
    groups.forEach((group) => {
      const targetPositions = group.targets.map((targetId) => positions.get(targetId)).filter(Boolean);
      if (!targetPositions.length) return;
      const centroidY = targetPositions.reduce((sum, pos) => sum + pos.y + NODE_CENTER_Y, 0) / targetPositions.length - NODE_CENTER_Y;
      group.nodes.sort((a, b) => (positions.get(a)?.y || 0) - (positions.get(b)?.y || 0) || a - b);
      const startY = centroidY - ((group.nodes.length - 1) * NODE_ROW_GAP) / 2;
      group.nodes.forEach((nodeId, index) => {
        const pos = positions.get(nodeId);
        if (!pos) return;
        positions.set(nodeId, { ...pos, y: startY + index * NODE_ROW_GAP });
      });
    });
  }
  
  // Prevent going off top edge
  const yValues = Array.from(positions.values()).map(p => p.y).filter(y => typeof y === 'number' && !isNaN(y));
  if (yValues.length > 0) {
    const minY = Math.min(0, ...yValues);
    if (minY < 28) {
      const offset = 28 - minY;
      positions.forEach(pos => {
        if (pos && typeof pos.y === 'number' && !isNaN(pos.y)) {
          pos.y += offset;
        }
      });
    }
  }
  
  metrics.runtimeMs = performance.now() - startMs;
  return { positions, metrics, cycles };
}

function getLayoutPositions(uniqueNodes, edges, useSaved = true) {
  // If the user's saved layout was poisoned with NaN by the old buggy algorithm, force recalculate
  const hasPoisonedData = uniqueNodes.some(n => {
    const pos = state.layout?.[n.id];
    return pos && (isNaN(pos.x) || isNaN(pos.y));
  });
  
  const missing = uniqueNodes.some(n => !state.layout?.[n.id]);
  
  if (!useSaved || missing || hasPoisonedData) {
    const layoutResult = calculateLayeredLayout(uniqueNodes, edges);
    state.layout = state.layout || {};
    layoutResult.positions.forEach((pos, id) => {
      if (!useSaved || !state.layout[id]) {
        state.layout[id] = pos;
      }
    });
    
    const warningsDiv = document.getElementById("layoutWarnings");
    if (warningsDiv && layoutResult.cycles.length > 0) {
      const cycleStr = layoutResult.cycles[0].map(id => byId(id)?.name || id).join(" → ");
      warningsDiv.textContent = `Warning: Cycle detected (${cycleStr})`;
      warningsDiv.classList.remove("is-hidden");
    } else if (warningsDiv) {
      warningsDiv.classList.add("is-hidden");
    }
  }
  const positions = new Map();
  uniqueNodes.forEach(n => positions.set(n.id, state.layout[n.id]));
  return positions;
}

function animateLayout(newPositions) {
  const duration = 400;
  const startTime = performance.now();
  const oldPositions = new Map();
  
  document.querySelectorAll('.graph-node').forEach(el => {
    const id = Number(el.dataset.nodeId);
    const transform = el.getAttribute('transform');
    if (transform) {
      const match = transform.match(/translate\(([\d.-]+),\s*([\d.-]+)\)/);
      if (match) {
        const x = Number(match[1]);
        const y = Number(match[2]);
        if (!isNaN(x) && !isNaN(y)) {
          oldPositions.set(id, { x, y });
        }
      }
    }
  });

  function step(now) {
    const progress = Math.min(1, (now - startTime) / duration);
    const ease = 1 - Math.pow(1 - progress, 3); // easeOutCubic
    
    newPositions.forEach((targetPos, id) => {
      const oldPos = oldPositions.get(id) || targetPos;
      
      // Safety check to absolutely prevent NaN from entering the state cache
      const newX = oldPos.x + (targetPos.x - oldPos.x) * ease;
      const newY = oldPos.y + (targetPos.y - oldPos.y) * ease;
      
      if (!isNaN(newX) && !isNaN(newY)) {
        state.layout[id] = { x: newX, y: newY };
      }
    });
    
    renderAll();
    
    if (progress < 1) {
      requestAnimationFrame(step);
    } else {
      newPositions.forEach((pos, id) => {
        if (!isNaN(pos.x) && !isNaN(pos.y)) {
          state.layout[id] = { x: pos.x, y: pos.y };
        }
      });
      saveState();
      renderAll();
    }
  }
  requestAnimationFrame(step);
}

function renderGraph(root, deps) {
  const graph = document.getElementById("graph");
  document.getElementById("zoomLabel").textContent = `${Math.round(graphZoom * 100)}%`;
  const filter = document.getElementById("statusFilter").value;
  
  const allowedIds = new Set([root.id]);
  deps.forEach((item) => {
    if (filter === "blockers" && readyStatuses.has(item.object.status)) return;
    if (filter === "ready" && !readyStatuses.has(item.object.status)) return;
    allowedIds.add(item.object.id);
    allowedIds.add(item.link.parentId);
  });
  
  const nodes = [root, ...deps.map((item) => item.object)].filter((item) => allowedIds.has(item.id));
  const uniqueNodes = Array.from(new Map(nodes.map((item) => [item.id, item])).values());
  const edges = state.dependencies.filter(link => allowedIds.has(link.parentId) && allowedIds.has(link.childId));
  
  const positions = getLayoutPositions(uniqueNodes, edges, true);

  const selectedSet = new Set(selectedObjectIds);
  if (selectedObjectId) selectedSet.add(selectedObjectId);

  const highlightSet = new Set(selectedSet);
  if (selectedSet.size > 0) {
    state.dependencies.forEach(link => {
      if (selectedSet.has(link.parentId)) highlightSet.add(link.childId);
      if (selectedSet.has(link.childId)) highlightSet.add(link.parentId);
    });
  }

  const width = Math.max(760, 300 + Math.max(0, ...Array.from(positions.values()).map((pos) => pos.x || 0)));
  const height = Math.max(620, Math.max(0, ...Array.from(positions.values()).map((pos) => (pos.y || 0) + NODE_HEIGHT + 28)));
  const linkGroups = edges.filter(link => positions.has(link.parentId) && positions.has(link.childId)).reduce((groups, link) => {
    const list = groups.get(link.parentId) || [];
    list.push(link);
    groups.set(link.parentId, list);
    return groups;
  }, new Map());
  const lines = Array.from(linkGroups.entries())
    .map(([blockedId, links]) => {
      const blocked = positions.get(Number(blockedId));
      const endX = blocked.x - 12;
      const endY = blocked.y + NODE_CENTER_Y;
      if (links.length >= 4) {
        const hubX = blocked.x - 52;
        const hubY = endY;
        const feeders = links.map((link) => {
          const blocker = positions.get(link.childId);
          const startX = blocker.x + NODE_WIDTH;
          const startY = blocker.y + NODE_CENTER_Y;
          const curve = Math.max(44, Math.abs(hubX - startX) * 0.35);
          const isHighlight = selectedSet.size === 0 || (highlightSet.has(link.parentId) && highlightSet.has(link.childId));
          return `<path class="graph-line graph-line-feeder${isHighlight ? "" : " dimmed"}" d="M ${startX} ${startY} C ${startX + curve} ${startY}, ${hubX - curve} ${hubY}, ${hubX} ${hubY}" />`;
        }).join("");
        const groupHighlight = selectedSet.size === 0 || highlightSet.has(Number(blockedId));
        return `
          ${feeders}
          <circle class="junction-dot${groupHighlight ? "" : " dimmed"}" cx="${hubX}" cy="${hubY}" r="5"></circle>
          <text class="junction-label${groupHighlight ? "" : " dimmed"}" x="${hubX - 8}" y="${hubY - 12}">${links.length} blockers</text>
          <path class="graph-line graph-line-final${groupHighlight ? "" : " dimmed"}" d="M ${hubX} ${hubY} L ${endX} ${endY}" marker-end="url(#arrow)" />
        `;
      }
      return links.map((link) => {
        const blocker = positions.get(link.childId);
        const startX = blocker.x + NODE_WIDTH;
        const startY = blocker.y + NODE_CENTER_Y;
        const isHighlight = selectedSet.size === 0 || (highlightSet.has(link.parentId) && highlightSet.has(link.childId));
        
        let pathD = "";
        const isLongEdge = (endX - startX) > 400; // Skip multiple layers
        if (isLongEdge) {
          const midX1 = startX + 32;
          const midX2 = endX - 32;
          const safeY = Math.max(startY, endY) + 110; // Route below nodes
          pathD = `M ${startX} ${startY} C ${midX1} ${startY}, ${midX1} ${safeY}, ${midX1 + 32} ${safeY} L ${midX2 - 32} ${safeY} C ${midX2} ${safeY}, ${midX2} ${endY}, ${endX} ${endY}`;
        } else {
          const curve = Math.max(54, Math.abs(endX - startX) * 0.42);
          pathD = `M ${startX} ${startY} C ${startX + curve} ${startY}, ${endX - curve} ${endY}, ${endX} ${endY}`;
        }
        
        const midX = (startX + endX) / 2;
        const midY = isLongEdge ? Math.max(startY, endY) + 110 : (startY + endY) / 2 - 6;
        
        return `
          <path class="graph-line${isHighlight ? "" : " dimmed"}" d="${pathD}" marker-end="url(#arrow)" />
          <text class="edge-label${isHighlight ? "" : " dimmed"}" x="${midX}" y="${midY}">blocks</text>
        `;
      }).join("");
    })
    .join("");

  const nodeMarkup = uniqueNodes
    .map((item) => {
      const pos = positions.get(item.id);
      const isReady = readyStatuses.has(item.status);
      const isSelected = selectedObjectIds.has(item.id) || item.id === selectedObjectId;
      const isHighlight = selectedSet.size === 0 || highlightSet.has(item.id);
      const isSource = item.id === connectSourceId;
      const className = [
        "graph-node",
        isReady ? "ready" : "blocker",
        item.type.toLowerCase().replaceAll("/", "-").replaceAll(" ", "-"),
        isSelected ? "selected" : "",
        !isHighlight ? "dimmed" : "",
        isSource ? "connect-source" : "",
        connectMode && !isSource ? "connect-target" : ""
      ].join(" ");
      const blockers = state.dependencies.filter((link) => link.parentId === item.id).length;
      const statusClass = nodeStatusClass(item.status);
      const chip = nodeTypeChipLayout(item.type);
      const countMarkup = blockers > 0
        ? `<text class="node-count" x="${NODE_WIDTH - NODE_PAD_X}" y="${chip.textY}">${blockers}</text>`
        : "";
      return `
        <g class="${className} ${statusClass}" data-node-id="${item.id}" transform="translate(${pos.x}, ${pos.y})" tabindex="0">
          <defs>
            <clipPath id="node-clip-${item.id}">
              <rect width="${NODE_WIDTH}" height="${NODE_HEIGHT}" rx="16" ry="16"></rect>
            </clipPath>
          </defs>
          <g class="node-surface" clip-path="url(#node-clip-${item.id})">
            <rect class="node-body" width="${NODE_WIDTH}" height="${NODE_HEIGHT}" rx="16" ry="16"></rect>
            <rect class="node-accent" width="${NODE_WIDTH}" height="3.5"></rect>
          </g>
          <rect class="node-type-chip" x="${chip.x}" y="${chip.y}" width="${chip.width}" height="${chip.height}" rx="${chip.rx}"></rect>
          <text class="node-type" x="${chip.textX}" y="${chip.textY}" text-anchor="middle">${escapeSvg(item.type)}</text>
          ${countMarkup}
          <text class="node-title" x="${NODE_PAD_X}" y="${NODE_TITLE_Y}">${escapeSvg(shorten(item.name, 24))}</text>
          <circle class="status-dot" cx="${NODE_PAD_X + 4}" cy="${NODE_DOT_CY}" r="3"></circle>
          <text class="meta" x="${NODE_PAD_X + 12}" y="${NODE_META_Y}">${escapeSvg(item.status)} · ${escapeSvg(item.owner || "Unassigned")}</text>
          <circle class="connect-handle output" data-handle="source" cx="${NODE_WIDTH}" cy="${NODE_CENTER_Y}" r="5"></circle>
          <circle class="connect-handle input" data-handle="target" cx="0" cy="${NODE_CENTER_Y}" r="5"></circle>
        </g>
      `;
    })
    .join("");

  graph.innerHTML = `
    <svg width="100%" height="100%" style="min-height:650px;" role="img" aria-label="Dependency map">
      <defs>
        <pattern id="dotGrid" width="24" height="24" patternUnits="userSpaceOnUse" patternTransform="translate(${panX}, ${panY})">
          <circle cx="2" cy="2" r="1.5" class="grid-dot"></circle>
        </pattern>
        <marker id="arrow" markerWidth="12" markerHeight="12" refX="10" refY="5" orient="auto" markerUnits="strokeWidth">
          <path d="M1,1 L10,5 L1,9" class="arrow-head"></path>
        </marker>
      </defs>
      <rect width="100%" height="100%" fill="url(#dotGrid)" class="grid-bg" />
      <g id="canvasGroup" transform="translate(${panX}, ${panY}) scale(${graphZoom})">
        ${lines}${nodeMarkup}
      </g>
    </svg>
  `;
}

function renderInspector() {
  const item = byId(selectedObjectId);
  const inspector = document.getElementById("inspectorContent");
  const typeLabel = document.getElementById("selectedType");
  if (!item || !inspector) {
    if (inspector) inspector.innerHTML = `<div class="empty-card">Select a block on the map.</div>`;
    if (typeLabel) typeLabel.textContent = "None";
    return;
  }

  selectedObjectId = item.id;
  const multiSelected = selectedObjects();
  if (multiSelected.length > 1) {
    typeLabel.textContent = `${multiSelected.length} selected`;
    inspector.innerHTML = `
      <div class="selected-card multi-selected-card">
        <span class="lozenge type-pill">Multi-select</span>
        <h3>${multiSelected.length} blocks selected</h3>
        <p>A new shared blocker can be attached to all selected blocks at once.</p>
      </div>
      <div class="mini-list selected-target-list">
        <strong>Selected targets</strong>
        ${multiSelected.map((target) => `<span>${escapeHtml(target.name)} <small>${escapeHtml(target.type)} - ${escapeHtml(target.status)}</small></span>`).join("")}
      </div>
      <div class="quick-actions">
        <button class="button" type="button" data-add-shared-blocker="true">Add shared blocker</button>
        <button class="button secondary" type="button" data-clear-multi-select="true">Clear selection</button>
      </div>
    `;
    return;
  }
  typeLabel.textContent = item.type;
  const requiredBy = state.dependencies.filter((link) => link.childId === item.id).map((link) => byId(link.parentId)).filter(Boolean);
  const requires = state.dependencies.filter((link) => link.parentId === item.id).map((link) => byId(link.childId)).filter(Boolean);
  const status = blockColor(item.status);
  const matchedMember = findMemberForOwner(item.owner);
  const pingCount = state.pings.filter((ping) => ping.objectId === item.id).length;
  const docs = ensureDocumentation(item);
  const openActions = docs.actionItems.filter((action) => !action.done);
  const latestUpdate = docs.updates[0];
  const latestActivity = (state.activity || []).find((event) => Number(event.objectId) === Number(item.id));
  inspector.innerHTML = `
    <div class="selected-card" style="border-left-color:${status.border};">
      <span class="lozenge type-pill">${escapeHtml(item.type)}</span>
      <h3>${escapeHtml(item.name)}</h3>
      <p>${escapeHtml(item.status)} - ${escapeHtml(item.owner || "Unassigned")}</p>
    </div>
    <label>Name<input data-edit-name="${item.id}" value="${escapeHtml(item.name)}" /></label>
    <div class="two-col">
      <label>Status${statusSelect(item)}</label>
      <label>Owner${ownerInput(item)}</label>
    </div>
    <label>Notes<input data-edit-description="${item.id}" value="${escapeHtml(item.description || "")}" /></label>
    <div class="owner-assignment">
      <div>
        <strong>${escapeHtml(matchedMember?.name || item.owner || "No owner assigned")}</strong>
        <span>${matchedMember ? escapeHtml(`${matchedMember.role} - ${matchedMember.email}`) : "Add this person in Teams to make future email pings possible."}</span>
      </div>
      <button class="button secondary" type="button" data-ping-owner="${item.id}">Ping owner</button>
    </div>
    <div class="quick-actions">
      <button class="button secondary" type="button" data-add-for="${item.id}">Add blocker</button>
      <button class="button secondary" type="button" data-connect-from="${item.id}">Connect from</button>
      <button class="button secondary" type="button" data-open-doc="${item.id}">Open docs</button>
    </div>
    <section class="block-workspace">
      <div class="workspace-head">
        <div>
          <strong>Block workspace</strong>
          <span>Docs, actions, updates, and context stay with this block.</span>
        </div>
        <span class="workspace-score">${documentationCompleteness(item)}/5 docs</span>
      </div>
      <label>Summary<textarea data-inline-doc-summary data-doc-object="${item.id}" rows="3" placeholder="What is this block and what closes it out?">${escapeHtml(docs.summary)}</textarea></label>
      <label>Engineering notes<textarea data-inline-doc-body data-doc-object="${item.id}" rows="5" placeholder="Current state, open issues, evidence, constraints, handoff notes...">${escapeHtml(docs.body)}</textarea></label>
      <div class="workspace-grid">
        <div class="workspace-panel">
          <div class="workspace-panel-head">
            <strong>Actions</strong>
            <span>${openActions.length} open</span>
          </div>
          <div class="inline-doc-list">
            ${docs.actionItems.length ? docs.actionItems.slice(0, 4).map((action) => `
              <label class="inline-action ${action.done ? "done" : ""}">
                <input type="checkbox" data-toggle-doc-action="${action.id}" data-doc-object="${item.id}" ${action.done ? "checked" : ""} />
                <span>${escapeHtml(action.text)}</span>
              </label>
            `).join("") : `<em>No actions yet.</em>`}
          </div>
          <form class="inline-doc-form" data-inline-action-form="${item.id}">
            <input data-inline-action-text placeholder="Add action item" />
            <button class="button secondary" type="submit">Add</button>
          </form>
        </div>
        <div class="workspace-panel">
          <div class="workspace-panel-head">
            <strong>Updates</strong>
            <span>${docs.updates.length} logged</span>
          </div>
          <div class="inline-update">
            ${latestUpdate ? `<span>${formatDate(latestUpdate.createdAt)}</span><p>${escapeHtml(latestUpdate.text)}</p>` : `<em>No updates yet.</em>`}
          </div>
          <form class="inline-doc-form" data-inline-update-form="${item.id}">
            <input data-inline-update-text placeholder="Log update" />
            <button class="button secondary" type="submit">Log</button>
          </form>
        </div>
      </div>
      <div class="workspace-footer">
        <div>
          <strong>Links</strong>
          <span>${docs.links.length ? docs.links.slice(0, 2).map((link) => `<a href="${escapeHtml(link.url)}" target="_blank" rel="noreferrer">${escapeHtml(link.label)}</a>`).join("") : "<em>No links yet</em>"}</span>
        </div>
        <div>
          <strong>Latest activity</strong>
          <span>${latestActivity ? `${escapeHtml(latestActivity.action)} - ${formatDate(latestActivity.createdAt)}` : "No activity yet"}</span>
        </div>
      </div>
    </section>
    <div class="mini-list compact-mini">
      <strong>Ping history</strong>
      ${pingCount ? `<span>${pingCount} ping${pingCount === 1 ? "" : "s"} queued for this block.</span>` : "<em>No pings yet</em>"}
    </div>
    <div class="mini-list">
      <strong>Blocked by</strong>
      ${requires.length ? requires.map((child) => `<span>${escapeHtml(child.name)}</span>`).join("") : "<em>Nothing yet</em>"}
    </div>
    <div class="mini-list">
      <strong>Blocks</strong>
      ${requiredBy.length ? requiredBy.map((parent) => `<span>${escapeHtml(parent.name)}</span>`).join("") : "<em>Nothing yet</em>"}
    </div>
    <button class="button danger full-width" type="button" data-delete-object="${item.id}">Delete selected block</button>
  `;
}

function escapeSvg(value) {
  return escapeHtml(value);
}

function shorten(value, max) {
  const text = String(value ?? "");
  return text.length > max ? `${text.slice(0, max - 1)}...` : text;
}

function renderReport() {
  const campaignId = Number(document.getElementById("campaignSelect").value);
  const report = buildReport(campaignId);
  document.getElementById("reportOutput").value = report;
}

function buildReport(campaignId) {
  const campaign = byId(campaignId);
  if (!campaign) return "No campaign selected.";
  const readiness = calculateReadiness(campaignId);
  const percent = Math.round(readiness.score * 100);
  const readyItems = readiness.ready.map((item) => `- ${item.object.name}: ${item.object.status}`).join("\n") || "- None";
  const blockers = readiness.blockers.map((item) => `- ${item.object.name}: ${item.object.status} (${item.object.owner || "Unassigned"})`).join("\n") || "- None";
  const notes = readiness.dependencies
    .map((item) => `- ${byId(item.link.parentId)?.name || "Unknown"} ${item.link.relationshipType} ${item.object.name}${item.link.notes ? `: ${item.link.notes}` : ""}`)
    .join("\n") || "- No dependencies recorded.";

  return `${campaign.name} Readiness

Readiness: ${percent}%
Status: ${readiness.isReady ? "Ready" : "Not Ready"}
Owner: ${campaign.owner || "Unassigned"}

Ready Items
${readyItems}

Blockers
${blockers}

Dependency Notes
${notes}

Recommended Next Actions
${readiness.blockers.map((item) => `- Move ${item.object.name} from ${item.object.status} to Ready or Complete.`).join("\n") || "- Maintain current readiness state until test day."}
`;
}

function copyReport() {
  const campaignId = Number(document.getElementById("campaignSelect").value);
  const workbook = buildDiagramWorkbook(campaignId);
  navigator.clipboard?.writeText(document.getElementById("reportOutput").value);
  const blob = new Blob([workbook], { type: "application/vnd.ms-excel" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "gtpl-dependency-diagram.xls";
  a.click();
  URL.revokeObjectURL(url);
}

function excelText(value) {
  return escapeHtml(value).replaceAll("\n", "<br>");
}

function blockColor(status) {
  if (readyStatuses.has(status)) return { border: "#1f845a", fill: "#e3fcef", flag: "#1f845a" };
  if (status === "In Progress" || status === "Needs Review") return { border: "#c25100", fill: "#fff4d6", flag: "#c25100" };
  if (status === "Blocked" || status === "Invalidated") return { border: "#c9372c", fill: "#ffebe6", flag: "#c9372c" };
  return { border: "#5f6c7b", fill: "#f4f5f7", flag: "#5f6c7b" };
}

function nodeStatusClass(status) {
  if (readyStatuses.has(status)) return "status-ready";
  if (status === "In Progress") return "status-in-progress";
  if (status === "Needs Review") return "status-needs-review";
  if (status === "Blocked" || status === "Invalidated") return "status-blocked";
  if (status === "Unknown") return "status-unknown";
  return "status-not-started";
}

function nodeTypeChipLayout(type) {
  const label = type.toUpperCase();
  const charWidth = 5.55;
  const narrowWidth = 3.8;
  const fontSize = 9;
  const letterSpacing = 0.06;
  const padX = 10;
  const chipHeight = 18;
  const rowTop = 12;

  let textWidth = 0;
  for (const ch of label) {
    textWidth += ch === " " || ch === "/" ? narrowWidth : charWidth;
  }
  if (label.length > 1) {
    textWidth += (label.length - 1) * fontSize * letterSpacing;
  }

  const maxWidth = NODE_WIDTH - NODE_PAD_X * 2 - 22;
  const width = Math.min(maxWidth, Math.max(34, Math.ceil(textWidth + padX * 2)));

  return {
    x: NODE_PAD_X,
    y: rowTop,
    width,
    height: chipHeight,
    rx: 6,
    textX: NODE_PAD_X + width / 2,
    textY: rowTop + chipHeight / 2 + 3.2
  };
}

function buildDiagramWorkbook(campaignId) {
  const campaign = byId(campaignId);
  if (!campaign) return "<html><body>No campaign selected.</body></html>";
  const readiness = calculateReadiness(campaignId);
  const percent = Math.round(readiness.score * 100);
  const maxDepth = Math.max(0, ...readiness.dependencies.map((item) => item.depth));
  const columns = Array.from({ length: maxDepth + 1 }, (_, index) => index);
  const byColumn = new Map(columns.map((column) => [column, []]));
  byColumn.get(maxDepth).push(campaign);
  readiness.dependencies.forEach((item) => {
    const column = maxDepth - item.depth;
    byColumn.get(column)?.push(item.object);
  });
  const rowCount = Math.max(...Array.from(byColumn.values()).map((items) => items.length), 1);
  const layoutIndex = new Map();
  columns.forEach((column) => {
    byColumn.get(column)?.forEach((item, row) => layoutIndex.set(item.id, { column, row: row + 1 }));
  });
  const visibleBlocks = [campaign, ...readiness.dependencies.map((item) => item.object)]
    .filter((item, index, items) => items.findIndex((candidate) => candidate.id === item.id) === index)
  const blockRelations = (item) => {
    const blocks = state.dependencies
      .filter((link) => link.childId === item.id)
      .map((link) => byId(link.parentId)?.name)
      .filter(Boolean)
      .join("; ");
    const blockedBy = state.dependencies
      .filter((link) => link.parentId === item.id)
      .map((link) => byId(link.childId)?.name)
      .filter(Boolean)
      .join("; ");
    return { blocks, blockedBy };
  };
  const columnHeaders = columns
    .map((column) => `<th>${column === maxDepth ? "Campaign / blocked gate" : `Blocker level ${maxDepth - column}`}</th>`)
    .join("");
  const diagramRows = Array.from({ length: rowCount }, (_, row) => {
    const cells = columns
      .map((column) => {
        const item = byColumn.get(column)?.[row];
        if (!item) return `<td class="empty-cell"></td>`;
        const colors = blockColor(item.status);
        const relations = blockRelations(item);
        return `
          <td class="block-cell">
            <div class="block-card" style="border-color:${colors.border}; background:${colors.fill};">
              <div class="block-type" style="color:${colors.flag};">${excelText(item.type)}</div>
              <div class="block-name">${excelText(item.name)}</div>
              <div class="block-meta">${excelText(item.status)} | ${excelText(item.owner || "Unassigned")}</div>
              <div class="block-notes">${excelText(item.description || "No notes")}</div>
              <div class="block-link"><b>Blocks:</b> ${excelText(relations.blocks || "Nothing")}</div>
              <div class="block-link"><b>Blocked by:</b> ${excelText(relations.blockedBy || "Nothing")}</div>
            </div>
          </td>
        `;
      })
      .join("");
    return `<tr>${cells}</tr>`;
  }).join("");
  const blockRows = visibleBlocks
    .map((item) => {
      const relations = blockRelations(item);
      const pos = layoutIndex.get(item.id) || { column: "", row: "" };
      return `
        <tr>
          <td>${excelText(item.name)}</td>
          <td>${excelText(item.type)}</td>
          <td>${excelText(item.status)}</td>
          <td>${excelText(item.owner || "Unassigned")}</td>
          <td>${excelText(item.description || "")}</td>
          <td>${excelText(pos.column)}</td>
          <td>${excelText(pos.row)}</td>
          <td>${excelText(relations.blocks)}</td>
          <td>${excelText(relations.blockedBy)}</td>
        </tr>
      `;
    })
    .join("");
  const linkRows = state.dependencies
    .map((link) => {
      const blocked = byId(link.parentId);
      const blocker = byId(link.childId);
      return `
        <tr>
          <td>${excelText(blocker?.name || "Missing block")}</td>
          <td>blocks</td>
          <td>${excelText(blocked?.name || "Missing block")}</td>
          <td>${excelText(`${blocked?.name || "Missing block"} requires ${blocker?.name || "Missing block"}`)}</td>
          <td>${excelText(link.relationshipType)}</td>
          <td>${excelText(link.notes || "")}</td>
        </tr>
      `;
    })
    .join("");

  return `
    <html>
      <head>
        <meta charset="utf-8" />
        <style>
          body { font-family: Montserrat, Aptos, Arial, sans-serif; color: #071225; }
          table { border-collapse: collapse; }
          .title { font-size: 22px; font-weight: 800; background: #040506; color: #ffffff; }
          .summary td { border: 1px solid #d8dee8; padding: 7px 9px; }
          .summary .label { background: #f0ece2; font-weight: 800; text-transform: uppercase; }
          .diagram th { background: #1e3a5f; color: #ffffff; font-weight: 800; padding: 8px; border: 1px solid #0b1220; width: 240px; }
          .diagram td { width: 240px; height: 132px; vertical-align: top; border: 1px solid #d8dee8; padding: 8px; }
          .empty-cell { background: #fbfaf7; }
          .block-card { border: 3px solid #5f6c7b; padding: 9px; min-height: 108px; }
          .block-type { font-size: 10px; font-weight: 800; text-transform: uppercase; }
          .block-name { font-size: 15px; font-weight: 800; margin-top: 5px; }
          .block-meta { font-size: 12px; font-weight: 700; margin-top: 5px; }
          .block-notes { font-size: 11px; margin-top: 6px; color: #334155; }
          .block-link { font-size: 10px; margin-top: 4px; color: #172b4d; }
          .section { font-size: 16px; font-weight: 800; background: #ffd600; color: #040506; }
          .data th { background: #0b1220; color: #ffffff; font-weight: 800; padding: 7px; border: 1px solid #0b1220; }
          .data td { border: 1px solid #d8dee8; padding: 7px; vertical-align: top; }
        </style>
      </head>
      <body>
        <table class="summary">
          <tr><td class="title" colspan="4">GTPL Dependency Block Diagram</td></tr>
          <tr><td class="label">Campaign</td><td>${excelText(campaign.name)}</td><td class="label">Readiness</td><td>${percent}%</td></tr>
          <tr><td class="label">Status</td><td>${readiness.isReady ? "Ready" : "Not Ready"}</td><td class="label">Open blockers</td><td>${readiness.blockers.length}</td></tr>
          <tr><td class="label">Flow</td><td colspan="3">Read left to right: blocker blocks the item to its right. Campaign/final gate is on the right.</td></tr>
        </table>
        <br>
        <table class="diagram">
          <tr>${columnHeaders}</tr>
          ${diagramRows}
        </table>
        <br>
        <table class="data">
          <tr><td class="section" colspan="9">Block Details</td></tr>
          <tr><th>Name</th><th>Class</th><th>Status</th><th>Owner</th><th>Notes</th><th>Visual Column</th><th>Visual Row</th><th>Blocks</th><th>Blocked By</th></tr>
          ${blockRows}
        </table>
        <br>
        <table class="data">
          <tr><td class="section" colspan="6">Dependency Links</td></tr>
          <tr><th>Blocker</th><th>Direction</th><th>Blocked Item</th><th>Saved Rule</th><th>Relation</th><th>Notes</th></tr>
          ${linkRows}
        </table>
      </body>
    </html>
  `;
}

document.addEventListener("submit", (event) => {
  event.preventDefault();

  if (event.target.matches("[data-inline-action-form]")) {
    const item = byId(event.target.dataset.inlineActionForm);
    const input = event.target.querySelector("[data-inline-action-text]");
    const text = input?.value.trim();
    if (!item || !text) return;
    const docs = ensureDocumentation(item);
    rememberState();
    docs.actionItems.unshift({ id: nextDocId(docs.actionItems), text, done: false, createdAt: new Date().toISOString(), completedAt: "" });
    touchObject(item);
    logActivity(item.id, "Action added", text);
    saveState();
    event.target.reset();
    renderAll();
    return;
  }

  if (event.target.matches("[data-inline-update-form]")) {
    const item = byId(event.target.dataset.inlineUpdateForm);
    const input = event.target.querySelector("[data-inline-update-text]");
    const text = input?.value.trim();
    if (!item || !text) return;
    const docs = ensureDocumentation(item);
    rememberState();
    docs.updates.unshift({ id: nextDocId(docs.updates), text, author: item.owner || "", createdAt: new Date().toISOString() });
    touchObject(item);
    logActivity(item.id, "Update logged", text);
    saveState();
    event.target.reset();
    renderAll();
    return;
  }

  if (event.target.id === "docActionForm") {
    const item = byId(activeDocsObjectId);
    const text = document.getElementById("docActionText").value.trim();
    if (!item || !text) return;
    const docs = ensureDocumentation(item);
    rememberState();
    docs.actionItems.unshift({ id: nextDocId(docs.actionItems), text, done: false, createdAt: new Date().toISOString(), completedAt: "" });
    touchObject(item);
    logActivity(item.id, "Action added", text);
    saveState();
    event.target.reset();
    renderAll();
    return;
  }

  if (event.target.id === "docLinkForm") {
    const item = byId(activeDocsObjectId);
    const label = document.getElementById("docLinkLabel").value.trim();
    const url = document.getElementById("docLinkUrl").value.trim();
    if (!item || !url) return;
    const docs = ensureDocumentation(item);
    rememberState();
    docs.links.unshift({ id: nextDocId(docs.links), label: label || "Link", url, createdAt: new Date().toISOString() });
    touchObject(item);
    logActivity(item.id, "Link added", label || url);
    saveState();
    event.target.reset();
    renderAll();
    return;
  }

  if (event.target.id === "docUpdateForm") {
    const item = byId(activeDocsObjectId);
    const text = document.getElementById("docUpdateText").value.trim();
    if (!item || !text) return;
    const docs = ensureDocumentation(item);
    rememberState();
    docs.updates.unshift({ id: nextDocId(docs.updates), text, author: item.owner || "", createdAt: new Date().toISOString() });
    touchObject(item);
    logActivity(item.id, "Update logged", text);
    saveState();
    event.target.reset();
    renderAll();
    return;
  }

  if (event.target.id === "objectForm") {
    const campaignId = Number(document.getElementById("campaignSelect").value);
    const attachParentId = Number(document.getElementById("attachParentSelect").value) || campaignId;
    const targetIds = selectedObjectIds.size > 1 ? Array.from(selectedObjectIds) : [attachParentId];
    const item = object(
      document.getElementById("objectName").value.trim(),
      document.getElementById("objectType").value,
      document.getElementById("objectStatus").value,
      document.getElementById("objectOwner").value.trim(),
      document.getElementById("objectDescription").value.trim()
    );
    item.id = nextId(state.objects);
    item.projectId = Number(state.activeProjectId);
    item.documentation = emptyDocumentation();
    rememberState();
    state.objects.push(item);
    selectedObjectId = item.id;
    selectedObjectIds = new Set([item.id]);
    activeInspectorTab = "selected";
    targetIds.forEach((targetId) => addDependencyLink(targetId, item.id, targetIds.length > 1 ? "Added as a shared blocker for selected map blocks." : "Added from selected map block."));
    if (pendingBlockPosition) {
      moveNode(item.id, pendingBlockPosition.x, pendingBlockPosition.y);
      pendingBlockPosition = null;
    }
    if (document.getElementById("dependsToggle").checked) {
      const dependsOnId = Number(document.getElementById("dependsOnSelect").value);
      if (dependsOnId && dependsOnId !== item.id) {
        const link = dependency(item.id, dependsOnId, "requires", "Added as an upstream requirement.");
        link.id = nextId(state.dependencies);
        state.dependencies.push(link);
      }
    }
    logActivity(item.id, "Block created", item.description || "");
    saveState();
    event.target.reset();
    document.getElementById("dependsOnWrap").classList.add("is-hidden");
    renderAll();
  }

  if (event.target.id === "dependencyForm") {
    const parentId = Number(document.getElementById("parentSelect").value);
    const childId = Number(document.getElementById("childSelect").value);
    const warning = document.getElementById("ruleWarning");
    warning.textContent = "";
    if (parentId === childId) {
      warning.textContent = "Pick two different items. An item cannot require itself.";
      return;
    }
    const duplicate = state.dependencies.some(
      (link) =>
        link.parentId === parentId &&
        link.childId === childId &&
        link.relationshipType === document.getElementById("relationshipType").value
    );
    if (duplicate) {
      warning.textContent = "That rule already exists.";
      return;
    }
    const link = dependency(
      parentId,
      childId,
      document.getElementById("relationshipType").value,
      document.getElementById("dependencyNotes").value.trim()
    );
    link.id = nextId(state.dependencies);
    rememberState();
    state.dependencies.push(link);
    logActivity(parentId, "Dependency added", `${byId(childId)?.name || "Block"} -> ${byId(parentId)?.name || "Block"}`);
    saveState();
    event.target.reset();
    renderAll();
  }

  if (event.target.id === "projectForm") {
    const name = document.getElementById("projectName").value.trim();
    const key = document.getElementById("projectKey").value.trim().toUpperCase() || name.slice(0, 4).toUpperCase();
    const item = project(
      name,
      key,
      document.getElementById("projectOwner").value.trim(),
      document.getElementById("projectDescription").value.trim()
    );
    item.id = nextId(state.projects);
    rememberState();
    state.projects.push(item);
    state.activeProjectId = item.id;
    saveState();
    event.target.reset();
    renderAll();
  }

  if (event.target.id === "campaignForm") {
    const projectId = Number(document.getElementById("campaignProjectSelect").value) || Number(state.activeProjectId);
    const item = object(
      document.getElementById("campaignName").value.trim(),
      "Campaign",
      "In Progress",
      document.getElementById("campaignOwner").value.trim(),
      document.getElementById("campaignDescription").value.trim()
    );
    item.id = nextId(state.objects);
    item.projectId = projectId;
    item.documentation = emptyDocumentation();
    rememberState();
    state.objects.push(item);
    state.activeProjectId = projectId;
    selectedObjectId = item.id;
    selectedObjectIds = new Set([item.id]);
    logActivity(item.id, "Campaign created", item.description || "");
    saveState();
    event.target.reset();
    showPage("map");
    renderAll();
  }

  if (event.target.id === "memberForm") {
    const email = document.getElementById("memberEmail").value.trim();
    const duplicate = state.members.some((item) => item.email.toLowerCase() === email.toLowerCase());
    if (duplicate) {
      window.alert("That email is already in the workspace member list.");
      return;
    }
    const item = member(
      email,
      document.getElementById("memberName").value.trim(),
      document.getElementById("memberRole").value,
      document.getElementById("memberDiscipline").value.trim()
    );
    item.id = nextId(state.members);
    rememberState();
    state.members.push(item);
    saveState();
    event.target.reset();
    renderAll();
  }
});

document.addEventListener("change", (event) => {
  if (event.target.id === "docsBlockSelect") {
    activeDocsObjectId = Number(event.target.value);
    selectedObjectId = activeDocsObjectId;
    selectedObjectIds = new Set([activeDocsObjectId]);
    renderAll();
    return;
  }

  if (event.target.id === "docsStatusFilter") {
    activeDocsStatus = event.target.value;
    renderDocumentationPage();
    return;
  }

  if (event.target.id === "myOwnerSelect") {
    activeWorkOwner = event.target.value;
    renderWorkPage();
    return;
  }

  if (event.target.id === "workStatusFilter") {
    activeWorkStatus = event.target.value;
    renderWorkPage();
    return;
  }

  if (event.target.id === "workSortSelect") {
    activeWorkSort = event.target.value;
    renderWorkPage();
    return;
  }

  if (event.target.matches("[data-doc-summary], [data-doc-body], [data-inline-doc-summary], [data-inline-doc-body]")) {
    const objectId = Number(event.target.dataset.docObject) || activeDocsObjectId;
    const item = byId(objectId);
    if (!item) return;
    const docs = ensureDocumentation(item);
    rememberState();
    if (event.target.matches("[data-doc-summary], [data-inline-doc-summary]")) docs.summary = event.target.value;
    if (event.target.matches("[data-doc-body], [data-inline-doc-body]")) docs.body = event.target.value;
    touchObject(item);
    logActivity(item.id, "Documentation updated", event.target.matches("[data-doc-summary], [data-inline-doc-summary]") ? "Summary edited" : "Engineering notes edited");
    saveState();
    renderAll();
    return;
  }

  if (event.target.matches("[data-toggle-doc-action]")) {
    const objectId = Number(event.target.dataset.docObject) || activeDocsObjectId;
    const item = byId(objectId);
    if (!item) return;
    const docs = ensureDocumentation(item);
    const action = docs.actionItems.find((entry) => entry.id === Number(event.target.dataset.toggleDocAction));
    if (!action) return;
    rememberState();
    action.done = event.target.checked;
    action.completedAt = action.done ? new Date().toISOString() : "";
    touchObject(item);
    logActivity(item.id, action.done ? "Action completed" : "Action reopened", action.text);
    saveState();
    renderAll();
    return;
  }

  if (event.target.id === "projectSelect") {
    state.activeProjectId = Number(event.target.value);
    const firstCampaign = projectCampaigns()[0];
    selectedObjectId = firstCampaign?.id || null;
    selectedObjectIds = selectedObjectId ? new Set([selectedObjectId]) : new Set();
    saveState();
    renderAll();
  }

  if (event.target.id === "campaignSelect" || event.target.id === "statusFilter") {
    if (event.target.id === "campaignSelect") {
      selectedObjectId = Number(event.target.value);
      selectedObjectIds = new Set([selectedObjectId]);
    }
    renderDependencyOptions();
    renderReadiness();
    renderReport();
  }

  if (event.target.id === "attachParentSelect") {
    selectedObjectId = Number(event.target.value);
    selectedObjectIds = new Set([selectedObjectId]);
    renderAll();
  }

  if (event.target.id === "parentSelect") {
    const childSelect = document.getElementById("childSelect");
    if (childSelect.value === event.target.value) {
      const child = state.objects.find((item) => item.id !== Number(event.target.value));
      if (child) childSelect.value = String(child.id);
    }
  }

  if (event.target.id === "dependsToggle") {
    document.getElementById("dependsOnWrap").classList.toggle("is-hidden", !event.target.checked);
  }

  if (event.target.matches("[data-status-id]")) {
    const item = byId(event.target.dataset.statusId);
    if (!item) return;
    const previous = item.status;
    rememberState();
    item.status = event.target.value;
    touchObject(item);
    if (previous !== item.status) logActivity(item.id, "Status changed", `${previous} -> ${item.status}`);
    saveState();
    renderAll();
  }

  if (event.target.matches("[data-edit-name]")) {
    const item = byId(event.target.dataset.editName);
    if (!item) return;
    const previous = item.name;
    rememberState();
    item.name = event.target.value;
    touchObject(item);
    if (previous !== item.name) logActivity(item.id, "Block renamed", `${previous} -> ${item.name}`);
    saveState();
    renderAll();
  }

  if (event.target.matches("[data-edit-description]")) {
    const item = byId(event.target.dataset.editDescription);
    if (!item) return;
    rememberState();
    item.description = event.target.value;
    touchObject(item);
    logActivity(item.id, "Quick notes updated", "");
    saveState();
    renderAll();
  }
});

document.addEventListener("input", (event) => {
  if (event.target.id === "docsSearchInput") {
    activeDocsSearch = event.target.value.trim();
    renderDocumentationPage();
    return;
  }

  if (event.target.matches("[data-owner-id]")) {
    const item = byId(event.target.dataset.ownerId);
    if (!item) return;
    const shouldLog = event.target.dataset.historyCaptured !== "true";
    if (event.target.dataset.historyCaptured !== "true") {
      rememberState();
      event.target.dataset.historyCaptured = "true";
    }
    item.owner = event.target.value;
    touchObject(item);
    if (shouldLog) logActivity(item.id, "Owner edited", item.owner || "Unassigned");
    saveState();
  }
});

document.addEventListener("contextmenu", (event) => {
  const graphNode = event.target.closest("[data-node-id]");
  const menu = document.getElementById("nodeContextMenu");
  if (!graphNode || !menu) {
    menu?.setAttribute("hidden", "");
    contextTargetId = null;
    return;
  }
  event.preventDefault();
  contextTargetId = Number(graphNode.dataset.nodeId);
  setPrimarySelection(contextTargetId, event.shiftKey);
  renderAll();
  menu.style.left = `${event.clientX}px`;
  menu.style.top = `${event.clientY}px`;
  menu.removeAttribute("hidden");
});

// Prevent native middle-click autoscroll completely
document.addEventListener("mousedown", (event) => {
  if (event.button === 1) event.preventDefault();
});

document.addEventListener("pointerdown", (event) => {
  const isLeftClick = event.button === 0;
  const isMiddleClick = event.button === 1;
  
  if (!isLeftClick && !isMiddleClick) return;
  
  if (isMiddleClick) {
    event.preventDefault();
  }

  const graphNode = event.target.closest("[data-node-id]");
  const handle = event.target.closest("[data-handle]");
  
  // Start panning if we middle click anywhere, or left click on the empty canvas background
  if (isMiddleClick || (!graphNode && event.target.closest("svg"))) {
    const svg = event.target.closest("svg");
    if (!svg) return;
    panState = {
      isPanning: true,
      startX: event.clientX - panX,
      startY: event.clientY - panY,
      moved: false
    };
    svg.setPointerCapture(event.pointerId);
    return;
  }

  if (!graphNode || handle) return;
  
  const start = graphPoint(event);
  if (!start) return;
  const nodeId = Number(graphNode.dataset.nodeId);
  const transform = graphNode.getAttribute("transform") || "";
  const match = transform.match(/translate\(([-\d.]+),\s*([-\d.]+)\)/);
  dragState = {
    nodeId,
    node: graphNode,
    startX: start.x,
    startY: start.y,
    originX: match ? Number(match[1]) : 0,
    originY: match ? Number(match[2]) : 0,
    currentX: match ? Number(match[1]) : 0,
    currentY: match ? Number(match[2]) : 0,
    moved: false
  };
  graphNode.setPointerCapture?.(event.pointerId);
});

document.addEventListener("pointermove", (event) => {
  if (panState && panState.isPanning) {
    const nextPanX = event.clientX - panState.startX;
    const nextPanY = event.clientY - panState.startY;
    if (Math.abs(nextPanX - panX) > 2 || Math.abs(nextPanY - panY) > 2) panState.moved = true;
    panX = nextPanX;
    panY = nextPanY;
    const group = document.getElementById("canvasGroup");
    const pattern = document.getElementById("dotGrid");
    if (group) group.setAttribute("transform", `translate(${panX}, ${panY}) scale(${graphZoom})`);
    if (pattern) pattern.setAttribute("patternTransform", `translate(${panX}, ${panY})`);
    return;
  }

  if (!dragState) return;
  const point = graphPoint(event);
  if (!point) return;
  const nextX = dragState.originX + point.x - dragState.startX;
  const nextY = dragState.originY + point.y - dragState.startY;
  if (Math.abs(nextX - dragState.originX) > 2 || Math.abs(nextY - dragState.originY) > 2) dragState.moved = true;
  dragState.currentX = nextX;
  dragState.currentY = Math.max(8, nextY);
  dragState.node.setAttribute("transform", `translate(${dragState.currentX}, ${dragState.currentY})`);
});

document.addEventListener("pointerup", (event) => {
  let wasPanMoved = false;
  if (panState) {
    wasPanMoved = panState.moved;
    panState.isPanning = false;
    panState = null;
  }
  
  if (!wasPanMoved && !dragState && event.target.closest("svg") && !event.target.closest("[data-node-id]")) {
    selectedObjectIds.clear();
    selectedObjectId = null;
    renderAll();
  }

  if (!dragState) return;
  if (dragState.moved) {
    const snapped = snapPoint(dragState.nodeId, dragState.currentX, dragState.currentY);
    rememberState();
    moveNode(dragState.nodeId, snapped.x, snapped.y);
    saveState();
    renderAll();
  }
  dragState = null;
});

document.getElementById("graph").addEventListener("dblclick", (event) => {
  if (event.target.closest("[data-node-id]")) return;
  const point = graphPoint(event);
  if (!point) return;
  pendingBlockPosition = { x: point.x - 94, y: point.y - 38 };
  prepareAddBlock(selectedObjectId || Number(document.getElementById("campaignSelect").value));
});

document.addEventListener("click", (event) => {
  const menu = document.getElementById("nodeContextMenu");
  const customTrigger = event.target.closest(".custom-select-trigger");
  if (customTrigger) {
    const custom = customTrigger.closest(".custom-select");
    if (custom.classList.contains("is-open")) closeCustomSelect(custom, false);
    else openCustomSelect(custom);
    return;
  }

  const customOption = event.target.closest(".custom-select-option");
  if (customOption) {
    chooseCustomSelectOption(customOption.closest(".custom-select"), customOption);
    return;
  }

  if (!event.target.closest(".custom-select")) closeCustomSelects();

  const pageLink = event.target.closest("[data-page]");
  if (pageLink) {
    event.preventDefault();
    showPage(pageLink.dataset.page);
    renderAll();
    return;
  }

  if (event.target.matches("[data-inspector-tab]")) {
    showInspectorTab(event.target.dataset.inspectorTab);
    return;
  }

  if (event.target.matches("[data-doc-tool-tab]")) {
    activeDocToolTab = event.target.dataset.docToolTab;
    renderDocumentationPage();
    return;
  }

  if (event.target.matches("[data-ping-owner]")) {
    pingOwner(Number(event.target.dataset.pingOwner));
    return;
  }

  if (event.target.id === "createProjectShortcut") {
    showPage("projects");
    document.getElementById("projectName")?.focus();
    return;
  }

  if (event.target.id === "mapFocusModeBtn") {
    showPage("map");
    setMapFocusMode(!mapFocusMode);
    return;
  }

  if (event.target.id === "inspectorDrawerToggle") {
    mapInspectorCollapsed = !mapInspectorCollapsed;
    syncMapFocusMode();
    return;
  }

  if (event.target.id === "docsBackToMapBtn") {
    if (activeDocsObjectId) {
      selectedObjectId = activeDocsObjectId;
      selectedObjectIds = new Set([activeDocsObjectId]);
    }
    showPage("map");
    renderAll();
    setTimeout(focusSelectedNode, 0);
    return;
  }

  const openDocButton = event.target.closest("[data-open-doc]");
  if (openDocButton) {
    activeDocsObjectId = Number(openDocButton.dataset.openDoc);
    selectedObjectId = activeDocsObjectId;
    selectedObjectIds = new Set([activeDocsObjectId]);
    showPage("docs");
    renderAll();
    return;
  }

  if (event.target.matches("[data-delete-doc-action]")) {
    const item = byId(activeDocsObjectId);
    if (!item) return;
    const docs = ensureDocumentation(item);
    const action = docs.actionItems.find((entry) => entry.id === Number(event.target.dataset.deleteDocAction));
    rememberState();
    docs.actionItems = docs.actionItems.filter((entry) => entry.id !== Number(event.target.dataset.deleteDocAction));
    touchObject(item);
    logActivity(item.id, "Action deleted", action?.text || "");
    saveState();
    renderAll();
    return;
  }

  if (event.target.matches("[data-delete-doc-link]")) {
    const item = byId(activeDocsObjectId);
    if (!item) return;
    const docs = ensureDocumentation(item);
    const link = docs.links.find((entry) => entry.id === Number(event.target.dataset.deleteDocLink));
    rememberState();
    docs.links = docs.links.filter((entry) => entry.id !== Number(event.target.dataset.deleteDocLink));
    touchObject(item);
    logActivity(item.id, "Link deleted", link?.label || "");
    saveState();
    renderAll();
    return;
  }

  if (event.target.matches("[data-delete-doc-update]")) {
    const item = byId(activeDocsObjectId);
    if (!item) return;
    const docs = ensureDocumentation(item);
    rememberState();
    docs.updates = docs.updates.filter((entry) => entry.id !== Number(event.target.dataset.deleteDocUpdate));
    touchObject(item);
    logActivity(item.id, "Update deleted", "");
    saveState();
    renderAll();
    return;
  }

  if (event.target.matches("[data-open-project]")) {
    state.activeProjectId = Number(event.target.dataset.openProject);
    const firstCampaign = projectCampaigns()[0];
    selectedObjectId = firstCampaign?.id || null;
    selectedObjectIds = selectedObjectId ? new Set([selectedObjectId]) : new Set();
    saveState();
    showPage("map");
    renderAll();
    return;
  }

  if (event.target.matches("[data-delete-member]")) {
    rememberState();
    state.members = state.members.filter((item) => item.id !== Number(event.target.dataset.deleteMember));
    saveState();
    renderAll();
    return;
  }

  if (event.target.id === "contextAddBlock") {
    menu?.setAttribute("hidden", "");
    prepareAddBlock(contextTargetId);
    return;
  }

  if (event.target.id === "contextConnectBlock") {
    menu?.setAttribute("hidden", "");
    connectMode = true;
    connectSourceId = contextTargetId;
    const button = document.getElementById("connectModeBtn");
    button.classList.add("active");
    button.textContent = "Pick blocked item";
    renderAll();
    return;
  }

  if (event.target.id === "contextDeleteBlock") {
    menu?.setAttribute("hidden", "");
    deleteObject(contextTargetId);
    return;
  }

  if (!event.target.closest("#nodeContextMenu")) {
    menu?.setAttribute("hidden", "");
  }

  if (event.target.matches("[data-add-for]")) {
    showInspectorTab("add");
    prepareAddBlock(Number(event.target.dataset.addFor));
    return;
  }

  if (event.target.matches("[data-add-shared-blocker]")) {
    activeInspectorTab = "add";
    showInspectorTab("add");
    renderDependencyOptions();
    document.getElementById("objectName")?.focus();
    return;
  }

  if (event.target.matches("[data-clear-multi-select]")) {
    if (selectedObjectId) selectedObjectIds = new Set([selectedObjectId]);
    renderAll();
    return;
  }

  if (event.target.matches("[data-connect-from]")) {
    connectMode = true;
    connectSourceId = Number(event.target.dataset.connectFrom);
    document.getElementById("connectModeBtn").classList.add("active");
    document.getElementById("connectModeBtn").textContent = "Pick blocked item";
    renderAll();
    return;
  }

  const graphNode = event.target.closest("[data-node-id]");
  if (graphNode) {
    const nodeId = Number(graphNode.dataset.nodeId);
    const handle = event.target.closest("[data-handle]");
    if (handle) {
      if (handle.dataset.handle === "source") {
        if (selectedObjectIds.size > 1 && !selectedObjectIds.has(nodeId)) {
          connectBlockToTargets(nodeId, Array.from(selectedObjectIds));
          selectedObjectId = nodeId;
          selectedObjectIds = new Set([nodeId]);
          connectMode = false;
          connectSourceId = null;
          document.getElementById("connectModeBtn").classList.remove("active");
          document.getElementById("connectModeBtn").textContent = "Connect blocks";
          activeInspectorTab = "selected";
          renderAll();
          return;
        }
        connectMode = true;
        connectSourceId = nodeId;
        document.getElementById("connectModeBtn").classList.add("active");
        document.getElementById("connectModeBtn").textContent = "Pick blocked item";
      } else if (connectMode && connectSourceId) {
        const targets = selectedObjectIds.size > 1 && selectedObjectIds.has(nodeId) ? Array.from(selectedObjectIds) : [nodeId];
        connectBlockToTargets(connectSourceId, targets);
        connectMode = false;
        connectSourceId = null;
        document.getElementById("connectModeBtn").classList.remove("active");
        document.getElementById("connectModeBtn").textContent = "Connect blocks";
      }
      setPrimarySelection(nodeId, event.shiftKey);
      activeInspectorTab = "selected";
      renderAll();
      return;
    }
    if (connectMode) {
      if (!connectSourceId) {
        connectSourceId = nodeId;
      } else if (connectSourceId === nodeId) {
        connectSourceId = null;
      } else {
        const targets = selectedObjectIds.size > 1 && selectedObjectIds.has(nodeId) ? Array.from(selectedObjectIds) : [nodeId];
        connectBlockToTargets(connectSourceId, targets);
        connectSourceId = null;
        connectMode = false;
        document.getElementById("connectModeBtn").classList.remove("active");
        document.getElementById("connectModeBtn").textContent = "Connect blocks";
      }
    }
    setPrimarySelection(nodeId, event.shiftKey);
    activeInspectorTab = "selected";
    renderAll();
    return;
  }

  if (event.target.matches("[data-delete-object]")) {
    const id = Number(event.target.dataset.deleteObject);
    const target = byId(id);
    if (!target) return;
    const confirmed = window.confirm(`Delete ${target.name} and its dependency links?`);
    if (!confirmed) return;
    deleteObject(id);
  }

  if (event.target.matches("[data-delete-dependency]")) {
    const id = Number(event.target.dataset.deleteDependency);
    rememberState();
    state.dependencies = state.dependencies.filter((link) => link.id !== id);
    saveState();
    renderAll();
  }
});

document.getElementById("seedBtn").addEventListener("click", () => {
  rememberState();
  state = normalizeSeed(seedState);
  selectedObjectId = 1;
  selectedObjectIds = new Set([1]);
  connectMode = false;
  connectSourceId = null;
  saveState();
  renderAll();
});

document.getElementById("clearBoardBtn").addEventListener("click", () => {
  const confirmed = window.confirm("Full board reset clears every block and dependency. Start over with a blank campaign?");
  if (!confirmed) return;
  rememberState();
  state = blankBoard();
  selectedObjectId = 1;
  selectedObjectIds = new Set([1]);
  connectMode = false;
  connectSourceId = null;
  saveState();
  renderAll();
});

document.getElementById("exportBtn").addEventListener("click", copyReport);
document.getElementById("undoBtn").addEventListener("click", undo);
document.getElementById("redoBtn").addEventListener("click", redo);

document.getElementById("focusCampaignBtn").addEventListener("click", () => {
  selectedObjectId = Number(document.getElementById("campaignSelect").value);
  selectedObjectIds = new Set([selectedObjectId]);
  renderAll();
  setTimeout(focusSelectedNode, 0);
});

document.getElementById("connectModeBtn").addEventListener("click", () => {
  connectMode = !connectMode;
  connectSourceId = null;
  document.getElementById("connectModeBtn").classList.toggle("active", connectMode);
  document.getElementById("connectModeBtn").textContent = connectMode ? "Pick blocker first" : "Connect blocks";
  renderAll();
});

document.getElementById("zoomOutBtn").addEventListener("click", () => setZoom(graphZoom / 1.2));
document.getElementById("zoomInBtn").addEventListener("click", () => setZoom(graphZoom * 1.2));
document.getElementById("fitMapBtn").addEventListener("click", () => {
  selectedObjectId = selectedObjectId || Number(document.getElementById("campaignSelect").value);
  setZoom(1);
  setTimeout(focusSelectedNode, 0);
});
document.getElementById("stressTestBtn").addEventListener("click", () => {
  if (!confirm("This will clear your current graph. Continue?")) return;
  state.objects = [];
  state.dependencies = [];
  
  const root = object("campaign", "Stress Test Campaign", "Planning");
  root.id = 1000;
  state.objects.push(root);
  
  let prevLayer = [root.id];
  let currentId = 1001;
  
  for (let layer = 0; layer < 6; layer++) {
    const numNodes = 10 + Math.floor(Math.random() * 15);
    const currentLayer = [];
    for (let i = 0; i < numNodes; i++) {
      const type = ["task", "hardware", "document", "test", "review"][Math.floor(Math.random() * 5)];
      const obj = object(type, `Stress Node ${currentId}`, "Not Started");
      obj.id = currentId++;
      state.objects.push(obj);
      currentLayer.push(obj.id);
      
      const numConnections = 1 + Math.floor(Math.random() * 2);
      for (let c = 0; c < numConnections; c++) {
        const parentId = prevLayer[Math.floor(Math.random() * prevLayer.length)];
        const link = dependency(parentId, obj.id, "requires", "Stress link");
        link.id = nextId(state.dependencies);
        state.dependencies.push(link);
      }
    }
    
    // Add long edges occasionally
    if (layer > 1 && currentLayer.length > 0) {
      const link = dependency(1000, currentLayer[0], "requires", "Long edge");
      link.id = nextId(state.dependencies);
      state.dependencies.push(link);
    }
    
    prevLayer = currentLayer;
  }
  
  // Add intentional cycle
  if (prevLayer.length > 0) {
    const cycleStart = prevLayer[0];
    const link = dependency(cycleStart, 1000, "requires", "Cycle edge");
    link.id = nextId(state.dependencies);
    state.dependencies.push(link);
  }
  
  state.layout = {};
  saveState();
  populateDropdowns();
  document.getElementById("campaignSelect").value = root.id;
  renderAll();
  document.getElementById("arrangeMapBtn").click();
});

document.getElementById("arrangeMapBtn").addEventListener("click", () => {
  const campaignId = Number(document.getElementById("campaignSelect").value);
  const campaign = byId(campaignId);
  if (!campaign) return;
  const readiness = calculateReadiness(campaignId);
  
  const allowedIds = new Set([campaignId]);
  readiness.dependencies.forEach(item => { allowedIds.add(item.object.id); allowedIds.add(item.link.parentId); });
  const nodes = [campaign, ...readiness.dependencies.map(item => item.object)].filter(item => allowedIds.has(item.id));
  const uniqueNodes = Array.from(new Map(nodes.map(item => [item.id, item])).values());
  const edges = state.dependencies.filter(link => allowedIds.has(link.parentId) && allowedIds.has(link.childId));
  
  try {
    const layoutResult = calculateLayeredLayout(uniqueNodes, edges);
    
    console.log("--- Layout Quality Metrics ---");
    console.table(layoutResult.metrics);
    
    const warningsDiv = document.getElementById("layoutWarnings");
    if (warningsDiv && layoutResult.cycles.length > 0) {
      const cycleStr = layoutResult.cycles[0].map(id => byId(id)?.name || id).join(" → ");
      warningsDiv.textContent = `Warning: Cycle detected (${cycleStr})`;
      warningsDiv.classList.remove("is-hidden");
    } else if (warningsDiv) {
      warningsDiv.classList.add("is-hidden");
    }
    
    rememberState();
    state.layout = state.layout || {};
    animateLayout(layoutResult.positions);
  } catch (error) {
    const errDiv = document.getElementById("layoutWarnings");
    if (errDiv) {
      errDiv.textContent = `Layout Engine Error: ${error.message}`;
      errDiv.classList.remove("is-hidden");
    }
    console.error(error);
  }
});

document.addEventListener("keydown", (event) => {
  const activeCustom = event.target.closest?.(".custom-select");
  if (activeCustom) {
    if (event.key === "Escape") {
      event.preventDefault();
      closeCustomSelect(activeCustom, true);
      return;
    }
    if (event.target.matches(".custom-select-trigger") && ["ArrowDown", "ArrowUp", "Enter", " "].includes(event.key)) {
      event.preventDefault();
      openCustomSelect(activeCustom);
      return;
    }
    if (event.target.matches(".custom-select-option")) {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        focusCustomSelectOption(activeCustom, event.key === "ArrowUp" ? "up" : "down");
        return;
      }
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        chooseCustomSelectOption(activeCustom, event.target);
        return;
      }
    }
  }

  if (event.key === "Escape" && mapFocusMode) {
    event.preventDefault();
    setMapFocusMode(false);
    return;
  }

  const key = event.key.toLowerCase();
  const isUndo = (event.ctrlKey || event.metaKey) && key === "z" && !event.shiftKey;
  const isRedo = (event.ctrlKey || event.metaKey) && (key === "y" || (key === "z" && event.shiftKey));
  if (!isUndo && !isRedo) return;
  event.preventDefault();
  if (isUndo) undo();
  if (isRedo) redo();
});

document.getElementById("graph").addEventListener("wheel", (event) => {
  event.preventDefault(); // Stop native page scrolling
  
  // Standard web canvas behavior:
  // - Wheel + Ctrl (or Pinch on trackpad): Zoom
  // - Wheel without Ctrl: Pan vertically
  // - Wheel + Shift: Pan horizontally
  
  const isZoom = event.ctrlKey || event.metaKey;

  if (isZoom) {
    const graph = document.getElementById("graph");
    const rect = graph.getBoundingClientRect();
    const mouseX = event.clientX - rect.left;
    const mouseY = event.clientY - rect.top;
    
    const oldZoom = graphZoom;
    // Lowered multiplier from 0.01 to 0.0015 for smoother, less aggressive zooming increments
    let zoomFactor = Math.exp(-event.deltaY * 0.0015);
    let newZoom = Math.min(5, Math.max(0.1, graphZoom * zoomFactor));
    
    panX = mouseX - (mouseX - panX) * (newZoom / oldZoom);
    panY = mouseY - (mouseY - panY) * (newZoom / oldZoom);
    graphZoom = newZoom;
  } else {
    // Panning
    const deltaX = event.shiftKey && event.deltaX === 0 ? event.deltaY : event.deltaX;
    const deltaY = event.shiftKey && event.deltaX === 0 ? 0 : event.deltaY;
    
    panX -= deltaX;
    panY -= deltaY;
  }
  
  // Apply transforms efficiently without a full re-render
  const group = document.getElementById("canvasGroup");
  const pattern = document.getElementById("dotGrid");
  if (group) group.setAttribute("transform", `translate(${panX}, ${panY}) scale(${graphZoom})`);
  if (pattern) pattern.setAttribute("patternTransform", `translate(${panX}, ${panY}) scale(${graphZoom})`);
  
  const zoomLabel = document.getElementById("zoomLabel");
  if (zoomLabel) zoomLabel.textContent = `${Math.round(graphZoom * 100)}%`;
}, { passive: false });

renderAll();
