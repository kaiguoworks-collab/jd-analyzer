const INBOX_KEY = "jd-inbox";

const els = {
  user: document.getElementById("intake-user"),
  url: document.getElementById("intake-url"),
  text: document.getElementById("intake-text"),
  hint: document.getElementById("intake-hint"),
  matches: document.getElementById("intake-matches"),
  sent: document.getElementById("intake-sent"),
  send: document.getElementById("intake-send"),
};

const state = {
  users: [],
  matches: [],
  selectedIds: new Set(),
  sentIds: new Set(),
  rankTimer: null,
  rankInFlight: false,
  lastRankKey: "",
  jdRole: "",
  jdLocation: "",
  rankStatus: "idle",
  rankError: "",
  rankQueued: false,
  sentJobs: {},
  statusTimer: null,
  sendBusy: false,
};

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function scoreTone(value) {
  if (value >= 85) return "high";
  if (value >= 50) return "mid";
  return "low";
}

async function apiJson(url, options) {
  const response = await fetch(url, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Request failed.");
  return data;
}

function currentUserId() {
  return els.user?.value || state.users[0]?.id || "";
}

function fillUsers() {
  if (!els.user) return;
  const current = currentUserId();
  els.user.innerHTML = state.users
    .map(
      (user) =>
        `<option value="${escapeHtml(user.id)}"${user.id === current ? " selected" : ""}>${escapeHtml(user.name)}</option>`
    )
    .join("");
  if (!els.user.value && state.users[0]) els.user.value = state.users[0].id;
}

function tagCloud(items, emptyText, tagClass) {
  const tags = Array.isArray(items) ? items.filter(Boolean) : [];
  if (!tags.length) return `<span class="muted">${escapeHtml(emptyText)}</span>`;
  return tags
    .map((item) => `<span class="tag${tagClass ? ` ${tagClass}` : ""}">${escapeHtml(item)}</span>`)
    .join("");
}

function locationLabel(status) {
  if (status === "match") return "Matched";
  if (status === "mismatch") return "Not matched";
  return "Unknown";
}

function locationTone(status) {
  if (status === "match") return "high";
  if (status === "mismatch") return "low";
  return "mid";
}

function otherRoleCloud(items) {
  const roles = Array.isArray(items) ? items.filter((item) => item && item.role) : [];
  if (!roles.length) return `<span class="muted">No extra roles</span>`;
  return roles
    .map(
      (item) =>
        `<span class="tag is-role">${escapeHtml(item.role)} <b>${Number(item.score) || 0}%</b></span>`
    )
    .join("");
}

function matchCard(item, sent) {
  const checked = sent || state.selectedIds.has(item.profileId) ? " checked" : "";
  const disabled = sent ? " disabled" : "";
  const note = item.hasResume
    ? ""
    : `<p class="muted">No resume on this profile yet. Full analyze will fail until one is added.</p>`;
  const classes = ["intake-match"];
  if (item.topMatch && !sent) classes.push("is-top");
  if (sent) classes.push("is-sent");
  const mains = Array.isArray(item.mainRoles) && item.mainRoles.length
    ? item.mainRoles
    : item.mainRole
      ? [item.mainRole]
      : [];
  const location = item.location || "No location";
  return `
    <label class="${classes.join(" ")}">
      <input type="checkbox" data-profile-id="${escapeHtml(item.profileId)}"${checked}${disabled} />
      <div class="intake-match-body">
        <div class="intake-match-head">
          <strong>${escapeHtml(item.profileName)}</strong>
          <span class="score-chip ${scoreTone(item.score)}">${item.score}%</span>
          ${item.topMatch && !sent ? `<span class="score-chip high">Top match</span>` : ""}
          ${sent ? sentStatusHtml(item.profileId) : ""}
        </div>
        <div class="tag-block">
          <span class="field-label">Main role</span>
          <div class="keyword-cloud">
            ${
              mains.length
                ? mains.map((role) => `<span class="tag is-role">${escapeHtml(role)}</span>`).join("")
                : `<span class="muted">No main role</span>`
            }
            <span class="score-chip ${scoreTone(item.mainRoleScore)}">${Number(item.mainRoleScore) || 0}%</span>
          </div>
        </div>
        <div class="tag-block">
          <span class="field-label">Other roles</span>
          <div class="keyword-cloud">${otherRoleCloud(item.additionalRoles)}</div>
        </div>
        <div class="tag-block">
          <span class="field-label">Location</span>
          <div class="keyword-cloud">
            <span class="tag">${escapeHtml(location)}</span>
            <span class="score-chip ${locationTone(item.locationMatch)}">${locationLabel(item.locationMatch)}</span>
          </div>
          <p class="muted">${escapeHtml(item.locationNote || "")}</p>
        </div>
        <div class="tag-block">
          <span class="field-label">Keywords</span>
          <div class="keyword-cloud">${tagCloud(item.matchedKeywords, "No keyword hits", "is-skill")}</div>
        </div>
        ${note}
        ${sent ? sentErrorHtml(item.profileId) : ""}
      </div>
    </label>
  `;
}

function sentStatusHtml(profileId) {
  const job = state.sentJobs[profileId];
  if (job?.status === "failed") {
    return `<span class="jd-status failed">Failed</span>`;
  }
  if (job?.status === "completed") {
    return `<span class="score-chip high">Analyzed</span>`;
  }
  return `<span class="jd-status analyzing"><span class="spinner" aria-hidden="true"></span> Analyzing…</span>`;
}

function sentErrorHtml(profileId) {
  const job = state.sentJobs[profileId];
  if (job?.status !== "failed") return "";
  return `<p class="jd-status failed">Analyzing failed: ${escapeHtml(job.error || "Unknown error")}</p>`;
}

function availableMatches() {
  return state.matches.filter((item) => !state.sentIds.has(item.profileId));
}

function sentMatches() {
  return state.matches.filter((item) => state.sentIds.has(item.profileId));
}

function renderSent() {
  if (!els.sent) return;
  const sent = sentMatches();
  if (!sent.length) {
    els.sent.innerHTML = "";
    els.sent.classList.add("hidden");
    return;
  }
  els.sent.classList.remove("hidden");
  els.sent.innerHTML = `
    <div class="intake-sent-head">
      <h3>Sent to analyze lists</h3>
      <span class="muted">${sent.length} profile${sent.length === 1 ? "" : "s"}</span>
    </div>
    ${sent.map((item) => matchCard(item, true)).join("")}
  `;
}

function statusBanner(kind, title, detail) {
  const spinner =
    kind === "loading" ? `<span class="spinner" aria-hidden="true"></span>` : "";
  return `<div class="empty-state is-${kind}">${spinner}<strong>${escapeHtml(title)}</strong><span>${escapeHtml(detail)}</span></div>`;
}

function setHint(message, tone) {
  if (!els.hint) return;
  if (tone === "loading") {
    els.hint.innerHTML = `<span class="jd-status analyzing"><span class="spinner" aria-hidden="true"></span> ${escapeHtml(message)}</span>`;
    return;
  }
  if (tone === "failed") {
    els.hint.innerHTML = `<span class="jd-status failed">${escapeHtml(message)}</span>`;
    return;
  }
  els.hint.textContent = message;
}

function setSendBusy(busy) {
  state.sendBusy = busy;
  if (!els.send) return;
  els.send.disabled = busy || selectedProfileIds().length === 0;
  els.send.innerHTML = busy
    ? `<span class="spinner" aria-hidden="true"></span> Sending…`
    : "Send to analyze lists";
}

function renderMatches() {
  if (!els.matches) return;
  const available = availableMatches();
  const banner =
    state.rankStatus === "loading"
      ? statusBanner("loading", "Matching profiles", "Scoring main role, extra roles, keywords, and location.")
      : state.rankStatus === "failed"
        ? statusBanner("failed", "Matching failed", state.rankError || "The match did not complete.")
        : "";
  if (!state.matches.length) {
    els.matches.innerHTML =
      banner ||
      `<div class="empty-state"><strong>No match yet</strong><span>Paste a job description to rank this user’s profiles.</span></div>`;
    renderSent();
    if (els.send && !state.sendBusy) els.send.disabled = true;
    return;
  }
  const cards = !available.length
    ? `<div class="empty-state"><strong>All selected profiles sent</strong><span>Those profiles are listed below and cannot be sent again for this JD.</span></div>`
    : available.map((item) => matchCard(item, false)).join("");
  els.matches.innerHTML = `${banner}${cards}`;
  renderSent();
  if (els.send && !state.sendBusy) els.send.disabled = selectedProfileIds().length === 0;
}

function selectedProfileIds() {
  return availableMatches()
    .map((item) => item.profileId)
    .filter((id) => state.selectedIds.has(id));
}

function clearSent() {
  state.sentIds = new Set();
  state.sentJobs = {};
  clearTimeout(state.statusTimer);
  state.statusTimer = null;
}

function analyzingJobIds() {
  return Object.values(state.sentJobs)
    .filter((job) => job.status === "analyzing" && job.id)
    .map((job) => job.id);
}

function scheduleStatusPoll() {
  clearTimeout(state.statusTimer);
  if (!analyzingJobIds().length) return;
  state.statusTimer = setTimeout(() => {
    pollSentStatus().catch(() => scheduleStatusPoll());
  }, 4000);
}

async function pollSentStatus() {
  const ids = analyzingJobIds();
  if (!ids.length) return;
  const data = await apiJson(`/api/jobs/status?ids=${encodeURIComponent(ids.join(","))}`);
  let changed = false;
  (data.jobs || []).forEach((job) => {
    if (!job.profileId || !state.sentJobs[job.profileId]) return;
    const nextStatus = job.status || state.sentJobs[job.profileId].status;
    const nextError = job.error || "";
    if (state.sentJobs[job.profileId].status !== nextStatus || state.sentJobs[job.profileId].error !== nextError) {
      state.sentJobs[job.profileId] = { id: job.id, status: nextStatus, error: nextError };
      changed = true;
    }
  });
  if (changed) renderSent();
  scheduleStatusPoll();
}

function notifyInbox(payload) {
  const data = { ...payload, at: Date.now() };
  try {
    localStorage.setItem(INBOX_KEY, JSON.stringify(data));
  } catch (_error) {
    // Ignore quota / private mode.
  }
  try {
    const channel = new BroadcastChannel(INBOX_KEY);
    channel.postMessage(data);
    channel.close();
  } catch (_error) {
    // Older browsers ignore this.
  }
}

async function rankMatches() {
  const userId = currentUserId();
  const text = (els.text?.value || "").trim();
  const key = `${userId}\n${text}`;
  if (!userId) {
    setHint("Create a user on the Analyzer page first.");
    return;
  }
  if (text.length < 20) {
    state.matches = [];
    state.selectedIds = new Set();
    state.rankStatus = "idle";
    state.rankError = "";
    clearSent();
    state.lastRankKey = "";
    renderMatches();
    setHint("Paste a fuller job description to rank this user’s profiles.");
    return;
  }
  if (state.rankInFlight) {
    state.rankQueued = true;
    return;
  }
  if (key === state.lastRankKey && state.rankStatus === "idle") return;
  state.rankInFlight = true;
  state.rankStatus = "loading";
  state.rankError = "";
  renderMatches();
  setHint("Matching profiles…", "loading");
  try {
    const data = await apiJson("/api/intake/rank", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId, text, url: els.url?.value || "" }),
    });
    if (state.lastRankKey && state.lastRankKey !== key) clearSent();
    state.lastRankKey = key;
    state.rankStatus = "idle";
    state.jdRole = data.jdRole || "";
    state.jdLocation = data.jdLocation || "";
    state.matches = Array.isArray(data.matches) ? data.matches : [];
    state.selectedIds = new Set(
      state.matches
        .filter((item) => item.topMatch && !state.sentIds.has(item.profileId))
        .map((item) => item.profileId)
    );
    if (!state.selectedIds.size) {
      const next = state.matches.find((item) => !state.sentIds.has(item.profileId));
      if (next) state.selectedIds.add(next.profileId);
    }
    renderMatches();
    const top = state.matches.find((item) => item.topMatch) || state.matches[0];
    const jdBits = [state.jdRole, state.jdLocation].filter(Boolean).join(" · ");
    setHint(
      top
        ? `${jdBits ? `JD: ${jdBits}. ` : ""}Top match: ${top.profileName} (${top.score}%, main role ${top.mainRoleScore || 0}%).`
        : "No role fit yet. Add a resume so a main role and location can be extracted."
    );
  } catch (error) {
    state.rankStatus = "failed";
    state.rankError = error.message || "Matching failed.";
    renderMatches();
    setHint(`Matching failed: ${state.rankError}`, "failed");
  } finally {
    state.rankInFlight = false;
    if (state.rankQueued) {
      state.rankQueued = false;
      rankMatches().catch((error) => {
        state.rankStatus = "failed";
        state.rankError = error.message || "Matching failed.";
        renderMatches();
        setHint(`Matching failed: ${state.rankError}`, "failed");
      });
    }
  }
}

function scheduleRank() {
  clearTimeout(state.rankTimer);
  state.rankTimer = setTimeout(() => {
    rankMatches().catch((error) => {
      state.rankStatus = "failed";
      state.rankError = error.message || "Matching failed.";
      renderMatches();
      setHint(`Matching failed: ${state.rankError}`, "failed");
    });
  }, 700);
}

async function sendToLists() {
  const userId = currentUserId();
  const text = (els.text?.value || "").trim();
  const profileIds = selectedProfileIds();
  if (!profileIds.length) {
    setHint("Select at least one profile.");
    return;
  }
  setSendBusy(true);
  setHint("Sending this JD to the selected profile lists…", "loading");
  try {
    const data = await apiJson("/api/intake/assign", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userId,
        text,
        url: els.url?.value || "",
        profileIds,
      }),
    });
    notifyInbox({
      profileIds: data.profileIds || profileIds,
      jobIds: (data.jobs || []).map((job) => job.id),
    });
    profileIds.forEach((id) => {
      state.sentIds.add(id);
      state.selectedIds.delete(id);
    });
    (data.jobs || []).forEach((job) => {
      if (!job?.profileId) return;
      state.sentJobs[job.profileId] = {
        id: job.id,
        status: job.status || "analyzing",
        error: job.error || "",
      };
    });
    scheduleStatusPoll();
    const next = availableMatches()[0];
    if (next) state.selectedIds.add(next.profileId);
    renderMatches();
    const names = profileIds
      .map((id) => state.matches.find((item) => item.profileId === id)?.profileName || "profile")
      .join(", ");
    const failed = (data.jobs || []).filter((job) => job.status === "failed");
    if (failed.length) {
      setHint(`Sent to ${names}, but analyzing failed: ${failed[0].error || "Unknown error"}`, "failed");
    } else {
      setHint(`Sent to ${names}. Full resume analyze is running.`);
    }
  } catch (error) {
    setHint(`Sending failed: ${error.message || "Could not send this JD."}`, "failed");
  } finally {
    setSendBusy(false);
  }
}

els.user?.addEventListener("change", () => {
  state.lastRankKey = "";
  clearSent();
  state.selectedIds = new Set();
  scheduleRank();
});
els.text?.addEventListener("input", scheduleRank);
els.url?.addEventListener("change", scheduleRank);
els.matches?.addEventListener("change", (event) => {
  const input = event.target.closest("input[data-profile-id]");
  if (!input || input.disabled || state.sentIds.has(input.dataset.profileId)) return;
  if (input.checked) state.selectedIds.add(input.dataset.profileId);
  else state.selectedIds.delete(input.dataset.profileId);
  if (els.send) els.send.disabled = selectedProfileIds().length === 0;
});
els.send?.addEventListener("click", () => {
  sendToLists().catch((error) => {
    setHint(`Sending failed: ${error.message || "Could not send this JD."}`, "failed");
    setSendBusy(false);
  });
});

async function bootstrap() {
  try {
    const data = await apiJson("/api/users");
    state.users = Array.isArray(data.users) ? data.users : [];
    fillUsers();
    if (!state.users.length) {
      setHint("Create a user and profiles on the Analyzer page first.");
      return;
    }
    if ((els.text?.value || "").trim().length >= 20) scheduleRank();
  } catch (error) {
    setHint(`Could not load users: ${error.message || "Request failed."}`, "failed");
  }
}

bootstrap();
