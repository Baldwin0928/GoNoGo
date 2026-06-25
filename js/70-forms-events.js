// Split from app.js - forms, pointer/keyboard handlers, toolbar actions, initial render call
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
  event.preventDefault();
  window.getSelection?.()?.removeAllRanges();
  
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

  if (event.target.closest("[data-map-focus-toggle]")) {
    showPage("map");
    setMapFocusMode(!mapFocusMode);
    return;
  }

  if (event.target.id === "inspectorDrawerToggle") {
    mapInspectorCollapsed = !mapInspectorCollapsed;
    syncMapFocusMode();
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
      const cycleStr = layoutResult.cycles[0].map(id => byId(id)?.name || id).join(" -> ");
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
