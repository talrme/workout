const STORAGE_KEY = "workout-sheet-prototype-v1";

const DEFAULT_MACHINES = [
  { id: "leg-press", name: "Leg Press", targetWeight: 180, setupNotes: "Seat comfortable, knees tracking straight." },
  { id: "chest-press", name: "Chest Press", targetWeight: 70, setupNotes: "Seat so handles start around mid-chest." },
  { id: "lat-pulldown", name: "Lat Pulldown", targetWeight: 80, setupNotes: "Thigh pad snug, pull toward upper chest." },
  { id: "seated-row", name: "Seated Row", targetWeight: 75, setupNotes: "Chest tall, no leaning back." },
  { id: "shoulder-press", name: "Shoulder Press", targetWeight: 45, setupNotes: "Seat so handles start around ear height." },
  { id: "leg-curl", name: "Leg Curl", targetWeight: 65, setupNotes: "Knee aligned with pivot point." },
  { id: "leg-extension", name: "Leg Extension", targetWeight: 70, setupNotes: "Pad just above ankle, controlled tempo." }
];

const state = {
  machines: DEFAULT_MACHINES.map((machine) => ({ ...machine })),
  logs: [],
  settings: {
    backendUrl: window.WORKOUT_CONFIG?.defaultBackendUrl || "",
    profileName: "Tal",
    autoSync: window.WORKOUT_CONFIG?.autoSync ?? false,
    reduceMotion: false
  }
};

const els = {
  machines: document.querySelector("[data-machines]"),
  logs: document.querySelector("[data-logs]"),
  setsToday: document.querySelector("[data-sets-today]"),
  syncTitle: document.querySelector("[data-sync-title]"),
  syncDetail: document.querySelector("[data-sync-detail]"),
  backendUrl: document.querySelector("[data-backend-url]"),
  profileName: document.querySelector("[data-profile-name]"),
  autoSync: document.querySelector("[data-auto-sync]"),
  reduceMotion: document.querySelector("[data-reduce-motion]"),
  settingsBackdrop: document.querySelector("[data-settings-backdrop]"),
  settingsModal: document.querySelector("[data-settings-modal]"),
  machineTemplate: document.querySelector("[data-machine-template]")
};

function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
    if (Array.isArray(saved.machines) && saved.machines.length) state.machines = saved.machines;
    if (Array.isArray(saved.logs)) state.logs = saved.logs;
    Object.assign(state.settings, saved.settings || {});
    if (!state.settings.backendUrl && window.WORKOUT_CONFIG?.defaultBackendUrl) {
      state.settings.backendUrl = window.WORKOUT_CONFIG.defaultBackendUrl;
      state.settings.autoSync = window.WORKOUT_CONFIG.autoSync ?? state.settings.autoSync;
    }
  } catch {
    localStorage.removeItem(STORAGE_KEY);
  }
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function render() {
  document.body.classList.toggle("reduce-motion", state.settings.reduceMotion);
  renderSyncStatus();
  renderMachines();
  renderLogs();
  renderSettings();
}

function renderSyncStatus() {
  const enabled = Boolean(state.settings.backendUrl);
  els.syncTitle.textContent = enabled ? "Google Sheet connected" : "Local mode";
  els.syncDetail.textContent = enabled
    ? "Machine targets and set logs can sync with your Sheet."
    : "Saved on this browser. Paste a Google Apps Script URL in settings to sync with a Sheet.";
}

function renderSettings() {
  els.backendUrl.value = state.settings.backendUrl || "";
  els.profileName.value = state.settings.profileName || "";
  els.autoSync.checked = Boolean(state.settings.autoSync);
  els.reduceMotion.checked = Boolean(state.settings.reduceMotion);
}

function renderMachines() {
  els.machines.innerHTML = "";
  state.machines.forEach((machine, index) => {
    const node = els.machineTemplate.content.firstElementChild.cloneNode(true);
    node.dataset.machineId = machine.id;
    node.querySelector(".machine-number").textContent = `Machine ${index + 1}`;
    node.querySelector("h2").textContent = machine.name;
    node.querySelector("[data-target-weight]").value = machine.targetWeight ?? "";
    node.querySelector("[data-log-weight]").value = machine.targetWeight ?? "";
    node.querySelector("[data-setup-notes]").value = machine.setupNotes || "";
    els.machines.appendChild(node);
  });
}

function renderLogs() {
  const today = isoDate(new Date());
  const todaysLogs = state.logs.filter((log) => log.date === today);
  els.setsToday.textContent = todaysLogs.length;

  if (!state.logs.length) {
    els.logs.innerHTML = `<p>No logs yet. Try logging one set.</p>`;
    return;
  }

  els.logs.innerHTML = state.logs
    .slice()
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
    .slice(0, 18)
    .map((log) => {
      const effort = log.effort ? ` · effort ${escapeHtml(log.effort)}` : "";
      const rir = log.rir ? ` · ${escapeHtml(log.rir)} left` : "";
      const reps = log.reps ? ` x ${escapeHtml(log.reps)}` : "";
      const note = log.note ? `<span>${escapeHtml(log.note)}</span>` : "";
      return `
        <article class="log-row">
          <div>
            <strong>${escapeHtml(log.machineName)}</strong>
            <span>${escapeHtml(log.date)} · <em>${escapeHtml(log.weight || "")} lb${reps}</em>${effort}${rir}</span>
            ${note}
          </div>
          <button type="button" data-delete-log="${escapeHtml(log.id)}">Delete</button>
        </article>
      `;
    })
    .join("");
}

function saveMachine(card) {
  const machine = machineFromCard(card);
  state.machines = state.machines.map((item) => item.id === machine.id ? { ...item, ...machine } : item);
  saveState();
  render();
  syncMachine(machine);
}

function logSet(card) {
  const machine = machineFromCard(card);
  const log = {
    id: crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`,
    date: isoDate(new Date()),
    createdAt: new Date().toISOString(),
    profileName: state.settings.profileName || "",
    machineId: machine.id,
    machineName: machine.name,
    weight: card.querySelector("[data-log-weight]").value.trim(),
    reps: card.querySelector("[data-reps]").value.trim(),
    effort: card.querySelector("[data-effort]").value,
    rir: card.querySelector("[data-rir]").value,
    note: card.querySelector("[data-log-note]").value.trim()
  };

  state.machines = state.machines.map((item) => item.id === machine.id ? { ...item, ...machine } : item);
  state.logs.push(log);
  saveState();
  card.querySelector("[data-reps]").value = "";
  card.querySelector("[data-effort]").value = "";
  card.querySelector("[data-rir]").value = "";
  card.querySelector("[data-log-note]").value = "";
  render();
  syncMachine(machine);
  syncLog(log);
}

function machineFromCard(card) {
  const original = state.machines.find((machine) => machine.id === card.dataset.machineId);
  return {
    ...original,
    targetWeight: card.querySelector("[data-target-weight]").value.trim(),
    setupNotes: card.querySelector("[data-setup-notes]").value.trim()
  };
}

function deleteLog(id) {
  state.logs = state.logs.filter((log) => log.id !== id);
  saveState();
  render();
}

async function syncNow() {
  if (!state.settings.backendUrl) {
    openSettings();
    return;
  }
  setSyncDetail("Syncing...");
  try {
    const response = await backendRequest("snapshot");
    if (response && response.ok) {
      if (Array.isArray(response.machines) && response.machines.length) {
        state.machines = mergeMachines(response.machines);
      }
      if (Array.isArray(response.logs)) {
        state.logs = mergeLogs(response.logs);
      }
      saveState();
      render();
      setSyncDetail("Synced with your Google Sheet.");
    } else {
      setSyncDetail("The Sheet responded, but not with the expected data.");
    }
  } catch (error) {
    console.warn(error);
    setSyncDetail("Could not sync. Check the Apps Script URL and deployment permissions.");
  }
}

function syncMachine(machine) {
  if (!state.settings.backendUrl) return;
  backendRequest("saveMachine", { machine }).catch((error) => {
    console.warn(error);
    setSyncDetail("Saved locally, but the Sheet sync failed.");
  });
}

function syncLog(log) {
  if (!state.settings.backendUrl) return;
  backendRequest("logSet", { log }).catch((error) => {
    console.warn(error);
    setSyncDetail("Logged locally, but the Sheet sync failed.");
  });
}

function backendRequest(action, payload = {}) {
  return new Promise((resolve, reject) => {
    const callbackName = `workoutCallback_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const url = new URL(state.settings.backendUrl);
    url.searchParams.set("action", action);
    url.searchParams.set("callback", callbackName);
    if (Object.keys(payload).length) url.searchParams.set("payload", JSON.stringify(payload));

    const script = document.createElement("script");
    const timeout = window.setTimeout(() => {
      cleanup();
      reject(new Error("Backend request timed out"));
    }, 10000);

    window[callbackName] = (data) => {
      cleanup();
      resolve(data);
    };

    script.onerror = () => {
      cleanup();
      reject(new Error("Backend request failed"));
    };

    function cleanup() {
      window.clearTimeout(timeout);
      delete window[callbackName];
      script.remove();
    }

    script.src = url.toString();
    document.body.appendChild(script);
  });
}

function mergeMachines(incoming) {
  const byId = new Map(state.machines.map((machine) => [machine.id, machine]));
  incoming.forEach((machine) => {
    byId.set(machine.id, { ...(byId.get(machine.id) || {}), ...machine });
  });
  return DEFAULT_MACHINES.map((machine) => ({ ...machine, ...(byId.get(machine.id) || {}) }));
}

function mergeLogs(incoming) {
  const byId = new Map(state.logs.map((log) => [log.id, log]));
  incoming.forEach((log) => {
    if (log.id) byId.set(log.id, log);
  });
  return Array.from(byId.values());
}

function setSyncDetail(message) {
  els.syncDetail.textContent = message;
}

function openSettings() {
  els.settingsBackdrop.hidden = false;
  els.settingsModal.hidden = false;
  document.body.classList.add("is-modal-open");
}

function closeSettings() {
  els.settingsBackdrop.hidden = true;
  els.settingsModal.hidden = true;
  document.body.classList.remove("is-modal-open");
}

function saveSettings() {
  state.settings.backendUrl = els.backendUrl.value.trim();
  state.settings.profileName = els.profileName.value.trim() || "Tal";
  state.settings.autoSync = els.autoSync.checked;
  state.settings.reduceMotion = els.reduceMotion.checked;
  saveState();
  closeSettings();
  render();
  if (state.settings.backendUrl) syncNow();
}

function resetSite() {
  localStorage.removeItem(STORAGE_KEY);
  window.location.reload();
}

function clearLocal() {
  state.logs = [];
  saveState();
  render();
}

function isoDate(date) {
  return date.toISOString().slice(0, 10);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function bindEvents() {
  document.querySelector("[data-open-settings]").addEventListener("click", openSettings);
  document.querySelector("[data-close-settings]").addEventListener("click", closeSettings);
  document.querySelector("[data-save-settings]").addEventListener("click", saveSettings);
  document.querySelector("[data-reset-site]").addEventListener("click", resetSite);
  document.querySelector("[data-sync-now]").addEventListener("click", syncNow);
  document.querySelector("[data-clear-local]").addEventListener("click", clearLocal);
  els.settingsBackdrop.addEventListener("click", closeSettings);

  els.machines.addEventListener("click", (event) => {
    const card = event.target.closest(".machine-card");
    if (!card) return;
    if (event.target.matches("[data-save-machine]")) saveMachine(card);
    if (event.target.matches("[data-log-set]")) logSet(card);
  });

  els.logs.addEventListener("click", (event) => {
    const id = event.target.dataset.deleteLog;
    if (id) deleteLog(id);
  });
}

function init() {
  loadState();
  bindEvents();
  render();
  if (state.settings.autoSync && state.settings.backendUrl) syncNow();
}

init();
