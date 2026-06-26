// Shared Supabase board persistence: auth, JSON blob save/load, realtime sync.
let cloudClient = null;
let cloudSession = null;
let cloudChannel = null;
let cloudSaveTimer = null;
let cloudApplyingRemote = false;
let cloudReady = false;
let cloudLastRemoteAt = "";

function setSyncStatus(label, tone = "local") {
  const status = document.getElementById("syncStatus");
  if (!status) return;
  status.textContent = label;
  status.dataset.tone = tone;
}

function setAuthScreen(visible, message = "") {
  const screen = document.getElementById("cloudAuthScreen");
  const msg = document.getElementById("cloudAuthMessage");
  if (screen) screen.hidden = !visible;
  document.body.classList.toggle("auth-locked", Boolean(visible));
  if (msg && message) msg.textContent = message;
}

function cloudUserName(user) {
  return user?.user_metadata?.full_name || user?.user_metadata?.name || user?.email || "You";
}

function serializableBoardState() {
  const copy = cloneState();
  delete copy.currentUser;
  delete copy.currentUserEmail;
  return copy;
}

function isValidBoardState(value) {
  return value && Array.isArray(value.objects) && Array.isArray(value.dependencies);
}

function isUserActivelyEditing() {
  const active = document.activeElement;
  const isFormField = active?.matches?.("input, textarea, select, [contenteditable='true']");
  return Boolean(dragState || panState || isFormField);
}

function applyRemoteState(remoteState) {
  if (!isValidBoardState(remoteState)) return false;
  const localUser = state.currentUser;
  const localEmail = state.currentUserEmail;
  cloudApplyingRemote = true;
  state = normalizeState(remoteState);
  state.currentUser = localUser;
  state.currentUserEmail = localEmail;
  selectedObjectId = byId(selectedObjectId) ? selectedObjectId : state.objects[0]?.id || null;
  selectedObjectIds = selectedObjectId ? new Set([selectedObjectId]) : new Set();
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  renderAll();
  cloudApplyingRemote = false;
  return true;
}

function scheduleRemoteState(remoteState, attempt = 0) {
  if (!isValidBoardState(remoteState)) return;
  if (isUserActivelyEditing() && attempt < 12) {
    window.setTimeout(() => scheduleRemoteState(remoteState, attempt + 1), 750);
    return;
  }
  applyRemoteState(remoteState);
}

async function loadCloudBoard() {
  if (!cloudClient || !cloudSession) return false;
  setSyncStatus("Syncing", "syncing");
  const { data, error } = await cloudClient
    .from("boards")
    .select("state, updated_at")
    .eq("id", SUPABASE_CONFIG.boardId)
    .single();

  if (error) {
    console.warn("Cloud load failed; using local fallback.", error);
    setSyncStatus("Offline local", "offline");
    return false;
  }

  cloudLastRemoteAt = data?.updated_at || "";
  if (isValidBoardState(data?.state)) {
    applyRemoteState(data.state);
  } else {
    await saveCloudBoardNow();
  }
  setSyncStatus("Synced", "synced");
  return true;
}

async function saveCloudBoardNow() {
  if (!cloudClient || !cloudSession || cloudApplyingRemote) return;
  const payload = {
    id: SUPABASE_CONFIG.boardId,
    state: serializableBoardState(),
    updated_by: cloudSession.user.id,
    updated_at: new Date().toISOString()
  };
  setSyncStatus("Saving", "syncing");
  const { error } = await cloudClient
    .from("boards")
    .upsert(payload, { onConflict: "id" });

  if (error) {
    console.warn("Cloud save failed; kept local copy.", error);
    setSyncStatus("Offline local", "offline");
    return;
  }
  setSyncStatus("Synced", "synced");
}

function queueCloudSave() {
  if (!cloudReady || cloudApplyingRemote || !cloudSession) return;
  window.clearTimeout(cloudSaveTimer);
  cloudSaveTimer = window.setTimeout(saveCloudBoardNow, 800);
}

function subscribeCloudBoard() {
  if (!cloudClient || !cloudSession) return;
  if (cloudChannel) cloudClient.removeChannel(cloudChannel);
  cloudChannel = cloudClient
    .channel(`board-${SUPABASE_CONFIG.boardId}`)
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "boards",
        filter: `id=eq.${SUPABASE_CONFIG.boardId}`
      },
      (payload) => {
        const updatedBy = payload.new?.updated_by;
        if (updatedBy && updatedBy === cloudSession.user.id) return;
        if (!isValidBoardState(payload.new?.state)) return;
        scheduleRemoteState(payload.new.state);
        setSyncStatus("Synced", "synced");
      }
    )
    .subscribe((status) => {
      if (status === "SUBSCRIBED") setSyncStatus("Live", "synced");
    });
}

async function handleSignedIn(session) {
  cloudSession = session;
  state.currentUser = cloudUserName(session.user);
  state.currentUserEmail = session.user.email || "";
  const signOut = document.getElementById("signOutBtn");
  if (signOut) signOut.hidden = false;
  setAuthScreen(false);
  cloudReady = true;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  await loadCloudBoard();
  subscribeCloudBoard();
  renderAll();
}

async function handleSignedOut() {
  cloudSession = null;
  cloudReady = false;
  if (cloudChannel && cloudClient) cloudClient.removeChannel(cloudChannel);
  cloudChannel = null;
  const signOut = document.getElementById("signOutBtn");
  if (signOut) signOut.hidden = true;
  setSyncStatus("Local", "local");
  if (SUPABASE_CONFIG.authRequired) setAuthScreen(true);
}

async function initCloudSync() {
  if (!window.supabase?.createClient) {
    setSyncStatus("Local", "local");
    if (SUPABASE_CONFIG.authRequired) setAuthScreen(true, "Supabase client did not load. Use a local server or check your connection.");
    return;
  }
  cloudClient = window.supabase.createClient(SUPABASE_CONFIG.url, SUPABASE_CONFIG.publishableKey);

  const { data } = await cloudClient.auth.getSession();
  if (data.session) await handleSignedIn(data.session);
  else await handleSignedOut();

  cloudClient.auth.onAuthStateChange((_event, session) => {
    if (session) handleSignedIn(session);
    else handleSignedOut();
  });
}

document.getElementById("cloudAuthForm")?.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!cloudClient) return;
  const email = document.getElementById("cloudAuthEmail")?.value.trim();
  if (!email) return;
  setSyncStatus("Email sent", "syncing");
  const { error } = await cloudClient.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: window.location.href.split("#")[0] }
  });
  const message = document.getElementById("cloudAuthMessage");
  if (message) message.textContent = error ? error.message : "Check your email for the magic sign-in link.";
});

document.getElementById("signOutBtn")?.addEventListener("click", async () => {
  await cloudClient?.auth.signOut();
});

document.getElementById("cloudLocalFallbackBtn")?.addEventListener("click", () => {
  setAuthScreen(false);
  setSyncStatus("Offline local", "offline");
});

initCloudSync();
