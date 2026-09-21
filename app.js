const STOP_WORDS = new Set(
  `a an the and or of to for in on with from by as at is are was were be been being this that those these it its you your they their we our i me my
  will would should can could may might must shall about into over under after before than then also not no nor so if but than using used use
  such other more most some any all each both few many much own same just than too very including include includes required requirements
  job description role team company work working opportunity responsibilities ability`.split(/\s+/)
);

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
  keywordCloud: document.getElementById("keyword-cloud"),
  keywordInput: document.getElementById("keyword-input"),
  addKeywordBtn: document.getElementById("add-keyword-btn"),
  rescrapeBtn: document.getElementById("rescrape-btn"),
  logList: document.getElementById("log-list"),
  jdTitle: document.getElementById("jd-title"),
  jdFile: document.getElementById("jd-file"),
  jdText: document.getElementById("jd-text"),
  addJdBtn: document.getElementById("add-jd-btn"),
  jdFileName: document.getElementById("jd-file-name"),
  jdList: document.getElementById("jd-list"),
  analyzeBtn: document.getElementById("analyze-btn"),
  analyzeHint: document.getElementById("analyze-hint"),
  resultsEmpty: document.getElementById("results-empty"),
  resultsBody: document.getElementById("results-body"),
  jdScoreRow: document.getElementById("jd-score-row"),
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
};

const state = {
  profiles: [],
  logs: [],
  activeProfileId: null,
  jobDescriptions: [],
  pendingJdFileName: "",
  results: [],
  selectedResultId: null,
  resumeObjectUrl: null,
  saveTimer: null,
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

function scrapeKeywords(text) {
  const phrases = [...(text || "").matchAll(/\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2})\b/g)]
    .map((match) => match[1].trim())
    .filter((phrase) => phrase.split(" ").every((word) => !STOP_WORDS.has(word.toLowerCase())));

  const tokens = (text || "")
    .replace(/[^A-Za-z0-9+#.\-\s]/g, " ")
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 1 && !STOP_WORDS.has(token.toLowerCase()));

  const counts = new Map();
  [...phrases, ...tokens].forEach((token) => {
    const key = token.length <= 3 ? token.toUpperCase() : token;
    if (!/[A-Za-z]/.test(key)) return;
    counts.set(key, (counts.get(key) || 0) + 1);
  });

  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || b[0].length - a[0].length)
    .slice(0, 18)
    .map(([term]) => term);
}

function formatTime(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString();
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

function renderKeywords() {
  const profile = activeProfile();
  els.keywordCloud.innerHTML = "";
  if (!profile || !profile.keywords.length) {
    els.keywordCloud.innerHTML = `<span class="muted">Keywords will appear after a resume is added.</span>`;
    return;
  }

  profile.keywords.forEach((keyword, index) => {
    const tag = document.createElement("span");
    tag.className = "tag";
    tag.innerHTML = `${escapeHtml(keyword)} <button type="button" aria-label="Remove ${escapeHtml(keyword)}">×</button>`;
    tag.querySelector("button").addEventListener("click", async () => {
      profile.keywords.splice(index, 1);
      renderKeywords();
      try {
        await persistProfile(profile, { log: false });
      } catch (error) {
        els.analyzeHint.textContent = error.message;
      }
    });
    els.keywordCloud.appendChild(tag);
  });
}

function renderLogs() {
  els.logList.innerHTML = "";
  if (!state.logs.length) {
    els.logList.innerHTML = `<span class="muted">No activity saved yet.</span>`;
    return;
  }
  state.logs.forEach((entry) => {
    const item = document.createElement("article");
    item.className = "log-item";
    item.innerHTML = `<b>${escapeHtml(entry.message || entry.action)}</b><small>${escapeHtml(formatTime(entry.createdAt))}</small>`;
    els.logList.appendChild(item);
  });
}

function renderJobs() {
  els.jdList.innerHTML = "";
  if (!state.jobDescriptions.length) {
    els.jdList.innerHTML = `<div class="empty-state" style="min-height:80px"><span>No job descriptions added yet.</span></div>`;
    return;
  }

  state.jobDescriptions.forEach((jd) => {
    const item = document.createElement("article");
    item.className = "jd-item";
    item.innerHTML = `
      <div>
        <b>${escapeHtml(jd.title)}</b>
        <p>${escapeHtml(jd.text)}</p>
      </div>
    `;
    const remove = document.createElement("button");
    remove.type = "button";
    remove.textContent = "Remove";
    remove.addEventListener("click", () => {
      state.jobDescriptions = state.jobDescriptions.filter((itemJd) => itemJd.id !== jd.id);
      state.results = state.results.filter((result) => result.id !== jd.id);
      renderJobs();
      renderResults();
    });
    item.appendChild(remove);
    els.jdList.appendChild(item);
  });
}

function renderResults() {
  if (!state.results.length) {
    els.resultsEmpty.classList.remove("hidden");
    els.resultsBody.classList.add("hidden");
    els.analyzeHint.textContent = "Results appear here after OpenAI compares the resume to each JD.";
    return;
  }

  els.resultsEmpty.classList.add("hidden");
  els.resultsBody.classList.remove("hidden");

  const selected =
    state.results.find((result) => result.id === state.selectedResultId) || state.results[0];
  state.selectedResultId = selected.id;

  els.jdScoreRow.innerHTML = "";
  state.results.forEach((result) => {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = `jd-chip${result.id === selected.id ? " active" : ""}`;
    chip.textContent = `${result.title} · ${result.overall}%`;
    chip.addEventListener("click", () => {
      state.selectedResultId = result.id;
      renderResults();
    });
    els.jdScoreRow.appendChild(chip);
  });

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
  els.analyzeHint.textContent = `Showing ${state.results.length} JD ${state.results.length === 1 ? "result" : "results"} for ${activeProfile()?.name || "this profile"}.`;
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
  if (log) await loadLogs();
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
  renderKeywords();
  const profile = activeProfile();
  try {
    await loadResumePreview(profile);
  } catch (_error) {
    state.resumeObjectUrl = null;
  }
  renderResume();
}

async function removeProfile(id) {
  try {
    await apiJson(`/api/profiles/${id}`, { method: "DELETE" });
    state.profiles = state.profiles.filter((profile) => profile.id !== id);
    if (state.activeProfileId === id) {
      state.activeProfileId = state.profiles[0]?.id || null;
    }
    await loadLogs();
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
  await loadLogs();
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
    renderKeywords();
  }
}

async function loadLogs() {
  try {
    const data = await apiJson("/api/logs?limit=12");
    state.logs = Array.isArray(data.logs) ? data.logs : [];
  } catch (_error) {
    state.logs = [];
  }
  renderLogs();
}

async function readFile(file) {
  const isText = /text|markdown|json|rtf/.test(file.type) || /\.(txt|md|rtf)$/i.test(file.name);
  if (isText || !file.type) {
    const text = await file.text();
    if (/[A-Za-z]/.test(text) && !text.includes("%PDF")) {
      return { text, objectUrl: null };
    }
  }
  return { text: "", objectUrl: URL.createObjectURL(file) };
}

async function extractTextFromFile(file) {
  const local = await readFile(file);
  if ((local.text || "").trim()) {
    return local;
  }

  const form = new FormData();
  form.append("file", file);
  const data = await apiJson("/api/extract-text", {
    method: "POST",
    body: form,
  });
  return {
    text: data.text || "",
    objectUrl: local.objectUrl || URL.createObjectURL(file),
  };
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
    const saved = activeProfile();
    if (saved && saved.resumeText) {
      saved.keywords = scrapeKeywords(saved.resumeText);
      await persistProfile(saved, { log: false });
    }
    if (state.resumeObjectUrl) URL.revokeObjectURL(state.resumeObjectUrl);
    state.resumeObjectUrl = URL.createObjectURL(file);
    renderProfiles();
    renderResume();
    renderKeywords();
    await loadLogs();
    if (!response.ok) throw new Error(data.error || "Could not save resume.");
    els.analyzeHint.textContent = "Resume saved. Add a JD, then click Analyze match.";
  } catch (error) {
    els.analyzeHint.textContent = error.message || "Could not extract resume text.";
    renderProfiles();
    renderResume();
    renderKeywords();
  }
});

els.resumeText.addEventListener("input", (event) => {
  const profile = activeProfile();
  if (!profile) return;
  profile.resumeText = event.target.value;
  profile.keywords = scrapeKeywords(profile.resumeText);
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
  renderKeywords();
  scheduleSave(profile);
});

els.clearResumeBtn.addEventListener("click", async () => {
  const profile = activeProfile();
  if (!profile) return;
  try {
    await persistProfile(profile, { log: true, clearResume: true });
    profile.resumeText = "";
    profile.resumeName = "";
    profile.resumeType = "";
    profile.hasFile = false;
    profile.keywords = [];
    if (state.resumeObjectUrl) URL.revokeObjectURL(state.resumeObjectUrl);
    state.resumeObjectUrl = null;
    renderProfiles();
    renderResume();
    renderKeywords();
  } catch (error) {
    els.analyzeHint.textContent = error.message;
  }
});

els.addKeywordBtn.addEventListener("click", async () => {
  const profile = activeProfile();
  const value = els.keywordInput.value.trim();
  if (!profile || !value) return;
  if (!profile.keywords.includes(value)) profile.keywords.unshift(value);
  els.keywordInput.value = "";
  renderKeywords();
  try {
    await persistProfile(profile, { log: false });
  } catch (error) {
    els.analyzeHint.textContent = error.message;
  }
});

els.keywordInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    els.addKeywordBtn.click();
  }
});

els.rescrapeBtn.addEventListener("click", async () => {
  const profile = activeProfile();
  if (!profile) return;
  profile.keywords = scrapeKeywords(profile.resumeText);
  renderKeywords();
  try {
    await persistProfile(profile, { log: false });
  } catch (error) {
    els.analyzeHint.textContent = error.message;
  }
});

els.jdFile.addEventListener("change", async (event) => {
  const file = event.target.files?.[0];
  event.target.value = "";
  if (!file) return;
  els.jdFileName.textContent = "Reading JD text…";
  try {
    const { text } = await extractTextFromFile(file);
    els.jdText.value = text || els.jdText.value;
    els.jdTitle.value = els.jdTitle.value || file.name.replace(/\.[^.]+$/, "");
    state.pendingJdFileName = file.name;
    els.jdFileName.textContent = file.name;
  } catch (error) {
    els.jdFileName.textContent = error.message || "Could not extract JD text.";
  }
});

els.addJdBtn.addEventListener("click", () => {
  const text = els.jdText.value.trim();
  if (!text) {
    els.jdFileName.textContent = "Paste or upload a job description first.";
    return;
  }
  state.jobDescriptions.push({
    id: uid(),
    title: els.jdTitle.value.trim() || `JD ${state.jobDescriptions.length + 1}`,
    text,
  });
  els.jdTitle.value = "";
  els.jdText.value = "";
  els.jdFileName.textContent = "";
  state.pendingJdFileName = "";
  renderJobs();
});

els.analyzeBtn.addEventListener("click", async () => {
  const profile = activeProfile();
  if (!profile || !(profile.resumeText || "").trim()) {
    els.analyzeHint.textContent = "Add resume text to the selected profile first.";
    return;
  }
  if (!state.jobDescriptions.length) {
    els.analyzeHint.textContent = "Add at least one job description first.";
    return;
  }

  els.analyzeBtn.disabled = true;
  els.analyzeHint.textContent = "Analyzing with OpenAI…";

  try {
    const data = await apiJson("/api/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        profileId: profile.id,
        profileName: profile.name,
        resumeText: profile.resumeText,
        keywords: profile.keywords,
        jobDescriptions: state.jobDescriptions.map((jd) => ({
          id: jd.id,
          title: jd.title,
          text: jd.text,
        })),
      }),
    });
    state.results = Array.isArray(data.results) ? data.results : [];
    state.selectedResultId = state.results[0]?.id || null;
    renderResults();
    await loadLogs();
  } catch (error) {
    els.analyzeHint.textContent = error.message || "Could not reach the analyze API.";
  } finally {
    els.analyzeBtn.disabled = false;
  }
});

async function bootstrap() {
  try {
    await loadProfiles();
    await loadLogs();
  } catch (error) {
    els.analyzeHint.textContent = error.message || "Could not load saved profiles.";
    renderProfiles();
    renderLogs();
  }
  renderJobs();
  renderResults();
}

bootstrap();
