const STORAGE_KEY = "workout-sheet-prototype-v2";
const OLD_STORAGE_KEY = "workout-sheet-prototype-v1";
const HISTORY_COLUMNS = 5;
let historyColumns = HISTORY_COLUMNS;
const DELETE_MARKER = "__WORKOUT_DELETE__";
const GROUP_ORDER = ["Legs", "Upper body", "Core", "Physical therapy", "Other"];
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
  expandedDate: "",
  extraDates: [],
  settings: {
    backendUrl: window.WORKOUT_CONFIG?.defaultBackendUrl || "",
    profileName: "Tal",
    autoSync: window.WORKOUT_CONFIG?.autoSync ?? true,
    reduceMotion: false,
    hideTodayNotes: false,
    showSetupNotes: true,
    theme: "garden"
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
  showNotes: document.querySelector("[data-show-notes]"),
  showSetup: document.querySelector("[data-show-setup]"),
  settingsBackdrop: document.querySelector("[data-settings-backdrop]"),
  settingsModal: document.querySelector("[data-settings-modal]"),
  workoutBackdrop: document.querySelector("[data-workout-backdrop]"),
  workoutModal: document.querySelector("[data-workout-modal]"),
  workoutName: document.querySelector("[data-workout-name]"),
  workoutGroup: document.querySelector("[data-workout-group]"),
  workoutDefault: document.querySelector("[data-workout-default]"),
  workoutSetup: document.querySelector("[data-workout-setup]")
};

function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || localStorage.getItem(OLD_STORAGE_KEY) || "{}");
    if (Array.isArray(saved.machines) && saved.machines.length) state.machines = mergeMachines(saved.machines);
    if (Array.isArray(saved.logs)) state.logs = saved.logs;
    if (Array.isArray(saved.extraDates)) state.extraDates = saved.extraDates.filter(date => /^\d{4}-\d{2}-\d{2}$/.test(date));
    Object.assign(state.settings, saved.settings || {});
  } catch {
    localStorage.removeItem(STORAGE_KEY);
  }
  if (window.WORKOUT_CONFIG?.defaultBackendUrl) {
    state.settings.backendUrl = window.WORKOUT_CONFIG.defaultBackendUrl;
  }
  state.settings.autoSync = state.settings.autoSync ?? window.WORKOUT_CONFIG?.autoSync ?? true;
  state.logs = state.logs.filter((log) => !isLegacySampleLog(log));
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function render() {
  applyAppearance();
  if (window.WORKOUT_CONFIG?.sheetUrl) els.sheetLink.href = window.WORKOUT_CONFIG.sheetUrl;
  if (els.settingsModal.hidden) renderSettings();
  renderMachineTable();
  document.body.classList.toggle("detail-open", Boolean(state.expandedId));
}

function applyAppearance() {
  const themes = ["garden", "tide", "moon", "sunrise"];
  if (!themes.includes(state.settings.theme)) state.settings.theme = "garden";
  document.body.dataset.theme = state.settings.theme;
  document.body.classList.toggle("reduce-motion", state.settings.reduceMotion);
}

function renderSettings() {
  els.profileName.value = state.settings.profileName || "";
  els.autoSync.checked = Boolean(state.settings.autoSync);
  els.reduceMotion.checked = Boolean(state.settings.reduceMotion);
  els.showNotes.checked = !state.settings.hideTodayNotes;
  els.showSetup.checked = state.settings.showSetupNotes;
  document.querySelectorAll("button[data-theme]").forEach(button => button.setAttribute("aria-pressed", String(button.dataset.theme === state.settings.theme)));
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
        <th scope="col" class="date-col" data-column-date="${escapeHtml(date)}">
          <div class="date-head">
            <div class="date-label">
              <span>${escapeHtml(formatDayLabel(date, date === today))}</span>
              <small>${escapeHtml(formatDateLabel(date))}</small>
            </div>
          </div>
        </th>
      `).join("")}
      <th scope="col" class="history-more-col">
        ${historyDates().length > historyColumns - 1 ? '<button type="button" class="older-button" data-older-entries>Show older entries →</button>' : '<span class="history-end">All entries shown</span>'}
        ${historyColumns > HISTORY_COLUMNS ? '<button type="button" class="older-button" data-recent-entries>Recent only</button>' : ''}
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
  els.machineTable.innerHTML = rows.join("");
  renderTableActions();
}

function updateTableWidth(dateCount = displayDates().length) {
  const compact = window.matchMedia("(max-width: 760px)").matches;
  const machineWidth = compact ? 132 : 250;
  const dateWidth = compact ? 92 : 108;
  const addDayWidth = 132;
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

function checkmarkIcon() {
  return '<svg class="checkmark-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="m5 12 4.5 4.5L19 7" /></svg>';
}

function machineRow(machine, dates, suggestedIds = new Set()) {
  const today = isoDate(new Date());
  const isSuggested = suggestedIds.has(machine.id);
  const setupPreview = String(machine.setupNotes || "").trim();
  return `
    <tr class="machine-row ${state.expandedId === machine.id ? "is-open" : ""} ${isSuggested ? "is-suggested" : ""}" data-machine-row="${escapeHtml(machine.id)}" ${isSuggested ? `title="${escapeHtml(machine.name)} has not been done in the last 3 workout days"` : ""}>
      <th scope="row">
        <button type="button" class="machine-name" data-expand="${escapeHtml(machine.id)}" aria-expanded="${state.expandedId === machine.id}">
          <span>${escapeHtml(machine.name)}</span>
          ${setupPreview && state.settings.showSetupNotes ? `<small class="setup-preview" title="${escapeHtml(setupPreview)}">${escapeHtml(setupPreview)}</small>` : ""}
        </button>
      </th>
      ${dates.map((date) => {
        const log = latestLogFor(machine.id, date);
        if (date === today) {
          const previous = previousWeight(machine.id, today) || defaultValue(machine);
          if (log?.weight) {
            return `<td class="today-cell"><div class="today-logged"><div class="done-pill"><button type="button" class="uncheck-button" data-remove-today="${escapeHtml(machine.id)}" aria-label="Uncheck today's ${escapeHtml(machine.name)}" title="Uncheck today">${checkmarkIcon()}</button><button type="button" class="done-weight" data-edit-today="${escapeHtml(machine.id)}" aria-label="Edit today's ${escapeHtml(machine.name)} ${escapeHtml(valueLabel(machine).toLowerCase())}">${escapeHtml(log.weight)}</button></div>${todayNoteHtml(log)}</div></td>`;
          }
          return `<td class="today-cell is-missing"><button type="button" class="same-button" data-repeat-weight="${escapeHtml(machine.id)}" aria-label="Log ${escapeHtml(machine.name)} at previous ${escapeHtml(valueLabel(machine).toLowerCase())}"><span class="empty-ring" aria-hidden="true"></span></button><span class="ghost-weight">${previous ? escapeHtml(previous) : ""}</span></td>`;
        }
        return `<td class="${log?.weight ? "" : "is-missing"}"><button type="button" class="history-entry-button ${log?.weight ? 'weight-chip' : 'empty-cell'}" data-open-entry-date="${escapeHtml(date)}" data-open-entry-machine="${escapeHtml(machine.id)}" aria-label="${log?.weight ? 'Edit' : 'Add'} ${escapeHtml(machine.name)} for ${escapeHtml(formatLongDate(date))}">${log?.weight ? escapeHtml(log.weight) : '–'}</button>${log ? todayNoteHtml(log) : ''}</td>`;
      }).join("")}
      <td class="history-spacer" aria-hidden="true"></td>
    </tr>
  `;
}

function todayNoteHtml(log) {
  const note = String(log?.note || "").trim();
  if (state.settings.hideTodayNotes || !note || note === DELETE_MARKER) return "";
  return `<small class="today-note" title="${escapeHtml(note)}">${escapeHtml(note)}</small>`;
}

function renderTableActions() {
  document.querySelector("[data-table-actions]").innerHTML = `
    <div class="table-add-buttons">
      <button type="button" class="add-workout-button" data-open-workout><span aria-hidden="true">+</span> Add workout</button>
      <button type="button" class="add-workout-button" data-add-day aria-expanded="false"><span aria-hidden="true">+</span> Add day</button>
    </div>
    <form class="add-day-form" data-add-day-form hidden>
      <label><span>Workout date</span><input type="date" data-new-date required value="${isoDate(addDays(new Date(), -1))}"></label>
      <button type="submit" class="primary">Add column</button>
    </form>`;
}

function detailRow(machine, colspan) {
  const date = state.expandedDate || isoDate(new Date());
  const isToday = date === isoDate(new Date());
  const todayLog = latestLogFor(machine.id, date);
  const previous = isToday ? previousWeight(machine.id, date) || defaultValue(machine) : "";
  const dateLabel = isToday ? "Today's" : formatDateLabel(date);
  return `
    <tr class="detail-row">
      <td colspan="${colspan}">
        <div class="detail-panel" data-detail-panel="${escapeHtml(machine.id)}">
          <div class="detail-grid">
            <label>
              <span>${escapeHtml(dateLabel)} ${escapeHtml(valueLabel(machine).toLowerCase())}</span>
              <input data-today-weight ${inputAttributes(machine)} value="${escapeHtml(todayLog?.weight || previous || "")}">
            </label>
            <label>
              <span>Setup notes</span>
              <textarea data-setup-notes rows="2">${escapeHtml(machine.setupNotes || "")}</textarea>
            </label>
          </div>
          <details class="detail-more">
            <summary>More options</summary>
            <label>
              <span>${isToday ? "Today’s note" : "Workout note"}</span>
              <input data-today-note type="text" value="${escapeHtml(todayLog?.note || "")}" placeholder="Felt smooth, seat tweak, etc.">
            </label>
          </details>
          <div class="detail-actions">
            <button type="button" class="primary" data-save-detail="${escapeHtml(machine.id)}">Save</button>
            ${todayLog ? `<button type="button" class="danger detail-secondary" data-remove-entry="${escapeHtml(machine.id)}" aria-label="Remove entry" title="Remove entry"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 10v7M14 10v7" /></svg></button>` : ""}
            <button type="button" class="detail-secondary" data-close-detail aria-label="Close editor" title="Close editor"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg></button>
          </div>
        </div>
      </td>
    </tr>
  `;
}

function historyDates() {
  const today = isoDate(new Date());
  return Array.from(new Set([...state.extraDates, ...state.logs
    .filter((log) => String(log.weight || "").trim())
    .map((log) => normalizeDate(log.date))
    .filter((date) => date && dateHasVisibleLog(date))]))
    .filter((date) => date !== today)
    .sort((a, b) => b.localeCompare(a));
}

function displayDates() {
  return [isoDate(new Date()), ...historyDates().slice(0, historyColumns - 1)];
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

let detailScrollTimer = 0;

function alignMachineDetail() {
  window.clearTimeout(detailScrollTimer);
  // Coalesce focus and keyboard resize events into a single gentle adjustment.
  detailScrollTimer = window.setTimeout(() => {
    if (!state.expandedId || !window.matchMedia("(max-width: 760px)").matches) return;
    const row = document.querySelector(`[data-machine-row="${CSS.escape(state.expandedId)}"]`);
    const panel = document.querySelector(`[data-detail-panel="${CSS.escape(state.expandedId)}"]`);
    if (!row || !panel) return;
    const viewport = window.visualViewport;
    const top = (viewport?.offsetTop || 0) + 12;
    const rowBounds = row.getBoundingClientRect();
    const panelBounds = panel.getBoundingClientRect();
    const editorHeight = panelBounds.bottom - rowBounds.top;
    // Prefer the upper half; use more space if needed to fit the whole editor.
    const availableHeight = Math.min(
      (viewport?.height || window.innerHeight) - 24,
      Math.max(window.innerHeight / 2 - 24, editorHeight)
    );
    const bottom = top + availableHeight;
    let adjustment = 0;
    if (panelBounds.bottom > bottom) adjustment = panelBounds.bottom - bottom;
    // Keep the workout heading visible when the expanded options are taller.
    adjustment = Math.min(adjustment, Math.max(0, rowBounds.top - top));
    if (rowBounds.top < top) adjustment = rowBounds.top - top;
    if (Math.abs(adjustment) < 2) return;
    const reduceMotion = state.settings.reduceMotion || window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    window.scrollBy({ top: adjustment, behavior: reduceMotion ? "instant" : "smooth" });
  }, 100);
}

function selectTodayWeight(machineId) {
  const input = document.querySelector(`[data-detail-panel="${CSS.escape(machineId)}"] [data-today-weight]`);
  // Keep focus in the tap handler so iOS can open the keyboard.
  input?.focus({ preventScroll: true });
  input?.select();
  alignMachineDetail();
}

function openMachineDetail(machineId, options = {}) {
  const shouldCollapse = state.expandedId === machineId && !options.focusWeight;
  if (shouldCollapse) {
    saveDetail(machineId);
    return;
  }
  const previousExpandedId = state.expandedId;
  if (previousExpandedId && previousExpandedId !== machineId) {
    saveDetail(previousExpandedId, { renderAfter: false });
  }
  state.expandedId = machineId;
  state.expandedDate = options.date || isoDate(new Date());
  saveState();
  render();
  alignMachineDetail();
  if (!shouldCollapse && options.focusWeight) selectTodayWeight(machineId);
}

function toggleMachine(machineId) {
  openMachineDetail(machineId);
}

function quickRepeat(machineId) {
  const machine = state.machines.find((item) => item.id === machineId);
  if (!machine) return;
  const weight = previousWeight(machineId, isoDate(new Date())) || defaultValue(machine);
  if (!weight) {
    openMachineDetail(machineId, { focusWeight: true });
    return;
  }
  appendTodayLog(machine, { weight, note: "" });
}

function saveDetail(machineId, options = {}) {
  const machine = state.machines.find((item) => item.id === machineId);
  const panel = document.querySelector(`[data-detail-panel="${CSS.escape(machineId)}"]`);
  if (!machine || !panel) return;

  const setupNotes = panel.querySelector("[data-setup-notes]").value.trim();
  const weight = panel.querySelector("[data-today-weight]").value.trim();
  const note = panel.querySelector("[data-today-note]").value.trim();
  const date = state.expandedDate || isoDate(new Date());
  const todayLog = latestLogFor(machineId, date);
  const updatedMachine = { ...machine, setupNotes };
  const setupChanged = setupNotes !== String(machine.setupNotes || "");
  const logChanged = Boolean(weight || note)
    && (String(todayLog?.weight || "") !== weight || String(todayLog?.note || "") !== note);

  state.machines = state.machines.map((item) => item.id === machineId ? updatedMachine : item);
  if (logChanged) appendLogForDate(updatedMachine, date, { weight, note }, { renderAfter: false });
  state.expandedId = "";
  saveState();
  if (options.renderAfter !== false) render();
  if (setupChanged) syncMachine(updatedMachine);
}

function removeToday(machineId) {
  const machine = state.machines.find((item) => item.id === machineId);
  const todayLog = latestLogFor(machineId, isoDate(new Date()));
  if (!machine || !todayLog) return;
  appendTodayLog(machine, { weight: "", note: DELETE_MARKER, deleted: true }, { renderAfter: false });
  state.expandedId = "";
  saveState();
  render();
  setSyncNote("Removed");
}

function openWorkoutModal() {
  closeExpandedDetail();
  els.workoutName.value = "";
  els.workoutGroup.value = "Legs";
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
    valueLabel: "Weight",
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
    deleted: Boolean(values.deleted)
  };
  state.logs.push(log);
  saveState();
  if (options.renderAfter !== false) render();
  syncLog(log);
}

function addDay() {
  const form = document.querySelector("[data-add-day-form]");
  form.hidden = !form.hidden;
  document.querySelector("[data-add-day]").setAttribute("aria-expanded", String(!form.hidden));
}

function addDateColumn(date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
  if (!state.extraDates.includes(date) && date !== isoDate(new Date())) state.extraDates.push(date);
  historyColumns = Math.max(historyColumns, historyDates().indexOf(date) + 2);
  saveState();
  render();
  const index = displayDates().indexOf(date);
  const scroller = document.querySelector(".table-scroll");
  const dateWidth = window.matchMedia("(max-width: 760px)").matches ? 92 : 108;
  scroller.scrollTo({ left: Math.max(0, index * dateWidth), behavior: state.settings.reduceMotion ? "instant" : "smooth" });
}

function removeEntry(machineId) {
  const date = state.expandedDate || isoDate(new Date());
  const machine = state.machines.find(item => item.id === machineId);
  if (!machine || !latestLogFor(machineId, date)) return;
  appendLogForDate(machine, date, { weight: "", note: DELETE_MARKER, deleted: true }, { renderAfter: false });
  state.expandedId = "";
  saveState();
  render();
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
  if (options.renderAfter !== false) renderAfterSnapshot();
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
  const byId = new Map(state.logs.filter((log) => !isLegacySampleLog(log)).map((log) => [log.id, log]));
  incoming.forEach((log) => {
    if (log.id) byId.set(log.id, { ...log, date: normalizeDate(log.date) });
  });
  return Array.from(byId.values());
}

function isDeleteMarker(log) {
  return Boolean(log?.deleted) || log?.note === DELETE_MARKER;
}

function isLegacySampleLog(log) {
  return Boolean(log?._demo) || String(log?.id || "").startsWith("demo-week-");
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

function closeExpandedDetail() {
  if (!state.expandedId) return;
  saveDetail(state.expandedId);
}

function isEditingExpandedDetail() {
  const active = document.activeElement;
  return Boolean(active?.closest?.("[data-detail-panel]"));
}

function renderAfterSnapshot() {
  if (isEditingExpandedDetail()) {
    return;
  }
  render();
}

function openSettings() {
  renderSettings();
  els.settingsBackdrop.hidden = false;
  els.settingsModal.hidden = false;
  document.body.classList.add("is-modal-open");
  document.querySelector("[data-close-settings]").focus({ preventScroll: true });
}

function closeSettings() {
  els.settingsBackdrop.hidden = true;
  els.settingsModal.hidden = true;
  document.body.classList.remove("is-modal-open");
  document.querySelector("[data-open-settings]").focus({ preventScroll: true });
}

function saveSettings() {
  state.settings.profileName = els.profileName.value.trim() || "Tal";
  state.settings.autoSync = els.autoSync.checked;
  state.settings.reduceMotion = els.reduceMotion.checked;
  state.settings.hideTodayNotes = !els.showNotes.checked;
  state.settings.showSetupNotes = els.showSetup.checked;
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
  els.settingsBackdrop.addEventListener("click", closeSettings);
  document.querySelector("[data-close-workout]").addEventListener("click", closeWorkoutModal);
  document.querySelector("[data-cancel-workout]").addEventListener("click", closeWorkoutModal);
  document.querySelector("[data-save-workout]").addEventListener("click", saveWorkoutModal);
  els.workoutBackdrop.addEventListener("click", closeWorkoutModal);
  els.settingsModal.addEventListener("click", event => {
    if (event.target === els.settingsModal) closeSettings();
    const button = event.target.closest("button[data-theme]");
    if (button) {
      state.settings.theme = button.dataset.theme;
      saveState();
      applyAppearance();
      document.querySelectorAll("button[data-theme]").forEach(item => item.setAttribute("aria-pressed", String(item === button)));
    }
  });
  document.addEventListener("keydown", event => {
    const modal = !els.settingsModal.hidden ? els.settingsModal : !els.workoutModal.hidden ? els.workoutModal : null;
    if (event.key === "Tab" && modal) {
      const controls = [...modal.querySelectorAll('button, input, select, textarea, a[href], summary')].filter(item => item.getClientRects().length && !item.disabled);
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }
    if (event.key === "Escape") {
      if (!els.settingsModal.hidden) closeSettings();
      if (!els.workoutModal.hidden) closeWorkoutModal();
      closeExpandedDetail();
    }
  });
  window.addEventListener("resize", () => updateTableWidth());
  window.visualViewport?.addEventListener("resize", () => {
    if (document.activeElement?.closest("[data-detail-panel]")) alignMachineDetail();
  });
  els.machineTable.addEventListener("focusin", (event) => {
    if (event.target.closest("[data-detail-panel]")) alignMachineDetail();
  });
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) syncAfterReturn();
  });
  window.addEventListener("focus", syncAfterReturn);
  window.addEventListener("pageshow", (event) => {
    if (event.persisted) syncAfterReturn();
  });
  // Capture outside taps before delegated controls stop propagation.
  document.addEventListener("click", (event) => {
    const addForm = document.querySelector("[data-add-day-form]");
    if (addForm && !event.target.closest("[data-add-day-form], [data-add-day]")) {
      addForm.hidden = true;
      document.querySelector("[data-add-day]")?.setAttribute("aria-expanded", "false");
    }
    if (!state.expandedId || event.target.closest("[data-detail-panel]")) return;
    event.closedDetailId = state.expandedId;
    closeExpandedDetail();
  }, true);

  document.querySelector("[data-table-actions]").addEventListener("click", (event) => {
    if (event.target.closest("[data-open-workout]")) openWorkoutModal();
    if (event.target.closest("[data-add-day]")) addDay();
  });
  document.querySelector("[data-table-actions]").addEventListener("submit", event => {
    if (!event.target.matches("[data-add-day-form]")) return;
    event.preventDefault();
    addDateColumn(event.target.querySelector("[data-new-date]").value);
  });

  els.tableHead.addEventListener("click", event => {
    if (event.target.closest("[data-older-entries]")) {
      historyColumns += HISTORY_COLUMNS;
      render();
    }
    if (event.target.closest("[data-recent-entries]")) {
      historyColumns = HISTORY_COLUMNS;
      document.querySelector(".table-scroll").scrollLeft = 0;
      render();
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
      openMachineDetail(historyEntry.dataset.openEntryMachine, { date: historyEntry.dataset.openEntryDate, focusWeight: true });
      return;
    }

    const repeatButton = event.target.closest("[data-repeat-weight]");
    if (repeatButton) {
      event.stopPropagation();
      quickRepeat(repeatButton.dataset.repeatWeight);
      return;
    }

    const editTodayButton = event.target.closest("[data-edit-today]");
    if (editTodayButton) {
      event.stopPropagation();
      openMachineDetail(editTodayButton.dataset.editToday, { focusWeight: true });
      return;
    }

    const saveButton = event.target.closest("[data-save-detail]");
    if (saveButton) {
      event.stopPropagation();
      saveDetail(saveButton.dataset.saveDetail);
      return;
    }

    const removeEntryButton = event.target.closest("[data-remove-entry]");
    if (removeEntryButton) {
      event.stopPropagation();
      removeEntry(removeEntryButton.dataset.removeEntry);
      return;
    }

    const removeButton = event.target.closest("[data-remove-today]");
    if (removeButton) {
      event.stopPropagation();
      removeToday(removeButton.dataset.removeToday);
      return;
    }

    if (event.target.closest("[data-close-detail]")) {
      event.stopPropagation();
      closeExpandedDetail();
      return;
    }

    const expandButton = event.target.closest("[data-expand]");
    if (expandButton) {
      event.stopPropagation();
      if (event.closedDetailId !== expandButton.dataset.expand) toggleMachine(expandButton.dataset.expand);
      return;
    }

    const row = event.target.closest("[data-machine-row]");
    if (row) {
      event.stopPropagation();
      if (event.closedDetailId !== row.dataset.machineRow) toggleMachine(row.dataset.machineRow);
    }
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
