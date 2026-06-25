// Split from app.js - constants, seed data, object factories, blank board
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

