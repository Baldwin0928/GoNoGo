// Block revision tracking: history inside blocks, not separate map nodes

// Tracks which block objects have already had their revisions normalized in
// place. This keeps ensureRevisions idempotent so callers can safely hold a
// reference to item.revisions without it being replaced out from under them.
const normalizedRevisionItems = new WeakSet();

function ensureRevisions(item) {
  if (!item) return [];
  if (!Array.isArray(item.revisions) || !normalizedRevisionItems.has(item)) {
    item.revisions = normalizeRevisions(item.revisions, item.id);
    normalizedRevisionItems.add(item);
    if (item.revisions.length && !item.revisions.some((rev) => rev.isCurrent)) {
      const preferred = item.currentRevisionId
        ? item.revisions.find((rev) => rev.revisionId === Number(item.currentRevisionId))
        : null;
      (preferred || item.revisions[item.revisions.length - 1]).isCurrent = true;
    }
    syncBlockRevisionFields(item);
  }
  return item.revisions;
}

function hasRevisions(item) {
  return Boolean(item?.revisions?.length);
}

function getCurrentRevision(item) {
  if (!item) return null;
  const revisions = ensureRevisions(item);
  return revisions.find((rev) => rev.isCurrent) || revisions[revisions.length - 1] || null;
}

function getRevisionById(item, revisionId) {
  return ensureRevisions(item).find((rev) => rev.revisionId === Number(revisionId)) || null;
}

function nextRevisionId(revisions) {
  return revisions.reduce((max, rev) => Math.max(max, Number(rev.revisionId) || 0), 0) + 1;
}

function syncBlockRevisionFields(item) {
  if (!item) return;
  const current = item.revisions?.find((rev) => rev.isCurrent) || null;
  item.currentRevisionId = current?.revisionId || null;
  item.currentRevisionLabel = current?.label || "";
  item.revisionStatus = current?.status || "";
  const released = item.revisions?.find((rev) => rev.isReleased) || null;
  item.releasedRevisionId = released?.revisionId || null;
}

function revisionDerivedBlockStatus(revisionStatus) {
  const map = {
    Draft: "In Progress",
    "In Review": "Needs Review",
    "Changes Requested": "In Progress",
    Approved: "Ready",
    Rejected: "Blocked",
    Superseded: "In Progress",
    Released: "Complete"
  };
  return map[revisionStatus] || null;
}

function syncBlockStatusFromRevision(item) {
  if (!item?.revisions?.length) return;
  const current = getCurrentRevision(item);
  if (!current || current.status === "Superseded") return;
  const derived = revisionDerivedBlockStatus(current.status);
  if (derived) item.status = derived;
}

function revisionStatusClass(status) {
  return `revision-status-${String(status || "draft").toLowerCase().replaceAll(" ", "-")}`;
}

// Append an immutable audit-trail entry capturing who did what and when.
function logRevisionEvent(rev, action, actor, note = "") {
  if (!rev) return;
  rev.events = Array.isArray(rev.events) ? rev.events : [];
  const id = rev.events.reduce((max, entry) => Math.max(max, Number(entry.id) || 0), 0) + 1;
  rev.events.push({
    id,
    action: String(action || "Updated"),
    actor: String(actor || currentActor()),
    at: new Date().toISOString(),
    note: String(note || "")
  });
}

function nodeRevisionMetaLine(item) {
  const current = getCurrentRevision(item);
  if (!current) return null;
  const parts = [current.label, current.status];
  if (item.owner) parts.push(item.owner);
  return parts.join(" · ");
}

function setCurrentRevision(item, revisionId, actor = "") {
  ensureRevisions(item).forEach((rev) => {
    const becomingCurrent = rev.revisionId === Number(revisionId);
    if (becomingCurrent && !rev.isCurrent) {
      logRevisionEvent(rev, "Set as current", actor || currentActor());
    }
    rev.isCurrent = becomingCurrent;
    if (rev.isCurrent) rev.updatedAt = new Date().toISOString();
  });
  syncBlockRevisionFields(item);
  syncBlockStatusFromRevision(item);
}

function supersedeActiveDrafts(item, exceptRevisionId = null, actor = "") {
  ensureRevisions(item).forEach((rev) => {
    if (rev.revisionId === Number(exceptRevisionId)) return;
    if (!rev.isCurrent) return;
    if (!["Draft", "In Review", "Changes Requested"].includes(rev.status)) return;
    rev.status = "Superseded";
    rev.isCurrent = false;
    rev.updatedAt = new Date().toISOString();
    logRevisionEvent(rev, "Superseded", actor || currentActor(), "Superseded by a newer revision.");
  });
}

function createRevision(item, options = {}) {
  ensureRevisions(item);
  const base = options.basedOnRevisionId
    ? getRevisionById(item, options.basedOnRevisionId)
    : getCurrentRevision(item);

  const author = options.createdBy || currentActor();
  supersedeActiveDrafts(item, null, author);
  // The newly created revision becomes the active one. Any previous revision
  // (including Approved/Released ones) stays in history but is no longer current.
  item.revisions.forEach((rev) => { rev.isCurrent = false; });

  const labelFallback = `Rev ${String.fromCharCode(65 + item.revisions.length)}`;
  const newRev = revision(item.id, options.label || labelFallback, "Draft", {
    createdBy: author,
    changeSummary: options.changeSummary || "",
    basedOnRevisionId: base?.revisionId || null,
    reviewerName: options.reviewerName || base?.reviewerName || "",
    isCurrent: true
  });
  newRev.revisionId = nextRevisionId(item.revisions);

  if (options.copyDocs && base) {
    const docs = ensureDocumentation(item);
    if (!newRev.changeSummary && docs.summary) newRev.changeSummary = docs.summary;
    if (!newRev.notes && docs.body) newRev.notes = `Based on ${base.label}.\n\n${docs.body.slice(0, 500)}`;
  }

  logRevisionEvent(newRev, "Created", author, base ? `Based on ${base.label}.` : "");
  item.revisions.push(newRev);
  syncBlockRevisionFields(item);
  syncBlockStatusFromRevision(item);
  return newRev;
}

function submitRevisionForReview(item, revisionId, reviewerName = "", submittedBy = "") {
  const rev = getRevisionById(item, revisionId);
  if (!rev || !["Draft", "Changes Requested"].includes(rev.status)) return false;
  const wasChangesRequested = rev.status === "Changes Requested";
  const submitter = submittedBy || rev.createdBy || currentActor();
  rev.status = "In Review";
  rev.submittedBy = submitter;
  rev.submittedAt = new Date().toISOString();
  rev.updatedAt = rev.submittedAt;
  rev.reviewerName = reviewerName || rev.reviewerName;
  rev.decision = "Pending";
  logRevisionEvent(rev, wasChangesRequested ? "Resubmitted for review" : "Submitted for review", submitter, rev.reviewerName ? `Reviewer: ${rev.reviewerName}` : "");
  syncBlockRevisionFields(item);
  if (rev.isCurrent) syncBlockStatusFromRevision(item);
  touchObject(item);
  return true;
}

function approveRevision(item, revisionId, reviewerName = "", notes = "") {
  const rev = getRevisionById(item, revisionId);
  if (!rev || rev.status !== "In Review") return false;
  const approver = reviewerName || rev.reviewerName || currentActor();
  const now = new Date().toISOString();
  rev.status = "Approved";
  rev.reviewerName = approver;
  rev.decidedBy = approver;
  rev.decidedAt = now;
  rev.approvedAt = now;
  rev.updatedAt = now;
  rev.decision = "Approved";
  if (notes) rev.notes = notes;
  rev.isApproved = true;
  logRevisionEvent(rev, "Approved", approver, notes);
  syncBlockRevisionFields(item);
  if (rev.isCurrent) syncBlockStatusFromRevision(item);
  touchObject(item);
  return true;
}

function requestRevisionChanges(item, revisionId, reviewerName = "", notes = "") {
  const rev = getRevisionById(item, revisionId);
  if (!rev || rev.status !== "In Review") return false;
  const reviewer = reviewerName || rev.reviewerName || currentActor();
  const now = new Date().toISOString();
  rev.status = "Changes Requested";
  rev.reviewerName = reviewer;
  rev.decidedBy = reviewer;
  rev.decidedAt = now;
  rev.updatedAt = now;
  rev.decision = "Changes Requested";
  if (notes) rev.notes = notes;
  logRevisionEvent(rev, "Changes requested", reviewer, notes);
  syncBlockRevisionFields(item);
  if (rev.isCurrent) syncBlockStatusFromRevision(item);
  touchObject(item);
  return true;
}

function rejectRevision(item, revisionId, reviewerName = "", notes = "") {
  const rev = getRevisionById(item, revisionId);
  if (!rev || rev.status !== "In Review") return false;
  const reviewer = reviewerName || rev.reviewerName || currentActor();
  const now = new Date().toISOString();
  rev.status = "Rejected";
  rev.reviewerName = reviewer;
  rev.decidedBy = reviewer;
  rev.decidedAt = now;
  rev.updatedAt = now;
  rev.decision = "Rejected";
  if (notes) rev.notes = notes;
  logRevisionEvent(rev, "Rejected", reviewer, notes);
  syncBlockRevisionFields(item);
  if (rev.isCurrent) syncBlockStatusFromRevision(item);
  touchObject(item);
  return true;
}

function releaseRevision(item, revisionId, releasedBy = "") {
  const rev = getRevisionById(item, revisionId);
  if (!rev || !["Approved", "Released"].includes(rev.status)) return false;
  const releaser = releasedBy || currentActor();
  const now = new Date().toISOString();
  ensureRevisions(item).forEach((entry) => {
    if (entry.isReleased && entry.revisionId !== rev.revisionId) entry.isReleased = false;
  });
  rev.status = "Released";
  rev.isReleased = true;
  rev.isApproved = true;
  rev.releasedBy = releaser;
  rev.releasedAt = now;
  rev.updatedAt = now;
  logRevisionEvent(rev, "Released", releaser);
  syncBlockRevisionFields(item);
  if (rev.isCurrent) syncBlockStatusFromRevision(item);
  touchObject(item);
  return true;
}

// A responsibility / sign-off row: role, person accountable, and exact timestamp.
function signoffRow(role, person, at, pending = false) {
  const who = person ? escapeHtml(person) : (pending ? "Awaiting" : "—");
  const when = at ? `<span class="signoff-when">${escapeHtml(formatDateTime(at))}</span>` : "";
  return `
    <div class="signoff-row ${pending ? "is-pending" : ""}">
      <span class="signoff-role">${escapeHtml(role)}</span>
      <div class="signoff-value">
        <span class="signoff-person">${who}</span>
        ${when}
      </div>
    </div>
  `;
}

function renderRevisionSignoff(rev, item) {
  const rows = [];
  rows.push(signoffRow("Created by", rev.createdBy || item.owner, rev.createdAt));
  if (rev.submittedAt || ["In Review", "Approved", "Released", "Changes Requested", "Rejected"].includes(rev.status)) {
    rows.push(signoffRow("Submitted by", rev.submittedBy, rev.submittedAt, !rev.submittedAt));
  }
  rows.push(signoffRow("Reviewer", rev.reviewerName, "", !rev.reviewerName));
  if (rev.decidedAt || rev.decision) {
    const decisionRole = rev.decision === "Approved" ? "Approved by"
      : rev.decision === "Changes Requested" ? "Changes requested by"
      : rev.decision === "Rejected" ? "Rejected by"
      : "Decision by";
    rows.push(signoffRow(decisionRole, rev.decidedBy, rev.decidedAt, rev.decision === "Pending"));
  }
  if (rev.isReleased || rev.releasedAt) {
    rows.push(signoffRow("Released by", rev.releasedBy, rev.releasedAt, !rev.releasedAt));
  }
  return `<div class="revision-signoff">${rows.join("")}</div>`;
}

function renderRevisionCurrentCard(item) {
  const current = getCurrentRevision(item);
  if (!current) {
    return `<div class="empty-card">No revisions yet. Create one to track design iterations.</div>`;
  }
  return `
    <article class="revision-current-card">
      <div class="revision-current-head">
        <span class="lozenge ${revisionStatusClass(current.status)}">${escapeHtml(current.status)}</span>
        <strong>${escapeHtml(current.label)}</strong>
        ${current.isCurrent ? `<span class="revision-current-badge">Current</span>` : ""}
        ${current.isReleased ? `<span class="revision-released-badge">Released</span>` : ""}
      </div>
      ${current.changeSummary ? `<p class="revision-summary">${escapeHtml(current.changeSummary)}</p>` : ""}
      <h4 class="revision-signoff-title">Responsibility &amp; sign-off</h4>
      ${renderRevisionSignoff(current, item)}
      ${current.decision && current.decision !== "Pending" && current.notes ? `<p class="revision-notes"><strong>Decision note:</strong> ${escapeHtml(current.notes)}</p>` : (current.notes ? `<p class="revision-notes">${escapeHtml(current.notes)}</p>` : "")}
    </article>
  `;
}

function revisionEventDotClass(action) {
  const a = String(action).toLowerCase();
  if (a.includes("approv")) return "event-dot-approve";
  if (a.includes("reject")) return "event-dot-reject";
  if (a.includes("changes")) return "event-dot-changes";
  if (a.includes("submit")) return "event-dot-submit";
  if (a.includes("released")) return "event-dot-release";
  if (a.includes("supersed")) return "event-dot-superseded";
  return "event-dot-created";
}

function renderRevisionEventLog(rev) {
  const events = Array.isArray(rev.events) ? [...rev.events].sort((a, b) => new Date(a.at) - new Date(b.at)) : [];
  if (!events.length) return "";
  return `
    <div class="revision-event-log">
      ${events.map((event) => `
        <div class="revision-event">
          <span class="revision-event-dot ${revisionEventDotClass(event.action)}"></span>
          <div class="revision-event-body">
            <div class="revision-event-line">
              <strong>${escapeHtml(event.action)}</strong>
              <span class="revision-event-actor">${escapeHtml(event.actor)}</span>
            </div>
            <span class="revision-event-time">${escapeHtml(formatDateTime(event.at))}</span>
            ${event.note ? `<p class="revision-event-note">${escapeHtml(event.note)}</p>` : ""}
          </div>
        </div>
      `).join("")}
    </div>
  `;
}

function renderRevisionActions(item) {
  const current = getCurrentRevision(item);
  if (!current) return "";
  const id = current.revisionId;
  const buttons = [];
  if (current.status === "Draft") {
    buttons.push(`<button class="button secondary" type="button" data-revision-action="submit" data-revision-id="${id}">Submit for review</button>`);
  }
  if (current.status === "Changes Requested") {
    buttons.push(`<button class="button" type="button" data-revision-action="submit" data-revision-id="${id}">Resubmit for review</button>`);
  }
  if (current.status === "In Review") {
    buttons.push(`<button class="button" type="button" data-revision-action="approve" data-revision-id="${id}">Approve</button>`);
    buttons.push(`<button class="button secondary" type="button" data-revision-action="changes" data-revision-id="${id}">Request changes</button>`);
    buttons.push(`<button class="button secondary danger-soft" type="button" data-revision-action="reject" data-revision-id="${id}">Reject</button>`);
  }
  if (current.status === "Approved") {
    buttons.push(`<button class="button" type="button" data-revision-action="release" data-revision-id="${id}">Mark released</button>`);
  }
  if (!current.isCurrent && !["Superseded", "Rejected"].includes(current.status)) {
    buttons.push(`<button class="button secondary" type="button" data-revision-action="set-current" data-revision-id="${id}">Set as current</button>`);
  }
  if (!buttons.length) return "";
  return `<div class="revision-actions">${buttons.join("")}</div>`;
}

function renderRevisionHistory(item) {
  const revisions = [...ensureRevisions(item)].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  if (!revisions.length) return `<div class="empty-card">Revision history will appear here.</div>`;
  return `
    <div class="revision-history">
      <h3 class="revision-history-title">History &amp; audit trail</h3>
      <div class="revision-timeline">
        ${revisions.map((rev) => `
          <article class="revision-timeline-item ${rev.isCurrent ? "is-current" : ""}">
            <div class="revision-timeline-marker"></div>
            <div class="revision-timeline-body">
              <div class="revision-timeline-head">
                <strong>${escapeHtml(rev.label)}</strong>
                <span class="lozenge ${revisionStatusClass(rev.status)}">${escapeHtml(rev.status)}</span>
                ${rev.isCurrent ? `<span class="revision-current-badge">Current</span>` : ""}
                ${rev.isReleased ? `<span class="revision-released-badge">Released</span>` : ""}
              </div>
              ${rev.changeSummary ? `<p class="revision-timeline-summary">${escapeHtml(rev.changeSummary)}</p>` : ""}
              ${renderRevisionEventLog(rev)}
              ${!rev.isCurrent && rev.status === "Draft" ? `<button class="row-action" type="button" data-revision-action="set-current" data-revision-id="${rev.revisionId}">Set current</button>` : ""}
            </div>
          </article>
        `).join("")}
      </div>
    </div>
  `;
}
