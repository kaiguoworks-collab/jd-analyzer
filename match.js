const els = {
  user: document.getElementById("match-user"),
  url: document.getElementById("match-url"),
  text: document.getElementById("match-text"),
  hint: document.getElementById("match-hint"),
  empty: document.getElementById("match-empty"),
  body: document.getElementById("match-body"),
  heading: document.getElementById("match-heading"),
  list: document.getElementById("match-list"),
  send: document.getElementById("match-send"),
  subtitle: document.getElementById("match-subtitle"),
};

const state = {
  users: [],
  userId: "",
  matches: [],
  title: "",
  company: "",
  role: "",
  selectedIds: new Set(),
  matchTimer: null,
  matchController: null,
  lastKey: "",
  sending: false,
};

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

async function apiJson(url, options) {
  const fetchOptions = options ? Object.assign({}, options) : {};
  const waitMs = String(url).includes("/match") ? 180000 : 45000;
  const controller = fetchOptions.signal
    ? null
    : typeof AbortController === "function"
      ? new AbortController()
      : null;
  if (controller) fetchOptions.signal = controller.signal;
  const timer = setTimeout(() => controller?.abort(), waitMs);
  try {
    const response = await fetch(url, fetchOptions);
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "Request failed.");
    return data;
  } catch (error) {
    if (error && error.name === "AbortError") throw error;
    throw error instanceof Error ? error : new Error("Request failed.");
  } finally {
    clearTimeout(timer);
  }
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

function notifyAssigned(profileIds) {
  const payload = { type: "assigned", profileIds, at: Date.now() };
  try {
    const channel = new BroadcastChannel("jd-inbox");
    channel.postMessage(payload);
    channel.close();
  } catch (_error) {
    // Older browsers still get localStorage.
  }
  try {
    localStorage.setItem("jd-inbox-assigned", JSON.stringify(payload));
  } catch (_error) {
    // Ignore quota or private-mode failures.
  }
}

function renderUsers() {
  if (!els.user) return;
  if (!state.users.length) {
    els.user.innerHTML = `<option value="">Create a user on the Analyzer page first</option>`;
    return;
  }
  els.user.innerHTML = state.users
    .map(
      (user) =>
        `<option value="${escapeHtml(user.id)}"${user.id === state.userId ? " selected" : ""}>${escapeHtml(user.name)}</option>`
    )
    .join("");
}

function renderMatches() {
  if (!state.matches.length) {
    els.empty.classList.remove("hidden");
    els.body.classList.add("hidden");
    return;
  }
  els.empty.classList.add("hidden");
  els.body.classList.remove("hidden");
  els.heading.textContent = state.title || "Ranked profiles";
  els.list.innerHTML = state.matches
    .map((item) => {
      const checked = state.selectedIds.has(item.profileId) ? " checked" : "";
      const top = item.top ? `<span class="score-chip high">Top match</span>` : "";
      return `
        <label class="match-item${item.top ? " is-top" : ""}">
          <input type="checkbox" data-profile-id="${escapeHtml(item.profileId)}"${checked} />
          <span>
            <b>${escapeHtml(item.profileName)}</b>
            <small>${escapeHtml(item.note || "No note.")}</small>
          </span>
          <span class="match-scores">
            ${top}
            <span class="score-chip">${item.overall}%</span>
          </span>
        </label>
      `;
    })
    .join("");
}

function scheduleMatch() {
  clearTimeout(state.matchTimer);
  state.matchTimer = setTimeout(() => {
    runMatch().catch((error) => {
      if (els.hint) els.hint.textContent = error.message || "Could not rank profiles.";
    });
  }, 700);
}

async function runMatch() {
  const userId = els.user?.value || "";
  const text = (els.text?.value || "").trim();
  const url = normalizeJdUrl(els.url?.value || "");
  if (!userId) {
    els.hint.textContent = "Select a user first.";
    return;
  }
  if (text.length < 40) {
    els.hint.textContent = "Paste more of the job description to start matching.";
    return;
  }
  const key = `${userId}\n${url}\n${text}`;
  if (key === state.lastKey) return;
  if (state.matchController) {
    try {
      state.matchController.abort();
    } catch (_error) {
      // Ignore.
    }
  }
  state.matchController = typeof AbortController === "function" ? new AbortController() : null;
  els.hint.textContent = "Ranking this user’s profiles…";
  try {
    const data = await apiJson("/api/match", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: state.matchController ? state.matchController.signal : undefined,
      body: JSON.stringify({ userId, url, text }),
    });
    state.lastKey = key;
    state.title = data.title || "";
    state.company = data.company || "";
    state.role = data.role || "";
    state.matches = Array.isArray(data.matches) ? data.matches : [];
    state.selectedIds = new Set(
      state.matches.filter((item) => item.top).map((item) => item.profileId)
    );
    if (!state.selectedIds.size && state.matches[0]) {
      state.selectedIds.add(state.matches[0].profileId);
    }
    renderMatches();
    const top = state.matches[0];
    els.hint.textContent = top
      ? `Top match: ${top.profileName} (${top.overall}%). Select profiles and send them to the analyzing list.`
      : "No ranked profiles were returned.";
  } catch (error) {
    if (error && error.name === "AbortError") return;
    throw error;
  }
}

async function sendToAnalyzer() {
  if (state.sending) return;
  const userId = els.user?.value || "";
  const text = (els.text?.value || "").trim();
  const url = normalizeJdUrl(els.url?.value || "");
  const profileIds = [...state.selectedIds];
  if (!profileIds.length) {
    els.hint.textContent = "Select at least one profile.";
    return;
  }
  state.sending = true;
  els.send.disabled = true;
  els.hint.textContent = "Sending to the analyzing list…";
  try {
    const data = await apiJson("/api/match/assign", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userId,
        url,
        text,
        title: state.title,
        company: state.company,
        role: state.role,
        profileIds,
      }),
    });
    const assigned = Array.isArray(data.jobs) ? data.jobs : [];
    notifyAssigned(assigned.map((item) => item.profile?.id).filter(Boolean));
    els.hint.textContent = `Sent to ${assigned.length} profile${assigned.length === 1 ? "" : "s"}. Full analyze is running in the Analyzer window.`;
    els.url.value = "";
    els.text.value = "";
    state.lastKey = "";
    state.matches = [];
    state.selectedIds = new Set();
    renderMatches();
  } catch (error) {
    els.hint.textContent = error.message || "Could not send this JD.";
  } finally {
    state.sending = false;
    els.send.disabled = false;
  }
}

els.user?.addEventListener("change", () => {
  state.userId = els.user.value;
  state.lastKey = "";
  scheduleMatch();
});

els.url?.addEventListener("input", scheduleMatch);
els.text?.addEventListener("input", scheduleMatch);
els.text?.addEventListener("paste", () => setTimeout(scheduleMatch, 50));
els.url?.addEventListener("paste", () => setTimeout(scheduleMatch, 50));

els.list?.addEventListener("change", (event) => {
  const input = event.target;
  if (!(input instanceof HTMLInputElement) || !input.dataset.profileId) return;
  if (input.checked) state.selectedIds.add(input.dataset.profileId);
  else state.selectedIds.delete(input.dataset.profileId);
});

els.send?.addEventListener("click", (event) => {
  event.preventDefault();
  sendToAnalyzer();
});

async function bootstrap() {
  try {
    const data = await apiJson("/api/users");
    state.users = Array.isArray(data.users) ? data.users : [];
    state.userId = state.users[0]?.id || "";
    renderUsers();
    if (!state.users.length) {
      els.hint.textContent = "Create a user and profiles on the Analyzer page first.";
    }
  } catch (error) {
    els.hint.textContent = error.message || "Could not load users.";
  }
}

bootstrap();
