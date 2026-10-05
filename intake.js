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

function matchCard(item, sent) {
  const checked = sent || state.selectedIds.has(item.profileId) ? " checked" : "";
  const disabled = sent ? " disabled" : "";
  const note = item.hasResume
    ? ""
    : `<p class="muted">No resume on this profile yet. Full analyze will fail until one is added.</p>`;
  const roleCount = item.roles?.length || 0;
  const keywordCount = item.keywords?.length || 0;
  const summary = [
    roleCount ? `${roleCount} role tag${roleCount === 1 ? "" : "s"}` : "No role tags",
    keywordCount ? `${keywordCount} keyword${keywordCount === 1 ? "" : "s"}` : "No keywords",
  ].join(" · ");
  const classes = ["intake-match"];
  if (item.topMatch && !sent) classes.push("is-top");
  if (sent) classes.push("is-sent");
  return `
    <label class="${classes.join(" ")}">
      <input type="checkbox" data-profile-id="${escapeHtml(item.profileId)}"${checked}${disabled} />
      <div class="intake-match-body">
        <div class="intake-match-head">
          <strong>${escapeHtml(item.profileName)}</strong>
          <span class="score-chip ${scoreTone(item.score)}">${item.score}%</span>
          ${item.topMatch && !sent ? `<span class="score-chip high">Top match</span>` : ""}
          ${sent ? `<span class="score-chip mid">Sent</span>` : ""}
        </div>
        <p class="muted">${escapeHtml(summary)}</p>
        <div class="tag-block">
          <span class="field-label">Role tags</span>
          <div class="keyword-cloud">${tagCloud(item.matchedRoles, "No role-tag hits", "is-role")}</div>
        </div>
        <div class="tag-block">
          <span class="field-label">Keywords</span>
          <div class="keyword-cloud">${tagCloud(item.matchedKeywords, "No keyword hits", "is-skill")}</div>
        </div>
        ${note}
      </div>
    </label>
  `;
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

function renderMatches() {
  if (!els.matches) return;
  const available = availableMatches();
  if (!state.matches.length) {
    els.matches.innerHTML = `<div class="empty-state"><strong>No match yet</strong><span>Paste a job description to rank this user’s profiles.</span></div>`;
    renderSent();
    if (els.send) els.send.disabled = true;
    return;
  }
  if (!available.length) {
    els.matches.innerHTML = `<div class="empty-state"><strong>All selected profiles sent</strong><span>Those profiles are listed below and cannot be sent again for this JD.</span></div>`;
  } else {
    els.matches.innerHTML = available.map((item) => matchCard(item, false)).join("");
  }
  renderSent();
  if (els.send) els.send.disabled = selectedProfileIds().length === 0;
}

function selectedProfileIds() {
  return availableMatches()
    .map((item) => item.profileId)
    .filter((id) => state.selectedIds.has(id));
}

function clearSent() {
  state.sentIds = new Set();
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
    els.hint.textContent = "Create a user on the Analyzer page first.";
    return;
  }
  if (text.length < 20) {
    state.matches = [];
    state.selectedIds = new Set();
    clearSent();
    state.lastRankKey = "";
    renderMatches();
    els.hint.textContent = "Paste a fuller job description to rank this user’s profiles.";
    return;
  }
  if (state.rankInFlight || key === state.lastRankKey) return;
  state.rankInFlight = true;
  els.hint.textContent = "Matching role tags and keywords against this JD…";
  try {
    const data = await apiJson("/api/intake/rank", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId, text, url: els.url?.value || "" }),
    });
    if (state.lastRankKey && state.lastRankKey !== key) clearSent();
    state.lastRankKey = key;
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
    els.hint.textContent = top
      ? `Top match: ${top.profileName} (${top.score}%). Select profiles and send them to analyze lists.`
      : "No role or keyword overlap yet. Add a resume on each profile so both can be extracted.";
  } catch (error) {
    els.hint.textContent = error.message || "Could not rank profiles.";
  } finally {
    state.rankInFlight = false;
  }
}

function scheduleRank() {
  clearTimeout(state.rankTimer);
  state.rankTimer = setTimeout(() => {
    rankMatches().catch((error) => {
      els.hint.textContent = error.message || "Could not rank profiles.";
    });
  }, 700);
}

async function sendToLists() {
  const userId = currentUserId();
  const text = (els.text?.value || "").trim();
  const profileIds = selectedProfileIds();
  if (!profileIds.length) {
    els.hint.textContent = "Select at least one profile.";
    return;
  }
  els.send.disabled = true;
  els.hint.textContent = "Sending this JD to the selected profile lists…";
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
    const next = availableMatches()[0];
    if (next) state.selectedIds.add(next.profileId);
    renderMatches();
    const names = profileIds
      .map((id) => state.matches.find((item) => item.profileId === id)?.profileName || "profile")
      .join(", ");
    els.hint.textContent = `Sent to ${names}. Those profiles are disabled below. Full resume analyze is running in the Analyzer window.`;
  } catch (error) {
    els.hint.textContent = error.message || "Could not send this JD.";
  } finally {
    if (els.send) els.send.disabled = selectedProfileIds().length === 0;
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
    els.hint.textContent = error.message || "Could not send this JD.";
  });
});

async function bootstrap() {
  try {
    const data = await apiJson("/api/users");
    state.users = Array.isArray(data.users) ? data.users : [];
    fillUsers();
    if (!state.users.length) {
      els.hint.textContent = "Create a user and profiles on the Analyzer page first.";
      return;
    }
    if ((els.text?.value || "").trim().length >= 20) scheduleRank();
  } catch (error) {
    els.hint.textContent = error.message || "Could not load users.";
  }
}

bootstrap();
