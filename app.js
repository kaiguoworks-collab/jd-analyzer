const els = {
  profileList: document.getElementById("profile-list"),
  addProfileBtn: document.getElementById("add-profile-btn"),
  addUserBtn: document.getElementById("add-user-btn"),
  openIntakeBtn: document.getElementById("open-intake-btn"),
  profileModal: document.getElementById("profile-modal"),
  profileForm: document.getElementById("profile-form"),
  profileName: document.getElementById("profile-name"),
  profileUser: document.getElementById("profile-user"),
  profileKeywordCloud: document.getElementById("profile-keyword-cloud"),
  profileRoleCloud: document.getElementById("profile-role-cloud"),
  refreshKeywordsBtn: document.getElementById("refresh-keywords-btn"),
  profileResumeFile: document.getElementById("profile-resume-file"),
  profileResumeText: document.getElementById("profile-resume-text"),
  userModal: document.getElementById("user-modal"),
  userForm: document.getElementById("user-form"),
  userName: document.getElementById("user-name"),
  userModalTitle: document.getElementById("user-modal-title"),
  userModalConfirm: document.getElementById("user-modal-confirm"),
  userModalCancel: document.getElementById("user-modal-cancel"),
  profileModalCancel: document.getElementById("profile-modal-cancel"),
  resumeProfileLabel: document.getElementById("resume-profile-label"),
  resumeFile: document.getElementById("resume-file"),
  resumeText: document.getElementById("resume-text"),
  clearResumeBtn: document.getElementById("clear-resume-btn"),
  resumeEmpty: document.getElementById("resume-empty"),
  resumePreview: document.getElementById("resume-preview"),
  resumeMeta: document.getElementById("resume-meta"),
  resumeFrame: document.getElementById("resume-frame"),
  resumeBody: document.getElementById("resume-body"),
  jdUrl: document.getElementById("jd-url"),
  jdText: document.getElementById("jd-text"),
  addJdBtn: document.getElementById("add-jd-btn"),
  jdList: document.getElementById("jd-list"),
  analyzeHint: document.getElementById("analyze-hint"),
  resultsEmpty: document.getElementById("results-empty"),
  resultsBody: document.getElementById("results-body"),
  resultsSubtitle: document.getElementById("results-subtitle"),
  resultJdLink: document.getElementById("result-jd-link"),
  resultActions: document.getElementById("result-actions"),
  resultApplyBtn: document.getElementById("result-apply-btn"),
  resultPlusBtn: document.getElementById("result-plus-btn"),
  resultDiscardBtn: document.getElementById("result-discard-btn"),
  overallRing: document.getElementById("overall-ring"),
  overallValue: document.getElementById("overall-value"),
  overallCaption: document.getElementById("overall-caption"),
  keywordScore: document.getElementById("keyword-score"),
  keywordBar: document.getElementById("keyword-bar"),
  experienceScore: document.getElementById("experience-score"),
  experienceBar: document.getElementById("experience-bar"),
  locationScore: document.getElementById("location-score"),
  locationBar: document.getElementById("location-bar"),
  strengthList: document.getElementById("strength-list"),
  weaknessList: document.getElementById("weakness-list"),
  missingKeywordCloud: document.getElementById("missing-keyword-cloud"),
  knockoutList: document.getElementById("knockout-list"),
  workstyleBadge: document.getElementById("workstyle-badge"),
  workstyleNote: document.getElementById("workstyle-note"),
  companyFlagSlot: document.getElementById("company-flag-slot"),
  resultsCard: document.getElementById("results-card"),
  appliedList: document.getElementById("selected-list"),
  appliedOpenBtn: document.getElementById("selected-apply-btn"),
  selectedBackupBtn: document.getElementById("selected-backup-btn"),
  selectedCount: document.getElementById("selected-count"),
  selectedSelectAll: document.getElementById("selected-select-all"),
  selectedSelectAllWrap: document.getElementById("selected-select-all-wrap"),
  appliedHistoryList: document.getElementById("applied-history-list"),
  discardedHistoryList: document.getElementById("discarded-history-list"),
  jdBulkBar: document.getElementById("jd-bulk-bar"),
  jdBulkCount: document.getElementById("jd-bulk-count"),
  jdBulkApply: document.getElementById("jd-bulk-apply"),
  jdBulkPlus: document.getElementById("jd-bulk-plus"),
  jdBulkDiscard: document.getElementById("jd-bulk-discard"),
  jdSelectAll: document.getElementById("jd-select-all"),
  appliedBulkBar: document.getElementById("applied-bulk-bar"),
  appliedBulkCount: document.getElementById("applied-bulk-count"),
  appliedBulkBackup: document.getElementById("applied-bulk-backup"),
  appliedBulkDiscard: document.getElementById("applied-bulk-discard"),
  appliedSelectAll: document.getElementById("applied-select-all"),
  discardedBulkBar: document.getElementById("discarded-bulk-bar"),
  discardedBulkCount: document.getElementById("discarded-bulk-count"),
  discardedBulkApply: document.getElementById("discarded-bulk-apply"),
  discardedBulkBackup: document.getElementById("discarded-bulk-backup"),
  discardedSelectAll: document.getElementById("discarded-select-all"),
  applyConfirmModal: document.getElementById("apply-confirm-modal"),
  applyConfirmForm: document.getElementById("apply-confirm-form"),
  applyConfirmTitle: document.getElementById("apply-confirm-title"),
  applyConfirmCopy: document.getElementById("apply-confirm-copy"),
  applyConfirmList: document.getElementById("apply-confirm-list"),
  applyConfirmNo: document.getElementById("apply-confirm-no"),
  applyConfirmYes: document.getElementById("apply-confirm-yes"),
};

const INBOX_KEY = "jd-inbox";

const state = {
  users: [],
  editingUserId: null,
  profiles: [],
  activeProfileId: null,
  jobDescriptions: [],
  selectedResultId: null,
  resumeObjectUrl: null,
  saveTimer: null,
  keywordTimer: null,
  pendingApplyJobIds: [],
  applyPrompt: { jobIds: [], leftPage: false, shown: false },
  checkedSelectedIds: new Set(),
  checkedMainIds: new Set(),
  checkedAppliedIds: new Set(),
  checkedDiscardedIds: new Set(),
  applyHistory: [],
  analyzeControllers: new Map(),
};

function uid() {
  return `jd-${Date.now().toString(16)}-${Math.random().toString(16).slice(2, 12)}`;
}

function activeProfile() {
  return state.profiles.find((profile) => profile.id === state.activeProfileId) || null;
}

async function apiJson(url, options) {
  const fetchOptions = options ? Object.assign({}, options) : {};
  const waitMs =
    Number(fetchOptions.timeoutMs) ||
    (String(url).includes("/analyze")
      ? 180000
      : String(url).includes("/keywords")
        ? 120000
        : 45000);
  const externalSignal = fetchOptions.signal;
  delete fetchOptions.timeoutMs;
  delete fetchOptions.signal;
  const canAbort = typeof AbortController === "function";
  const controller = canAbort ? new AbortController() : null;
  if (controller) fetchOptions.signal = controller.signal;
  const onExternalAbort = () => {
    if (controller) controller.abort();
  };
  if (externalSignal) {
    if (externalSignal.aborted) onExternalAbort();
    else externalSignal.addEventListener("abort", onExternalAbort);
  }
  const timer = setTimeout(() => {
    if (controller) controller.abort();
  }, waitMs);
  let response;
  try {
    response = await fetch(url, fetchOptions);
  } catch (error) {
    if (error && error.name === "AbortError") {
      if (externalSignal && externalSignal.aborted) {
        const stopped = new Error("Analyze was stopped.");
        stopped.name = "AbortError";
        throw stopped;
      }
      throw new Error("The server took too long to respond. Click Analyze again.");
    }
    throw new Error(
      "Could not reach the JD Analyzer server. On this machine open http://HOST:PORT from the PC that is running python server.py. Do not open the HTML file directly."
    );
  } finally {
    clearTimeout(timer);
    if (externalSignal) externalSignal.removeEventListener("abort", onExternalAbort);
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || "Request failed.");
  }
  return data;
}

function openDialog(dialog) {
  if (!dialog) return;
  try {
    if (typeof dialog.showModal === "function") {
      if (!dialog.open) dialog.showModal();
      return;
    }
  } catch (_error) {
    // Older browsers fall through to the open attribute.
  }
  dialog.setAttribute("open", "");
}

function closeDialog(dialog) {
  if (!dialog) return;
  try {
    if (typeof dialog.close === "function") {
      dialog.close();
      return;
    }
  } catch (_error) {
    // Older browsers fall through.
  }
  dialog.removeAttribute("open");
}

function parseKeywords(value) {
  return String(value || "")
    .split(/[\n,;|]+/)
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 40);
}

function flattenUsers(users) {
  state.users = Array.isArray(users) ? users : [];
  state.profiles = state.users.flatMap((user) =>
    (user.profiles || []).map((profile) => ({
      ...profile,
      userId: user.id,
      userName: user.name,
    }))
  );
}

function fillProfileUserSelect(preferredId) {
  if (!els.profileUser) return;
  const selected = preferredId || activeProfile()?.userId || state.users[0]?.id || "";
  els.profileUser.innerHTML = state.users
    .map(
      (user) =>
        `<option value="${escapeHtml(user.id)}"${user.id === selected ? " selected" : ""}>${escapeHtml(user.name)}</option>`
    )
    .join("");
}

function renderProfiles() {
  els.profileList.innerHTML = "";
  if (!state.users.length && !state.profiles.length) {
    els.profileList.innerHTML = `<div class="empty-state" style="min-height:90px"><span>Create a user, then add profiles under that user.</span></div>`;
    return;
  }

  state.users.forEach((user) => {
    const group = document.createElement("div");
    group.className = "user-group";
    group.dataset.userId = user.id;
    bindUserDropTarget(group, user.id);
    const head = document.createElement("div");
    head.className = "user-group-head";
    head.innerHTML = `<strong>${escapeHtml(user.name)}</strong>`;
    const actions = document.createElement("div");
    actions.className = "user-group-actions";
    const editUser = document.createElement("button");
    editUser.type = "button";
    editUser.className = "user-edit";
    editUser.setAttribute("aria-label", `Edit ${user.name}`);
    editUser.textContent = "Edit";
    editUser.addEventListener("click", (event) => {
      event.stopPropagation();
      openUserModal(user);
    });
    const removeUser = document.createElement("button");
    removeUser.type = "button";
    removeUser.className = "remove";
    removeUser.setAttribute("aria-label", `Remove ${user.name}`);
    removeUser.textContent = "×";
    removeUser.addEventListener("click", (event) => {
      event.stopPropagation();
      removeUserById(user.id);
    });
    actions.append(editUser, removeUser);
    head.appendChild(actions);
    group.appendChild(head);

    const profiles = state.profiles.filter((profile) => profile.userId === user.id);
    if (!profiles.length) {
      const empty = document.createElement("p");
      empty.className = "muted user-group-empty";
      empty.textContent = "No profiles yet.";
      group.appendChild(empty);
    }
    profiles.forEach((profile) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `profile-item${profile.id === state.activeProfileId ? " active" : ""}`;
      const roleCount = Array.isArray(profile.roles) ? profile.roles.length : 0;
      const keywordCount = Array.isArray(profile.keywords) ? profile.keywords.length : 0;
      const tagNote = [
        roleCount ? `${roleCount} role${roleCount === 1 ? "" : "s"}` : "",
        keywordCount ? `${keywordCount} keyword${keywordCount === 1 ? "" : "s"}` : "",
      ]
        .filter(Boolean)
        .join(" · ");
      button.innerHTML = `
        <span>
          <b>${escapeHtml(profile.name)}</b>
          <small>${profile.resumeName || profile.resumeText ? "Resume attached" : "No resume yet"}${
            tagNote ? ` · ${tagNote}` : ""
          }</small>
        </span>
      `;
      button.draggable = true;
      button.dataset.profileId = profile.id;
      button.addEventListener("dragstart", (event) => {
        event.dataTransfer.setData("text/plain", profile.id);
        event.dataTransfer.effectAllowed = "move";
        button.classList.add("is-dragging");
      });
      button.addEventListener("dragend", () => {
        button.classList.remove("is-dragging");
        document.querySelectorAll(".user-group.is-drop-target").forEach((node) => {
          node.classList.remove("is-drop-target");
        });
      });
      button.addEventListener("click", () => selectProfile(profile.id));
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "remove";
      remove.setAttribute("aria-label", `Remove ${profile.name}`);
      remove.textContent = "×";
      remove.addEventListener("click", (event) => {
        event.stopPropagation();
        removeProfile(profile.id);
      });
      button.appendChild(remove);
      group.appendChild(button);
    });
    els.profileList.appendChild(group);
  });
}

function bindUserDropTarget(group, userId) {
  group.addEventListener("dragover", (event) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    group.classList.add("is-drop-target");
  });
  group.addEventListener("dragleave", (event) => {
    if (!group.contains(event.relatedTarget)) group.classList.remove("is-drop-target");
  });
  group.addEventListener("drop", (event) => {
    event.preventDefault();
    group.classList.remove("is-drop-target");
    const profileId = event.dataTransfer.getData("text/plain");
    if (profileId) moveProfileToUser(profileId, userId);
  });
}

async function moveProfileToUser(profileId, userId) {
  const profile = state.profiles.find((item) => item.id === profileId);
  const user = state.users.find((item) => item.id === userId);
  if (!profile || !user || profile.userId === userId) return;
  profile.userId = userId;
  profile.userName = user.name;
  renderProfiles();
  renderResume();
  try {
    await apiJson(`/api/profiles/${profileId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId }),
    });
    await refreshUsers();
    if (state.activeProfileId === profileId) renderResume();
    els.analyzeHint.textContent = `Moved ${profile.name} to ${user.name}.`;
  } catch (error) {
    await refreshUsers().catch(() => {});
    els.analyzeHint.textContent = error.message || "Could not move this profile.";
  }
}

function renderTagCloud(node, items, emptyText, tagClass) {
  if (!node) return;
  const tags = Array.isArray(items) ? items.filter(Boolean) : [];
  node.innerHTML = tags.length
    ? tags
        .map((item) => `<span class="tag${tagClass ? ` ${tagClass}` : ""}">${escapeHtml(item)}</span>`)
        .join("")
    : `<span class="muted">${escapeHtml(emptyText)}</span>`;
}

function renderProfileKeywords(profile) {
  renderTagCloud(
    els.profileRoleCloud,
    profile?.roles,
    "Upload or paste a resume to extract role tags.",
    "is-role"
  );
  renderTagCloud(
    els.profileKeywordCloud,
    profile?.keywords,
    "Upload or paste a resume to extract keywords.",
    "is-skill"
  );
}

function renderResume() {
  const profile = activeProfile();
  if (!profile) {
    els.resumeProfileLabel.textContent = "Select a profile to attach a resume.";
    els.resumeEmpty.classList.remove("hidden");
    els.resumePreview.classList.add("hidden");
    els.resumeText.value = "";
    renderProfileKeywords(null);
    return;
  }

  els.resumeProfileLabel.textContent = `Resume for ${profile.name}${profile.userName ? ` · ${profile.userName}` : ""}`;
  els.resumeText.value = profile.resumeText || "";
  renderProfileKeywords(profile);

  const hasContent = Boolean(profile.resumeText || profile.resumeName);
  els.resumeEmpty.classList.toggle("hidden", hasContent);
  els.resumePreview.classList.toggle("hidden", !hasContent);
  if (!hasContent) return;

  els.resumeMeta.textContent = profile.resumeName
    ? `${profile.resumeName}${profile.resumeType ? ` · ${profile.resumeType}` : ""}`
    : "Pasted resume text";

  const isPdf = (profile.resumeType || "").includes("pdf") || /\.pdf$/i.test(profile.resumeName || "");
  if (isPdf && state.resumeObjectUrl) {
    els.resumeFrame.classList.remove("hidden");
    els.resumeFrame.src = state.resumeObjectUrl;
  } else {
    els.resumeFrame.classList.add("hidden");
    els.resumeFrame.removeAttribute("src");
  }

  els.resumeBody.textContent = profile.resumeText || "This file previewed, but no text was extracted yet.";
}

function normalizeJdUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  try {
    const url = new URL(/^[a-zA-Z][a-zA-Z\d+\-.]*:/.test(raw) ? raw : `https://${raw}`);
    if (url.protocol !== "http:" && url.protocol !== "https:") return "";
    return url.toString();
  } catch (_error) {
    return "";
  }
}

function jdLabel(jd) {
  const company = String(jd?.company || "").trim();
  const role = String(jd?.role || "").trim();
  if (company && role) return `${company} (${role})`;
  if (company) return company;
  if (role) return role;
  const heading = String(jd.title || "").trim();
  if (heading) return heading;
  try {
    return new URL(jd.url).hostname.replace(/^www\./, "");
  } catch (_error) {
    return "Job posting";
  }
}

function jobHeading(jd) {
  const company = String(jd?.company || "").trim();
  const role = String(jd?.role || "").trim();
  if (company && role) return `${company} | ${role}`;
  if (company) return company;
  if (role) return role;
  return jdLabel(jd);
}

function companyKey(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function historyDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return `${date.getFullYear()}.${date.getMonth() + 1}.${date.getDate()}`;
}

function companyHistoryJobs(jd) {
  const key = companyKey(jd?.company);
  if (!key) return [];
  const byId = new Map();
  [...(state.applyHistory || []), ...state.jobDescriptions].forEach((item) => {
    if (item?.id) byId.set(item.id, item);
  });
  return [...byId.values()]
    .filter((item) => item.id !== jd.id && companyKey(item.company) === key)
    .sort((a, b) => jobTimestamp(b) - jobTimestamp(a));
}

function companyHistoryLines(jd) {
  return companyHistoryJobs(jd).map((item) => {
    const date = historyDate(item.updatedAt || item.createdAt);
    const company = String(item.company || "Unknown company").trim();
    const role = String(item.role || item.title || "Role").trim();
    if (item.discarded) return `${date}, ${company}, ${role}, discarded`;
    if (item.applied) {
      const outcome = String(item.outcome || "applied").trim();
      return `${date}, ${company}, ${role}, applied, ${outcome}`;
    }
    return `${date}, ${company}, ${role}, in the list`;
  });
}

function hideCompanyFlagTip() {
  document.querySelectorAll(".company-flag-pop").forEach((node) => node.remove());
}

function showCompanyFlagTip(anchor, lines) {
  hideCompanyFlagTip();
  if (!anchor || !lines.length) return;
  const tip = document.createElement("div");
  tip.className = "company-flag-pop";
  lines.forEach((line) => {
    const row = document.createElement("div");
    row.textContent = line;
    tip.appendChild(row);
  });
  document.body.appendChild(tip);
  const rect = anchor.getBoundingClientRect();
  const top = rect.bottom + 8;
  const left = Math.min(rect.left, window.innerWidth - tip.offsetWidth - 12);
  tip.style.top = `${Math.max(8, top)}px`;
  tip.style.left = `${Math.max(8, left)}px`;
}

function attachCompanyFlag(parent, jd) {
  const lines = companyHistoryLines(jd);
  if (!parent || !lines.length) return;
  const flag = document.createElement("span");
  flag.className = "company-flag";
  flag.textContent = "applied before for this company";
  flag.addEventListener("mouseenter", () => showCompanyFlagTip(flag, lines));
  flag.addEventListener("mouseleave", hideCompanyFlagTip);
  parent.appendChild(flag);
}

function applyToJob(jd, event, options = {}) {
  const reapply = Boolean(options.reapply);
  if (!jd?.url) {
    event?.preventDefault();
    els.analyzeHint.textContent = "This JD has no apply link.";
    return;
  }
  if (jd.applied && !reapply) {
    event?.preventDefault();
    return;
  }
  if (event?.ctrlKey || event?.metaKey || event?.button === 1) return;

  event?.preventDefault();
  event?.stopPropagation();
  jd.queued = false;
  window.open(jd.url, "_blank");
  const profile = activeProfile();
  if (profile) persistJob(profile.id, jd).catch(() => {});
  renderAppliedList();
  armApplyPrompt([jd.id]);
}

function jobTimestamp(jd) {
  const value = Date.parse(jd?.updatedAt || jd?.createdAt || "");
  return Number.isFinite(value) ? value : 0;
}

function sortByNewest(jobs) {
  return [...jobs].sort((a, b) => jobTimestamp(b) - jobTimestamp(a));
}

function markJobsNewest(jobs) {
  const now = Date.now();
  jobs.forEach((jd, index) => {
    jd.updatedAt = new Date(now - index).toISOString();
  });
}

function moveJobsToFront(jobs) {
  if (!jobs.length) return;
  const ids = new Set(jobs.map((jd) => jd.id));
  const rest = state.jobDescriptions.filter((jd) => !ids.has(jd.id));
  state.jobDescriptions = [...jobs, ...rest];
}

function visibleJobs() {
  return sortByNewest(state.jobDescriptions.filter((jd) => !jd.discarded && !jd.applied));
}

function queuedJobs() {
  return state.jobDescriptions.filter(
    (jd) => jd.queued && !jd.applied && !jd.discarded && jd.url
  );
}

function checkedQueuedJobs() {
  return queuedJobs().filter((jd) => state.checkedSelectedIds.has(jd.id));
}

function appliedHistoryJobs() {
  return sortByNewest(state.jobDescriptions.filter((jd) => jd.applied && !jd.discarded));
}

function discardedJobs() {
  return sortByNewest(state.jobDescriptions.filter((jd) => jd.discarded));
}

function pruneSet(set, validIds) {
  [...set].forEach((id) => {
    if (!validIds.has(id)) set.delete(id);
  });
}

function checkedMainJobs() {
  return visibleJobs().filter((jd) => state.checkedMainIds.has(jd.id));
}

function checkedAppliedHistoryJobs() {
  return appliedHistoryJobs().filter((jd) => state.checkedAppliedIds.has(jd.id));
}

function checkedDiscardedHistoryJobs() {
  return discardedJobs().filter((jd) => state.checkedDiscardedIds.has(jd.id));
}

function setBulkBar(bar, countEl, selectedCount, totalCount) {
  if (!bar) return;
  if (countEl) countEl.textContent = `${selectedCount} selected`;
  bar.classList.toggle("hidden", totalCount === 0);
}

function syncSelectAll(checkbox, selectedCount, totalCount) {
  if (!checkbox) return;
  checkbox.disabled = totalCount === 0;
  checkbox.checked = totalCount > 0 && selectedCount === totalCount;
  checkbox.indeterminate = selectedCount > 0 && selectedCount < totalCount;
}

function toggleAllIds(set, jobs, checked) {
  jobs.forEach((jd) => {
    if (checked) set.add(jd.id);
    else set.delete(jd.id);
  });
}

function createItemCheckbox(set, id, onChange) {
  const box = document.createElement("input");
  box.type = "checkbox";
  box.className = "item-check";
  box.checked = set.has(id);
  box.addEventListener("click", (event) => event.stopPropagation());
  box.addEventListener("change", () => {
    if (box.checked) set.add(id);
    else set.delete(id);
    onChange();
  });
  return box;
}

function ensureVisibleSelection() {
  if (state.jobDescriptions.some((item) => item.id === state.selectedResultId)) return;
  const visible = visibleJobs();
  state.selectedResultId =
    visible.find((item) => item.status === "completed")?.id ||
    visible[0]?.id ||
    state.jobDescriptions[0]?.id ||
    null;
}

function scrollResultsIntoView() {
  const card = els.resultsCard;
  if (!card) return;
  requestAnimationFrame(() => {
    card.scrollIntoView({ behavior: "smooth", block: "center", inline: "nearest" });
  });
}

function viewAnalyzedJob(jd) {
  if (!jd) return;
  state.selectedResultId = jd.id;
  renderJobs();
  renderAppliedList();
  renderResults();
  scrollResultsIntoView();
}

function historyActionButton(label, className, onClick) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = className;
  button.textContent = label;
  button.addEventListener("click", onClick);
  return button;
}

function renderHistoryList(container, jobs, emptyText, variant) {
  if (!container) return;
  container.innerHTML = "";
  if (!jobs.length) {
    container.innerHTML = `<div class="empty-state" style="min-height:48px"><span>${emptyText}</span></div>`;
    return;
  }
  jobs.forEach((jd) => {
    const item = document.createElement("article");
    item.className = `history-item${jd.id === state.selectedResultId ? " active" : ""}`;
    const checkSet = variant === "applied" ? state.checkedAppliedIds : state.checkedDiscardedIds;
    const onCheck = variant === "applied" ? updateAppliedBulkBar : updateDiscardedBulkBar;
    const checkbox = createItemCheckbox(checkSet, jd.id, onCheck);
    const label = document.createElement("span");
    label.textContent = jdLabel(jd);
    label.title = jdLabel(jd);
    const actions = document.createElement("div");
    actions.className = "history-item-actions";
    if (variant === "applied") {
      actions.appendChild(
        historyActionButton("BackUp", "btn btn-ghost", () => backupJobs([jd]))
      );
    } else {
      const apply = historyActionButton("Apply", "btn btn-analyze", (event) => {
        applyJobs([jd], { reapply: true, event });
      });
      apply.disabled = !jd.url;
      actions.appendChild(apply);
      actions.appendChild(
        historyActionButton("BackUp", "btn btn-ghost", () => backupJobs([jd]))
      );
    }
    actions.addEventListener("click", (event) => event.stopPropagation());
    item.addEventListener("click", () => viewAnalyzedJob(jd));
    item.appendChild(checkbox);
    item.appendChild(label);
    item.appendChild(actions);
    container.appendChild(item);
  });
}

function updateAppliedBulkBar() {
  const all = appliedHistoryJobs();
  const jobs = checkedAppliedHistoryJobs();
  setBulkBar(els.appliedBulkBar, els.appliedBulkCount, jobs.length, all.length);
  syncSelectAll(els.appliedSelectAll, jobs.length, all.length);
  if (els.appliedBulkBackup) els.appliedBulkBackup.disabled = jobs.length === 0;
  if (els.appliedBulkDiscard) els.appliedBulkDiscard.disabled = jobs.length === 0;
}

function updateDiscardedBulkBar() {
  const all = discardedJobs();
  const jobs = checkedDiscardedHistoryJobs();
  setBulkBar(els.discardedBulkBar, els.discardedBulkCount, jobs.length, all.length);
  syncSelectAll(els.discardedSelectAll, jobs.length, all.length);
  const canApply = jobs.some((jd) => jd.url);
  if (els.discardedBulkApply) els.discardedBulkApply.disabled = !canApply;
  if (els.discardedBulkBackup) els.discardedBulkBackup.disabled = jobs.length === 0;
}

function updateMainBulkBar() {
  const all = visibleJobs();
  const jobs = checkedMainJobs();
  setBulkBar(els.jdBulkBar, els.jdBulkCount, jobs.length, all.length);
  syncSelectAll(els.jdSelectAll, jobs.length, all.length);
  const canApply = jobs.some((jd) => jd.url && !jd.applied);
  const canQueue = jobs.some((jd) => jd.url && !jd.applied && !jd.queued && !jd.discarded);
  if (els.jdBulkApply) els.jdBulkApply.disabled = !canApply;
  if (els.jdBulkPlus) els.jdBulkPlus.disabled = !canQueue;
  if (els.jdBulkDiscard) els.jdBulkDiscard.disabled = jobs.length === 0;
}

function updateSelectedCount() {
  const all = queuedJobs();
  const count = checkedQueuedJobs().length;
  if (els.selectedCount) els.selectedCount.textContent = `${count} selected`;
  syncSelectAll(els.selectedSelectAll, count, all.length);
  if (els.selectedSelectAllWrap) els.selectedSelectAllWrap.classList.toggle("hidden", all.length === 0);
  const hasChecked = count > 0;
  if (els.appliedOpenBtn) els.appliedOpenBtn.disabled = !hasChecked;
  if (els.selectedBackupBtn) els.selectedBackupBtn.disabled = !hasChecked;
}

function renderAppliedList() {
  if (!els.appliedList) return;
  const jobs = queuedJobs();
  const validIds = new Set(jobs.map((jd) => jd.id));
  [...state.checkedSelectedIds].forEach((id) => {
    if (!validIds.has(id)) state.checkedSelectedIds.delete(id);
  });
  els.appliedList.innerHTML = "";
  if (!jobs.length) {
    els.appliedList.innerHTML = `<div class="empty-state"><span>Click + on a job to add it here.</span></div>`;
  } else {
    jobs.forEach((jd) => {
      const item = document.createElement("label");
      item.className = "selected-item";
      const box = document.createElement("input");
      box.type = "checkbox";
      box.checked = state.checkedSelectedIds.has(jd.id);
      box.addEventListener("change", () => {
        if (box.checked) state.checkedSelectedIds.add(jd.id);
        else state.checkedSelectedIds.delete(jd.id);
        updateSelectedCount();
      });
      const name = document.createElement("span");
      name.textContent = jdLabel(jd);
      name.title = jdLabel(jd);
      item.appendChild(box);
      item.appendChild(name);
      els.appliedList.appendChild(item);
    });
  }
  updateSelectedCount();
  pruneSet(state.checkedAppliedIds, new Set(appliedHistoryJobs().map((jd) => jd.id)));
  pruneSet(state.checkedDiscardedIds, new Set(discardedJobs().map((jd) => jd.id)));
  renderHistoryList(els.appliedHistoryList, appliedHistoryJobs(), "No applied jobs yet.", "applied");
  renderHistoryList(els.discardedHistoryList, discardedJobs(), "No discarded jobs yet.", "discarded");
  updateAppliedBulkBar();
  updateDiscardedBulkBar();
}

async function queueJob(jd) {
  if (!jd?.url || jd.applied || jd.queued || jd.discarded) return;
  jd.queued = true;
  state.checkedSelectedIds.add(jd.id);
  renderJobs();
  renderAppliedList();
  renderResultActions(jd);
  const profile = activeProfile();
  try {
    if (profile) await persistJob(profile.id, jd);
  } catch (error) {
    els.analyzeHint.textContent = error.message;
  }
}

function openApplyWindow(url) {
  const opened = window.open(url, "_blank");
  if (opened) {
    try {
      opened.opener = null;
    } catch (_error) {
      // Ignore cross-origin opener access errors.
    }
  }
  return opened;
}

function openApplyItemsInThisBrowser(items) {
  const ready = items.filter((item) => item?.url);
  if (!ready.length) return;
  let opened = 0;
  ready.forEach((item) => {
    if (openApplyWindow(item.url)) opened += 1;
  });
  if (opened < ready.length && els.analyzeHint) {
    els.analyzeHint.textContent =
      opened === 0
        ? "This browser blocked the apply tabs. Allow popups for this site, then click Apply again."
        : `Opened ${opened} of ${ready.length} apply tabs. Allow popups for this site, then click Apply again to open the rest in this browser.`;
  }
}

function applyJobs(jobs, { reapply = false, event } = {}) {
  const ready = jobs.filter((jd) => jd.url && (reapply || !jd.applied));
  if (!ready.length) {
    event?.preventDefault();
    els.analyzeHint.textContent = "No apply links in the selected jobs.";
    return;
  }
  if (event?.ctrlKey || event?.metaKey || event?.button === 1) return;
  event?.preventDefault();
  event?.stopPropagation();

  const jobIds = ready.map((jd) => jd.id);
  openApplyItemsInThisBrowser(
    ready.map((jd) => ({
      url: jd.url,
      title: jobHeading(jd),
    }))
  );
  ready.forEach((jd) => {
    jd.queued = false;
    state.checkedSelectedIds.delete(jd.id);
    state.checkedMainIds.delete(jd.id);
    state.checkedAppliedIds.delete(jd.id);
    state.checkedDiscardedIds.delete(jd.id);
  });
  renderJobs();
  renderAppliedList();
  const profile = activeProfile();
  ready.forEach((jd) => {
    if (profile) persistJob(profile.id, jd).catch(() => {});
  });
  armApplyPrompt(jobIds);
}

function applyQueuedJobs() {
  applyJobs(checkedQueuedJobs());
}

async function queueJobs(jobs) {
  const ready = jobs.filter((jd) => jd.url && !jd.applied && !jd.queued && !jd.discarded);
  if (!ready.length) return;
  ready.forEach((jd) => {
    jd.queued = true;
    state.checkedSelectedIds.add(jd.id);
  });
  renderJobs();
  renderAppliedList();
  renderResultActions(state.jobDescriptions.find((item) => item.id === state.selectedResultId));
  await persistJobsNewestFirst(ready);
}

async function persistJobsNewestFirst(jobs) {
  const profile = activeProfile();
  if (!profile) return;
  for (let index = jobs.length - 1; index >= 0; index -= 1) {
    try {
      await persistJob(profile.id, jobs[index]);
    } catch (error) {
      els.analyzeHint.textContent = error.message;
    }
  }
}

async function backupQueuedJobs() {
  const jobs = checkedQueuedJobs();
  if (!jobs.length) return;
  jobs.forEach((jd) => {
    jd.queued = false;
    state.checkedSelectedIds.delete(jd.id);
  });
  markJobsNewest(jobs);
  moveJobsToFront(jobs);
  renderJobs();
  renderAppliedList();
  renderResultActions(state.jobDescriptions.find((item) => item.id === state.selectedResultId));
  await persistJobsNewestFirst(jobs);
}

async function backupJobs(jobs) {
  if (!jobs.length) return;
  jobs.forEach((jd) => {
    jd.applied = false;
    jd.discarded = false;
    jd.queued = false;
    jd.outcome = "";
    state.checkedSelectedIds.delete(jd.id);
    state.checkedMainIds.delete(jd.id);
    state.checkedAppliedIds.delete(jd.id);
    state.checkedDiscardedIds.delete(jd.id);
  });
  markJobsNewest(jobs);
  moveJobsToFront(jobs);
  renderJobs();
  renderAppliedList();
  renderResults();
  await persistJobsNewestFirst(jobs);
  await loadApplyHistory(activeProfile()?.id);
  renderJobs();
  renderAppliedList();
  renderResults();
}

function armApplyPrompt(jobIds) {
  state.applyPrompt = {
    jobIds: [...jobIds],
    leftPage: document.hidden,
    shown: false,
  };
  window.setTimeout(() => {
    if (!state.applyPrompt.shown && state.applyPrompt.jobIds.length) {
      state.applyPrompt.leftPage = true;
      maybeShowApplyPrompt();
    }
  }, 2500);
}

function maybeShowApplyPrompt() {
  if (state.applyPrompt.shown || !state.applyPrompt.jobIds.length) return;
  if (document.hidden) {
    state.applyPrompt.leftPage = true;
    return;
  }
  if (!state.applyPrompt.leftPage) return;
  state.applyPrompt.shown = true;
  const jobIds = state.applyPrompt.jobIds;
  state.applyPrompt.jobIds = [];
  openApplyConfirmModal(jobIds);
}

function openApplyConfirmModal(jobIds) {
  const jobs = jobIds
    .map((id) => state.jobDescriptions.find((item) => item.id === id))
    .filter(Boolean);
  if (!jobs.length || !els.applyConfirmModal) return;
  state.pendingApplyJobIds = jobs.map((jd) => jd.id);
  if (jobs.length === 1) {
    els.applyConfirmTitle.textContent = "Did you apply?";
    els.applyConfirmCopy.textContent = `Did you apply for ${jobHeading(jobs[0])}?`;
    els.applyConfirmList.innerHTML = "";
    els.applyConfirmList.classList.add("hidden");
    els.applyConfirmNo.textContent = "No";
    els.applyConfirmYes.textContent = "Yes";
  } else {
    els.applyConfirmTitle.textContent = "Which jobs did you apply to?";
    els.applyConfirmCopy.textContent = "Check the jobs you applied for.";
    els.applyConfirmList.classList.remove("hidden");
    els.applyConfirmList.innerHTML = jobs
      .map(
        (jd) => `
          <label class="apply-check">
            <input type="checkbox" name="applied-job" value="${escapeHtml(jd.id)}" checked />
            <span>${escapeHtml(jobHeading(jd))}</span>
          </label>
        `
      )
      .join("");
    els.applyConfirmNo.textContent = "None";
    els.applyConfirmYes.textContent = "Save";
  }
  openDialog(els.applyConfirmModal);
}

async function settleApplyPrompt(allIds, confirmedIds) {
  const confirmed = new Set(confirmedIds);
  const confirmedJobs = [];
  const otherJobs = [];
  for (const id of allIds) {
    const jd = state.jobDescriptions.find((item) => item.id === id);
    if (!jd) continue;
    if (confirmed.has(id)) {
      jd.applied = true;
      jd.discarded = false;
      jd.outcome = jd.outcome || "applied";
      confirmedJobs.push(jd);
    } else {
      otherJobs.push(jd);
    }
    jd.queued = false;
  }
  markJobsNewest(confirmedJobs);
  moveJobsToFront(confirmedJobs);
  await persistJobsNewestFirst([...otherJobs, ...confirmedJobs]);
  await loadApplyHistory(activeProfile()?.id);
  state.pendingApplyJobIds = [];
  ensureVisibleSelection();
  renderJobs();
  renderAppliedList();
  renderResults();
}

function applySavedJob(jd, saved) {
  if (!jd || !saved) return;
  const oldId = jd.id;
  Object.assign(jd, saved);
  if (state.selectedResultId === oldId) state.selectedResultId = jd.id;
}

async function persistJob(profileId, jd) {
  if (!profileId || !jd) return jd;
  const data = await apiJson(`/api/profiles/${profileId}/jobs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      id: jd.id,
      url: jd.url,
      title: jd.title,
      company: jd.company || "",
      role: jd.role || "",
      text: jd.text,
      status: jd.status,
      error: jd.error || "",
      result: jd.result,
      applied: Boolean(jd.applied),
      queued: Boolean(jd.queued),
      discarded: Boolean(jd.discarded),
      outcome: jd.outcome || "",
    }),
  });
  applySavedJob(jd, data.job);
  return jd;
}

async function loadApplyHistory(profileId) {
  if (!profileId) {
    state.applyHistory = [];
    return;
  }
  try {
    const data = await apiJson(`/api/profiles/${profileId}/apply-history`);
    state.applyHistory = Array.isArray(data.jobs) ? data.jobs : [];
  } catch (_error) {
    state.applyHistory = state.jobDescriptions.filter((jd) => jd.applied || jd.discarded);
  }
}

async function loadJobs(profileId) {
  if (!profileId) {
    state.jobDescriptions = [];
    state.selectedResultId = null;
    state.checkedSelectedIds.clear();
    state.checkedMainIds.clear();
    state.checkedAppliedIds.clear();
    state.checkedDiscardedIds.clear();
    state.applyHistory = [];
    renderJobs();
    renderAppliedList();
    renderResults();
    return;
  }
  const data = await apiJson(`/api/profiles/${profileId}/jobs?limit=100`);
  state.jobDescriptions = (Array.isArray(data.jobs) ? data.jobs : []).slice(0, 100);
  queuedJobs().forEach((jd) => state.checkedSelectedIds.add(jd.id));
  await loadApplyHistory(profileId);
  ensureVisibleSelection();
  renderJobs();
  renderAppliedList();
  renderResults();
  const profile = activeProfile();
  if (profile) {
    const count = state.jobDescriptions.length;
    els.analyzeHint.textContent = count
      ? `Showing the last ${count} analyses for ${profile.name}.`
      : `No saved analyses for ${profile.name} yet.`;
  }
}

async function discardJobs(jobs) {
  if (!jobs.length) return;
  const ids = new Set(jobs.map((jd) => jd.id));
  jobs.forEach((jd) => {
    jd.discarded = true;
    jd.queued = false;
    state.checkedSelectedIds.delete(jd.id);
    state.checkedMainIds.delete(jd.id);
    state.checkedAppliedIds.delete(jd.id);
    state.checkedDiscardedIds.delete(jd.id);
  });
  markJobsNewest(jobs);
  if (ids.has(state.selectedResultId)) {
    const visible = visibleJobs();
    state.selectedResultId =
      visible.find((itemJd) => itemJd.status === "completed")?.id || visible[0]?.id || null;
  }
  renderJobs();
  renderAppliedList();
  renderResults();
  await persistJobsNewestFirst(jobs);
  await loadApplyHistory(activeProfile()?.id);
  renderJobs();
  renderAppliedList();
  renderResults();
}

async function discardJob(id) {
  const jd = state.jobDescriptions.find((itemJd) => itemJd.id === id);
  if (jd) await discardJobs([jd]);
}

function renderJobs() {
  hideCompanyFlagTip();
  const jobs = visibleJobs();
  pruneSet(state.checkedMainIds, new Set(jobs.map((jd) => jd.id)));
  els.jdList.innerHTML = "";
  if (!jobs.length) {
    els.jdList.innerHTML = `<div class="empty-state" style="min-height:80px"><span>No job descriptions analyzed yet.</span></div>`;
    updateMainBulkBar();
    return;
  }

  jobs.forEach((jd) => {
    const item = document.createElement("article");
    const selected = jd.id === state.selectedResultId;
    item.className = `jd-item status-${jd.status || "pending"}${selected ? " active" : ""}`;
    item.dataset.jobId = jd.id;
    const checkbox = createItemCheckbox(state.checkedMainIds, jd.id, updateMainBulkBar);

    const main = document.createElement("button");
    main.type = "button";
    main.className = "jd-item-main";
    const titleRow = document.createElement("span");
    titleRow.className = "jd-title-row";
    const title = document.createElement("b");
    title.textContent = jdLabel(jd);
    titleRow.appendChild(title);
    attachCompanyFlag(titleRow, jd);

    const status = document.createElement("div");
    status.innerHTML = jdStatusHtml(jd);

    main.appendChild(titleRow);
    main.appendChild(status);
    main.addEventListener("click", () => {
      viewAnalyzedJob(jd);
    });

    const actions = document.createElement("div");
    actions.className = "jd-item-actions";
    if (jd.status === "completed" || jd.status === "failed" || jd.status === "analyzing") {
      const reanalyze = document.createElement("button");
      reanalyze.type = "button";
      reanalyze.className = "btn btn-ghost btn-reanalyze";
      reanalyze.textContent = "Reanalyze";
      reanalyze.title =
        jd.status === "analyzing"
          ? "Stop this analyze and start it again"
          : "Run analyze again";
      reanalyze.setAttribute("data-job-id", jd.id);
      actions.appendChild(reanalyze);
    }
    if (jd.status === "completed") {
      const apply = document.createElement("a");
      apply.className = `btn btn-analyze${jd.applied ? " is-applied" : ""}`;
      apply.textContent = jd.applied ? "Applied" : "Apply";
      apply.href = jd.url || "#";
      apply.target = "_blank";
      apply.rel = "noopener noreferrer";
      if (jd.applied) apply.setAttribute("aria-disabled", "true");
      apply.addEventListener("click", (event) => {
        event.stopPropagation();
        applyToJob(jd, event);
      });
      actions.appendChild(apply);

      const add = document.createElement("button");
      add.type = "button";
      add.className = "btn btn-ghost btn-plus";
      add.textContent = "+";
      add.disabled = Boolean(jd.applied) || Boolean(jd.queued) || Boolean(jd.discarded) || !jd.url;
      add.addEventListener("click", (event) => {
        event.stopPropagation();
        queueJob(jd);
      });
      actions.appendChild(add);
    }
    const discard = document.createElement("button");
    discard.type = "button";
    discard.className = "btn btn-ghost";
    discard.textContent = "Discard";
    discard.addEventListener("click", (event) => {
      event.stopPropagation();
      discardJob(jd.id);
    });
    actions.appendChild(discard);

    item.appendChild(checkbox);
    item.appendChild(main);
    item.appendChild(actions);
    els.jdList.appendChild(item);
  });
  updateMainBulkBar();
}

function scoreTone(value) {
  if (value >= 85) return "high";
  if (value >= 50) return "mid";
  return "low";
}

function asTermList(value) {
  return Array.isArray(value) ? value.map((item) => String(item || "").trim()).filter(Boolean) : [];
}

function splitMissingKeywords(result) {
  const required = asTermList(result?.requiredMissing);
  const preferred = asTermList(result?.preferredMissing);
  const legacy = asTermList(result?.missingKeywords);
  if (required.length || preferred.length) {
    return { required, preferred, split: true };
  }
  return { required: legacy, preferred: [], split: false };
}

function failedKnockouts(result) {
  return (Array.isArray(result?.knockouts) ? result.knockouts : []).filter(
    (item) => item && String(item.status || "").toLowerCase() === "fail"
  );
}

function renderKeywordGroups(container, result) {
  if (!container) return;
  const groups = splitMissingKeywords(result);
  if (!groups.required.length && !groups.preferred.length) {
    container.innerHTML = `<span class="muted">No missing keywords were identified.</span>`;
    return;
  }
  const requiredLabel = groups.split ? "Required missing" : "Missing keywords";
  const required = groups.required.length
    ? groups.required.map((keyword) => `<span class="tag is-required">${escapeHtml(keyword)}</span>`).join("")
    : `<span class="muted">None</span>`;
  const preferred = groups.split
    ? `<div class="missing-group"><h4>Preferred missing</h4><div class="keyword-cloud">${
        groups.preferred.length
          ? groups.preferred.map((keyword) => `<span class="tag is-preferred">${escapeHtml(keyword)}</span>`).join("")
          : `<span class="muted">None</span>`
      }</div></div>`
    : "";
  container.innerHTML = `<div class="missing-group"><h4>${requiredLabel}</h4><div class="keyword-cloud">${required}</div></div>${preferred}`;
}

function renderKnockouts(container, result) {
  if (!container) return;
  const knockouts = Array.isArray(result?.knockouts) ? result.knockouts : [];
  if (!knockouts.length) {
    container.innerHTML = `<span class="muted">No hard requirements were flagged.</span>`;
    return;
  }
  container.innerHTML = `<ul class="knockout-list">${knockouts
    .map((item) => {
      const status = String(item.status || "unknown").toLowerCase();
      const label = status === "fail" ? "Fail" : status === "pass" ? "Pass" : "Unknown";
      const note = item.note ? `<p class="muted">${escapeHtml(item.note)}</p>` : "";
      return `<li class="knockout-item is-${escapeHtml(status)}"><span class="knockout-flag">${label}</span><div><strong>${escapeHtml(item.requirement || "Requirement")}</strong>${note}</div></li>`;
    })
    .join("")}</ul>`;
}

function jdStatusHtml(jd) {
  if (jd.status === "analyzing") {
    return `<div class="jd-item-meta"><span class="jd-status analyzing"><span class="spinner" aria-hidden="true"></span> Analyzing…</span>${analyzedDateHtml(jd)}</div>`;
  }
  if (jd.status === "failed") {
    return `<div class="jd-item-meta"><span class="jd-status failed">Analyzing failed: ${escapeHtml(jd.error || "Unknown error")}</span>${analyzedDateHtml(jd)}</div>`;
  }
  if (jd.status === "completed" && jd.result) {
    const location = Number.isFinite(jd.result.location) ? jd.result.location : 0;
    const overall = Number.isFinite(jd.result.overall) ? jd.result.overall : 0;
    const workStyle = jd.result.workStyle || "Unspecified";
    const knockoutCount = failedKnockouts(jd.result).length;
    return `
      <div class="jd-item-meta">
        <span class="jd-status completed">Completed</span>
        ${analyzedDateHtml(jd)}
        <span class="jd-metrics">
          <span class="score-chip ${scoreTone(overall)}">Overall match ${overall}%</span>
          <span class="score-chip ${scoreTone(location)}"><span>${escapeHtml(workStyle)}</span><span>${location}%</span></span>
          ${
            knockoutCount
              ? `<span class="score-chip knockout">${knockoutCount} knockout${knockoutCount === 1 ? "" : "s"}</span>`
              : ""
          }
        </span>
      </div>
    `;
  }
  return `<span class="jd-status">Waiting</span>`;
}

function formatAnalyzedAt(jd) {
  const raw = jd?.analyzedAt || "";
  const fallback =
    jd?.status === "completed" || jd?.status === "failed" ? jd?.createdAt || "" : "";
  const date = new Date(raw || fallback);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function analyzedDateHtml(jd) {
  const label = formatAnalyzedAt(jd);
  if (!label) return "";
  return `<span class="jd-analyzed-date">Analyzed ${escapeHtml(label)}</span>`;
}

function abortAnalyze(jobId) {
  const controller = state.analyzeControllers.get(jobId);
  if (!controller) return;
  try {
    controller.abort();
  } catch (_error) {
    // Ignore browsers that cannot abort.
  }
  state.analyzeControllers.delete(jobId);
}

async function reanalyzeJob(jd) {
  const profile = activeProfile();
  if (!profile || !(profile.resumeText || "").trim()) {
    els.analyzeHint.textContent = "Add resume text to the selected profile first.";
    return;
  }
  if (!jd?.text) {
    els.analyzeHint.textContent = "This JD has no saved text to reanalyze.";
    return;
  }
  if (jd.status === "analyzing") {
    abortAnalyze(jd.id);
    els.analyzeHint.textContent = `Stopped current analyze. Restarting ${jdLabel(jd)}…`;
  } else {
    els.analyzeHint.textContent = `Reanalyzing ${jdLabel(jd)}…`;
  }
  state.selectedResultId = jd.id;
  try {
    await analyzeJob(jd, profile);
  } catch (error) {
    if (error && error.name === "AbortError") return;
    els.analyzeHint.textContent = error.message || "Reanalyze failed.";
  }
}

function setResultJdLink(jd) {
  const link = els.resultJdLink;
  if (!link) return;
  const url = jd?.url || "";
  if (!url) {
    link.classList.add("hidden");
    link.removeAttribute("href");
    link.textContent = "";
    return;
  }
  link.classList.remove("hidden");
  link.href = url;
  link.textContent = url;
}

function renderResults() {
  const selectedJd = state.jobDescriptions.find((jd) => jd.id === state.selectedResultId);
  const selected = selectedJd?.status === "completed" ? selectedJd.result : null;
  setResultJdLink(selectedJd);
  if (!selected) {
    els.resultsEmpty.classList.remove("hidden");
    els.resultsBody.classList.add("hidden");
    if (selectedJd?.status === "analyzing") {
      els.resultsEmpty.innerHTML = `<strong>Analyzing…</strong><span>Scoring this job description against the selected resume.</span>`;
    } else if (selectedJd?.status === "failed") {
      els.resultsEmpty.innerHTML = `<strong>Analyzing failed</strong><span>${escapeHtml(selectedJd.error || "The analysis did not complete.")}</span>`;
    } else {
      els.resultsEmpty.innerHTML = `<strong>No analysis yet</strong><span>Paste a job description and click Analyze. Open a completed item for the full breakdown.</span>`;
    }
    els.resultsSubtitle.textContent = "Overall is keyword and experience only. Location is scored separately.";
    if (els.companyFlagSlot) els.companyFlagSlot.innerHTML = "";
    attachCompanyFlag(els.companyFlagSlot, selectedJd);
    renderResultActions(selectedJd);
    return;
  }

  els.resultsEmpty.classList.add("hidden");
  els.resultsBody.classList.remove("hidden");

  els.overallValue.textContent = `${selected.overall}%`;
  els.overallRing.style.background = `conic-gradient(var(--teal) ${selected.overall * 3.6}deg, var(--surface-2) 0deg)`;
  const knockoutFails = failedKnockouts(selected);
  const fitLabel =
    selected.overall >= 75 ? "Strong overall fit" : selected.overall >= 50 ? "Partial fit" : "Weak overall fit";
  els.overallCaption.textContent = knockoutFails.length
    ? `${fitLabel} · ${knockoutFails.length} knockout${knockoutFails.length === 1 ? "" : "s"}`
    : fitLabel;

  setMetric(els.keywordScore, els.keywordBar, selected.keyword);
  setMetric(els.experienceScore, els.experienceBar, selected.experience);
  setMetric(els.locationScore, els.locationBar, selected.location);

  els.strengthList.innerHTML = selected.strengths.map((item) => `<li>${escapeHtml(item)}</li>`).join("");
  els.weaknessList.innerHTML = selected.weaknesses.map((item) => `<li>${escapeHtml(item)}</li>`).join("");
  renderKeywordGroups(els.missingKeywordCloud, selected);
  renderKnockouts(els.knockoutList, selected);
  const workStyle = selected.workStyle || "Unspecified";
  els.workstyleBadge.textContent = workStyle;
  els.workstyleBadge.dataset.style = workStyle;
  els.workstyleNote.textContent = selected.workStyleNote || "";
  els.analyzeHint.textContent = `Showing details for ${jdLabel(selectedJd)}.`;
  if (els.resultsSubtitle) {
    els.resultsSubtitle.textContent = jdLabel(selectedJd);
  }
  if (els.companyFlagSlot) els.companyFlagSlot.innerHTML = "";
  attachCompanyFlag(els.companyFlagSlot, selectedJd);
  renderResultActions(selectedJd);
}

function renderResultActions(jd) {
  if (!jd) {
    els.resultActions.classList.add("hidden");
    return;
  }
  els.resultActions.classList.remove("hidden");
  const canApply = jd.status === "completed" && Boolean(jd.url);
  els.resultApplyBtn.classList.toggle("hidden", !canApply);
  if (els.resultPlusBtn) {
    els.resultPlusBtn.classList.toggle("hidden", !canApply);
    els.resultPlusBtn.disabled = Boolean(jd.applied) || Boolean(jd.queued) || Boolean(jd.discarded) || !canApply;
  }
  if (canApply) {
    els.resultApplyBtn.href = jd.url;
    els.resultApplyBtn.target = "_blank";
    els.resultApplyBtn.rel = "noopener noreferrer";
    els.resultApplyBtn.textContent = jd.applied ? "Applied" : "Apply";
    els.resultApplyBtn.classList.toggle("is-applied", Boolean(jd.applied));
  } else {
    els.resultApplyBtn.removeAttribute("href");
    els.resultApplyBtn.textContent = "Apply";
    els.resultApplyBtn.classList.remove("is-applied");
  }
}

function setMetric(label, bar, value) {
  label.textContent = `${value}%`;
  bar.style.width = `${value}%`;
  bar.style.background = value >= 75 ? "var(--teal)" : value >= 50 ? "var(--gold)" : "var(--rose)";
}

function mergeProfile(updated) {
  if (!updated?.id) return;
  const index = state.profiles.findIndex((item) => item.id === updated.id);
  const current = index >= 0 ? state.profiles[index] : null;
  const next = {
    keywords: [],
    roles: [],
    resumeText: "",
    resumeName: "",
    resumeType: "",
    hasFile: false,
    userId: current?.userId || "",
    userName: current?.userName || "",
    ...(current || {}),
    ...updated,
  };
  if (!next.userName && next.userId) {
    next.userName = state.users.find((user) => user.id === next.userId)?.name || next.userName;
  }
  if (index >= 0) state.profiles[index] = next;
  else state.profiles.push(next);
  const user = state.users.find((item) => item.id === next.userId);
  if (user) {
    user.profiles = Array.isArray(user.profiles) ? user.profiles : [];
    const userIndex = user.profiles.findIndex((item) => item.id === next.id);
    if (userIndex >= 0) user.profiles[userIndex] = { ...user.profiles[userIndex], ...next };
    else user.profiles.push(next);
  }
}

async function persistProfile(profile, { log = false, clearResume = false } = {}) {
  const data = await apiJson(`/api/profiles/${profile.id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: profile.name,
      resumeText: profile.resumeText,
      resumeName: profile.resumeName,
      resumeType: profile.resumeType,
      clearResume,
      log,
    }),
  });
  if (data.profile) mergeProfile(data.profile);
}

function scheduleSave(profile) {
  clearTimeout(state.saveTimer);
  state.saveTimer = setTimeout(() => {
    persistProfile(profile, { log: false }).catch((error) => {
      els.analyzeHint.textContent = error.message;
    });
  }, 450);
}

function scheduleKeywordExtract(profile) {
  clearTimeout(state.keywordTimer);
  state.keywordTimer = setTimeout(() => {
    if (!(profile.resumeText || "").trim()) return;
    refreshKeywordsFromResume(profile).catch((error) => {
      els.analyzeHint.textContent = error.message;
    });
  }, 1400);
}

async function loadResumePreview(profile) {
  if (state.resumeObjectUrl) {
    URL.revokeObjectURL(state.resumeObjectUrl);
    state.resumeObjectUrl = null;
  }
  if (!profile?.hasFile) return;
  const response = await fetch(`/api/profiles/${profile.id}/file`);
  if (!response.ok) return;
  const blob = await response.blob();
  state.resumeObjectUrl = URL.createObjectURL(blob);
}

async function selectProfile(id) {
  state.activeProfileId = id;
  renderProfiles();
  const profile = activeProfile();
  try {
    await loadResumePreview(profile);
  } catch (_error) {
    state.resumeObjectUrl = null;
  }
  renderResume();
  try {
    await loadJobs(id);
  } catch (error) {
    els.analyzeHint.textContent = error.message;
    state.jobDescriptions = [];
    state.selectedResultId = null;
    renderJobs();
    renderAppliedList();
    renderResults();
  }
}

async function removeProfile(id) {
  try {
    await apiJson(`/api/profiles/${id}`, { method: "DELETE" });
    await refreshUsers();
    if (state.activeProfileId === id) {
      state.activeProfileId = state.profiles[0]?.id || null;
    }
    await selectProfile(state.activeProfileId);
  } catch (error) {
    els.analyzeHint.textContent = error.message;
  }
}

function openUserModal(user) {
  state.editingUserId = user?.id || null;
  if (els.userModalTitle) els.userModalTitle.textContent = user ? "Edit user" : "New user";
  if (els.userModalConfirm) els.userModalConfirm.textContent = user ? "Save" : "Create";
  if (els.userName) els.userName.value = user?.name || "";
  openDialog(els.userModal);
  els.userName?.focus();
  els.userName?.select();
}

async function createUser(name) {
  const data = await apiJson("/api/users", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  await refreshUsers();
  return data.user;
}

async function renameUser(id, name) {
  await apiJson(`/api/users/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  await refreshUsers();
  renderResume();
}

async function removeUserById(id) {
  try {
    await apiJson(`/api/users/${id}`, { method: "DELETE" });
    const wasActive = activeProfile()?.userId === id;
    await refreshUsers();
    if (wasActive || !state.profiles.some((profile) => profile.id === state.activeProfileId)) {
      state.activeProfileId = state.profiles[0]?.id || null;
      await selectProfile(state.activeProfileId);
    } else {
      renderProfiles();
    }
  } catch (error) {
    els.analyzeHint.textContent = error.message;
  }
}

async function createProfile({ name, userId, resumeText, resumeName, resumeFile }) {
  const data = await apiJson("/api/profiles", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name,
      userId,
      resumeText: resumeFile ? "" : resumeText || "",
      resumeName: resumeFile ? "" : resumeName || "",
    }),
  });
  const created = data.profile;
  if (!created?.id) throw new Error("Could not create this profile.");
  await refreshUsers();
  if (!state.profiles.some((item) => item.id === created.id)) mergeProfile(created);
  await selectProfile(created.id);
  const profile = activeProfile();
  if (resumeFile && profile) {
    await uploadResumeFile(profile, resumeFile);
  } else if (profile && (profile.resumeText || "").trim()) {
    await refreshKeywordsFromResume(profile);
  }
  return activeProfile();
}

async function uploadResumeFile(profile, file) {
  if (state.resumeObjectUrl) URL.revokeObjectURL(state.resumeObjectUrl);
  state.resumeObjectUrl = URL.createObjectURL(file);
  profile.resumeName = file.name;
  profile.resumeType = file.type || "";
  profile.hasFile = true;
  renderProfiles();
  renderResume();

  const form = new FormData();
  form.append("file", file);
  const response = await fetch(`/api/profiles/${profile.id}/resume`, {
    method: "POST",
    body: form,
  });
  const data = await response.json().catch(() => ({}));
  if (data.profile) mergeProfile(data.profile);
  renderProfiles();
  renderResume();
  if (!response.ok) throw new Error(data.error || "Could not save resume.");
  const saved = activeProfile() || profile;
  if ((saved.resumeText || "").trim()) {
    await refreshKeywordsFromResume(saved);
  }
  return data.profile;
}

async function refreshKeywordsFromResume(profile) {
  if (!profile) return;
  const data = await apiJson(`/api/profiles/${profile.id}/keywords`, { method: "POST" });
  if (data.profile) mergeProfile(data.profile);
  renderProfiles();
  renderResume();
}

async function refreshUsers() {
  const data = await apiJson("/api/users");
  flattenUsers(data.users);
  fillProfileUserSelect();
  renderProfiles();
}

async function loadProfiles() {
  await refreshUsers();
  state.activeProfileId = state.profiles[0]?.id || null;
  if (state.activeProfileId) {
    await selectProfile(state.activeProfileId);
  } else {
    renderProfiles();
    renderResume();
    await loadJobs(null);
  }
}

function openIntakeWindow() {
  window.open("/intake", "jd-intake", "popup=yes,width=1100,height=900");
}

async function handleInbox(payload) {
  let data = payload;
  if (!data) {
    try {
      data = JSON.parse(localStorage.getItem(INBOX_KEY) || "null");
    } catch (_error) {
      data = null;
    }
  }
  if (!data || !Array.isArray(data.profileIds) || !data.profileIds.length) return;
  if (!data.profileIds.includes(state.activeProfileId)) return;
  try {
    await loadJobs(state.activeProfileId);
    els.analyzeHint.textContent = "A matched JD was added to this profile. Full analyze is running.";
  } catch (error) {
    els.analyzeHint.textContent = error.message;
  }
}

function startInboxWatch() {
  window.addEventListener("storage", (event) => {
    if (event.key === INBOX_KEY) handleInbox();
  });
  try {
    const channel = new BroadcastChannel(INBOX_KEY);
    channel.addEventListener("message", (event) => handleInbox(event.data));
  } catch (_error) {
    // Older browsers fall back to polling.
  }
  setInterval(() => {
    if (document.hidden || !state.activeProfileId) return;
    refreshJobsQuiet().catch(() => {});
  }, 5000);
}

async function refreshJobsQuiet() {
  const profileId = state.activeProfileId;
  if (!profileId) return;
  const data = await apiJson(`/api/profiles/${profileId}/jobs?limit=100`);
  if (state.activeProfileId !== profileId) return;
  const incoming = (Array.isArray(data.jobs) ? data.jobs : []).slice(0, 100);
  const previous = new Map(state.jobDescriptions.map((jd) => [jd.id, jd.status]));
  const changed =
    incoming.length !== state.jobDescriptions.length ||
    incoming.some((jd) => previous.get(jd.id) !== jd.status);
  if (!changed) return;
  state.jobDescriptions = incoming;
  renderJobs();
  renderAppliedList();
  renderResults();
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

els.userModalCancel?.addEventListener("click", () => {
  state.editingUserId = null;
  closeDialog(els.userModal);
});

els.profileModalCancel?.addEventListener("click", () => {
  closeDialog(els.profileModal);
});

els.addUserBtn?.addEventListener("click", () => {
  openUserModal(null);
});

els.userForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const name = els.userName?.value.trim();
  if (!name) {
    els.analyzeHint.textContent = "Enter a user name.";
    return;
  }
  const editingId = state.editingUserId;
  state.editingUserId = null;
  closeDialog(els.userModal);
  try {
    if (editingId) {
      await renameUser(editingId, name);
      els.analyzeHint.textContent = `Renamed user to ${name}.`;
    } else {
      await createUser(name);
      els.analyzeHint.textContent = `Created user ${name}. Add a profile under that user.`;
    }
  } catch (error) {
    els.analyzeHint.textContent = error.message;
  }
});

els.addProfileBtn?.addEventListener("click", () => {
  if (!state.users.length) {
    els.analyzeHint.textContent = "Create a user first, then add a profile.";
    return;
  }
  els.profileName.value = "";
  if (els.profileResumeText) els.profileResumeText.value = "";
  if (els.profileResumeFile) els.profileResumeFile.value = "";
  fillProfileUserSelect();
  openDialog(els.profileModal);
  els.profileName.focus();
});

els.openIntakeBtn?.addEventListener("click", openIntakeWindow);

els.profileForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const submitter = event.submitter || document.activeElement;
  if (submitter?.dataset?.cancel === "true") return;
  const name = els.profileName.value.trim();
  const userId = els.profileUser?.value || state.users[0]?.id;
  const resumeText = els.profileResumeText?.value || "";
  const resumeFile = els.profileResumeFile?.files?.[0] || null;
  const resumeName = resumeFile?.name || (resumeText.trim() ? "Pasted resume" : "");
  if (!name) {
    els.analyzeHint.textContent = "Enter a profile name.";
    return;
  }
  closeDialog(els.profileModal);
  try {
    els.analyzeHint.textContent = resumeFile || resumeText.trim()
      ? "Creating profile and reading the resume…"
      : "Creating profile…";
    await createProfile({
      name,
      userId,
      resumeText,
      resumeName,
      resumeFile,
    });
    const created = activeProfile();
    const roleCount = created?.roles?.length || 0;
    const keywordCount = created?.keywords?.length || 0;
    els.analyzeHint.textContent =
      roleCount || keywordCount
        ? `Created ${name}. ${roleCount} role tag${roleCount === 1 ? "" : "s"} and ${keywordCount} keyword${keywordCount === 1 ? "" : "s"} extracted.`
        : created?.resumeText
          ? `Created ${name}. Resume is attached; tags could not be extracted yet.`
          : `Created ${name}. Add a resume to extract role tags and keywords for Match.`;
  } catch (error) {
    els.analyzeHint.textContent = error.message;
    renderProfiles();
    renderResume();
  }
});

els.refreshKeywordsBtn?.addEventListener("click", async () => {
  const profile = activeProfile();
  if (!profile) return;
  els.analyzeHint.textContent = "Extracting role tags and keywords from this resume…";
  try {
    await refreshKeywordsFromResume(profile);
    const current = activeProfile();
    els.analyzeHint.textContent = `${(current?.roles || []).length} role tags and ${(current?.keywords || []).length} keywords updated.`;
  } catch (error) {
    els.analyzeHint.textContent = error.message || "Could not extract role tags and keywords.";
  }
});

els.resumeFile?.addEventListener("change", async (event) => {
  const profile = activeProfile();
  const file = event.target.files?.[0];
  event.target.value = "";
  if (!profile || !file) return;
    els.analyzeHint.textContent = "Saving resume…";
  try {
    await uploadResumeFile(profile, file);
    const current = activeProfile();
    const roleCount = current?.roles?.length || 0;
    const keywordCount = current?.keywords?.length || 0;
    els.analyzeHint.textContent =
      roleCount || keywordCount
        ? `Resume saved. ${roleCount} role tags and ${keywordCount} keywords extracted for Match.`
        : (current?.resumeText || "").trim()
          ? "Resume saved. Tags could not be extracted yet."
          : "Resume saved. Paste a JD and click Analyze.";
  } catch (error) {
    els.analyzeHint.textContent = error.message || "Could not extract resume text.";
    renderProfiles();
    renderResume();
  }
});

els.resumeText?.addEventListener("input", (event) => {
  const profile = activeProfile();
  if (!profile) return;
  profile.resumeText = event.target.value;
  if (!profile.resumeName) profile.resumeName = "Pasted resume";
  const hasContent = Boolean(profile.resumeText || profile.resumeName);
  els.resumeEmpty.classList.toggle("hidden", hasContent);
  els.resumePreview.classList.toggle("hidden", !hasContent);
  if (hasContent) {
    els.resumeMeta.textContent = profile.resumeName
      ? `${profile.resumeName}${profile.resumeType ? ` · ${profile.resumeType}` : ""}`
      : "Pasted resume text";
    els.resumeBody.textContent = profile.resumeText;
  }
  renderProfiles();
  scheduleSave(profile);
  scheduleKeywordExtract(profile);
});

els.clearResumeBtn?.addEventListener("click", async () => {
  const profile = activeProfile();
  if (!profile) return;
  try {
    await persistProfile(profile, { log: false, clearResume: true });
    profile.resumeText = "";
    profile.resumeName = "";
    profile.resumeType = "";
    profile.hasFile = false;
    profile.keywords = [];
    profile.roles = [];
    if (state.resumeObjectUrl) URL.revokeObjectURL(state.resumeObjectUrl);
    state.resumeObjectUrl = null;
    renderProfiles();
    renderResume();
  } catch (error) {
    els.analyzeHint.textContent = error.message;
  }
});

function analyzingJobs() {
  return state.jobDescriptions.filter((jd) => jd.status === "analyzing");
}

function setAnalyzeProgressHint(latestJd) {
  if (!els.analyzeHint) return;
  const running = analyzingJobs();
  if (!running.length) return;
  if (running.length === 1) {
    els.analyzeHint.textContent = `Analyzing ${jdLabel(running[0])}… Paste another JD and click Analyze to run more at the same time.`;
    return;
  }
  const latest = latestJd ? ` Latest: ${jdLabel(latestJd)}.` : "";
  els.analyzeHint.textContent = `Analyzing ${running.length} jobs at the same time.${latest}`;
}

async function startAnalyzeFromComposer() {
  const text = els.jdText ? els.jdText.value.trim() : "";
  const url = normalizeJdUrl(els.jdUrl ? els.jdUrl.value : "");
  if (!url) {
    els.analyzeHint.textContent = "Paste a valid JD link first.";
    return;
  }
  if (!text) {
    els.analyzeHint.textContent = "Paste a job description first.";
    return;
  }
  const profile = activeProfile();
  if (!profile || !(profile.resumeText || "").trim()) {
    els.analyzeHint.textContent = "Add resume text to the selected profile first.";
    return;
  }

  let hostname = "Job posting";
  try {
    hostname = new URL(url).hostname.replace(/^www\./, "");
  } catch (_error) {
    hostname = "Job posting";
  }

  const jd = {
    id: uid(),
    title: hostname,
    url,
    text,
    status: "analyzing",
    error: "",
    result: null,
    applied: false,
    queued: false,
    discarded: false,
    outcome: "",
  };
  state.jobDescriptions.unshift(jd);
  state.jobDescriptions = state.jobDescriptions.slice(0, 100);
  state.selectedResultId = jd.id;
  if (els.jdUrl) els.jdUrl.value = "";
  if (els.jdText) els.jdText.value = "";
  setAnalyzeProgressHint(jd);
  renderJobs();
  renderAppliedList();
  renderResults();
  if (els.jdUrl) els.jdUrl.focus();

  try {
    try {
      await persistJob(profile.id, jd);
    } catch (error) {
      els.analyzeHint.textContent = error.message;
    }
    await analyzeJob(jd, profile);
  } catch (error) {
    els.analyzeHint.textContent = error.message || "Analyze failed.";
  }
}

document.addEventListener("click", (event) => {
  const analyzeBtn = event.target.closest("#add-jd-btn");
  if (analyzeBtn) {
    event.preventDefault();
    startAnalyzeFromComposer();
    return;
  }
  const reanalyzeBtn = event.target.closest(".btn-reanalyze");
  if (!reanalyzeBtn) return;
  event.preventDefault();
  event.stopPropagation();
  const jobId = reanalyzeBtn.getAttribute("data-job-id") || reanalyzeBtn.closest("[data-job-id]")?.dataset.jobId;
  const jd = state.jobDescriptions.find((item) => item.id === jobId);
  if (!jd) {
    els.analyzeHint.textContent = "Could not find this JD to reanalyze.";
    return;
  }
  reanalyzeJob(jd);
});

els.resultApplyBtn?.addEventListener("click", (event) => {
  const jd = state.jobDescriptions.find((item) => item.id === state.selectedResultId);
  applyToJob(jd, event);
});

els.resultPlusBtn?.addEventListener("click", () => {
  const jd = state.jobDescriptions.find((item) => item.id === state.selectedResultId);
  queueJob(jd);
});

els.appliedOpenBtn?.addEventListener("click", () => {
  applyQueuedJobs();
});

els.selectedBackupBtn?.addEventListener("click", () => {
  backupQueuedJobs();
});

els.selectedSelectAll?.addEventListener("change", () => {
  toggleAllIds(state.checkedSelectedIds, queuedJobs(), Boolean(els.selectedSelectAll.checked));
  renderAppliedList();
});

els.jdSelectAll?.addEventListener("change", () => {
  toggleAllIds(state.checkedMainIds, visibleJobs(), Boolean(els.jdSelectAll.checked));
  renderJobs();
});

els.appliedSelectAll?.addEventListener("change", () => {
  toggleAllIds(state.checkedAppliedIds, appliedHistoryJobs(), Boolean(els.appliedSelectAll.checked));
  renderAppliedList();
});

els.discardedSelectAll?.addEventListener("change", () => {
  toggleAllIds(state.checkedDiscardedIds, discardedJobs(), Boolean(els.discardedSelectAll.checked));
  renderAppliedList();
});

els.jdBulkApply?.addEventListener("click", () => {
  applyJobs(checkedMainJobs());
});

els.jdBulkPlus?.addEventListener("click", () => {
  queueJobs(checkedMainJobs());
});

els.jdBulkDiscard?.addEventListener("click", () => {
  discardJobs(checkedMainJobs());
});

els.appliedBulkBackup?.addEventListener("click", () => {
  backupJobs(checkedAppliedHistoryJobs());
});

els.appliedBulkDiscard?.addEventListener("click", () => {
  discardJobs(checkedAppliedHistoryJobs());
});

els.discardedBulkApply?.addEventListener("click", () => {
  applyJobs(checkedDiscardedHistoryJobs(), { reapply: true });
});

els.discardedBulkBackup?.addEventListener("click", () => {
  backupJobs(checkedDiscardedHistoryJobs());
});

els.applyConfirmForm?.addEventListener("submit", (event) => {
  const submitter = event.submitter || document.activeElement;
  const allIds = [...(state.pendingApplyJobIds || [])];
  state.pendingApplyJobIds = [];
  let confirmedIds = [];
  if (submitter?.value === "confirm") {
    if (allIds.length <= 1) confirmedIds = allIds;
    else {
      confirmedIds = [...els.applyConfirmList.querySelectorAll("input:checked")].map(
        (input) => input.value
      );
    }
  }
  settleApplyPrompt(allIds, confirmedIds);
});

els.applyConfirmModal?.addEventListener("close", () => {
  if (state.pendingApplyJobIds.length) {
    const leftover = [...state.pendingApplyJobIds];
    state.pendingApplyJobIds = [];
    settleApplyPrompt(leftover, []);
  }
});

document.addEventListener("scroll", hideCompanyFlagTip, true);
els.jdList?.addEventListener("scroll", hideCompanyFlagTip);

document.addEventListener("visibilitychange", () => {
  if (document.hidden) state.applyPrompt.leftPage = true;
  else maybeShowApplyPrompt();
});

window.addEventListener("focus", () => {
  maybeShowApplyPrompt();
});

els.resultDiscardBtn?.addEventListener("click", () => {
  if (state.selectedResultId) discardJob(state.selectedResultId);
});

async function analyzeJob(jd, profile) {
  abortAnalyze(jd.id);
  const runId = uid();
  jd.analyzeRunId = runId;
  jd.status = "analyzing";
  jd.error = "";
  const controller = typeof AbortController === "function" ? new AbortController() : null;
  if (controller) state.analyzeControllers.set(jd.id, controller);
  renderJobs();
  renderResults();
  try {
    const data = await apiJson("/api/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller ? controller.signal : undefined,
      body: JSON.stringify({
        profileId: profile.id,
        profileName: profile.name,
        resumeText: profile.resumeText,
        keywords: profile.keywords,
        roles: profile.roles,
        jobDescriptions: [{ id: jd.id, title: jd.title, text: jd.text, url: jd.url }],
      }),
    });
    if (jd.analyzeRunId !== runId) return;
    const result = Array.isArray(data.results) ? data.results[0] : null;
    if (!result) throw new Error("OpenAI returned no result for this JD.");
    jd.status = "completed";
    jd.result = result;
    jd.company = result.company || "";
    jd.role = result.role || "";
    if (result.title) jd.title = result.title;
    jd.error = "";
    if (Array.isArray(data.jobs) && data.jobs[0]) applySavedJob(jd, data.jobs[0]);
    const remaining = analyzingJobs().filter((item) => item.id !== jd.id);
    els.analyzeHint.textContent = remaining.length
      ? `${jdLabel(jd)} completed. ${remaining.length} still analyzing.`
      : `${jdLabel(jd)} completed. Click it for the full breakdown.`;
  } catch (error) {
    if (jd.analyzeRunId !== runId) return;
    if (error && error.name === "AbortError") return;
    jd.status = "failed";
    jd.result = null;
    jd.error = error.message || "Could not reach the analyze API.";
    const remaining = analyzingJobs().filter((item) => item.id !== jd.id);
    els.analyzeHint.textContent = remaining.length
      ? `${jdLabel(jd)} failed. ${remaining.length} still analyzing.`
      : `${jdLabel(jd)} failed.`;
    try {
      await persistJob(profile.id, jd);
    } catch (_persistError) {
      // Analyze already writes failed rows when the server is reachable.
    }
  } finally {
    if (state.analyzeControllers.get(jd.id) === controller) {
      state.analyzeControllers.delete(jd.id);
    }
    if (jd.analyzeRunId === runId) {
      renderJobs();
      renderAppliedList();
      renderResults();
    }
  }
}

async function bootstrap() {
  try {
    const health = await apiJson("/api/health");
    if (!health.hasApiKey) {
      els.analyzeHint.textContent =
        "Server is missing OPENAI_API_KEY in .env. Analyze will fail until that is set and the server is restarted.";
    }
  } catch (error) {
    els.analyzeHint.textContent = error.message || "Could not reach the JD Analyzer server.";
  }
  try {
    await loadProfiles();
  } catch (error) {
    els.analyzeHint.textContent = error.message || "Could not load saved profiles.";
    renderProfiles();
  }
  startInboxWatch();
  renderJobs();
  renderAppliedList();
  renderResults();
}

bootstrap();
