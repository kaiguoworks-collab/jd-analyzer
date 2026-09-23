const els = {
  profileList: document.getElementById("profile-list"),
  addProfileBtn: document.getElementById("add-profile-btn"),
  profileModal: document.getElementById("profile-modal"),
  profileForm: document.getElementById("profile-form"),
  profileName: document.getElementById("profile-name"),
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

const state = {
  profiles: [],
  activeProfileId: null,
  jobDescriptions: [],
  selectedResultId: null,
  resumeObjectUrl: null,
  saveTimer: null,
  pendingApplyJobIds: [],
  applyPrompt: { jobIds: [], leftPage: false, shown: false },
  checkedSelectedIds: new Set(),
  checkedMainIds: new Set(),
  checkedAppliedIds: new Set(),
  checkedDiscardedIds: new Set(),
  applyHistory: [],
};

function uid() {
  return crypto.randomUUID();
}

function activeProfile() {
  return state.profiles.find((profile) => profile.id === state.activeProfileId) || null;
}

async function apiJson(url, options = {}) {
  const response = await fetch(url, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || "Request failed.");
  }
  return data;
}

function renderProfiles() {
  els.profileList.innerHTML = "";
  if (!state.profiles.length) {
    els.profileList.innerHTML = `<div class="empty-state" style="min-height:90px"><span>Create a profile, then upload its resume.</span></div>`;
    return;
  }

  state.profiles.forEach((profile) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `profile-item${profile.id === state.activeProfileId ? " active" : ""}`;
    button.innerHTML = `
      <span>
        <b>${escapeHtml(profile.name)}</b>
        <small>${profile.resumeName || profile.resumeText ? "Resume attached" : "No resume yet"}</small>
      </span>
    `;
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
    els.profileList.appendChild(button);
  });
}

function renderResume() {
  const profile = activeProfile();
  if (!profile) {
    els.resumeProfileLabel.textContent = "Select a profile to attach a resume.";
    els.resumeEmpty.classList.remove("hidden");
    els.resumePreview.classList.add("hidden");
    els.resumeText.value = "";
    return;
  }

  els.resumeProfileLabel.textContent = `Resume for ${profile.name}`;
  els.resumeText.value = profile.resumeText || "";

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

function isLocalAppHost() {
  const host = window.location.hostname;
  return host === "127.0.0.1" || host === "localhost" || host === "[::1]";
}

function openApplyUrlsHere(urls) {
  let blocked = 0;
  urls.forEach((url) => {
    const opened = window.open(url, "_blank");
    if (opened) opened.opener = null;
    else blocked += 1;
  });
  return blocked;
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

  const urls = ready.map((jd) => jd.url);
  const jobIds = ready.map((jd) => jd.id);
  if (isLocalAppHost()) {
    window.open(urls[0], "_blank");
    if (urls.length > 1) {
      fetch("/api/open-apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ urls: urls.slice(1) }),
      }).catch((error) => {
        els.analyzeHint.textContent = error.message || "Could not open every apply link.";
      });
    }
  } else {
    const blocked = openApplyUrlsHere(urls);
    if (blocked) {
      els.analyzeHint.textContent =
        blocked === urls.length
          ? "Browser blocked the apply tabs. Allow popups for this site, then click Apply again."
          : `${blocked} extra apply tab${blocked === 1 ? " was" : "s were"} blocked. Allow popups for this site, then click Apply again.`;
    }
  }
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
  if (!els.applyConfirmModal.open) els.applyConfirmModal.showModal();
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

function jdStatusHtml(jd) {
  if (jd.status === "analyzing") {
    return `<span class="jd-status analyzing"><span class="spinner" aria-hidden="true"></span> Analyzing…</span>`;
  }
  if (jd.status === "failed") {
    return `<span class="jd-status failed">Analyzing failed: ${escapeHtml(jd.error || "Unknown error")}</span>`;
  }
  if (jd.status === "completed" && jd.result) {
    const location = Number.isFinite(jd.result.location) ? jd.result.location : 0;
    const overall = Number.isFinite(jd.result.overall) ? jd.result.overall : 0;
    const workStyle = jd.result.workStyle || "Unspecified";
    return `
      <div class="jd-item-meta">
        <span class="jd-status completed">Completed</span>
        <span class="jd-metrics">
          <span class="score-chip ${scoreTone(overall)}">Overall match ${overall}%</span>
          <span class="score-chip ${scoreTone(location)}"><span>${escapeHtml(workStyle)}</span><span>${location}%</span></span>
        </span>
      </div>
    `;
  }
  return `<span class="jd-status">Waiting</span>`;
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
    els.resultsSubtitle.textContent = "Overall score plus keyword, experience, location, and work style.";
    if (els.companyFlagSlot) els.companyFlagSlot.innerHTML = "";
    attachCompanyFlag(els.companyFlagSlot, selectedJd);
    renderResultActions(selectedJd);
    return;
  }

  els.resultsEmpty.classList.add("hidden");
  els.resultsBody.classList.remove("hidden");

  els.overallValue.textContent = `${selected.overall}%`;
  els.overallRing.style.background = `conic-gradient(var(--teal) ${selected.overall * 3.6}deg, var(--surface-2) 0deg)`;
  els.overallCaption.textContent =
    selected.overall >= 75 ? "Strong overall fit" : selected.overall >= 50 ? "Partial fit" : "Weak overall fit";

  setMetric(els.keywordScore, els.keywordBar, selected.keyword);
  setMetric(els.experienceScore, els.experienceBar, selected.experience);
  setMetric(els.locationScore, els.locationBar, selected.location);

  els.strengthList.innerHTML = selected.strengths.map((item) => `<li>${escapeHtml(item)}</li>`).join("");
  els.weaknessList.innerHTML = selected.weaknesses.map((item) => `<li>${escapeHtml(item)}</li>`).join("");
  const missing = Array.isArray(selected.missingKeywords) ? selected.missingKeywords : [];
  els.missingKeywordCloud.innerHTML = missing.length
    ? missing.map((keyword) => `<span class="tag">${escapeHtml(keyword)}</span>`).join("")
    : `<span class="muted">No missing keywords were identified.</span>`;
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
  const index = state.profiles.findIndex((item) => item.id === updated.id);
  const next = {
    keywords: [],
    resumeText: "",
    resumeName: "",
    resumeType: "",
    hasFile: false,
    ...updated,
  };
  if (index >= 0) state.profiles[index] = { ...state.profiles[index], ...next };
  else state.profiles.push(next);
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
      keywords: profile.keywords,
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
    state.profiles = state.profiles.filter((profile) => profile.id !== id);
    if (state.activeProfileId === id) {
      state.activeProfileId = state.profiles[0]?.id || null;
    }
    await selectProfile(state.activeProfileId);
  } catch (error) {
    els.analyzeHint.textContent = error.message;
  }
}

async function createProfile(name) {
  const data = await apiJson("/api/profiles", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  mergeProfile(data.profile);
  await selectProfile(data.profile.id);
}

async function loadProfiles() {
  const data = await apiJson("/api/profiles");
  state.profiles = Array.isArray(data.profiles) ? data.profiles : [];
  state.activeProfileId = state.profiles[0]?.id || null;
  if (state.activeProfileId) {
    await selectProfile(state.activeProfileId);
  } else {
    renderProfiles();
    renderResume();
    await loadJobs(null);
  }
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

els.addProfileBtn.addEventListener("click", () => {
  els.profileName.value = "";
  els.profileModal.showModal();
  els.profileName.focus();
});

els.profileForm.addEventListener("submit", async (event) => {
  const submitter = event.submitter;
  if (submitter?.value !== "confirm") return;
  const name = els.profileName.value.trim();
  if (!name) return;
  try {
    await createProfile(name);
  } catch (error) {
    els.analyzeHint.textContent = error.message;
  }
});

els.resumeFile.addEventListener("change", async (event) => {
  const profile = activeProfile();
  const file = event.target.files?.[0];
  event.target.value = "";
  if (!profile || !file) return;
  els.analyzeHint.textContent = "Saving resume…";
  try {
    const form = new FormData();
    form.append("file", file);
    const response = await fetch(`/api/profiles/${profile.id}/resume`, {
      method: "POST",
      body: form,
    });
    const data = await response.json().catch(() => ({}));
    if (data.profile) mergeProfile(data.profile);
    if (state.resumeObjectUrl) URL.revokeObjectURL(state.resumeObjectUrl);
    state.resumeObjectUrl = URL.createObjectURL(file);
    renderProfiles();
    renderResume();
    if (!response.ok) throw new Error(data.error || "Could not save resume.");
    els.analyzeHint.textContent = "Resume saved. Paste a JD and click Analyze.";
  } catch (error) {
    els.analyzeHint.textContent = error.message || "Could not extract resume text.";
    renderProfiles();
    renderResume();
  }
});

els.resumeText.addEventListener("input", (event) => {
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
});

els.clearResumeBtn.addEventListener("click", async () => {
  const profile = activeProfile();
  if (!profile) return;
  try {
    await persistProfile(profile, { log: false, clearResume: true });
    profile.resumeText = "";
    profile.resumeName = "";
    profile.resumeType = "";
    profile.hasFile = false;
    profile.keywords = [];
    if (state.resumeObjectUrl) URL.revokeObjectURL(state.resumeObjectUrl);
    state.resumeObjectUrl = null;
    renderProfiles();
    renderResume();
  } catch (error) {
    els.analyzeHint.textContent = error.message;
  }
});

els.addJdBtn.addEventListener("click", async () => {
  const text = els.jdText.value.trim();
  const url = normalizeJdUrl(els.jdUrl.value);
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
  els.jdUrl.value = "";
  els.jdText.value = "";
  els.analyzeHint.textContent = `Analyzing ${jdLabel(jd)}…`;
  renderJobs();
  renderAppliedList();
  renderResults();
  try {
    await persistJob(profile.id, jd);
  } catch (error) {
    els.analyzeHint.textContent = error.message;
  }
  await analyzeJob(jd, profile);
});

els.resultApplyBtn.addEventListener("click", (event) => {
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
  const submitter = event.submitter;
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

els.resultDiscardBtn.addEventListener("click", () => {
  if (state.selectedResultId) discardJob(state.selectedResultId);
});

async function analyzeJob(jd, profile) {
  jd.status = "analyzing";
  jd.error = "";
  renderJobs();
  renderResults();
  try {
    const data = await apiJson("/api/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        profileId: profile.id,
        profileName: profile.name,
        resumeText: profile.resumeText,
        keywords: profile.keywords,
        jobDescriptions: [{ id: jd.id, title: jd.title, text: jd.text, url: jd.url }],
      }),
    });
    const result = Array.isArray(data.results) ? data.results[0] : null;
    if (!result) throw new Error("OpenAI returned no result for this JD.");
    jd.status = "completed";
    jd.result = result;
    jd.company = result.company || "";
    jd.role = result.role || "";
    if (result.title) jd.title = result.title;
    jd.error = "";
    if (Array.isArray(data.jobs) && data.jobs[0]) applySavedJob(jd, data.jobs[0]);
    els.analyzeHint.textContent = `${jdLabel(jd)} completed. Click it for the full breakdown.`;
  } catch (error) {
    jd.status = "failed";
    jd.result = null;
    jd.error = error.message || "Could not reach the analyze API.";
    els.analyzeHint.textContent = `${jdLabel(jd)} failed.`;
    try {
      await persistJob(profile.id, jd);
    } catch (_persistError) {
      // Analyze already writes failed rows when the server is reachable.
    }
  }
  renderJobs();
  renderAppliedList();
  renderResults();
}

async function bootstrap() {
  try {
    await loadProfiles();
  } catch (error) {
    els.analyzeHint.textContent = error.message || "Could not load saved profiles.";
    renderProfiles();
  }
  renderJobs();
  renderAppliedList();
  renderResults();
}

bootstrap();
