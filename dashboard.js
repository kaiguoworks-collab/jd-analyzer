const OUTCOME_LABELS = {
  applied: "Applied",
  replied: "Replied",
  "on-going": "On-going",
  accepted: "Accepted",
  rejected: "Rejected",
  finished: "Finished",
  offer: "Offer",
  ghosted: "Ghosted",
};

const OUTCOMES = Object.keys(OUTCOME_LABELS);

const state = {
  jobs: [],
  users: [],
  profiles: [],
  selectedProfileIds: new Set(),
  applied: { query: "", sortKey: "date", sortDir: "desc" },
  discarded: { query: "", sortKey: "date", sortDir: "desc" },
  modalJobId: null,
  reanalyzeJobIds: new Set(),
};

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
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

function formatDate(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function listStatusLabel(status) {
  return status === "discarded" ? "Discarded" : "Applied";
}

function rowSearchText(job) {
  return [
    job.userName,
    job.profileName,
    formatDate(job.updatedAt || job.createdAt),
    job.company,
    job.role,
    listStatusLabel(job.listStatus),
    OUTCOME_LABELS[job.outcome] || job.outcome || "",
    job.result?.overall,
    job.result?.location,
    job.result?.workStyle,
  ]
    .join(" ")
    .toLowerCase();
}

function sortValue(job, key) {
  if (key === "date") return Date.parse(job.updatedAt || job.createdAt || "") || 0;
  if (key === "listStatus") return listStatusLabel(job.listStatus).toLowerCase();
  if (key === "outcome") return (OUTCOME_LABELS[job.outcome] || job.outcome || "").toLowerCase();
  return String(job[key] || "").toLowerCase();
}

function visibleRows(kind) {
  const section = state[kind];
  const query = section.query.trim().toLowerCase();
  const rows = state.jobs.filter((job) => {
    if (!state.selectedProfileIds.has(job.profileId)) return false;
    return kind === "applied" ? job.listStatus === "applied" : job.listStatus === "discarded";
  });
  const filtered = query ? rows.filter((job) => rowSearchText(job).includes(query)) : rows;
  const dir = section.sortDir === "asc" ? 1 : -1;
  return [...filtered].sort((a, b) => {
    const left = sortValue(a, section.sortKey);
    const right = sortValue(b, section.sortKey);
    if (left < right) return -1 * dir;
    if (left > right) return 1 * dir;
    return 0;
  });
}

function sortMark(kind, key) {
  const section = state[kind];
  if (section.sortKey !== key) return "";
  return section.sortDir === "asc" ? " ↑" : " ↓";
}

function updateHeaders(tableId, kind) {
  document.querySelectorAll(`#${tableId} th[data-key]`).forEach((header) => {
    const key = header.dataset.key;
    const button = header.querySelector("button");
    header.classList.toggle("is-sorted", state[kind].sortKey === key);
    if (!button || key === "number") return;
    const label = button.textContent.replace(/ [↑↓]$/, "");
    button.textContent = `${label}${sortMark(kind, key)}`;
  });
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

function jobRequiredMissing(job) {
  const groups = splitMissingKeywords(job?.result);
  return groups.required;
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

function scoreTone(value) {
  if (value >= 85) return "high";
  if (value >= 50) return "mid";
  return "low";
}

function numericScore(job, key) {
  const value = Number(job?.result?.[key]);
  return Number.isFinite(value) ? value : null;
}

function roleCell(job) {
  const role = job.role || job.title || "—";
  const overall = numericScore(job, "overall");
  const location = numericScore(job, "location");
  const workStyle = job?.result?.workStyle || "Unspecified";
  const chips = [];
  if (overall !== null) {
    chips.push(`<span class="score-chip ${scoreTone(overall)}">${overall}%</span>`);
  }
  if (location !== null) {
    chips.push(
      `<span class="score-chip ${scoreTone(location)}"><span>${escapeHtml(workStyle)}</span><span>${location}%</span></span>`
    );
  }
  const knockoutCount = failedKnockouts(job?.result).length;
  if (knockoutCount) {
    chips.push(
      `<span class="score-chip knockout">${knockoutCount} knockout${knockoutCount === 1 ? "" : "s"}</span>`
    );
  }
  return `<span class="dash-role">${escapeHtml(role)}${chips.join("")}</span>`;
}

function outcomeSelect(job) {
  const value = job.outcome && OUTCOME_LABELS[job.outcome] ? job.outcome : "applied";
  const options = OUTCOMES.map(
    (item) =>
      `<option value="${item}"${value === item ? " selected" : ""}>${OUTCOME_LABELS[item]}</option>`
  ).join("");
  return `<select class="outcome-select outcome-${value}" data-id="${escapeHtml(job.id)}" data-outcome="${value}">${options}</select>`;
}

function renderSection(kind) {
  const rows = visibleRows(kind);
  const body = document.getElementById(`${kind}-body`);
  const count = document.getElementById(`${kind}-count`);
  const tableId = `${kind}-table`;
  if (count) count.textContent = `${rows.length} row${rows.length === 1 ? "" : "s"}`;
  updateHeaders(tableId, kind);
  if (!body) return;
  if (!rows.length) {
    const cols = kind === "applied" ? 8 : 7;
    body.innerHTML = `<tr><td colspan="${cols}" class="muted">No matching jobs.</td></tr>`;
    return;
  }
  body.innerHTML = rows
    .map((job, index) => {
      const date = formatDate(job.updatedAt || job.createdAt);
      const status = listStatusLabel(job.listStatus);
      const outcomeCell =
        kind === "applied"
          ? `<td>${outcomeSelect(job)}</td>`
          : "";
      return `
        <tr class="dash-row" data-job-id="${escapeHtml(job.id)}">
          <td>${index + 1}</td>
          <td>${escapeHtml(job.userName || "—")}</td>
          <td>${escapeHtml(job.profileName || "—")}</td>
          <td>${escapeHtml(date)}</td>
          <td>${escapeHtml(job.company || "—")}</td>
          <td>${roleCell(job)}</td>
          <td><span class="status-pill ${job.listStatus}">${status}</span></td>
          ${outcomeCell}
        </tr>
      `;
    })
    .join("");
}

function render() {
  renderSection("applied");
  renderSection("discarded");
}

function dashboardProfiles() {
  const byId = new Map();
  state.profiles.forEach((profile) => {
    if (profile?.id) {
      byId.set(profile.id, {
        id: profile.id,
        name: profile.name || "Profile",
        userId: profile.userId || "",
        userName: profile.userName || "User",
      });
    }
  });
  state.jobs.forEach((job) => {
    if (job.profileId && !byId.has(job.profileId)) {
      byId.set(job.profileId, {
        id: job.profileId,
        name: job.profileName || "Profile",
        userId: job.userId || "",
        userName: job.userName || "User",
      });
    }
  });
  return [...byId.values()].sort((a, b) => {
    const user = a.userName.localeCompare(b.userName);
    return user || a.name.localeCompare(b.name);
  });
}

function dashboardUsers() {
  const users = new Map();
  (state.users || []).forEach((user) => {
    if (!user?.id) return;
    users.set(user.id, { id: user.id, name: user.name || "User", profiles: [] });
  });
  dashboardProfiles().forEach((profile) => {
    const id = profile.userId || "unknown";
    if (!users.has(id)) {
      users.set(id, { id, name: profile.userName || "User", profiles: [] });
    }
    users.get(id).profiles.push(profile);
  });
  return [...users.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function fillProfileFilter() {
  const list = document.getElementById("profile-filter-list");
  if (!list) return;
  const profiles = dashboardProfiles();
  const users = dashboardUsers();
  if (!state.selectedProfileIds.size) {
    profiles.forEach((profile) => state.selectedProfileIds.add(profile.id));
  }
  const allChecked = profiles.length > 0 && profiles.every((profile) => state.selectedProfileIds.has(profile.id));
  const chips = [
    `<label class="profile-check is-all">
      <input type="checkbox" id="profile-filter-all" ${allChecked ? "checked" : ""} />
      All users
    </label>`,
    ...users.map((user) => {
      const selectedCount = user.profiles.filter((profile) => state.selectedProfileIds.has(profile.id)).length;
      const userChecked = user.profiles.length > 0 && selectedCount === user.profiles.length;
      const userPartial = selectedCount > 0 && selectedCount < user.profiles.length;
      const profileChips = user.profiles.length
        ? user.profiles
            .map(
              (profile) => `
                <label class="profile-check">
                  <input type="checkbox" data-profile-id="${escapeHtml(profile.id)}" ${
                    state.selectedProfileIds.has(profile.id) ? "checked" : ""
                  } />
                  ${escapeHtml(profile.name)}
                </label>
              `
            )
            .join("")
        : `<p class="muted filter-user-empty">No profiles yet</p>`;
      return `
        <div class="filter-user-group">
          <label class="filter-user-name">
            <input
              type="checkbox"
              data-user-id="${escapeHtml(user.id)}"
              ${userChecked ? "checked" : ""}
              ${userPartial ? "data-partial=\"true\"" : ""}
              ${user.profiles.length ? "" : "disabled"}
            />
            ${escapeHtml(user.name)}
            <span class="filter-user-count">${user.profiles.length}</span>
          </label>
          <div class="filter-user-profiles">${profileChips}</div>
        </div>
      `;
    }),
  ];
  list.innerHTML = chips.join("");
  list.querySelectorAll("input[data-user-id][data-partial]").forEach((input) => {
    input.indeterminate = true;
  });
}

async function loadDashboard() {
  const [jobsResponse, usersResponse] = await Promise.all([
    fetch("/api/dashboard/jobs"),
    fetch("/api/users"),
  ]);
  const jobsData = await jobsResponse.json().catch(() => ({}));
  const usersData = await usersResponse.json().catch(() => ({}));
  if (!jobsResponse.ok) throw new Error(jobsData.error || "Could not load dashboard.");
  if (!usersResponse.ok) throw new Error(usersData.error || "Could not load users.");
  state.jobs = Array.isArray(jobsData.jobs) ? jobsData.jobs : [];
  state.users = Array.isArray(usersData.users) ? usersData.users : [];
  state.profiles = state.users.flatMap((user) =>
    (user.profiles || []).map((profile) => ({ ...profile, userId: user.id, userName: user.name }))
  );
  const profileById = new Map(state.profiles.map((profile) => [profile.id, profile]));
  state.jobs.forEach((job) => {
    const profile = profileById.get(job.profileId);
    if (!profile) return;
    if (!job.userName) job.userName = profile.userName || "";
    if (!job.userId) job.userId = profile.userId || "";
    if (!job.profileName) job.profileName = profile.name || job.profileName;
  });
  fillProfileFilter();
  render();
}

function bindSort(tableId, kind) {
  document.querySelectorAll(`#${tableId} th[data-key] button`).forEach((button) => {
    button.addEventListener("click", () => {
      const key = button.closest("th")?.dataset.key;
      if (!key || key === "number") return;
      if (state[kind].sortKey === key) {
        state[kind].sortDir = state[kind].sortDir === "asc" ? "desc" : "asc";
      } else {
        state[kind].sortKey = key;
        state[kind].sortDir = key === "date" ? "desc" : "asc";
      }
      renderSection(kind);
    });
  });
}

document.getElementById("profile-filter-list")?.addEventListener("change", (event) => {
  const input = event.target;
  if (!(input instanceof HTMLInputElement) || input.type !== "checkbox") return;
  const profiles = dashboardProfiles();
  if (input.id === "profile-filter-all") {
    state.selectedProfileIds = input.checked ? new Set(profiles.map((profile) => profile.id)) : new Set();
  } else if (input.dataset.userId) {
    const user = dashboardUsers().find((item) => item.id === input.dataset.userId);
    (user?.profiles || []).forEach((profile) => {
      if (input.checked) state.selectedProfileIds.add(profile.id);
      else state.selectedProfileIds.delete(profile.id);
    });
  } else if (input.dataset.profileId) {
    if (input.checked) state.selectedProfileIds.add(input.dataset.profileId);
    else state.selectedProfileIds.delete(input.dataset.profileId);
  }
  fillProfileFilter();
  render();
});

document.getElementById("applied-search")?.addEventListener("input", (event) => {
  state.applied.query = event.target.value;
  renderSection("applied");
});

document.getElementById("discarded-search")?.addEventListener("input", (event) => {
  state.discarded.query = event.target.value;
  renderSection("discarded");
});

document.getElementById("applied-body")?.addEventListener("change", async (event) => {
  const select = event.target.closest("select.outcome-select");
  if (!select) return;
  const job = state.jobs.find((item) => item.id === select.dataset.id);
  if (!job) return;
  const previous = job.outcome;
  const next = select.value;
  job.outcome = next;
  select.className = `outcome-select outcome-${next}`;
  select.dataset.outcome = next;
  try {
    const response = await fetch(`/api/jobs/${job.id}/outcome`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ outcome: next }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "Could not save status.");
    if (data.job) {
      Object.assign(job, data.job, {
        listStatus: "applied",
        profileName: job.profileName,
        userName: job.userName,
        userId: job.userId,
      });
    }
    const saved = job.outcome && OUTCOME_LABELS[job.outcome] ? job.outcome : next;
    select.className = `outcome-select outcome-${saved}`;
    select.dataset.outcome = saved;
  } catch (error) {
    job.outcome = previous;
    select.value = previous || "applied";
    select.className = `outcome-select outcome-${select.value}`;
    select.dataset.outcome = select.value;
    window.alert(error.message);
  }
});

function jobHeading(job) {
  const company = job.company || "";
  const role = job.role || job.title || "";
  if (company && role && role !== company) return `${company} (${role})`;
  return role || company || "Job posting";
}

function setModalMetric(labelId, barId, value) {
  const label = document.getElementById(labelId);
  const bar = document.getElementById(barId);
  const score = Number.isFinite(value) ? value : 0;
  if (label) label.textContent = `${score}%`;
  if (bar) {
    bar.style.width = `${score}%`;
    bar.style.background = score >= 75 ? "var(--teal)" : score >= 50 ? "var(--gold)" : "var(--rose)";
  }
}

function setModalJdLink(url) {
  const link = document.getElementById("result-modal-link");
  if (!link) return;
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

async function apiJson(url, options) {
  const waitMs = String(url).includes("/analyze") ? 180000 : 45000;
  const controller = typeof AbortController === "function" ? new AbortController() : null;
  const timer = setTimeout(() => controller?.abort(), waitMs);
  try {
    const response = await fetch(url, {
      ...(options || {}),
      signal: controller ? controller.signal : undefined,
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "Request failed.");
    return data;
  } catch (error) {
    if (error && error.name === "AbortError") {
      throw new Error("The server took too long to respond. Click Reanalyze again.");
    }
    throw error instanceof Error ? error : new Error("Request failed.");
  } finally {
    clearTimeout(timer);
  }
}

function modalJob() {
  return state.jobs.find((item) => item.id === state.modalJobId) || null;
}

function profileForJob(job) {
  return state.profiles.find((item) => item.id === job?.profileId) || null;
}

function setModalStatus(message, tone) {
  const status = document.getElementById("result-modal-status");
  if (!status) return;
  if (!message) {
    status.textContent = "";
    return;
  }
  if (tone === "loading") {
    status.innerHTML = `<span class="jd-status analyzing"><span class="spinner" aria-hidden="true"></span> ${escapeHtml(message)}</span>`;
    return;
  }
  if (tone === "failed") {
    status.innerHTML = `<span class="jd-status failed">${escapeHtml(message)}</span>`;
    return;
  }
  status.textContent = message;
}

function setReanalyzeControls(job) {
  const button = document.getElementById("result-modal-reanalyze");
  if (!button) return;
  const busy = Boolean(job && state.reanalyzeJobIds.has(job.id));
  button.disabled = busy;
  button.innerHTML = busy
    ? `<span class="spinner" aria-hidden="true"></span> Reanalyzing…`
    : "Reanalyze";
}

function mergeDashboardJob(current, saved) {
  if (!current || !saved) return current;
  const profileName = current.profileName;
  const userName = current.userName;
  const userId = current.userId;
  const listStatus = current.listStatus;
  Object.assign(current, saved);
  current.profileName = profileName || saved.profileName || current.profileName;
  current.userName = userName || saved.userName || current.userName;
  current.userId = userId || saved.userId || current.userId;
  if (saved.discarded) current.listStatus = "discarded";
  else if (saved.applied) current.listStatus = "applied";
  else current.listStatus = listStatus;
  return current;
}

function fillResultModal(job) {
  const title = document.getElementById("result-modal-title");
  const subtitle = document.getElementById("result-modal-subtitle");
  const empty = document.getElementById("result-modal-empty");
  const body = document.getElementById("result-modal-body");
  if (!job || !title || !subtitle || !empty || !body) return;

  const busy = state.reanalyzeJobIds.has(job.id);
  title.textContent = jobHeading(job);
  subtitle.textContent = [
    job.userName || "User",
    job.profileName || "Profile",
    formatDate(job.analyzedAt || job.updatedAt || job.createdAt),
    listStatusLabel(job.listStatus),
  ].join(" · ");
  setModalJdLink(job.url);
  setReanalyzeControls(job);
  if (!busy) setModalStatus("");

  const result = job.result;
  if (!result || typeof result !== "object") {
    empty.classList.remove("hidden");
    body.classList.add("hidden");
    if (busy || job.status === "analyzing") {
      empty.innerHTML = `<span class="spinner" aria-hidden="true"></span><strong>${busy ? "Reanalyzing" : "Analyzing…"}</strong><span>Stay on this page. Results will update here when the analysis finishes.</span>`;
      empty.classList.add("is-loading");
      empty.classList.remove("is-failed");
    } else if (job.status === "failed") {
      empty.innerHTML = `<strong>Analyzing failed</strong><span>${escapeHtml(job.error || "The analysis did not complete.")}</span>`;
      empty.classList.add("is-failed");
      empty.classList.remove("is-loading");
    } else {
      empty.innerHTML = `<strong>No analysis yet</strong><span>This job has no saved analyze result.</span>`;
      empty.classList.remove("is-loading", "is-failed");
    }
    return;
  }

  empty.classList.add("hidden");
  body.classList.remove("hidden");

  const overall = Number.isFinite(result.overall) ? result.overall : 0;
  const overallValue = document.getElementById("result-modal-overall-value");
  const overallRing = document.getElementById("result-modal-overall-ring");
  const overallCaption = document.getElementById("result-modal-overall-caption");
  if (overallValue) overallValue.textContent = `${overall}%`;
  if (overallRing) {
    overallRing.style.background = `conic-gradient(var(--teal) ${overall * 3.6}deg, var(--surface-2) 0deg)`;
  }
  if (overallCaption) {
    const knockoutFails = failedKnockouts(result);
    const fitLabel =
      overall >= 75 ? "Strong overall fit" : overall >= 50 ? "Partial fit" : "Weak overall fit";
    overallCaption.textContent = knockoutFails.length
      ? `${fitLabel} · ${knockoutFails.length} knockout${knockoutFails.length === 1 ? "" : "s"}`
      : fitLabel;
  }

  setModalMetric("result-modal-keyword-score", "result-modal-keyword-bar", result.keyword);
  setModalMetric("result-modal-experience-score", "result-modal-experience-bar", result.experience);
  setModalMetric("result-modal-location-score", "result-modal-location-bar", result.location);

  const workStyle = result.workStyle || "Unspecified";
  const workstyleBadge = document.getElementById("result-modal-workstyle");
  const workstyleNote = document.getElementById("result-modal-workstyle-note");
  if (workstyleBadge) {
    workstyleBadge.textContent = workStyle;
    workstyleBadge.dataset.style = workStyle;
  }
  if (workstyleNote) workstyleNote.textContent = result.workStyleNote || "";

  renderKeywordGroups(document.getElementById("result-modal-missing"), result);
  renderKnockouts(document.getElementById("result-modal-knockouts"), result);

  const strengths = document.getElementById("result-modal-strengths");
  const weaknesses = document.getElementById("result-modal-weaknesses");
  const strengthItems = Array.isArray(result.strengths) ? result.strengths : [];
  const weaknessItems = Array.isArray(result.weaknesses) ? result.weaknesses : [];
  if (strengths) {
    strengths.innerHTML = strengthItems.length
      ? strengthItems.map((item) => `<li>${escapeHtml(item)}</li>`).join("")
      : "<li>No strengths were returned.</li>";
  }
  if (weaknesses) {
    weaknesses.innerHTML = weaknessItems.length
      ? weaknessItems.map((item) => `<li>${escapeHtml(item)}</li>`).join("")
      : "<li>No weakness points were returned.</li>";
  }
}

function openResultModal(job) {
  const modal = document.getElementById("result-modal");
  if (!job || !modal) return;
  state.modalJobId = job.id;
  fillResultModal(job);
  if (!modal.open) openDialog(modal);
}

async function reanalyzeModalJob() {
  const job = modalJob();
  if (!job) {
    setModalStatus("Could not find this job.");
    return;
  }
  if (state.reanalyzeJobIds.has(job.id)) return;

  const profile = profileForJob(job);
  const resumeText = (profile?.resumeText || "").trim();
  const text = (job.text || "").trim();
  if (!resumeText) {
    setModalStatus("Add resume text to this profile on the Analyzer page first.");
    return;
  }
  if (!text) {
    setModalStatus("This job has no saved description text to reanalyze.");
    return;
  }

  const jobId = job.id;
  state.reanalyzeJobIds.add(jobId);
  setReanalyzeControls(job);
  setModalStatus("Reanalyzing… results will update in this modal.", "loading");
  fillResultModal(job);

  try {
    const data = await apiJson("/api/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        profileId: profile.id,
        profileName: profile.name || job.profileName,
        resumeText,
        keywords: Array.isArray(profile.keywords) ? profile.keywords : [],
        roles: Array.isArray(profile.roles) ? profile.roles : [],
        jobDescriptions: [{ id: job.id, title: job.title, text: job.text, url: job.url }],
      }),
    });
    const current = state.jobs.find((item) => item.id === jobId);
    if (!current) return;
    const saved = Array.isArray(data.jobs) ? data.jobs[0] : null;
    const result = Array.isArray(data.results) ? data.results[0] : null;
    if (saved) mergeDashboardJob(current, saved);
    if (result) {
      current.result = result;
      current.status = "completed";
      current.error = "";
      if (result.company) current.company = result.company;
      if (result.role) current.role = result.role;
      if (result.title) current.title = result.title;
    }
    if (!result && !saved) throw new Error("Analyze returned no result.");
    state.reanalyzeJobIds.delete(jobId);
    render();
    if (state.modalJobId === jobId) {
      fillResultModal(current);
      setModalStatus("Updated just now.");
    }
  } catch (error) {
    const message = error.message || "Reanalyze failed.";
    const current = state.jobs.find((item) => item.id === jobId);
    if (current && (!current.result || typeof current.result !== "object")) {
      current.status = "failed";
      current.error = message;
    }
    state.reanalyzeJobIds.delete(jobId);
    render();
    if (state.modalJobId === jobId) {
      if (current) fillResultModal(current);
      setModalStatus(message, "failed");
    }
  } finally {
    state.reanalyzeJobIds.delete(jobId);
    if (state.modalJobId === jobId) setReanalyzeControls(modalJob());
  }
}

function bindRowClicks(bodyId) {
  document.getElementById(bodyId)?.addEventListener("click", (event) => {
    if (event.target.closest("select, button, a, input, label")) return;
    const row = event.target.closest("tr[data-job-id]");
    if (!row) return;
    const job = state.jobs.find((item) => item.id === row.dataset.jobId);
    if (job) openResultModal(job);
  });
}

function appliedJobsForSummary() {
  return state.jobs.filter(
    (job) => job.listStatus === "applied" && state.selectedProfileIds.has(job.profileId)
  );
}

function normalizeKeyword(value) {
  return String(value || "").trim().replace(/\s+/g, " ");
}

function knockoutSummary(jobs) {
  const total = jobs.length;
  const counts = new Map();
  jobs.forEach((job) => {
    const seen = new Set();
    failedKnockouts(job?.result).forEach((item) => {
      const label = normalizeKeyword(item.requirement);
      if (!label) return;
      const key = label.toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      const current = counts.get(key);
      if (current) current.count += 1;
      else counts.set(key, { label, count: 1 });
    });
  });
  return [...counts.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

function missingKeywordSummary(jobs) {
  const total = jobs.length;
  const counts = new Map();
  jobs.forEach((job) => {
    const seen = new Set();
    const missing = jobRequiredMissing(job);
    missing.forEach((item) => {
      const label = normalizeKeyword(item);
      if (!label) return;
      const key = label.toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      const current = counts.get(key);
      if (current) current.count += 1;
      else counts.set(key, { label, count: 1 });
    });
  });
  const items = [...counts.values()].sort(
    (a, b) => b.count - a.count || a.label.localeCompare(b.label)
  );
  const most = [];
  const medium = [];
  const others = [];
  items.forEach((item) => {
    const share = total ? item.count / total : 0;
    if (share >= 0.3) most.push(item);
    else if (share >= 0.1) medium.push(item);
    else others.push(item);
  });
  return { total, most, medium, others };
}

function renderSummaryKeywords(containerId, items, total) {
  const node = document.getElementById(containerId);
  if (!node) return;
  if (!items.length) {
    node.innerHTML = `<span class="summary-empty-line">None</span>`;
    return;
  }
  node.innerHTML = items
    .map(
      (item) =>
        `<span class="summary-keyword"><b>'${escapeHtml(item.label)}'</b><span>${item.count}/${total}</span></span>`
    )
    .join("");
}

function openSummaryModal() {
  const modal = document.getElementById("summary-modal");
  const empty = document.getElementById("summary-empty");
  const body = document.getElementById("summary-body");
  const subtitle = document.getElementById("summary-subtitle");
  if (!modal || !empty || !body || !subtitle) {
    window.alert("Analyzing summary is missing from this page. Hard-refresh the dashboard.");
    return;
  }

  const jobs = appliedJobsForSummary();
  const summary = missingKeywordSummary(jobs);
  const knockouts = knockoutSummary(jobs);
  subtitle.textContent = jobs.length
    ? `Required missing keywords and failed knockouts across ${summary.total} applied job${summary.total === 1 ? "" : "s"} in the selected users and profiles.`
    : "Required missing keywords and failed knockouts across applied jobs.";

  if (!jobs.length) {
    empty.classList.remove("hidden");
    body.classList.add("hidden");
    empty.innerHTML = `<strong>No applied jobs</strong><span>Apply to jobs first, or select a user or profile that has applied jobs.</span>`;
    if (!modal.open) openDialog(modal);
    return;
  }

  if (!summary.most.length && !summary.medium.length && !summary.others.length && !knockouts.length) {
    empty.classList.remove("hidden");
    body.classList.add("hidden");
    empty.innerHTML = `<strong>No missing keywords</strong><span>The selected applied jobs do not have saved required-missing or knockout results.</span>`;
    if (!modal.open) openDialog(modal);
    return;
  }

  empty.classList.add("hidden");
  body.classList.remove("hidden");
  renderSummaryKeywords("summary-knockouts", knockouts, summary.total);
  renderSummaryKeywords("summary-most", summary.most, summary.total);
  renderSummaryKeywords("summary-medium", summary.medium, summary.total);
  renderSummaryKeywords("summary-others", summary.others, summary.total);
  if (!modal.open) openDialog(modal);
}

document.addEventListener("click", (event) => {
  if (!event.target.closest("#summary-btn")) return;
  event.preventDefault();
  try {
    openSummaryModal();
  } catch (error) {
    window.alert(error.message || "Could not open the analyzing summary.");
  }
});

document.getElementById("summary-modal-close")?.addEventListener("click", () => {
  closeDialog(document.getElementById("summary-modal"));
});

document.getElementById("summary-modal")?.addEventListener("click", (event) => {
  if (event.target.id === "summary-modal") closeDialog(event.currentTarget);
});

document.getElementById("result-modal-reanalyze")?.addEventListener("click", (event) => {
  event.preventDefault();
  event.stopPropagation();
  reanalyzeModalJob();
});

document.getElementById("result-modal-close")?.addEventListener("click", () => {
  closeDialog(document.getElementById("result-modal"));
});

document.getElementById("result-modal")?.addEventListener("click", (event) => {
  if (event.target.id === "result-modal") closeDialog(event.currentTarget);
});

bindSort("applied-table", "applied");
bindSort("discarded-table", "discarded");
bindRowClicks("applied-body");
bindRowClicks("discarded-body");

loadDashboard().catch((error) => {
  const appliedBody = document.getElementById("applied-body");
  const discardedBody = document.getElementById("discarded-body");
  const message = `<tr><td colspan="8" class="muted">${escapeHtml(error.message)}</td></tr>`;
  if (appliedBody) appliedBody.innerHTML = message;
  if (discardedBody) discardedBody.innerHTML = message;
});
