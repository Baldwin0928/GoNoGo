// Split from app.js - dependency traversal, readiness calculation, select population, dropdown helpers
function directDependencies(parentId) {
  return state.dependencies.filter((link) => link.parentId === Number(parentId) && link.requiredForReadiness !== false);
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
  const ready = dependencies.filter((item) => readyStatuses.has(effectiveObjectStatus(item.object)));
  const blockers = dependencies.filter((item) => !readyStatuses.has(effectiveObjectStatus(item.object)));
  const score = dependencies.length ? ready.length / dependencies.length : 1;
  return { dependencies, ready, blockers, score, isReady: blockers.length === 0 };
}

function linkedGateBlock(item) {
  if (!item?.linkedProjectId) return null;
  const gateId = Number(item.rollupGateBlockId || item.linkedMapId);
  const explicitGate = gateId ? byId(gateId) : null;
  if (explicitGate && explicitGate.projectId === Number(item.linkedProjectId)) return explicitGate;
  return projectCampaigns(item.linkedProjectId)[0] || projectObjects(item.linkedProjectId)[0] || null;
}

function inferRollupStatus(items, blockers) {
  if (!items.length) return "Unknown";
  if (!blockers.length) return "Ready";
  const statuses = items.map((entry) => effectiveObjectStatus(entry.object || entry));
  if (statuses.some((status) => status === "Blocked" || status === "Invalidated")) return "Blocked";
  if (statuses.some((status) => status === "In Progress" || status === "Needs Review" || readyStatuses.has(status))) return "In Progress";
  return "Not Started";
}

function getLinkedRollup(item, seen = new Set()) {
  if (!item?.isLinkedProjectBlock || !item.linkedProjectId || item.rollupMode === "manual" || item.manualOverride) return null;
  const childProject = state.projects.find((project) => project.id === Number(item.linkedProjectId));
  if (!childProject) return null;
  const cycleKey = `${item.projectId}:${item.linkedProjectId}:${item.id}`;
  if (seen.has(cycleKey)) {
    return { status: "Blocked", score: 0, blockers: [], blockerCount: 0, isReady: false, warning: "Linked project cycle detected." };
  }
  seen.add(cycleKey);

  const childObjects = projectObjects(item.linkedProjectId);
  const gate = linkedGateBlock(item);
  let score = 0;
  let blockers = [];
  let status = "Unknown";
  let dependencies = [];

  if (item.rollupMode === "all") {
    const counted = childObjects.filter((object) => object.requiredForReadiness !== false);
    const ready = counted.filter((object) => readyStatuses.has(effectiveObjectStatus(object, seen)));
    blockers = counted.filter((object) => !readyStatuses.has(effectiveObjectStatus(object, seen)));
    score = counted.length ? ready.length / counted.length : 1;
    status = inferRollupStatus(counted, blockers);
    dependencies = counted.map((object) => ({ object, depth: 1 }));
  } else if (item.rollupMode === "gate") {
    const gateStatus = gate ? effectiveObjectStatus(gate, seen) : "Unknown";
    score = readyStatuses.has(gateStatus) ? 1 : 0;
    blockers = gate && !readyStatuses.has(gateStatus) ? [{ object: gate, depth: 0 }] : [];
    status = gateStatus;
    dependencies = gate ? [{ object: gate, depth: 0 }] : [];
  } else if (gate) {
    const readiness = calculateReadiness(gate.id);
    dependencies = readiness.dependencies.length ? readiness.dependencies : [{ object: gate, depth: 0 }];
    blockers = readiness.dependencies.length ? readiness.blockers : (readyStatuses.has(effectiveObjectStatus(gate, seen)) ? [] : [{ object: gate, depth: 0 }]);
    score = readiness.dependencies.length ? readiness.score : (blockers.length ? 0 : 1);
    status = blockers.length ? inferRollupStatus(dependencies, blockers) : "Ready";
  }

  const docs = childObjects.map((object) => ensureDocumentation(object));
  const openActions = docs.reduce((sum, doc) => sum + doc.actionItems.filter((action) => !action.done).length, 0);
  const staleItems = childObjects.filter((object) => isStale(object)).length;
  const lastUpdated = childObjects
    .map((object) => new Date(object.updatedAt || object.createdAt || 0).getTime())
    .filter((time) => Number.isFinite(time));

  return {
    childProject,
    gate,
    dependencies,
    status,
    score,
    readinessPercent: Math.round(score * 100),
    blockers,
    blockerCount: blockers.length,
    openActions,
    staleItems,
    lastUpdated: lastUpdated.length ? new Date(Math.max(...lastUpdated)).toISOString() : "",
    isReady: blockers.length === 0 && readyStatuses.has(status)
  };
}

function effectiveObjectStatus(item, seen = new Set()) {
  const rollup = getLinkedRollup(item, seen);
  if (rollup?.status) return rollup.status;
  if (hasRevisions(item)) {
    const current = getCurrentRevision(item);
    if (current && current.status !== "Superseded") {
      const derived = revisionDerivedBlockStatus(current.status);
      if (derived) return derived;
    }
  }
  return item?.status || "Unknown";
}

function effectiveReadinessPercent(item) {
  const rollup = getLinkedRollup(item);
  return rollup ? rollup.readinessPercent : null;
}

function rollupModeLabel(mode) {
  if (mode === "all") return "All blocks ready";
  if (mode === "gate") return "Specific gate block ready";
  if (mode === "manual") return "Manual override";
  return "All required blockers ready";
}

function wouldCreateLinkedProjectCycle(sourceProjectId, targetProjectId, objectId = null) {
  const source = Number(sourceProjectId);
  const target = Number(targetProjectId);
  if (!source || !target || source === target) return true;
  const edges = state.objects
    .filter((item) => item.isLinkedProjectBlock && item.linkedProjectId && Number(item.id) !== Number(objectId))
    .map((item) => [Number(item.projectId), Number(item.linkedProjectId)]);
  edges.push([source, target]);
  const graph = edges.reduce((map, [from, to]) => {
    const list = map.get(from) || [];
    list.push(to);
    map.set(from, list);
    return map;
  }, new Map());
  const seen = new Set();
  function visit(projectId) {
    if (projectId === source) return true;
    if (seen.has(projectId)) return false;
    seen.add(projectId);
    return (graph.get(projectId) || []).some(visit);
  }
  return visit(target);
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

