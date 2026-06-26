// Shared Supabase board persistence: auth, JSON blob save/load, realtime sync.
let cloudClient = null;
let cloudSession = null;
let cloudChannel = null;
let cloudSaveTimer = null;
let cloudApplyingRemote = false;
let cloudReady = false;
let cloudLastRemoteAt = "";
let cloudMembership = null;

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

function cloudUserEmail(user) {
  return (user?.email || "").trim().toLowerCase();
}

function showPendingAccessScreen(message) {
  const screen = document.getElementById("cloudAuthScreen");
  const card = document.getElementById("cloudAuthForm");
  const emailInput = document.getElementById("cloudAuthEmail");
  const submit = card?.querySelector("button[type='submit']");
  const localBtn = document.getElementById("cloudLocalFallbackBtn");
  const screenSignOut = document.getElementById("cloudSignOutBtn");
  const msg = document.getElementById("cloudAuthMessage");
  if (screen) screen.hidden = false;
  if (card) {
    const title = card.querySelector("h1");
    const body = card.querySelector("p");
    const label = card.querySelector("label");
    if (title) title.textContent = "Waiting for approval";
    if (body) body.textContent = "Your email is verified. An admin needs to approve your access before this shared board opens.";
    if (label) label.hidden = true;
  }
  if (emailInput) emailInput.required = false;
  if (submit) submit.hidden = true;
  if (localBtn) {
    localBtn.hidden = false;
    localBtn.textContent = "Continue locally";
  }
  if (screenSignOut) screenSignOut.hidden = false;
  if (msg) msg.textContent = message || "Your request is pending. Ask the workspace admin to approve you in Supabase.";
  document.body.classList.add("auth-locked");
}

function resetAuthScreen() {
  const card = document.getElementById("cloudAuthForm");
  const emailInput = document.getElementById("cloudAuthEmail");
  const submit = card?.querySelector("button[type='submit']");
  const localBtn = document.getElementById("cloudLocalFallbackBtn");
  const screenSignOut = document.getElementById("cloudSignOutBtn");
  const msg = document.getElementById("cloudAuthMessage");
  if (card) {
    const title = card.querySelector("h1");
    const body = card.querySelector("p");
    const label = card.querySelector("label");
    if (title) title.textContent = "Sign in to GoNoGo";
    if (body) body.textContent = "Use your team email to open the shared readiness board.";
    if (label) label.hidden = false;
  }
  if (emailInput) emailInput.required = true;
  if (submit) submit.hidden = false;
  if (localBtn) {
    localBtn.hidden = false;
    localBtn.textContent = "Continue locally";
  }
  if (screenSignOut) screenSignOut.hidden = true;
  if (msg) msg.textContent = "You will get a secure sign-in link by email.";
}

async function getOrCreateMembership(user) {
  if (!cloudClient || !user) return null;
  const email = cloudUserEmail(user);
  if (!email) return null;

  const { data, error } = await cloudClient
    .from("board_members")
    .select("board_id, email, role, status, requested_at, approved_at")
    .eq("board_id", SUPABASE_CONFIG.boardId)
    .ilike("email", email)
    .maybeSingle();

  if (error) {
    console.warn("Membership check failed.", error);
    return { status: "error", role: "viewer", email };
  }

  if (data) return data;

  const { data: inserted, error: insertError } = await cloudClient
    .from("board_members")
    .insert({
      board_id: SUPABASE_CONFIG.boardId,
      user_id: user.id,
      email,
      role: "editor",
      status: "pending"
    })
    .select("board_id, email, role, status, requested_at, approved_at")
    .single();

  if (insertError) {
    console.warn("Access request could not be created.", insertError);
    return { status: "error", role: "viewer", email };
  }

  return inserted;
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

  setSyncStatus("Checking access", "syncing");
  cloudMembership = await getOrCreateMembership(session.user);
  if (!cloudMembership || cloudMembership.status !== "approved") {
    cloudReady = false;
    const status = cloudMembership?.status === "error" ? "Access check failed" : "Pending approval";
    setSyncStatus(status, cloudMembership?.status === "error" ? "offline" : "syncing");
    showPendingAccessScreen(
      cloudMembership?.status === "error"
        ? "Could not verify board access. You can continue locally, or try signing in again."
        : `Access request sent for ${state.currentUserEmail}. Admin approval is required before this shared board opens.`
    );
    return;
  }

  setAuthScreen(false);
  cloudReady = true;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  await loadCloudBoard();
  subscribeCloudBoard();
  renderAll();
}

async function handleSignedOut() {
  cloudSession = null;
  cloudMembership = null;
  cloudReady = false;
  if (cloudChannel && cloudClient) cloudClient.removeChannel(cloudChannel);
  cloudChannel = null;
  const signOut = document.getElementById("signOutBtn");
  if (signOut) signOut.hidden = true;
  setSyncStatus("Local", "local");
  resetAuthScreen();
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

document.getElementById("cloudSignOutBtn")?.addEventListener("click", async () => {
  await cloudClient?.auth.signOut();
});

document.getElementById("cloudLocalFallbackBtn")?.addEventListener("click", () => {
  setAuthScreen(false);
  setSyncStatus("Offline local", "offline");
});

initCloudSync();
