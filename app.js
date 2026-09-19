const STORAGE_KEY = "workout-sheet-prototype-v2";
const OLD_STORAGE_KEY = "workout-sheet-prototype-v1";
const HISTORY_COLUMNS = 5;
const DEMO_DAYS = 6;
const DEMO_LOG_PREFIX = "demo-week-";
const DELETE_MARKER = "__WORKOUT_DELETE__";
const GROUP_ORDER = ["Legs", "Upper body", "Core", "Other"];
const SYNC_INTERVAL_MS = 15000;
const SYNC_BURST_DURATION_MS = 2 * 60 * 1000;

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
  editingMachineId: "",
  settings: {
    backendUrl: window.WORKOUT_CONFIG?.defaultBackendUrl || "",
    profileName: "Tal",
    autoSync: window.WORKOUT_CONFIG?.autoSync ?? true,
    reduceMotion: false,
    hideTodayNotes: false
  }
};

let syncTimer = 0;
let syncInFlight = false;
let syncBurstEndsAt = 0;
let lastSyncStartedAt = 0;

const els = {
  tableHead: document.querySelector("[data-table-head]"),
  machineTableEl: document.querySelector(".machine-table"),
  machineTable: document.querySelector("[data-machine-table]"),
  suggestionLegend: document.querySelector("[data-suggestion-legend]"),
  syncNote: document.querySelector("[data-sync-note]"),
  sheetLink: document.querySelector("[data-sheet-link]"),
  profileName: document.querySelector("[data-profile-name]"),
  autoSync: document.querySelector("[data-auto-sync]"),
  reduceMotion: document.querySelector("[data-reduce-motion]"),
  hideTodayNotes: document.querySelector("[data-hide-today-notes]"),
  settingsBackdrop: document.querySelector("[data-settings-backdrop]"),
  settingsModal: document.querySelector("[data-settings-modal]"),
  populateSample: document.querySelector("[data-populate-sample]"),
  clearSample: document.querySelector("[data-clear-sample]"),
  dateBackdrop: document.querySelector("[data-date-backdrop]"),
  dateModal: document.querySelector("[data-date-modal]"),
  dateTitle: document.querySelector("[data-date-title]"),
  editDate: document.querySelector("[data-edit-date]"),
  dayMachineList: document.querySelector("[data-day-machine-list]"),
  workoutBackdrop: document.querySelector("[data-workout-backdrop]"),
  workoutModal: document.querySelector("[data-workout-modal]"),
  workoutName: document.querySelector("[data-workout-name]"),
  workoutGroup: document.querySelector("[data-workout-group]"),
  workoutValueLabel: document.querySelector("[data-workout-value-label]"),
  workoutDefault: document.querySelector("[data-workout-default]"),
  workoutSetup: document.querySelector("[data-workout-setup]")
};

function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || localStorage.getItem(OLD_STORAGE_KEY) || "{}");
    if (Array.isArray(saved.machines) && saved.machines.length) state.machines = mergeMachines(saved.machines);
    if (Array.isArray(saved.logs)) state.logs = saved.logs;
    Object.assign(state.settings, saved.settings || {});
  } catch {
    localStorage.removeItem(STORAGE_KEY);
  }
  if (window.WORKOUT_CONFIG?.defaultBackendUrl) {
    state.settings.backendUrl = window.WORKOUT_CONFIG.defaultBackendUrl;
  }
  state.settings.autoSync = state.settings.autoSync ?? window.WORKOUT_CONFIG?.autoSync ?? true;
  if (state.settings.backendUrl) {
    state.logs = state.logs.filter((log) => !log._demo);
  }
  if (!state.logs.length && !state.settings.backendUrl) state.logs = createDemoLogs();
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
  els.hideTodayNotes.checked = Boolean(state.settings.hideTodayNotes);
}

function renderMachineTable() {
  const dates = displayDates();
  const today = isoDate(new Date());
  updateTableWidth(dates.length);
  const machines = orderedMachines();
  const suggestionInfo = suggestedWorkoutInfo(machines);
  renderSuggestionLegend(suggestionInfo);
  els.tableHead.innerHTML = `
    <tr>
      <th scope="col" class="machine-col">Machine</th>
      ${dates.map((date) => `
        <th scope="col" class="date-col">
          <div class="date-head">
            <button type="button" data-open-date="${escapeHtml(date)}">
              <span>${escapeHtml(formatDayLabel(date, date === today))}</span>
              <small>${escapeHtml(formatDateLabel(date))}</small>
            </button>
          </div>
        </th>
      `).join("")}
      <th scope="col" class="add-day-col">
        <button type="button" class="add-day-button" data-add-day aria-label="Add another workout day">
          <span aria-hidden="true">+</span>
          <small>Add Day</small>
        </button>
      </th>
    </tr>
  `;

  let lastGroup = "";
  const rows = [];
  machines.forEach((machine) => {
    if (machine.group !== lastGroup) {
      lastGroup = machine.group;
      rows.push(`<tr class="group-row"><th scope="row">${escapeHtml(lastGroup)}</th><td colspan="${dates.length + 1}"></td></tr>`);
    }
    rows.push(machineRow(machine, dates, suggestionInfo.suggestedIds));
    if (state.expandedId === machine.id) rows.push(detailRow(machine, dates.length + 2));
  });
  rows.push(addWorkoutRow(dates.length + 2));
  els.machineTable.innerHTML = rows.join("");
}

function updateTableWidth(dateCount = displayDates().length) {
  const compact = window.matchMedia("(max-width: 760px)").matches;
  const machineWidth = compact ? 132 : 250;
  const dateWidth = compact ? 92 : 108;
  const addDayWidth = compact ? 78 : 92;
  els.machineTableEl.style.setProperty("--table-target-width", `${machineWidth + (dateCount * dateWidth) + addDayWidth}px`);
}

function orderedMachines() {
  const order = new Map(DEFAULT_MACHINES.map((machine, index) => [machine.id, index]));
  return state.machines.slice().sort((a, b) => {
    const groupCompare = groupRank(a.group) - groupRank(b.group);
    if (groupCompare) return groupCompare;
    const orderCompare = (order.get(a.id) ?? 999) - (order.get(b.id) ?? 999);
    if (orderCompare) return orderCompare;
    return String(a.name || "").localeCompare(String(b.name || ""));
  });
}

function groupRank(group) {
  const index = GROUP_ORDER.indexOf(group || "Other");
  return index === -1 ? GROUP_ORDER.length : index;
}

function machineRow(machine, dates, suggestedIds = new Set()) {
  const today = isoDate(new Date());
  const isSuggested = suggestedIds.has(machine.id);
  return `
    <tr class="machine-row ${state.expandedId === machine.id ? "is-open" : ""} ${isSuggested ? "is-suggested" : ""}" data-machine-row="${escapeHtml(machine.id)}" ${isSuggested ? `title="${escapeHtml(machine.name)} has not been done in the last 3 workout days"` : ""}>
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
            return `<td class="today-cell"><div class="today-logged"><button type="button" class="done-pill" data-expand="${escapeHtml(machine.id)}" aria-label="Edit today's ${escapeHtml(machine.name)} ${escapeHtml(valueLabel(machine).toLowerCase())}"><span aria-hidden="true">✓</span>${escapeHtml(log.weight)}</button><button type="button" class="clear-today-button" data-delete-today="${escapeHtml(machine.id)}" aria-label="Clear today's ${escapeHtml(machine.name)}">×</button>${todayNoteHtml(log)}</div></td>`;
          }
          return `<td class="today-cell is-missing"><button type="button" class="same-button" data-repeat-weight="${escapeHtml(machine.id)}" aria-label="Log ${escapeHtml(machine.name)} at previous ${escapeHtml(valueLabel(machine).toLowerCase())}">✓</button><span class="ghost-weight">${previous ? escapeHtml(previous) : ""}</span></td>`;
        }
        return `<td class="${log?.weight ? "" : "is-missing"}">${log?.weight ? `<button type="button" class="weight-chip history-entry-button" data-open-entry-date="${escapeHtml(date)}" data-open-entry-machine="${escapeHtml(machine.id)}" aria-label="Edit ${escapeHtml(machine.name)} for ${escapeHtml(formatLongDate(date))}">${escapeHtml(log.weight)}</button>` : `<span class="empty-cell">-</span>`}</td>`;
      }).join("")}
      <td class="add-day-spacer" aria-hidden="true"></td>
    </tr>
  `;
}

function todayNoteHtml(log) {
  const note = String(log?.note || "").trim();
  if (state.settings.hideTodayNotes || !note || note === DELETE_MARKER) return "";
  return `<small class="today-note" title="${escapeHtml(note)}">${escapeHtml(note)}</small>`;
}

function addWorkoutRow(colspan) {
  return `
    <tr class="add-workout-row">
      <td colspan="${colspan}">
        <button type="button" class="add-workout-button" data-open-workout>
          <span aria-hidden="true">+</span>
          <strong>Add workout</strong>
        </button>
      </td>
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
    .slice(0, HISTORY_COLUMNS - 1);
  return [today, ...unique];
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

function dateHasVisibleLogForMachines(date, machines) {
  return machines.some((machine) => latestLogFor(machine.id, date));
}

function recentWorkoutDates(limit, machines) {
  return Array.from(new Set(state.logs
    .filter((log) => String(log.weight || "").trim())
    .map((log) => normalizeDate(log.date))
    .filter((date) => date && dateHasVisibleLogForMachines(date, machines))))
    .sort((a, b) => b.localeCompare(a))
    .slice(0, limit);
}

function suggestedWorkoutInfo(machines) {
  const recentDates = recentWorkoutDates(3, machines);
  const suggestedIds = new Set();
  if (recentDates.length >= 3) {
    machines.forEach((machine) => {
      const wasRecentlyDone = recentDates.some((date) => latestLogFor(machine.id, date));
      if (!wasRecentlyDone) suggestedIds.add(machine.id);
    });
  }
  return { recentDates, suggestedIds };
}

function renderSuggestionLegend(info) {
  if (!els.suggestionLegend) return;
  const hasSuggestions = info.recentDates.length >= 3 && info.suggestedIds.size > 0;
  els.suggestionLegend.hidden = !hasSuggestions;
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

function formatDayLabel(date, isTodayColumn = false) {
  if (isTodayColumn) return "Today";
  const normalized = normalizeDate(date);
  if (!normalized) return "";
  const [year, month, day] = normalized.split("-").map(Number);
  const localDate = new Date(year, month - 1, day);
  return new Intl.DateTimeFormat(undefined, { weekday: "long" }).format(localDate);
}

function formatDateLabel(date) {
  const normalized = normalizeDate(date);
  if (!normalized) return "";
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

function openWorkoutModal() {
  els.workoutName.value = "";
  els.workoutGroup.value = "Legs";
  els.workoutValueLabel.value = "Weight";
  els.workoutDefault.value = "";
  els.workoutSetup.value = "";
  els.workoutBackdrop.hidden = false;
  els.workoutModal.hidden = false;
  document.body.classList.add("is-modal-open");
  window.setTimeout(() => els.workoutName.focus(), 0);
}

function closeWorkoutModal() {
  els.workoutBackdrop.hidden = true;
  els.workoutModal.hidden = true;
  document.body.classList.remove("is-modal-open");
}

function saveWorkoutModal() {
  const name = els.workoutName.value.trim();
  if (!name) {
    els.workoutName.focus();
    return;
  }
  const defaultValueText = els.workoutDefault.value.trim();
  const machine = {
    id: uniqueMachineId(name),
    name,
    group: els.workoutGroup.value || "Other",
    valueLabel: els.workoutValueLabel.value === "Time" ? "Time" : "Weight",
    seedWeight: defaultValueText,
    targetWeight: defaultValueText,
    setupNotes: els.workoutSetup.value.trim(),
    custom: true
  };

  state.machines.push(machine);
  state.expandedId = machine.id;
  saveState();
  closeWorkoutModal();
  render();
  syncMachine(machine);
}

function uniqueMachineId(name) {
  const slug = String(name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 32) || "workout";
  const used = new Set(state.machines.map((machine) => machine.id));
  if (!used.has(`custom-${slug}`)) return `custom-${slug}`;
  let suffix = 2;
  while (used.has(`custom-${slug}-${suffix}`)) suffix += 1;
  return `custom-${slug}-${suffix}`;
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

function openDateModal(date, focusMachineId = "") {
  state.editingDate = normalizeDate(date) || isoDate(new Date());
  state.editingMachineId = focusMachineId;
  els.editDate.value = state.editingDate;
  renderDateModal();
  els.dateBackdrop.hidden = false;
  els.dateModal.hidden = false;
  document.body.classList.add("is-modal-open");
  if (focusMachineId) {
    window.setTimeout(() => {
      const section = els.dayMachineList.querySelector(`[data-day-machine="${CSS.escape(focusMachineId)}"]`);
      const input = section?.querySelector("[data-day-weight]");
      section?.scrollIntoView({ block: "center" });
      input?.focus();
      input?.select();
    }, 0);
  }
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
      <section class="day-machine ${state.editingMachineId === machine.id ? "is-focused" : ""}" data-day-machine="${escapeHtml(machine.id)}">
        <div class="day-machine-head">
          <h3>${escapeHtml(machine.name)}</h3>
          ${log ? `<button type="button" class="entry-delete-button" data-delete-day-entry="${escapeHtml(machine.id)}">Delete</button>` : ""}
        </div>
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
  state.editingMachineId = "";
  els.dateBackdrop.hidden = true;
  els.dateModal.hidden = true;
  document.body.classList.remove("is-modal-open");
}

function deleteDayEntry(machineId) {
  const date = normalizeDate(els.editDate.value || state.editingDate);
  const machine = state.machines.find((item) => item.id === machineId);
  const existing = latestLogFor(machineId, date);
  if (!date || !machine || !existing) return;
  const localOnly = dateIsDemoOnly(date);
  appendLogForDate(machine, date, { weight: "", note: DELETE_MARKER, deleted: true, _demo: localOnly }, { renderAfter: false });
  state.editingMachineId = machineId;
  saveState();
  render();
  renderDateModal();
  setSyncNote("Entry deleted");
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

async function syncNow(options = {}) {
  if (!state.settings.backendUrl) {
    if (!options.quiet) setSyncNote("Saved locally");
    return;
  }
  if (syncInFlight) return;
  syncInFlight = true;
  lastSyncStartedAt = Date.now();
  if (!options.quiet) setSyncNote("Syncing...");
  try {
    const response = await backendRequest("snapshot");
    if (response && response.ok) {
      applySnapshot(response, { renderAfter: true });
      if (!options.quiet) setSyncNote("Synced");
    } else if (!options.quiet) {
      setSyncNote("Sync issue");
    }
  } catch (error) {
    console.warn(error);
    if (!options.quiet) setSyncNote("Offline");
  } finally {
    syncInFlight = false;
  }
}

function syncMachine(machine) {
  if (!state.settings.backendUrl) return;
  backendRequest("saveMachine", { machine }).then((response) => {
    if (response?.ok) applySnapshot(response, { renderAfter: true });
    setSyncNote(response?.ok ? "Synced" : "Sync issue");
    if (response?.ok) startAutoSync();
  }).catch((error) => {
    console.warn(error);
    setSyncNote("Saved locally");
  });
}

function syncLog(log) {
  if (log._demo) return;
  if (!state.settings.backendUrl) return;
  backendRequest("logSet", { log }).then((response) => {
    if (response?.ok) applySnapshot(response, { renderAfter: true });
    setSyncNote(response?.ok ? "Synced" : "Sync issue");
    if (response?.ok) startAutoSync();
  }).catch((error) => {
    console.warn(error);
    setSyncNote("Saved locally");
  });
}

function applySnapshot(response, options = {}) {
  if (Array.isArray(response.machines) && response.machines.length) {
    state.machines = mergeMachines(response.machines);
  }
  if (Array.isArray(response.logs)) {
    state.logs = mergeLogs(response.logs);
  }
  saveState();
  if (options.renderAfter !== false) render();
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
    const defaultMachine = DEFAULT_MACHINES.some((item) => item.id === machine.id);
    byId.set(machine.id, {
      ...fallback,
      ...machine,
      group: fallback.group || machine.group || (defaultMachine ? "Upper body" : "Other"),
      seedWeight: fallback.seedWeight || machine.targetWeight || machine.seedWeight || ""
    });
  });
  const defaultIds = new Set(DEFAULT_MACHINES.map((machine) => machine.id));
  const defaults = DEFAULT_MACHINES.map((machine) => ({ ...machine, ...(byId.get(machine.id) || {}) }));
  const custom = Array.from(byId.values())
    .filter((machine) => machine.id && !defaultIds.has(machine.id))
    .map((machine) => ({
      ...machine,
      group: machine.group || "Other",
      valueLabel: machine.valueLabel || "Weight",
      seedWeight: machine.seedWeight || machine.targetWeight || ""
    }));
  return [...defaults, ...custom];
}

function mergeLogs(incoming) {
  const byId = new Map(state.logs.filter((log) => !log._demo).map((log) => [log.id, log]));
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

function triggerAutoSync(options = {}) {
  if (!state.settings.autoSync) {
    setIdleSyncNote();
    return;
  }
  syncNow(options);
  startAutoSync();
}

function startAutoSync() {
  window.clearInterval(syncTimer);
  if (!state.settings.autoSync || !state.settings.backendUrl) return;
  syncBurstEndsAt = Date.now() + SYNC_BURST_DURATION_MS;
  syncTimer = window.setInterval(() => {
    if (Date.now() >= syncBurstEndsAt) {
      stopAutoSync();
      setIdleSyncNote();
      return;
    }
    syncNow({ quiet: true });
  }, SYNC_INTERVAL_MS);
}

function stopAutoSync() {
  window.clearInterval(syncTimer);
  syncTimer = 0;
  syncBurstEndsAt = 0;
}

function syncAfterReturn() {
  if (!state.settings.autoSync) return;
  const justSynced = Date.now() - lastSyncStartedAt < 5000;
  if (justSynced) {
    startAutoSync();
    return;
  }
  triggerAutoSync({ quiet: true });
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
  state.settings.hideTodayNotes = els.hideTodayNotes.checked;
  saveState();
  closeSettings();
  render();
  if (state.settings.autoSync) {
    triggerAutoSync();
  } else {
    stopAutoSync();
    setIdleSyncNote();
  }
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
  document.querySelector("[data-close-workout]").addEventListener("click", closeWorkoutModal);
  document.querySelector("[data-cancel-workout]").addEventListener("click", closeWorkoutModal);
  document.querySelector("[data-save-workout]").addEventListener("click", saveWorkoutModal);
  els.dateBackdrop.addEventListener("click", closeDateModal);
  els.workoutBackdrop.addEventListener("click", closeWorkoutModal);
  els.editDate.addEventListener("change", renderDateModal);
  els.dayMachineList.addEventListener("click", (event) => {
    const deleteButton = event.target.closest("[data-delete-day-entry]");
    if (deleteButton) {
      event.stopPropagation();
      deleteDayEntry(deleteButton.dataset.deleteDayEntry);
    }
  });
  window.addEventListener("resize", () => updateTableWidth());
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) syncAfterReturn();
  });
  window.addEventListener("focus", syncAfterReturn);
  window.addEventListener("pageshow", (event) => {
    if (event.persisted) syncAfterReturn();
  });

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
    if (event.target.closest("[data-open-workout]")) {
      event.stopPropagation();
      openWorkoutModal();
      return;
    }

    const historyEntry = event.target.closest("[data-open-entry-date]");
    if (historyEntry) {
      event.stopPropagation();
      openDateModal(historyEntry.dataset.openEntryDate, historyEntry.dataset.openEntryMachine);
      return;
    }

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
  if (state.settings.autoSync) {
    triggerAutoSync();
  } else {
    setIdleSyncNote();
  }
}

init();
