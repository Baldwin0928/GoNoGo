// Split from app.js - constants, seed data, object factories, blank board
const STORAGE_KEY = "gtpl-readiness-v1";
const SUPABASE_CONFIG = {
  url: "https://cnqbeyrvegwyiqtfevgo.supabase.co",
  publishableKey: "sb_publishable_PVGdOyS4EhSL2GuoNcFP_Q_OgNhAB2O",
  boardId: "gtpl-main",
  authRequired: true
};

const objectTypes = ["Project", "Campaign", "Hardware", "Document", "Review", "Task", "Test", "Person/Team"];
const statuses = ["Not Started", "In Progress", "Blocked", "Ready", "Complete", "Needs Review", "Invalidated", "Unknown"];
const relationshipTypes = ["requires", "blocks", "invalidates", "owns", "verifies", "depends_on", "derived_from", "replaces", "supersedes", "affects"];
const rollupModes = ["required", "all", "gate", "manual"];
const readyStatuses = new Set(["Ready", "Complete"]);
const revisionStatuses = ["Draft", "In Review", "Changes Requested", "Approved", "Rejected", "Superseded", "Released"];
const revisionReadyStatuses = new Set(["Approved", "Released"]);
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
const NODE_COLUMN_GAP = 260;
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
    object("Igniter Test", "Test", "Ready", "Ignition", "Ignition subsystem checkout."),
    object("Regen & Film-Cooled Nozzle Design", "Hardware", "In Progress", "Anyi", "Regenerative and film-cooled nozzle design iteration.")
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
  dependency(1, 10, "requires", "Igniter must be checked before hotfire."),
  dependency(1, 11, "requires", "Nozzle design must be reviewed before hotfire.")
];

function object(name, type, status, owner, description) {
  return {
    id: 0,
    name,
    type,
    status,
    owner,
    description,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    isLinkedProjectBlock: false,
    linkedProjectId: null,
    linkedMapId: null,
    rollupMode: "required",
    rollupGateBlockId: null,
    allowManualOverride: false,
    manualOverride: false,
    requiredForReadiness: true,
    revisions: [],
    currentRevisionId: null,
    currentRevisionLabel: "",
    revisionStatus: "",
    releasedRevisionId: null
  };
}

function revision(blockId, label, status, options = {}) {
  return {
    revisionId: 0,
    blockId: Number(blockId),
    label: String(label || "Rev A"),
    status: revisionStatuses.includes(status) ? status : "Draft",
    createdBy: String(options.createdBy || ""),
    createdAt: options.createdAt || new Date().toISOString(),
    updatedAt: options.updatedAt || new Date().toISOString(),
    submittedBy: String(options.submittedBy || ""),
    submittedAt: options.submittedAt || "",
    reviewerName: String(options.reviewerName || ""),
    decidedBy: String(options.decidedBy || ""),
    decidedAt: options.decidedAt || "",
    approvedAt: options.approvedAt || "",
    releasedBy: String(options.releasedBy || ""),
    releasedAt: options.releasedAt || "",
    decision: String(options.decision || ""),
    changeSummary: String(options.changeSummary || ""),
    notes: String(options.notes || ""),
    linkedDocs: Array.isArray(options.linkedDocs) ? options.linkedDocs : [],
    isCurrent: Boolean(options.isCurrent),
    isReleased: Boolean(options.isReleased),
    isApproved: Boolean(options.isApproved),
    basedOnRevisionId: options.basedOnRevisionId ? Number(options.basedOnRevisionId) : null,
    events: Array.isArray(options.events) ? options.events : []
  };
}

function normalizeRevisionEvents(raw = []) {
  if (!Array.isArray(raw)) return [];
  return raw.map((entry, index) => ({
    id: Number(entry.id) || Date.now() + index,
    action: String(entry.action || "Updated"),
    actor: String(entry.actor || "Unknown"),
    at: entry.at || new Date().toISOString(),
    note: String(entry.note || "")
  }));
}

function extractMentions(value = "") {
  return Array.from(new Set(String(value).match(/@[A-Za-z0-9_.-]+/g) || []));
}

function normalizeRevisions(raw = [], blockId = 0) {
  if (!Array.isArray(raw)) return [];
  return raw.map((entry, index) => ({
    revisionId: Number(entry.revisionId) || Date.now() + index,
    blockId: Number(entry.blockId) || Number(blockId),
    label: String(entry.label || `Rev ${index + 1}`),
    status: revisionStatuses.includes(entry.status) ? entry.status : "Draft",
    createdBy: String(entry.createdBy || ""),
    createdAt: entry.createdAt || new Date().toISOString(),
    updatedAt: entry.updatedAt || entry.createdAt || new Date().toISOString(),
    submittedBy: String(entry.submittedBy || ""),
    submittedAt: entry.submittedAt || "",
    reviewerName: String(entry.reviewerName || ""),
    decidedBy: String(entry.decidedBy || ""),
    decidedAt: entry.decidedAt || entry.approvedAt || "",
    approvedAt: entry.approvedAt || "",
    releasedBy: String(entry.releasedBy || ""),
    releasedAt: entry.releasedAt || "",
    decision: String(entry.decision || ""),
    changeSummary: String(entry.changeSummary || ""),
    notes: String(entry.notes || ""),
    linkedDocs: Array.isArray(entry.linkedDocs) ? entry.linkedDocs : [],
    isCurrent: Boolean(entry.isCurrent),
    isReleased: Boolean(entry.isReleased),
    isApproved: Boolean(entry.isApproved),
    basedOnRevisionId: entry.basedOnRevisionId ? Number(entry.basedOnRevisionId) : null,
    events: normalizeRevisionEvents(entry.events)
  }));
}

function seedBlockRevisions(item) {
  if (item.name === "Regen & Film-Cooled Nozzle Design") {
    const day = 86400000;
    const aCreated = new Date(Date.now() - day * 21).toISOString();
    const aSubmitted = new Date(Date.now() - day * 19).toISOString();
    const aApproved = new Date(Date.now() - day * 18).toISOString();
    const revA = revision(item.id, "Rev A", "Superseded", {
      createdBy: "Anyi Okafor",
      createdAt: aCreated,
      changeSummary: "Initial regen channel layout and baseline film cooling pattern.",
      isCurrent: false,
      isApproved: true,
      submittedBy: "Anyi Okafor",
      submittedAt: aSubmitted,
      reviewerName: "Marcus Lee (Propulsion Lead)",
      decidedBy: "Marcus Lee (Propulsion Lead)",
      decidedAt: aApproved,
      approvedAt: aApproved,
      decision: "Approved",
      events: [
        { id: 1, action: "Created", actor: "Anyi Okafor", at: aCreated, note: "Baseline nozzle design." },
        { id: 2, action: "Submitted for review", actor: "Anyi Okafor", at: aSubmitted, note: "" },
        { id: 3, action: "Approved", actor: "Marcus Lee (Propulsion Lead)", at: aApproved, note: "Meets baseline cooling margin." },
        { id: 4, action: "Superseded", actor: "Anyi Okafor", at: new Date(Date.now() - day * 4).toISOString(), note: "Superseded by Rev B." }
      ]
    });
    revA.revisionId = 1;
    const bCreated = new Date(Date.now() - day * 4).toISOString();
    const bSubmitted = new Date(Date.now() - day * 2).toISOString();
    const revB = revision(item.id, "Rev B", "In Review", {
      createdBy: "Anyi Okafor",
      createdAt: bCreated,
      changeSummary: "Updated cooling channel geometry and film cooling pattern.",
      basedOnRevisionId: 1,
      isCurrent: true,
      submittedBy: "Anyi Okafor",
      submittedAt: bSubmitted,
      reviewerName: "Marcus Lee (Propulsion Lead)",
      decision: "Pending",
      events: [
        { id: 1, action: "Created", actor: "Anyi Okafor", at: bCreated, note: "Based on Rev A." },
        { id: 2, action: "Submitted for review", actor: "Anyi Okafor", at: bSubmitted, note: "Requesting propulsion sign-off." }
      ]
    });
    revB.revisionId = 2;
    const cCreated = new Date(Date.now() - day).toISOString();
    const revC = revision(item.id, "Rev C", "Draft", {
      createdBy: "Anyi Okafor",
      createdAt: cCreated,
      changeSummary: "Planned optimization for higher chamber pressure.",
      basedOnRevisionId: 2,
      isCurrent: false,
      events: [
        { id: 1, action: "Created", actor: "Anyi Okafor", at: cCreated, note: "Exploratory next iteration." }
      ]
    });
    revC.revisionId = 3;
    item.revisions = [revA, revB, revC];
    item.currentRevisionId = 2;
    item.currentRevisionLabel = "Rev B";
    item.revisionStatus = "In Review";
    item.status = "Needs Review";
  }
  return item;
}

function dependency(parentId, childId, relationshipType, notes) {
  return {
    id: 0,
    parentId,
    childId,
    relationshipType,
    notes,
    createdAt: new Date().toISOString(),
    requiredForReadiness: true
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
    actionItems: [],
    comments: []
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
    })).filter((action) => action.text) : [],
    comments: Array.isArray(docs.comments) ? docs.comments.map((comment, index) => ({
      id: Number(comment.id) || Date.now() + index,
      text: String(comment.text || ""),
      author: String(comment.author || ""),
      mentions: Array.isArray(comment.mentions) ? comment.mentions.map(String) : extractMentions(comment.text || ""),
      createdAt: comment.createdAt || new Date().toISOString()
    })).filter((comment) => comment.text) : []
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
    objects: seed.objects.map((item, index) => seedBlockRevisions({
      ...item,
      id: index + 1,
      projectId: DEFAULT_PROJECT_ID,
      documentation: normalizeDocumentation(item.documentation),
      revisions: normalizeRevisions(item.revisions, index + 1)
    })),
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

