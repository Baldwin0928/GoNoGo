// Split from app.js - graph rendering, inspector rendering, report and export helpers

function renderGraph(root, deps) {
  const graph = document.getElementById("graph");
  document.getElementById("zoomLabel").textContent = `${Math.round(graphZoom * 100)}%`;
  const filter = document.getElementById("statusFilter").value;
  
  const allowedIds = new Set([root.id]);
  deps.forEach((item) => {
    if (filter === "blockers" && readyStatuses.has(effectiveObjectStatus(item.object))) return;
    if (filter === "ready" && !readyStatuses.has(effectiveObjectStatus(item.object))) return;
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
  const routedEdges = edges.filter(link => positions.has(link.parentId) && positions.has(link.childId));
  const incomingRoutes = new Map();
  const outgoingRoutes = new Map();
  routedEdges.forEach((link) => {
    const incoming = incomingRoutes.get(link.parentId) || [];
    incoming.push(link);
    incomingRoutes.set(link.parentId, incoming);
    const outgoing = outgoingRoutes.get(link.childId) || [];
    outgoing.push(link);
    outgoingRoutes.set(link.childId, outgoing);
  });
  incomingRoutes.forEach((list) => list.sort((a, b) => positions.get(a.childId).y - positions.get(b.childId).y));
  outgoingRoutes.forEach((list) => list.sort((a, b) => positions.get(a.parentId).y - positions.get(b.parentId).y));
  const laneOffset = (link, routeMap, key, spacing = 12) => {
    const routes = routeMap.get(key) || [];
    const index = routes.findIndex((route) => Number(route.id) === Number(link.id));
    if (index < 0 || routes.length <= 1) return 0;
    return (index - (routes.length - 1) / 2) * spacing;
  };
  const linkGroups = edges.filter(link => positions.has(link.parentId) && positions.has(link.childId)).reduce((groups, link) => {
    const list = groups.get(link.parentId) || [];
    list.push(link);
    groups.set(link.parentId, list);
    return groups;
  }, new Map());
  const lines = Array.from(linkGroups.entries())
    .map(([blockedId, links]) => {
      const blocked = positions.get(Number(blockedId));
      const endX = blocked.x - 18;
      const endY = blocked.y + NODE_CENTER_Y;
      if (links.length >= 2) {
        const hubX = blocked.x - 38;
        const hubY = endY;
        const sortedLinks = [...links].sort((a, b) => positions.get(a.childId).y - positions.get(b.childId).y);
        const laneSpacing = Math.max(10, Math.min(18, 72 / Math.max(1, sortedLinks.length - 1)));
        const laneYs = sortedLinks.map((link, index) => hubY + (index - (sortedLinks.length - 1) / 2) * laneSpacing);
        const feeders = sortedLinks.map((link, index) => {
          const blocker = positions.get(link.childId);
          const startX = blocker.x + NODE_WIDTH + 8;
          const startY = blocker.y + NODE_CENTER_Y + laneOffset(link, outgoingRoutes, link.childId, 10);
          const laneY = laneYs[index];
          const routeGap = Math.max(1, hubX - startX);
          const bendX = startX + Math.min(42, Math.max(12, routeGap * 0.55));
          const isHighlight = selectedSet.size === 0 || (highlightSet.has(link.parentId) && highlightSet.has(link.childId));
          const isSelectedEdge = Number(link.id) === Number(selectedDependencyId);
          const pathD = `M ${startX} ${startY} C ${bendX} ${startY}, ${bendX} ${laneY}, ${hubX} ${laneY}`;
          return `
            <path class="graph-line graph-line-feeder${isHighlight ? "" : " dimmed"}${isSelectedEdge ? " selected-edge" : ""}" data-dependency-id="${link.id}" d="${pathD}" />
            <path class="graph-line-hit" data-dependency-id="${link.id}" d="${pathD}" />
          `;
        }).join("");
        const groupHighlight = selectedSet.size === 0 || highlightSet.has(Number(blockedId));
        const spineTop = Math.min(...laneYs, hubY);
        const spineBottom = Math.max(...laneYs, hubY);
        return `
          ${feeders}
          <path class="graph-line graph-line-spine${groupHighlight ? "" : " dimmed"}" d="M ${hubX} ${spineTop} L ${hubX} ${spineBottom}" />
          <circle class="junction-dot${groupHighlight ? "" : " dimmed"}" cx="${hubX}" cy="${hubY}" r="3.8"></circle>
          ${links.length >= 4 ? `<text class="junction-label${groupHighlight ? "" : " dimmed"}" x="${hubX - 6}" y="${hubY - 13}">${links.length} blockers</text>` : ""}
          <path class="graph-line graph-line-final${groupHighlight ? "" : " dimmed"}" d="M ${hubX} ${hubY} C ${hubX + 16} ${hubY}, ${endX - 18} ${endY}, ${endX} ${endY}" marker-end="url(#arrow)" />
        `;
      }
      return links.map((link) => {
        const blocker = positions.get(link.childId);
        const startX = blocker.x + NODE_WIDTH + 8;
        const startY = blocker.y + NODE_CENTER_Y + laneOffset(link, outgoingRoutes, link.childId, 10);
        const targetY = endY + laneOffset(link, incomingRoutes, link.parentId, 12);
        const isHighlight = selectedSet.size === 0 || (highlightSet.has(link.parentId) && highlightSet.has(link.childId));
        
        let pathD = "";
        const isLongEdge = (endX - startX) > 400; // Skip multiple layers
        if (isLongEdge) {
          const midX1 = startX + 32;
          const midX2 = endX - 32;
          const safeY = Math.max(startY, targetY) + 118 + Math.abs(laneOffset(link, incomingRoutes, link.parentId, 12)); // Route below nodes
          pathD = `M ${startX} ${startY} C ${midX1} ${startY}, ${midX1} ${safeY}, ${midX1 + 32} ${safeY} L ${midX2 - 32} ${safeY} C ${midX2} ${safeY}, ${midX2} ${targetY}, ${endX} ${targetY}`;
        } else {
          const curve = Math.min(52, Math.max(18, Math.abs(endX - startX) * 0.45));
          pathD = `M ${startX} ${startY} C ${startX + curve} ${startY}, ${endX - curve} ${targetY}, ${endX} ${targetY}`;
        }
        
        const midX = (startX + endX) / 2;
        const midY = isLongEdge ? Math.max(startY, targetY) + 110 : (startY + targetY) / 2 - 6;
        
        const isSelectedEdge = Number(link.id) === Number(selectedDependencyId);
        return `
          <path class="graph-line${isHighlight ? "" : " dimmed"}${isSelectedEdge ? " selected-edge" : ""}" data-dependency-id="${link.id}" d="${pathD}" marker-end="url(#arrow)" />
          <path class="graph-line-hit" data-dependency-id="${link.id}" d="${pathD}" />
          <text class="edge-label${isHighlight ? "" : " dimmed"}" x="${midX}" y="${midY}">blocks</text>
        `;
      }).join("");
    })
    .join("");

  const nodeMarkup = uniqueNodes
    .map((item) => {
      const pos = positions.get(item.id);
      const rollup = getLinkedRollup(item);
      const displayStatus = rollup?.status || item.status;
      const linkedMeta = rollup ? `${rollup.readinessPercent}% ready | ${rollup.blockerCount} blocker${rollup.blockerCount === 1 ? "" : "s"}` : "";
      const isReady = readyStatuses.has(displayStatus);
      const isSelected = selectedObjectIds.has(item.id) || item.id === selectedObjectId;
      const isHighlight = selectedSet.size === 0 || highlightSet.has(item.id);
      const isSource = item.id === connectSourceId;
      const className = [
        "graph-node",
        isReady ? "ready" : "blocker",
        item.type.toLowerCase().replaceAll("/", "-").replaceAll(" ", "-"),
        rollup ? "linked-project-node" : "",
        isSelected ? "selected" : "",
        !isHighlight ? "dimmed" : "",
        isSource ? "connect-source" : "",
        connectMode && !isSource ? "connect-target" : ""
      ].join(" ");
      const blockers = state.dependencies.filter((link) => link.parentId === item.id).length;
      const statusClass = nodeStatusClass(displayStatus);
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
          <text class="meta" x="${NODE_PAD_X + 12}" y="${NODE_META_Y}">${escapeSvg(nodeRevisionMetaLine(item) || `${displayStatus} - ${item.owner || "Unassigned"}`)}</text>
          ${rollup ? `<text class="linked-meta-label" x="${NODE_PAD_X}" y="${NODE_META_Y + 13}">Linked</text><text class="linked-meta" x="${NODE_PAD_X + 42}" y="${NODE_META_Y + 13}">${escapeSvg(linkedMeta)}</text>` : ""}
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
        <marker id="arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto" markerUnits="strokeWidth">
          <path d="M1.2,1.4 L7,4 L1.2,6.6" class="arrow-head"></path>
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
  const selectedDependency = state.dependencies.find((link) => Number(link.id) === Number(selectedDependencyId));
  const item = byId(selectedObjectId);
  const inspector = document.getElementById("inspectorContent");
  const typeLabel = document.getElementById("selectedType");
  const returnMarkup = linkedMapReturnStack.length ? `<div class="linked-return-card"><button class="button secondary full-width" type="button" data-return-linked-map="true">Back to parent map</button></div>` : "";
  if (selectedDependency && inspector) {
    const blocked = byId(selectedDependency.parentId);
    const blocker = byId(selectedDependency.childId);
    if (typeLabel) typeLabel.textContent = "Connection";
    inspector.innerHTML = `${returnMarkup}
      <div class="selected-card dependency-selected-card">
        <span class="lozenge type-pill">Connection</span>
        <h3>${escapeHtml(blocker?.name || "Missing blocker")} -> ${escapeHtml(blocked?.name || "Missing blocked item")}</h3>
        <p>${escapeHtml(selectedDependency.relationshipType || "requires")}</p>
      </div>
      <div class="mini-list selected-target-list">
        <strong>Flow</strong>
        <span>Blocker <small>${escapeHtml(blocker?.name || "Missing blocker")}</small></span>
        <span>Blocked item <small>${escapeHtml(blocked?.name || "Missing blocked item")}</small></span>
      </div>
      ${selectedDependency.notes ? `<div class="empty-card">${escapeHtml(selectedDependency.notes)}</div>` : ""}
      <div class="quick-actions">
        <button class="button danger" type="button" data-delete-dependency="${selectedDependency.id}">Delete connection</button>
        <button class="button secondary" type="button" data-clear-edge-selection="true">Clear selection</button>
      </div>
    `;
    return;
  }
  if (selectedDependencyId && !selectedDependency) selectedDependencyId = null;
  if (!item || !inspector) {
    if (inspector) inspector.innerHTML = `${returnMarkup}<div class="empty-card">Select a block on the map.</div>`;
    if (typeLabel) typeLabel.textContent = "None";
    return;
  }

  selectedObjectId = item.id;
  const multiSelected = selectedObjects();
  if (multiSelected.length > 1) {
    typeLabel.textContent = `${multiSelected.length} selected`;
    inspector.innerHTML = `${returnMarkup}
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
  const status = blockColor(effectiveObjectStatus(item));
  const matchedMember = findMemberForOwner(item.owner);
  const pingCount = state.pings.filter((ping) => ping.objectId === item.id).length;
  const rollup = getLinkedRollup(item);
  const displayStatus = rollup?.status || item.status;
  const displayReadiness = rollup ? `${rollup.readinessPercent}% ready` : "Manual status";
  const linkedProjects = state.projects.filter((project) => project.id !== Number(item.projectId));
  const selectedLinkedProjectId = item.linkedProjectId && linkedProjects.some((project) => project.id === Number(item.linkedProjectId)) ? Number(item.linkedProjectId) : linkedProjects[0]?.id || "";
  const linkedProjectBlocks = selectedLinkedProjectId ? projectObjects(selectedLinkedProjectId) : [];
  const selectedGateId = linkedGateBlock(item)?.id || linkedProjectBlocks[0]?.id || "";
  const linkedProjectOptions = linkedProjects.length
    ? linkedProjects.map((project) => `<option value="${project.id}" ${Number(project.id) === Number(selectedLinkedProjectId) ? "selected" : ""}>${escapeHtml(project.name)} (${escapeHtml(project.key || "Project")})</option>`).join("")
    : `<option value="">Create another project first</option>`;
  const gateOptions = linkedProjectBlocks.length
    ? linkedProjectBlocks.map((block) => `<option value="${block.id}" ${Number(block.id) === Number(selectedGateId) ? "selected" : ""}>${escapeHtml(block.name)} (${escapeHtml(block.type)})</option>`).join("")
    : `<option value="">No child blocks yet</option>`;
  const linkedProjectPanel = `
    <section class="linked-project-panel ${item.isLinkedProjectBlock ? "is-linked" : ""}">
      <div class="linked-project-head">
        <div>
          <strong>Linked project rollup</strong>
          <span>${item.isLinkedProjectBlock ? "Status is synced from linked project." : "Turn this block into a drill-down map."}</span>
        </div>
        <label class="toggle-row compact-toggle"><input type="checkbox" data-linked-enabled="${item.id}" ${item.isLinkedProjectBlock ? "checked" : ""} /> Linked</label>
      </div>
      ${item.isLinkedProjectBlock ? `
        <div class="linked-rollup-summary">
          <span><strong>${escapeHtml(displayStatus)}</strong><small>${escapeHtml(displayReadiness)}</small></span>
          <span><strong>${rollup?.blockerCount ?? 0}</strong><small>blockers</small></span>
          <span><strong>${rollup?.openActions ?? 0}</strong><small>open actions</small></span>
        </div>
        <label>Child project
          <select data-linked-project="${item.id}">${linkedProjectOptions}</select>
        </label>
        <label>Rollup rule
          <select data-rollup-mode="${item.id}">
            ${rollupModes.map((mode) => `<option value="${mode}" ${mode === item.rollupMode ? "selected" : ""}>${escapeHtml(rollupModeLabel(mode))}</option>`).join("")}
          </select>
        </label>
        <label>Gate block
          <select data-rollup-gate="${item.id}" ${item.rollupMode === "all" ? "disabled" : ""}>${gateOptions}</select>
        </label>
        <div class="quick-actions compact-actions">
          <button class="button secondary" type="button" data-open-linked-map="${item.id}" ${item.linkedProjectId ? "" : "disabled"}>Open linked map</button>
          <button class="button secondary" type="button" data-unlink-project="${item.id}">Unlink</button>
        </div>
        ${rollup?.warning ? `<div class="form-hint warning-hint">${escapeHtml(rollup.warning)}</div>` : ""}
      ` : `<div class="form-hint">Link this block to another project/map when its detailed work should drive this parent status.</div>`}
    </section>
  `;
  const docs = ensureDocumentation(item);
  const openActions = docs.actionItems.filter((action) => !action.done);
  const latestUpdate = docs.updates[0];
  const latestActivity = (state.activity || []).find((event) => Number(event.objectId) === Number(item.id));
  inspector.innerHTML = `${returnMarkup}
    <div class="selected-card" style="border-left-color:${status.border};">
      <span class="lozenge type-pill">${escapeHtml(item.type)}</span>
      <h3>${escapeHtml(item.name)}</h3>
      <p>${escapeHtml(displayStatus)} - ${escapeHtml(item.owner || "Unassigned")}${rollup ? ` - ${rollup.readinessPercent}% linked readiness` : ""}</p>
    </div>
    <label>Name<input data-edit-name="${item.id}" value="${escapeHtml(item.name)}" /></label>
    <div class="two-col">
      <label>Status${statusSelect(item)}</label>
      <label>Owner${ownerInput(item)}</label>
    </div>
    <label>Notes<input data-edit-description="${item.id}" value="${escapeHtml(item.description || "")}" /></label>
    ${linkedProjectPanel}
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

