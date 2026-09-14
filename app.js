const STORAGE_KEY = "workout-sheet-prototype-v2";
const OLD_STORAGE_KEY = "workout-sheet-prototype-v1";
const HISTORY_COLUMNS = 5;
const DEMO_DAYS = 6;
const DEMO_LOG_PREFIX = "demo-week-";
const DELETE_MARKER = "__WORKOUT_DELETE__";

const DEFAULT_MACHINES = [
  { id: "leg-press", name: "Leg Press", group: "Legs", seedWeight: 180, setupNotes: "Seat comfortable, knees tracking straight." },
  { id: "leg-curl", name: "Leg Curl", group: "Legs", seedWeight: 65, setupNotes: "Knee aligned with pivot point." },
  { id: "leg-extension", name: "Leg Extension", group: "Legs", seedWeight: 70, setupNotes: "Pad just above ankle, controlled tempo." },
  { id: "chest-press", name: "Chest Press", group: "Upper body", seedWeight: 70, setupNotes: "Seat so handles start around mid-chest." },
  { id: "lat-pulldown", name: "Lat Pulldown", group: "Upper body", seedWeight: 80, setupNotes: "Thigh pad snug, pull toward upper chest." },
  { id: "seated-row", name: "Seated Row", group: "Upper body", seedWeight: 75, setupNotes: "Chest tall, no leaning back." },
  { id: "shoulder-press", name: "Shoulder Press", group: "Upper body", seedWeight: 45, setupNotes: "Seat so handles start around ear height." },
  { id: "plank", name: "Plank", group: "Core", seedWeight: "30s", valueLabel: "Time", setupNotes: "Start with 30 seconds. Keep hips steady and breathe." }
];

const state = {
  machines: DEFAULT_MACHINES.map((machine) => ({ ...machine })),
  logs: [],
  expandedId: "",
  editingDate: "",
  settings: {
    backendUrl: window.WORKOUT_CONFIG?.defaultBackendUrl || "",
    profileName: "Tal",
    autoSync: window.WORKOUT_CONFIG?.autoSync ?? true,
    reduceMotion: false
  }
};

const els = {
  tableHead: document.querySelector("[data-table-head]"),
  machineTable: document.querySelector("[data-machine-table]"),
  syncNote: document.querySelector("[data-sync-note]"),
  sheetLink: document.querySelector("[data-sheet-link]"),
  profileName: document.querySelector("[data-profile-name]"),
  autoSync: document.querySelector("[data-auto-sync]"),
  reduceMotion: document.querySelector("[data-reduce-motion]"),
  settingsBackdrop: document.querySelector("[data-settings-backdrop]"),
  settingsModal: document.querySelector("[data-settings-modal]"),
  populateSample: document.querySelector("[data-populate-sample]"),
  clearSample: document.querySelector("[data-clear-sample]"),
  dateBackdrop: document.querySelector("[data-date-backdrop]"),
  dateModal: document.querySelector("[data-date-modal]"),
  dateTitle: document.querySelector("[data-date-title]"),
  editDate: document.querySelector("[data-edit-date]"),
  dayMachineList: document.querySelector("[data-day-machine-list]")
};

function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || localStorage.getItem(OLD_STORAGE_KEY) || "{}");
    if (Array.isArray(saved.machines) && saved.machines.length) state.machines = mergeMachines(saved.machines);
    if (Array.isArray(saved.logs)) state.logs = saved.logs;
    Object.assign(state.settings, saved.settings || {});
    if (!state.settings.backendUrl && window.WORKOUT_CONFIG?.defaultBackendUrl) {
      state.settings.backendUrl = window.WORKOUT_CONFIG.defaultBackendUrl;
      state.settings.autoSync = window.WORKOUT_CONFIG.autoSync ?? state.settings.autoSync;
    }
  } catch {
    localStorage.removeItem(STORAGE_KEY);
  }
  if (!state.logs.length) state.logs = createDemoLogs();
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function render() {
  document.body.classList.toggle("reduce-motion", state.settings.reduceMotion);
  if (window.WORKOUT_CONFIG?.sheetUrl) els.sheetLink.href = window.WORKOUT_CONFIG.sheetUrl;
  renderSettings();
  renderMachineTable();
}

function renderSettings() {
  els.profileName.value = state.settings.profileName || "";
  els.autoSync.checked = Boolean(state.settings.autoSync);
  els.reduceMotion.checked = Boolean(state.settings.reduceMotion);
}

function renderMachineTable() {
  const dates = displayDates();
  els.tableHead.innerHTML = `
    <tr>
      <th scope="col" class="machine-col">Machine</th>
      ${dates.map((date, index) => `
        <th scope="col" class="date-col">
          <div class="date-head ${completionClass(date)}">
            <button type="button" data-open-date="${escapeHtml(date)}">
              <span>${escapeHtml(formatDateLabel(date, index === dates.length - 1))}</span>
              <small>${escapeHtml(completionText(date))}</small>
            </button>
            ${index === dates.length - 1 ? `<button type="button" class="add-day-button" data-add-day aria-label="Add another day">+</button>` : ""}
          </div>
        </th>
      `).join("")}
    </tr>
  `;

  let lastGroup = "";
  const rows = [];
  orderedMachines().forEach((machine) => {
    if (machine.group !== lastGroup) {
      lastGroup = machine.group;
      rows.push(`<tr class="group-row"><th scope="row">${escapeHtml(lastGroup)}</th><td colspan="${dates.length}"></td></tr>`);
    }
    rows.push(machineRow(machine, dates));
    if (state.expandedId === machine.id) rows.push(detailRow(machine, dates.length + 1));
  });
  els.machineTable.innerHTML = rows.join("");
}

function orderedMachines() {
  const order = new Map(DEFAULT_MACHINES.map((machine, index) => [machine.id, index]));
  return state.machines.slice().sort((a, b) => (order.get(a.id) ?? 99) - (order.get(b.id) ?? 99));
}

function machineRow(machine, dates) {
  const today = isoDate(new Date());
  return `
    <tr class="machine-row ${state.expandedId === machine.id ? "is-open" : ""}" data-machine-row="${escapeHtml(machine.id)}">
      <th scope="row">
        <button type="button" class="machine-name" data-expand="${escapeHtml(machine.id)}" aria-expanded="${state.expandedId === machine.id}">
          <span>${escapeHtml(machine.name)}</span>
          <small>${escapeHtml(machine.setupNotes || "Add setup notes")}</small>
        </button>
      </th>
      ${dates.map((date) => {
        const log = latestLogFor(machine.id, date);
        if (date === today) {
          const previous = previousWeight(machine.id, today) || defaultValue(machine);
          if (log?.weight) {
            return `<td class="today-cell"><button type="button" class="done-pill" data-expand="${escapeHtml(machine.id)}" aria-label="Edit today's ${escapeHtml(machine.name)} ${escapeHtml(valueLabel(machine).toLowerCase())}"><span aria-hidden="true">✓</span>${escapeHtml(log.weight)}</button></td>`;
          }
          return `<td class="today-cell is-missing"><button type="button" class="same-button" data-repeat-weight="${escapeHtml(machine.id)}" aria-label="Log ${escapeHtml(machine.name)} at previous ${escapeHtml(valueLabel(machine).toLowerCase())}">✓</button><span class="ghost-weight">${previous ? escapeHtml(previous) : ""}</span></td>`;
        }
        return `<td class="${log?.weight ? "" : "is-missing"}">${log?.weight ? `<span class="weight-chip">${escapeHtml(log.weight)}</span>` : `<span class="empty-cell">-</span>`}</td>`;
      }).join("")}
    </tr>
  `;
}

function detailRow(machine, colspan) {
  const today = isoDate(new Date());
  const todayLog = latestLogFor(machine.id, today);
  const previous = previousWeight(machine.id, today) || defaultValue(machine);
  return `
    <tr class="detail-row">
      <td colspan="${colspan}">
        <div class="detail-panel" data-detail-panel="${escapeHtml(machine.id)}">
          <div class="detail-grid">
            <label>
              <span>Today's ${escapeHtml(valueLabel(machine).toLowerCase())}</span>
              <input data-today-weight ${inputAttributes(machine)} value="${escapeHtml(todayLog?.weight || previous || "")}">
            </label>
            <label>
              <span>Today's note</span>
              <input data-today-note type="text" value="${escapeHtml(todayLog?.note || "")}" placeholder="Felt smooth, seat tweak, etc.">
            </label>
          </div>
          <label>
            <span>Setup notes</span>
            <textarea data-setup-notes rows="3">${escapeHtml(machine.setupNotes || "")}</textarea>
          </label>
          <div class="detail-actions">
            <button type="button" class="primary" data-save-detail="${escapeHtml(machine.id)}">Save</button>
            ${todayLog ? `<button type="button" class="danger" data-delete-today="${escapeHtml(machine.id)}">Delete today</button>` : ""}
            <button type="button" data-close-detail>Close</button>
          </div>
        </div>
      </td>
    </tr>
  `;
}

function displayDates() {
  const today = isoDate(new Date());
  const unique = Array.from(new Set(state.logs
    .filter((log) => String(log.weight || "").trim())
    .map((log) => normalizeDate(log.date))
    .filter((date) => date && dateHasVisibleLog(date))))
    .filter((date) => date !== today)
    .sort((a, b) => b.localeCompare(a))
    .slice(0, HISTORY_COLUMNS - 1)
    .reverse();
  return [...unique, today];
}

function latestLogFor(machineId, date) {
  const latest = latestEventFor(machineId, date);
  if (!latest || isDeleteMarker(latest) || !String(latest.weight || "").trim()) return null;
  return latest;
}

function latestEventFor(machineId, date) {
  const normalizedDate = normalizeDate(date);
  return state.logs
    .filter((log) => log.machineId === machineId && normalizeDate(log.date) === normalizedDate)
    .sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")))[0];
}

function dateHasVisibleLog(date) {
  return orderedMachines().some((machine) => latestLogFor(machine.id, date));
}

function completionForDate(date) {
  const total = orderedMachines().length;
  const done = orderedMachines().filter((machine) => latestLogFor(machine.id, date)).length;
  return { done, total };
}

function completionText(date) {
  const { done, total } = completionForDate(date);
  return `${done}/${total}`;
}

function completionClass(date) {
  const { done, total } = completionForDate(date);
  if (done === 0) return "is-empty-day";
  if (done === total) return "is-complete-day";
  return "is-partial-day";
}

function previousWeight(machineId, beforeDate) {
  const normalizedBefore = normalizeDate(beforeDate);
  const dates = Array.from(new Set(state.logs
    .filter((item) => item.machineId === machineId && normalizeDate(item.date) !== normalizedBefore)
    .map((item) => normalizeDate(item.date))
    .filter(Boolean)))
    .sort((a, b) => b.localeCompare(a));
  for (const date of dates) {
    const log = latestLogFor(machineId, date);
    if (log?.weight) return log.weight;
  }
  return "";
}

function formatDateLabel(date, isTodayColumn = false) {
  const normalized = normalizeDate(date);
  if (!normalized) return "";
  if (isTodayColumn) return "Today";
  const parts = normalized.split("-");
  return `${Number(parts[1])}/${Number(parts[2])}`;
}

function formatLongDate(date) {
  const normalized = normalizeDate(date);
  if (!normalized) return "Edit day";
  const [year, month, day] = normalized.split("-").map(Number);
  const localDate = new Date(year, month - 1, day);
  return new Intl.DateTimeFormat(undefined, { weekday: "short", month: "short", day: "numeric" }).format(localDate);
}

function valueLabel(machine) {
  return machine.valueLabel || "Weight";
}

function defaultValue(machine) {
  return machine.seedWeight || machine.targetWeight || "";
}

function inputAttributes(machine) {
  if (machine.valueLabel === "Time") return `type="text" inputmode="text" placeholder="30s"`;
  return `type="number" min="0" step="5" inputmode="decimal"`;
}

function toggleMachine(machineId) {
  state.expandedId = state.expandedId === machineId ? "" : machineId;
  saveState();
  render();
}

function quickRepeat(machineId) {
  const machine = state.machines.find((item) => item.id === machineId);
  if (!machine) return;
  const weight = previousWeight(machineId, isoDate(new Date())) || defaultValue(machine);
  if (!weight) {
    state.expandedId = machineId;
    saveState();
    render();
    return;
  }
  appendTodayLog(machine, { weight, note: "" });
}

function saveDetail(machineId) {
  const machine = state.machines.find((item) => item.id === machineId);
  const panel = document.querySelector(`[data-detail-panel="${CSS.escape(machineId)}"]`);
  if (!machine || !panel) return;

  const setupNotes = panel.querySelector("[data-setup-notes]").value.trim();
  const weight = panel.querySelector("[data-today-weight]").value.trim();
  const note = panel.querySelector("[data-today-note]").value.trim();
  const updatedMachine = { ...machine, setupNotes };

  state.machines = state.machines.map((item) => item.id === machineId ? updatedMachine : item);
  if (weight) appendTodayLog(updatedMachine, { weight, note }, { renderAfter: false });
  state.expandedId = "";
  saveState();
  render();
  syncMachine(updatedMachine);
}

function deleteToday(machineId) {
  const machine = state.machines.find((item) => item.id === machineId);
  const todayLog = latestLogFor(machineId, isoDate(new Date()));
  if (!machine || !todayLog) return;
  appendTodayLog(machine, { weight: "", note: DELETE_MARKER, deleted: true });
}

function appendTodayLog(machine, values, options = {}) {
  appendLogForDate(machine, isoDate(new Date()), values, options);
}

function appendLogForDate(machine, date, values, options = {}) {
  const log = {
    id: crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`,
    date,
    createdAt: new Date().toISOString(),
    profileName: state.settings.profileName || "",
    machineId: machine.id,
    machineName: machine.name,
    weight: values.weight || "",
    reps: "",
    effort: "",
    rir: "",
    note: values.deleted ? DELETE_MARKER : values.note || "",
    deleted: Boolean(values.deleted),
    _demo: Boolean(values._demo)
  };
  state.logs.push(log);
  saveState();
  if (options.renderAfter !== false) render();
  syncLog(log);
}

function openDateModal(date) {
  state.editingDate = normalizeDate(date) || isoDate(new Date());
  els.editDate.value = state.editingDate;
  renderDateModal();
  els.dateBackdrop.hidden = false;
  els.dateModal.hidden = false;
  document.body.classList.add("is-modal-open");
}

function addDay() {
  openDateModal(isoDate(addDays(new Date(), -1)));
}

function renderDateModal() {
  const date = normalizeDate(els.editDate.value || state.editingDate);
  els.dateTitle.textContent = formatLongDate(date);
  els.dayMachineList.innerHTML = orderedMachines().map((machine) => {
    const log = latestLogFor(machine.id, date);
    return `
      <section class="day-machine" data-day-machine="${escapeHtml(machine.id)}">
        <h3>${escapeHtml(machine.name)}</h3>
        <div class="day-fields">
          <label>
            <span>${escapeHtml(valueLabel(machine))}</span>
            <input data-day-weight ${inputAttributes(machine)} value="${escapeHtml(log?.weight || "")}">
          </label>
          <label>
            <span>Note</span>
            <input data-day-note type="text" value="${escapeHtml(log?.note || "")}" placeholder="Optional">
          </label>
        </div>
      </section>
    `;
  }).join("");
}

function closeDateModal() {
  state.editingDate = "";
  els.dateBackdrop.hidden = true;
  els.dateModal.hidden = true;
  document.body.classList.remove("is-modal-open");
}

function saveDateModal() {
  const date = normalizeDate(els.editDate.value || state.editingDate);
  if (!date) return;
  const localOnly = dateIsDemoOnly(date);
  orderedMachines().forEach((machine) => {
    const section = els.dayMachineList.querySelector(`[data-day-machine="${CSS.escape(machine.id)}"]`);
    if (!section) return;
    const weight = section.querySelector("[data-day-weight]").value.trim();
    const note = section.querySelector("[data-day-note]").value.trim();
    const existing = latestLogFor(machine.id, date);
    if (!weight && !note && existing) {
      appendLogForDate(machine, date, { weight: "", note: DELETE_MARKER, deleted: true, _demo: localOnly }, { renderAfter: false });
      return;
    }
    if (!weight && !note) return;
    if (String(existing?.weight || "") === weight && String(existing?.note || "") === note) return;
    appendLogForDate(machine, date, { weight, note, _demo: localOnly }, { renderAfter: false });
  });
  saveState();
  closeDateModal();
  render();
  setSyncNote("Saved");
}

function deleteDateModal() {
  const date = normalizeDate(els.editDate.value || state.editingDate);
  if (!date) return;
  const localOnly = dateIsDemoOnly(date);
  orderedMachines().forEach((machine) => {
    appendLogForDate(machine, date, { weight: "", note: DELETE_MARKER, deleted: true, _demo: localOnly }, { renderAfter: false });
  });
  saveState();
  closeDateModal();
  render();
  setSyncNote("Day deleted");
}

async function syncNow() {
  if (!state.settings.backendUrl) {
    setSyncNote("Saved locally");
    return;
  }
  setSyncNote("Syncing...");
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
      setSyncNote("Synced");
    } else {
      setSyncNote("Sync issue");
    }
  } catch (error) {
    console.warn(error);
    setSyncNote("Offline");
  }
}

function syncMachine(machine) {
  if (!state.settings.backendUrl) return;
  backendRequest("saveMachine", { machine }).then(() => setSyncNote("Synced")).catch((error) => {
    console.warn(error);
    setSyncNote("Saved locally");
  });
}

function syncLog(log) {
  if (log._demo) return;
  if (!state.settings.backendUrl) return;
  backendRequest("logSet", { log }).then(() => setSyncNote("Synced")).catch((error) => {
    console.warn(error);
    setSyncNote("Saved locally");
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
  const byId = new Map(DEFAULT_MACHINES.map((machine) => [machine.id, { ...machine }]));
  state.machines.forEach((machine) => byId.set(machine.id, { ...(byId.get(machine.id) || {}), ...machine }));
  incoming.forEach((machine) => {
    if (!machine.id) return;
    const fallback = byId.get(machine.id) || {};
    byId.set(machine.id, {
      ...fallback,
      ...machine,
      group: fallback.group || machine.group || "Upper body",
      seedWeight: fallback.seedWeight || machine.targetWeight || machine.seedWeight || ""
    });
  });
  return DEFAULT_MACHINES.map((machine) => ({ ...machine, ...(byId.get(machine.id) || {}) }));
}

function mergeLogs(incoming) {
  const byId = new Map(state.logs.map((log) => [log.id, log]));
  incoming.forEach((log) => {
    if (log.id) byId.set(log.id, { ...log, date: normalizeDate(log.date) });
  });
  return Array.from(byId.values());
}

function createDemoLogs() {
  const today = new Date();
  return DEFAULT_MACHINES.flatMap((machine, machineIndex) => {
    return Array.from({ length: DEMO_DAYS }, (_, dayIndex) => {
      const daysAgo = DEMO_DAYS - dayIndex;
      const date = addDays(today, -daysAgo);
      const weightBump = Math.max(0, dayIndex - 2) * 5 + (machineIndex % 2 ? 0 : 5);
      const skipped = (machineIndex + dayIndex) % 7 === 0;
      if (skipped) return null;
      const dateText = isoDate(date);
      const weight = machine.id === "plank" ? `${30 + (dayIndex % 3) * 5}s` : String(Number(machine.seedWeight || 0) + weightBump);
      return {
        id: `${DEMO_LOG_PREFIX}${machine.id}-${dateText}`,
        date: dateText,
        createdAt: `${dateText}T12:00:00.000Z`,
        profileName: "Sample",
        machineId: machine.id,
        machineName: machine.name,
        weight,
        reps: "",
        effort: "",
        rir: "",
        note: "",
        _demo: true
      };
    }).filter(Boolean);
  });
}

function populateSampleData() {
  state.logs = state.logs.filter((log) => !log._demo);
  state.logs.push(...createDemoLogs());
  saveState();
  render();
  setSyncNote("Sample data");
}

function clearSampleData() {
  state.logs = state.logs.filter((log) => !log._demo);
  saveState();
  render();
  setSyncNote(state.logs.length ? "Synced" : "No history");
}

function isDeleteMarker(log) {
  return Boolean(log?.deleted) || log?.note === DELETE_MARKER;
}

function dateIsDemoOnly(date) {
  const logs = state.logs.filter((log) => normalizeDate(log.date) === normalizeDate(date));
  return logs.length > 0 && logs.every((log) => log._demo);
}

function setSyncNote(message) {
  els.syncNote.textContent = message;
}

function setIdleSyncNote() {
  if (!state.settings.backendUrl) {
    setSyncNote("Saved locally");
    return;
  }
  setSyncNote(state.settings.autoSync ? "Ready" : "Sync off");
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
  state.settings.profileName = els.profileName.value.trim() || "Tal";
  state.settings.autoSync = els.autoSync.checked;
  state.settings.reduceMotion = els.reduceMotion.checked;
  saveState();
  closeSettings();
  render();
  if (state.settings.autoSync) syncNow();
  else setIdleSyncNote();
}

function resetSite() {
  localStorage.removeItem(STORAGE_KEY);
  localStorage.removeItem(OLD_STORAGE_KEY);
  window.location.reload();
}

function isoDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function addDays(date, days) {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

function normalizeDate(value) {
  if (!value) return "";
  if (value instanceof Date) return isoDate(value);
  const text = String(value);
  if (/^\d{4}-\d{2}-\d{2}/.test(text)) return text.slice(0, 10);
  const parsed = new Date(text);
  if (!Number.isNaN(parsed.getTime())) return isoDate(parsed);
  return text;
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
  els.populateSample.addEventListener("click", populateSampleData);
  els.clearSample.addEventListener("click", clearSampleData);
  els.settingsBackdrop.addEventListener("click", closeSettings);
  document.querySelector("[data-close-date]").addEventListener("click", closeDateModal);
  document.querySelector("[data-cancel-date]").addEventListener("click", closeDateModal);
  document.querySelector("[data-save-date]").addEventListener("click", saveDateModal);
  document.querySelector("[data-delete-date]").addEventListener("click", deleteDateModal);
  els.dateBackdrop.addEventListener("click", closeDateModal);
  els.editDate.addEventListener("change", renderDateModal);

  els.tableHead.addEventListener("click", (event) => {
    const openDateButton = event.target.closest("[data-open-date]");
    if (openDateButton) {
      event.stopPropagation();
      openDateModal(openDateButton.dataset.openDate);
      return;
    }

    const addDayButton = event.target.closest("[data-add-day]");
    if (addDayButton) {
      event.stopPropagation();
      addDay();
      return;
    }
  });

  els.machineTable.addEventListener("click", (event) => {
    const repeatButton = event.target.closest("[data-repeat-weight]");
    if (repeatButton) {
      event.stopPropagation();
      quickRepeat(repeatButton.dataset.repeatWeight);
      return;
    }

    const saveButton = event.target.closest("[data-save-detail]");
    if (saveButton) {
      event.stopPropagation();
      saveDetail(saveButton.dataset.saveDetail);
      return;
    }

    const deleteButton = event.target.closest("[data-delete-today]");
    if (deleteButton) {
      event.stopPropagation();
      deleteToday(deleteButton.dataset.deleteToday);
      return;
    }

    if (event.target.closest("[data-close-detail]")) {
      event.stopPropagation();
      state.expandedId = "";
      saveState();
      render();
      return;
    }

    const expandButton = event.target.closest("[data-expand]");
    if (expandButton) {
      event.stopPropagation();
      toggleMachine(expandButton.dataset.expand);
      return;
    }

    const row = event.target.closest("[data-machine-row]");
    if (row) toggleMachine(row.dataset.machineRow);
  });
}

function init() {
  loadState();
  bindEvents();
  render();
  if (state.settings.autoSync) syncNow();
  else setIdleSyncNote();
}

init();
