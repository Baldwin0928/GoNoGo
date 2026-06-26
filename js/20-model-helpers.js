// Split from app.js - selection, CRUD helpers, ownership helpers, graph mutation helpers

// Single source of truth for "who is performing this action right now".
// Every revision/audit actor (created by, submitted by, decided by, released by)
// flows through here so accountability is consistent across the app.
//
// LOCAL-FIRST (today): there is no authentication, so we use one stored
// workspace identity (state.currentUser). It defaults to "You" instead of a
// vague "Unknown", and can be overridden by setting state.currentUser.
//
// ONLINE (future): replace the body of this function to return the signed-in
// user's display name (e.g. session.user.name). That single change makes every
// new revision and audit event automatically attribute to the real user.
function currentActor() {
  const name = state && state.currentUser ? String(state.currentUser).trim() : "";
  return name || "You";
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
  selectedDependencyId = null;
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

function highlightMentions(value) {
  return escapeHtml(value).replace(/(@[A-Za-z0-9_.-]+)/g, `<span class="mention-chip">$1</span>`);
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
  if (selectedDependencyId && !state.dependencies.some((link) => Number(link.id) === Number(selectedDependencyId))) selectedDependencyId = null;
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


function openLinkedMap(item) {
  const gate = linkedGateBlock(item);
  if (!item?.linkedProjectId) return;
  linkedMapReturnStack.push({
    projectId: Number(state.activeProjectId),
    campaignId: Number(document.getElementById("campaignSelect")?.value) || null,
    selectedObjectId,
    panX,
    panY,
    graphZoom
  });
  state.activeProjectId = Number(item.linkedProjectId);
  selectedObjectId = gate?.id || projectCampaigns(item.linkedProjectId)[0]?.id || projectObjects(item.linkedProjectId)[0]?.id || null;
  selectedObjectIds = selectedObjectId ? new Set([selectedObjectId]) : new Set();
  selectedDependencyId = null;
  saveState();
  showPage("map");
  renderAll();
  setTimeout(focusSelectedNode, 0);
}

function returnFromLinkedMap() {
  const previous = linkedMapReturnStack.pop();
  if (!previous) return;
  state.activeProjectId = previous.projectId;
  selectedObjectId = previous.selectedObjectId || previous.campaignId || null;
  selectedObjectIds = selectedObjectId ? new Set([selectedObjectId]) : new Set();
  panX = previous.panX;
  panY = previous.panY;
  graphZoom = previous.graphZoom;
  selectedDependencyId = null;
  saveState();
  showPage("map");
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
  document.querySelectorAll("[data-map-focus-toggle]").forEach((focusButton) => {
    focusButton.textContent = mapFocusMode ? "Exit focus" : "Full screen";
    focusButton.title = mapFocusMode ? "Exit focused map workspace" : "Open focused map workspace";
    focusButton.setAttribute("aria-pressed", String(mapFocusMode));
  });
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

