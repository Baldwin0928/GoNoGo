// Shared Supabase board persistence: auth, JSON blob save/load, realtime sync.
let cloudClient = null;
let cloudSession = null;
let cloudChannel = null;
let cloudSaveTimer = null;
let cloudApplyingRemote = false;
let cloudReady = false;
let cloudLastRemoteAt = "";
let cloudMembership = null;
let cloudBoardMembers = [];

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

function initialsForName(value) {
  const clean = String(value || "")
    .replace(/@.*/, "")
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .trim();
  if (!clean) return "PL";
  const parts = clean.split(/\s+/).filter(Boolean);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0] || ""}${parts[parts.length - 1][0] || ""}`.toUpperCase();
}

function updateSignedInUserChrome(user) {
  const name = cloudUserName(user);
  const initials = initialsForName(name);
  document.querySelectorAll(".avatar").forEach((avatar) => {
    avatar.textContent = initials;
    avatar.title = name;
    avatar.setAttribute("aria-label", `Signed in as ${name}`);
  });
}

function authRedirectUrl() {
  return window.location.href.split("#")[0];
}

function authEmailErrorMessage(error, fallback) {
  if (!error) return fallback;
  const message = error.message || String(error);
  if (/rate limit/i.test(message)) {
    return "Supabase email rate limit hit. Wait a bit before sending another link, or sign in with your password.";
  }
  if (/redirect/i.test(message)) {
    return `${message} Check Supabase Auth URL Configuration for this site URL.`;
  }
  return message;
}

function authElements() {
  const card = document.getElementById("cloudAuthForm");
  return {
    screen: document.getElementById("cloudAuthScreen"),
    card,
    title: card?.querySelector("h1"),
    body: card?.querySelector("p"),
    emailLabel: card?.querySelector("label"),
    emailInput: document.getElementById("cloudAuthEmail"),
    nameLabel: document.getElementById("cloudNameLabel"),
    nameInput: document.getElementById("cloudAuthName"),
    passwordLabel: document.getElementById("cloudPasswordLabel"),
    passwordInput: document.getElementById("cloudAuthPassword"),
    submit: document.getElementById("cloudAuthSubmitBtn"),
    signUp: document.getElementById("cloudSignUpBtn"),
    magic: document.getElementById("cloudMagicLinkBtn"),
    reset: document.getElementById("cloudResetPasswordBtn"),
    local: document.getElementById("cloudLocalFallbackBtn"),
    screenSignOut: document.getElementById("cloudSignOutBtn"),
    msg: document.getElementById("cloudAuthMessage")
  };
}

function setPasswordSetupScreen(message = "") {
  const el = authElements();
  if (el.screen) el.screen.hidden = false;
  if (el.title) el.title.textContent = "Set your password";
  if (el.body) el.body.textContent = "Choose a password for faster sign-in next time.";
  if (el.emailLabel) el.emailLabel.hidden = true;
  if (el.emailInput) el.emailInput.required = false;
  if (el.nameLabel) el.nameLabel.hidden = true;
  if (el.nameInput) el.nameInput.required = false;
  if (el.passwordLabel) el.passwordLabel.hidden = false;
  if (el.passwordInput) {
    el.passwordInput.required = true;
    el.passwordInput.value = "";
    el.passwordInput.autocomplete = "new-password";
    el.passwordInput.placeholder = "New password";
    el.passwordInput.focus();
  }
  if (el.submit) {
    el.submit.hidden = false;
    el.submit.textContent = "Save password";
    el.submit.dataset.authMode = "set-password";
  }
  if (el.signUp) el.signUp.hidden = true;
  if (el.magic) el.magic.hidden = true;
  if (el.reset) el.reset.hidden = true;
  if (el.local) el.local.hidden = true;
  if (el.screenSignOut) {
    el.screenSignOut.hidden = false;
    el.screenSignOut.textContent = "Cancel";
  }
  if (el.msg) el.msg.textContent = message || "Use at least 6 characters.";
  document.body.classList.add("auth-locked");
}

function showPendingAccessScreen(message) {
  const el = authElements();
  if (el.screen) el.screen.hidden = false;
  if (el.title) el.title.textContent = "Waiting for approval";
  if (el.body) el.body.textContent = "Your email is verified. An admin needs to approve your access before this shared board opens.";
  if (el.emailLabel) el.emailLabel.hidden = true;
  if (el.emailInput) el.emailInput.required = false;
  if (el.nameLabel) el.nameLabel.hidden = true;
  if (el.nameInput) el.nameInput.required = false;
  if (el.passwordLabel) el.passwordLabel.hidden = true;
  if (el.passwordInput) el.passwordInput.required = false;
  if (el.submit) el.submit.hidden = true;
  if (el.signUp) el.signUp.hidden = true;
  if (el.magic) el.magic.hidden = true;
  if (el.reset) el.reset.hidden = true;
  if (el.local) {
    el.local.hidden = false;
    el.local.textContent = "Continue locally";
  }
  if (el.screenSignOut) {
    el.screenSignOut.hidden = false;
    el.screenSignOut.textContent = "Use a different email";
  }
  if (el.msg) el.msg.textContent = message || "Your request is pending. Ask the workspace admin to approve you in Supabase.";
  document.body.classList.add("auth-locked");
}

function resetAuthScreen() {
  const el = authElements();
  if (el.title) el.title.textContent = "Project Management";
  if (el.body) el.body.textContent = "Use your team email to open the shared readiness board.";
  if (el.emailLabel) el.emailLabel.hidden = false;
  if (el.emailInput) {
    el.emailInput.required = true;
    el.emailInput.disabled = false;
  }
  if (el.nameLabel) el.nameLabel.hidden = true;
  if (el.nameInput) {
    el.nameInput.required = false;
    el.nameInput.value = "";
  }
  if (el.passwordLabel) el.passwordLabel.hidden = false;
  if (el.passwordInput) {
    el.passwordInput.required = false;
    el.passwordInput.autocomplete = "current-password";
    el.passwordInput.placeholder = "Your password";
  }
  if (el.submit) {
    el.submit.hidden = false;
    el.submit.textContent = "Sign in";
    el.submit.dataset.authMode = "sign-in";
  }
  if (el.signUp) el.signUp.hidden = false;
  if (el.magic) el.magic.hidden = false;
  if (el.reset) el.reset.hidden = false;
  if (el.local) {
    el.local.hidden = false;
    el.local.textContent = "Continue locally";
  }
  if (el.screenSignOut) {
    el.screenSignOut.hidden = true;
    el.screenSignOut.textContent = "Use a different email";
  }
  if (el.msg) el.msg.textContent = "Sign in with your password, or use magic link as backup.";
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

function getCloudMembers() {
  return cloudBoardMembers;
}

function canManageCloudMembers() {
  return Boolean(cloudReady && cloudMembership?.role === "admin" && cloudMembership?.status === "approved");
}

async function loadCloudMembers() {
  if (!cloudClient || !cloudSession || !cloudMembership) return [];
  const { data, error } = await cloudClient
    .from("board_members")
    .select("id, board_id, user_id, email, role, status, requested_at, approved_at")
    .eq("board_id", SUPABASE_CONFIG.boardId)
    .order("requested_at", { ascending: false });

  if (error) {
    console.warn("Cloud members could not be loaded.", error);
    cloudBoardMembers = [];
    return cloudBoardMembers;
  }

  cloudBoardMembers = data || [];
  return cloudBoardMembers;
}

async function inviteCloudMember({ email, role }) {
  if (!canManageCloudMembers()) {
    throw new Error("Only approved admins can invite or approve workspace members.");
  }
  const normalizedEmail = (email || "").trim().toLowerCase();
  const normalizedRole = ["admin", "editor", "viewer"].includes((role || "").toLowerCase())
    ? role.toLowerCase()
    : "editor";
  if (!normalizedEmail) throw new Error("Enter an email address.");

  const { data: existing, error: existingError } = await cloudClient
    .from("board_members")
    .select("id")
    .eq("board_id", SUPABASE_CONFIG.boardId)
    .ilike("email", normalizedEmail)
    .maybeSingle();

  if (existingError) throw existingError;

  const payload = {
    board_id: SUPABASE_CONFIG.boardId,
    email: normalizedEmail,
    role: normalizedRole,
    status: "approved",
    approved_at: new Date().toISOString(),
    approved_by: cloudSession.user.id
  };

  const query = existing
    ? cloudClient.from("board_members").update(payload).eq("id", existing.id)
    : cloudClient.from("board_members").insert(payload);
  const { error } = await query;
  if (error) throw error;
  await loadCloudMembers();
  renderAll();
}

async function updateCloudMember(memberId, updates) {
  if (!canManageCloudMembers()) {
    throw new Error("Only approved admins can manage workspace members.");
  }
  const payload = { ...updates };
  if (payload.role) payload.role = payload.role.toLowerCase();
  if (payload.status === "approved") {
    payload.approved_at = new Date().toISOString();
    payload.approved_by = cloudSession.user.id;
  }
  const { error } = await cloudClient.from("board_members").update(payload).eq("id", memberId);
  if (error) throw error;
  await loadCloudMembers();
  renderAll();
}

async function removeCloudMember(memberId) {
  if (!canManageCloudMembers()) {
    throw new Error("Only approved admins can remove workspace members.");
  }
  const { error } = await cloudClient.from("board_members").delete().eq("id", memberId);
  if (error) throw error;
  await loadCloudMembers();
  renderAll();
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
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "board_members",
        filter: `board_id=eq.${SUPABASE_CONFIG.boardId}`
      },
      async () => {
        await loadCloudMembers();
        renderAll();
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
  updateSignedInUserChrome(session.user);
  const signOut = document.getElementById("signOutBtn");
  if (signOut) signOut.hidden = false;
  const setPassword = document.getElementById("setPasswordBtn");
  if (setPassword) setPassword.hidden = false;

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
  await loadCloudMembers();
  subscribeCloudBoard();
  renderAll();
}

async function handleSignedOut() {
  cloudSession = null;
  cloudMembership = null;
  cloudBoardMembers = [];
  cloudReady = false;
  updateSignedInUserChrome({ user_metadata: { full_name: "Propulsive Landers" } });
  if (cloudChannel && cloudClient) cloudClient.removeChannel(cloudChannel);
  cloudChannel = null;
  const signOut = document.getElementById("signOutBtn");
  if (signOut) signOut.hidden = true;
  const setPassword = document.getElementById("setPasswordBtn");
  if (setPassword) setPassword.hidden = true;
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

  cloudClient.auth.onAuthStateChange((event, session) => {
    if (event === "PASSWORD_RECOVERY") {
      cloudSession = session;
      if (session?.user) {
        state.currentUser = cloudUserName(session.user);
        state.currentUserEmail = session.user.email || "";
      }
      setPasswordSetupScreen("Enter a new password to finish recovery.");
      return;
    }
    if (session) handleSignedIn(session);
    else handleSignedOut();
  });
}

document.getElementById("cloudAuthForm")?.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!cloudClient) return;
  const email = document.getElementById("cloudAuthEmail")?.value.trim();
  const password = document.getElementById("cloudAuthPassword")?.value || "";
  const message = document.getElementById("cloudAuthMessage");
  const mode = document.getElementById("cloudAuthSubmitBtn")?.dataset.authMode || "sign-in";

  if (mode === "set-password") {
    if (!password || password.length < 6) {
      if (message) message.textContent = "Use at least 6 characters.";
      return;
    }
    setSyncStatus("Saving password", "syncing");
    const { error } = await cloudClient.auth.updateUser({ password });
    if (message) message.textContent = error ? error.message : "Password saved. You can use it next time you sign in.";
    if (!error) {
      const { data } = await cloudClient.auth.getSession();
      if (data.session || cloudSession) {
        await handleSignedIn(data.session || cloudSession);
      } else {
        setAuthScreen(false);
        resetAuthScreen();
        setSyncStatus("Password saved", "synced");
      }
    }
    return;
  }

  if (!email || !password) {
    if (message) message.textContent = "Enter your email and password, or use magic link.";
    return;
  }

  setSyncStatus("Signing in", "syncing");
  const { error } = await cloudClient.auth.signInWithPassword({ email, password });
  if (message) message.textContent = error ? error.message : "Signed in.";
});

document.getElementById("cloudSignUpBtn")?.addEventListener("click", async () => {
  if (!cloudClient) return;
  const el = authElements();
  const email = el.emailInput?.value.trim();
  const password = el.passwordInput?.value || "";
  const fullName = el.nameInput?.value.trim();
  const message = el.msg;
  if (el.nameLabel?.hidden) {
    el.nameLabel.hidden = false;
    if (el.nameInput) {
      el.nameInput.required = true;
      el.nameInput.focus();
    }
    if (message) message.textContent = "Enter your full name, email, and password to create an account.";
    return;
  }
  if (!fullName) {
    if (message) message.textContent = "Enter your full name so teammates know who you are.";
    el.nameInput?.focus();
    return;
  }
  if (!email || !password) {
    if (message) message.textContent = "Enter an email and password to create an account.";
    return;
  }
  if (password.length < 6) {
    if (message) message.textContent = "Use at least 6 characters.";
    return;
  }
  setSyncStatus("Creating account", "syncing");
  const { error } = await cloudClient.auth.signUp({
    email,
    password,
    options: {
      emailRedirectTo: authRedirectUrl(),
      data: { full_name: fullName, name: fullName }
    }
  });
  if (message) message.textContent = authEmailErrorMessage(error, "Account created. Check your email if Supabase asks you to confirm it.");
  setSyncStatus(error ? "Email failed" : "Account created", error ? "offline" : "synced");
});

document.getElementById("cloudMagicLinkBtn")?.addEventListener("click", async () => {
  if (!cloudClient) return;
  const email = document.getElementById("cloudAuthEmail")?.value.trim();
  const message = document.getElementById("cloudAuthMessage");
  if (!email) {
    if (message) message.textContent = "Enter your email first.";
    return;
  }
  setSyncStatus("Sending email", "syncing");
  const { error } = await cloudClient.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: authRedirectUrl() }
  });
  if (message) message.textContent = authEmailErrorMessage(error, "Check your email for the magic sign-in link.");
  setSyncStatus(error ? "Email failed" : "Email sent", error ? "offline" : "synced");
});

document.getElementById("cloudResetPasswordBtn")?.addEventListener("click", async () => {
  if (!cloudClient) return;
  const email = document.getElementById("cloudAuthEmail")?.value.trim();
  const message = document.getElementById("cloudAuthMessage");
  if (!email) {
    if (message) message.textContent = "Enter your email first.";
    return;
  }
  setSyncStatus("Sending reset", "syncing");
  const { error } = await cloudClient.auth.resetPasswordForEmail(email, {
    redirectTo: authRedirectUrl()
  });
  if (message) message.textContent = authEmailErrorMessage(error, "Check your email for the password reset link.");
  setSyncStatus(error ? "Email failed" : "Reset email sent", error ? "offline" : "synced");
});

document.getElementById("signOutBtn")?.addEventListener("click", async () => {
  await cloudClient?.auth.signOut();
});

document.getElementById("cloudSignOutBtn")?.addEventListener("click", async () => {
  if (document.getElementById("cloudAuthSubmitBtn")?.dataset.authMode === "set-password" && cloudSession) {
    setAuthScreen(false);
    resetAuthScreen();
    return;
  }
  await cloudClient?.auth.signOut();
});

document.getElementById("setPasswordBtn")?.addEventListener("click", () => {
  setPasswordSetupScreen();
});

document.getElementById("cloudLocalFallbackBtn")?.addEventListener("click", () => {
  setAuthScreen(false);
  setSyncStatus("Offline local", "offline");
});

initCloudSync();
