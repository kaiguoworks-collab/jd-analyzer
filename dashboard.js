const OUTCOME_LABELS = {
  applied: "Applied",
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
  profiles: [],
  selectedProfileIds: new Set(),
  applied: { query: "", sortKey: "date", sortDir: "desc" },
  discarded: { query: "", sortKey: "date", sortDir: "desc" },
};

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
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
    const cols = kind === "applied" ? 7 : 6;
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
    if (profile?.id) byId.set(profile.id, { id: profile.id, name: profile.name || "Profile" });
  });
  state.jobs.forEach((job) => {
    if (job.profileId && !byId.has(job.profileId)) {
      byId.set(job.profileId, { id: job.profileId, name: job.profileName || "Profile" });
    }
  });
  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function fillProfileFilter() {
  const list = document.getElementById("profile-filter-list");
  if (!list) return;
  const profiles = dashboardProfiles();
  if (!state.selectedProfileIds.size) {
    profiles.forEach((profile) => state.selectedProfileIds.add(profile.id));
  }
  const allChecked = profiles.length > 0 && profiles.every((profile) => state.selectedProfileIds.has(profile.id));
  const chips = [
    `<label class="profile-check is-all">
      <input type="checkbox" id="profile-filter-all" ${allChecked ? "checked" : ""} />
      All profiles
    </label>`,
    ...profiles.map(
      (profile) => `
        <label class="profile-check">
          <input type="checkbox" data-profile-id="${escapeHtml(profile.id)}" ${
            state.selectedProfileIds.has(profile.id) ? "checked" : ""
          } />
          ${escapeHtml(profile.name)}
        </label>
      `
    ),
  ];
  list.innerHTML = chips.join("");
}

async function loadDashboard() {
  const [jobsResponse, profilesResponse] = await Promise.all([
    fetch("/api/dashboard/jobs"),
    fetch("/api/profiles"),
  ]);
  const jobsData = await jobsResponse.json().catch(() => ({}));
  const profilesData = await profilesResponse.json().catch(() => ({}));
  if (!jobsResponse.ok) throw new Error(jobsData.error || "Could not load dashboard.");
  if (!profilesResponse.ok) throw new Error(profilesData.error || "Could not load profiles.");
  state.jobs = Array.isArray(jobsData.jobs) ? jobsData.jobs : [];
  state.profiles = Array.isArray(profilesData.profiles) ? profilesData.profiles : [];
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
    if (data.job) Object.assign(job, data.job, { listStatus: "applied", profileName: job.profileName });
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

function openResultModal(job) {
  const modal = document.getElementById("result-modal");
  const title = document.getElementById("result-modal-title");
  const subtitle = document.getElementById("result-modal-subtitle");
  const empty = document.getElementById("result-modal-empty");
  const body = document.getElementById("result-modal-body");
  if (!modal || !title || !subtitle || !empty || !body) return;

  title.textContent = jobHeading(job);
  subtitle.textContent = [
    job.profileName || "Profile",
    formatDate(job.updatedAt || job.createdAt),
    listStatusLabel(job.listStatus),
  ].join(" · ");
  setModalJdLink(job.url);

  const result = job.result;
  if (!result || typeof result !== "object") {
    empty.classList.remove("hidden");
    body.classList.add("hidden");
    if (job.status === "failed") {
      empty.innerHTML = `<strong>Analyzing failed</strong><span>${escapeHtml(job.error || "The analysis did not complete.")}</span>`;
    } else {
      empty.innerHTML = `<strong>No analysis yet</strong><span>This job has no saved analyze result.</span>`;
    }
    if (!modal.open) modal.showModal();
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
    overallCaption.textContent =
      overall >= 75 ? "Strong overall fit" : overall >= 50 ? "Partial fit" : "Weak overall fit";
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

  const missing = Array.isArray(result.missingKeywords) ? result.missingKeywords : [];
  const missingCloud = document.getElementById("result-modal-missing");
  if (missingCloud) {
    missingCloud.innerHTML = missing.length
      ? missing.map((keyword) => `<span class="tag">${escapeHtml(keyword)}</span>`).join("")
      : `<span class="muted">No missing keywords were identified.</span>`;
  }

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

  if (!modal.open) modal.showModal();
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

document.getElementById("result-modal-close")?.addEventListener("click", () => {
  document.getElementById("result-modal")?.close();
});

document.getElementById("result-modal")?.addEventListener("click", (event) => {
  if (event.target.id === "result-modal") event.currentTarget.close();
});

bindSort("applied-table", "applied");
bindSort("discarded-table", "discarded");
bindRowClicks("applied-body");
bindRowClicks("discarded-body");

loadDashboard().catch((error) => {
  const appliedBody = document.getElementById("applied-body");
  const discardedBody = document.getElementById("discarded-body");
  const message = `<tr><td colspan="7" class="muted">${escapeHtml(error.message)}</td></tr>`;
  if (appliedBody) appliedBody.innerHTML = message;
  if (discardedBody) discardedBody.innerHTML = message;
});
