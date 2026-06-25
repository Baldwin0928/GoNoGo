// Split from app.js - renderAll, tables, pages, inspector support, readiness panels
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
