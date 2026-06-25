// Split from app.js - dependency traversal, readiness calculation, select population, dropdown helpers
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

