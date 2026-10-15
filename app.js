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

const DEFAULT_SETTINGS = {
    backendUrl: window.WORKOUT_CONFIG?.defaultBackendUrl || "",
    profileName: "Tal",
    autoSync: window.WORKOUT_CONFIG?.autoSync ?? true,
    reduceMotion: false,
    hideTodayNotes: false,
    showSetupNotes: true,
    highlightMissedWorkouts: true,
    theme: "garden"
  };

const state = {
  machines: DEFAULT_MACHINES.map((machine) => ({ ...machine })),
  logs: [],
  expandedId: "",
  expandedDate: "",
  extraDates: [],
  archivedMachineIds: [],
  settings: { ...DEFAULT_SETTINGS },
  activeUserId: "tal",
  users: [{ id: "tal", name: "Tal", archived: false }]
};

let backendReady = false;
let profileBusy = false;
let flushingWrites = false;
let profiles = {};
let pendingWrites = [];
let requestedUserId = new URL(window.location.href).searchParams.get("user") || "";
let newUserDraft = null;
let installPrompt = null;
let pendingDayDeletion = null;
let pendingArchiveId = "";
let undoArchiveId = "";
let syncTimer = 0;
let syncInFlight = false;
let syncBurstEndsAt = 0;
let lastSyncStartedAt = 0;

const els = {
  tableHead: document.querySelector("[data-table-head]"),
  dayActions: document.querySelector("[data-day-actions]"),
  machineTableEl: document.querySelector(".machine-table"),
  machineTable: document.querySelector("[data-machine-table]"),
  suggestionLegend: document.querySelector("[data-suggestion-legend]"),
  syncNote: document.querySelector("[data-sync-note]"),
  sheetLink: document.querySelector("[data-sheet-link]"),
  autoSync: document.querySelector("[data-auto-sync]"),
  reduceMotion: document.querySelector("[data-reduce-motion]"),
  showNotes: document.querySelector("[data-show-notes]"),
  showSetup: document.querySelector("[data-show-setup]"),
  highlightMissed: document.querySelector("[data-highlight-missed]"),
  settingsBackdrop: document.querySelector("[data-settings-backdrop]"),
  settingsModal: document.querySelector("[data-settings-modal]"),
  workoutBackdrop: document.querySelector("[data-workout-backdrop]"),
  workoutModal: document.querySelector("[data-workout-modal]"),
  workoutName: document.querySelector("[data-workout-name]"),
  workoutGroup: document.querySelector("[data-workout-group]"),
  workoutDefault: document.querySelector("[data-workout-default]"),
  workoutSetup: document.querySelector("[data-workout-setup]")
};

function emptyProfile(userId) {
  return { machines: userId === "tal" ? DEFAULT_MACHINES.map(machine => ({ ...machine })) : [], logs: [], extraDates: [], archivedMachineIds: [], migrationPrepared: false };
}

function cacheProfile() {
  profiles[state.activeUserId] = { ...profiles[state.activeUserId], machines: state.machines, logs: state.logs,
    extraDates: state.extraDates, archivedMachineIds: state.archivedMachineIds };
}

function activateProfile(userId) {
  cacheProfile();
  const data = profiles[userId] || emptyProfile(userId);
  profiles[userId] = data;
  state.activeUserId = userId;
  state.machines = data.machines;
  state.logs = data.logs;
  state.extraDates = data.extraDates;
  state.archivedMachineIds = data.archivedMachineIds;
  state.expandedId = "";
  state.expandedDate = "";
  historyColumns = HISTORY_COLUMNS;
  undoArchiveId = "";
  document.querySelector("[data-archive-notice]").hidden = true;
  const url = new URL(window.location.href);
  url.searchParams.set("user", userId);
  window.history.replaceState(null, "", url);
  saveState();
  render();
}

function loadState() {
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || localStorage.getItem(OLD_STORAGE_KEY) || "{}"); }
  catch { /* Keep the old stored value intact if it cannot be parsed. */ }
  Object.assign(state.settings, saved.settings || {});
  if (window.WORKOUT_CONFIG?.defaultBackendUrl) state.settings.backendUrl = window.WORKOUT_CONFIG.defaultBackendUrl;
  if (saved.profiles && typeof saved.profiles === "object") profiles = saved.profiles;
  if (!profiles.tal) profiles.tal = {
    ...emptyProfile("tal"),
    machines: Array.isArray(saved.machines) && saved.machines.length ? saved.machines : emptyProfile("tal").machines,
    logs: Array.isArray(saved.logs) ? saved.logs : [],
    extraDates: Array.isArray(saved.extraDates) ? saved.extraDates : [],
    archivedMachineIds: Array.isArray(saved.archivedMachineIds) ? saved.archivedMachineIds : []
  };
  if (Array.isArray(saved.users) && saved.users.length) state.users = saved.users;
  pendingWrites = Array.isArray(saved.pendingWrites) ? saved.pendingWrites : [];
  newUserDraft = saved.newUserDraft || null;
  const userId = saved.activeUserId && profiles[saved.activeUserId] ? saved.activeUserId : "tal";
  const data = { ...emptyProfile(userId), ...profiles[userId] };
  state.activeUserId = userId;
  state.machines = data.machines;
  state.logs = data.logs.filter(log => !isLegacySampleLog(log));
  state.extraDates = data.extraDates;
  state.archivedMachineIds = data.archivedMachineIds;
}

function saveState() {
  cacheProfile();
  // Legacy top-level data always represents Tal, including after a rollback.
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...state, ...profiles.tal, profiles, pendingWrites, newUserDraft }));
}

function boolValue(value) { return value === true || String(value).toLowerCase() === "true"; }
function currentUser() { return state.users.find(user => user.id === state.activeUserId) || { id: state.activeUserId, name: "Tal" }; }
function userWritable() { return !backendReady || !boolValue(currentUser().archived); }

function renderUserSettings() {
  const select = document.querySelector("[data-user-select]");
  const active = state.users.filter(user => !boolValue(user.archived));
  select.innerHTML = active.map(user => `<option value="${escapeHtml(user.id)}">${escapeHtml(user.name)}</option>`).join("");
  select.value = state.activeUserId;
  select.disabled = !backendReady || profileBusy;
  document.querySelector("[data-users-controls]").hidden = !backendReady;
  document.querySelector("[data-user-status]").textContent = backendReady ? "Shared profiles: anyone with the link can switch users." : "User features will unlock after the Apps Script update.";
  document.querySelector("[data-create-user]").disabled = profileBusy;
  document.querySelector("[data-archive-user]").disabled = profileBusy || active.length < 2;
  const archived = state.users.filter(user => boolValue(user.archived));
  document.querySelector("[data-archived-users]").innerHTML = archived.length ? archived.map(user => `<div class="archived-workout"><span>${escapeHtml(user.name)}</span><button type="button" data-restore-user="${escapeHtml(user.id)}" ${profileBusy ? "disabled" : ""}>Restore</button></div>`).join("") : '<p class="setting-help">No archived users.</p>';
  document.querySelector("[data-check-users]").disabled = profileBusy;
}

async function switchUser(userId) {
  if (!backendReady || profileBusy) return;
  closeExpandedDetail();
  profileBusy = true;
  renderUserSettings();
  try {
    const response = await backendRequest("snapshot", {}, userId);
    if (!response?.ok || Number(response.schemaVersion) < 2) throw new Error(response?.error || "Backend update needed");
    if (boolValue((response.users || []).find(user => user.id === userId)?.archived)) throw new Error("This user is archived");
    applySnapshot(response, { renderAfter: false });
    activateProfile(userId);
  } catch (error) { setSyncNote(error.message); }
  finally { profileBusy = false; renderUserSettings(); }
}

async function createUser() {
  if (!backendReady || profileBusy) return;
  const name = document.querySelector("[data-new-user-name]").value.trim();
  if (!name) { document.querySelector("[data-new-user-name]").focus(); return; }
  const copyTal = document.querySelector("[data-new-user-start]").value === "copy";
  if (!newUserDraft || newUserDraft.name !== name || newUserDraft.copyTal !== copyTal) newUserDraft = { id: `user-${crypto.randomUUID()}`, name, copyTal };
  profileBusy = true;
  saveState();
  renderUserSettings();
  try {
    if (!await flushWrites()) throw new Error("Wait for pending workout changes to sync, then try again.");
    const response = await backendRequest("createUser", newUserDraft);
    if (!response?.ok) throw new Error(response?.error || "User could not be created");
    applySnapshot(response, { renderAfter: false });
    activateProfile(response.userId);
    newUserDraft = null;
    saveState();
    document.querySelector("[data-new-user-name]").value = "";
    document.querySelector("[data-add-user-details]").open = false;
    setSyncNote("User added");
  } catch (error) { setSyncNote(error.message); }
  finally { profileBusy = false; renderUserSettings(); }
}

async function setUserArchived(userId, archived) {
  if (!backendReady || profileBusy) return;
  const user = state.users.find(item => item.id === userId);
  if (!user) return;
  if (archived && !window.confirm(`Archive ${user.name}? Their exercises and history will be kept and can be restored here.`)) return;
  closeExpandedDetail();
  profileBusy = true;
  renderUserSettings();
  try {
    if (!await flushWrites()) throw new Error("Wait for pending workout changes to sync, then try again.");
    const response = await backendRequest("setUserArchived", { id: userId, archived });
    if (!response?.ok) throw new Error(response?.error || "User could not be updated");
    applySnapshot(response, { renderAfter: false });
    if (archived && userId === state.activeUserId) {
      const next = state.users.find(item => !boolValue(item.archived));
      const snapshot = await backendRequest("snapshot", {}, next.id);
      if (!snapshot?.ok) throw new Error("User archived. Select another user to continue.");
      applySnapshot(snapshot, { renderAfter: false });
      activateProfile(next.id);
    } else render();
    setSyncNote(archived ? "User archived; data kept" : "User restored");
  } catch (error) { setSyncNote(error.message); }
  finally { profileBusy = false; renderUserSettings(); }
}

function render() {
  applyAppearance();
  if (window.WORKOUT_CONFIG?.sheetUrl) els.sheetLink.href = window.WORKOUT_CONFIG.sheetUrl;
  if (els.settingsModal.hidden) renderSettings();
  renderMachineTable();
  renderArchivedWorkouts();
  renderUserSettings();
  renderDayDeleteUndo();
  updateInstallManifest();
  if (document.querySelector("[data-share-dialog]").open) renderShareDetails();
  document.body.classList.toggle("detail-open", Boolean(state.expandedId));
}

function applyAppearance() {
  const themes = ["garden", "tide", "moon", "sunrise"];
  if (!themes.includes(state.settings.theme)) state.settings.theme = "garden";
  document.body.dataset.theme = state.settings.theme;
  document.body.classList.toggle("reduce-motion", state.settings.reduceMotion);
}

function renderSettings() {
  els.autoSync.checked = Boolean(state.settings.autoSync);
  els.reduceMotion.checked = Boolean(state.settings.reduceMotion);
  els.showNotes.checked = !state.settings.hideTodayNotes;
  els.showSetup.checked = state.settings.showSetupNotes;
  els.highlightMissed.checked = state.settings.highlightMissedWorkouts;
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
      <th scope="col" class="machine-col" aria-label="Workout"></th>
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
  if (!machines.length) rows.push(`<tr><td class="empty-workouts" colspan="${dates.length + 2}">No active workouts. Add a workout below or restore one in Settings.</td></tr>`);
  els.machineTable.innerHTML = rows.join("");
  renderTableActions();
  renderDayActions(dates);
}

function dayDeleteLabel(date) {
  const [year, month, day] = date.split("-").map(Number);
  return new Intl.DateTimeFormat(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" }).format(new Date(year, month - 1, day, 12));
}

function dayEntries(date) {
  // Include archived exercises so deleting a day doesn't leave hidden entries.
  return state.machines.map(machine => ({ machine, log: latestLogFor(machine.id, date) })).filter(entry => entry.log);
}

function renderDayActions(dates) {
  els.dayActions.innerHTML = `<tr class="day-actions-row"><th scope="row">Day options</th>${dates.map(date => {
    const canDelete = userWritable() && (dayEntries(date).length > 0 || state.extraDates.includes(date));
    return `<td><button type="button" class="delete-day-button" data-delete-day="${escapeHtml(date)}" aria-label="Delete ${escapeHtml(dayDeleteLabel(date))}" title="Delete ${escapeHtml(dayDeleteLabel(date))}" ${canDelete ? "" : "disabled"}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 10v7M14 10v7" /></svg></button></td>`;
  }).join("")}<td aria-hidden="true"></td></tr>`;
}

function openDayDeletion(date) {
  if (!userWritable() || (!dayEntries(date).length && !state.extraDates.includes(date))) return;
  pendingDayDeletion = { date, userId: state.activeUserId };
  const count = dayEntries(date).length;
  document.querySelector("[data-delete-day-title]").textContent = `Delete ${dayDeleteLabel(date)}?`;
  document.querySelector("[data-delete-day-description]").textContent = count
    ? `Remove all ${count} workout ${count === 1 ? "entry" : "entries"} for ${currentUser().name} on this date, including any archived workouts? Other days and users are kept. You can undo this afterward.`
    : `Remove this empty date column for ${currentUser().name}? You can undo this afterward.`;
  document.querySelector("[data-delete-day-dialog]").showModal();
  document.body.classList.add("is-modal-open");
  document.querySelector("[data-cancel-day-delete]").focus({ preventScroll: true });
}

function confirmDayDeletion() {
  const pending = pendingDayDeletion;
  if (!pending) return;
  const dialog = document.querySelector("[data-delete-day-dialog]");
  if (pending.userId !== state.activeUserId || !userWritable()) { dialog.close(); return; }
  const entries = dayEntries(pending.date);
  const wasExtraDate = state.extraDates.includes(pending.date);
  const undo = { date: pending.date, userId: state.activeUserId, wasExtraDate, entries: [] };
  entries.forEach(({ machine, log }) => {
    const deletion = appendLogForDate(machine, pending.date, { weight: "", note: DELETE_MARKER, deleted: true }, { renderAfter: false });
    undo.entries.push({ machineId: machine.id, log: { ...log }, deletionId: deletion.id });
  });
  state.extraDates = state.extraDates.filter(date => date !== pending.date);
  cacheProfile();
  profiles[state.activeUserId].dayDeleteUndo = undo;
  state.expandedId = "";
  saveState();
  dialog.close();
  render();
  document.querySelector("[data-undo-day-delete]").focus({ preventScroll: true });
}

function renderDayDeleteUndo() {
  const undo = profiles[state.activeUserId]?.dayDeleteUndo;
  const notice = document.querySelector("[data-day-delete-notice]");
  notice.hidden = !undo;
  if (undo) document.querySelector("[data-day-delete-message]").textContent = `${formatLongDate(undo.date)} deleted for ${currentUser().name}.`;
}

function undoDayDeletion() {
  const undo = profiles[state.activeUserId]?.dayDeleteUndo;
  if (!undo || undo.userId !== state.activeUserId || !userWritable()) return;
  undo.entries.forEach(entry => {
    const machine = state.machines.find(item => item.id === entry.machineId);
    // Don't overwrite a newer edit made after deletion (including on another device).
    if (machine && latestEventFor(machine.id, undo.date)?.id === entry.deletionId) {
      appendLogForDate(machine, undo.date, entry.log, { renderAfter: false });
    }
  });
  if (undo.wasExtraDate && !state.extraDates.includes(undo.date)) state.extraDates.push(undo.date);
  delete profiles[state.activeUserId].dayDeleteUndo;
  historyColumns = Math.max(historyColumns, historyDates().indexOf(undo.date) + 2);
  saveState();
  render();
  document.querySelector(`[data-delete-day="${CSS.escape(undo.date)}"]`)?.focus({ preventScroll: true });
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
  return state.machines.filter(machine => !state.archivedMachineIds.includes(machine.id)).sort((a, b) => {
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
      <td class="history-spacer"><button type="button" class="archive-row-button" data-archive-workout="${escapeHtml(machine.id)}" aria-label="Archive ${escapeHtml(machine.name)}" title="Archive ${escapeHtml(machine.name)}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 10v7M14 10v7" /></svg></button></td>
    </tr>
  `;
}

function renderArchivedWorkouts() {
  const archived = state.machines.filter(machine => state.archivedMachineIds.includes(machine.id));
  document.querySelector("[data-archive-count]").textContent = String(archived.length);
  document.querySelector("[data-archived-list]").innerHTML = archived.length
    ? archived.map(machine => `<div class="archived-workout"><span>${escapeHtml(machine.name)}</span><button type="button" data-restore-workout="${escapeHtml(machine.id)}" aria-label="Restore ${escapeHtml(machine.name)}">Restore</button></div>`).join("")
    : '<p class="setting-help">No archived workouts.</p>';
}

function openArchiveConfirmation(machineId) {
  const machine = state.machines.find(item => item.id === machineId);
  if (!machine || state.archivedMachineIds.includes(machineId)) return;
  pendingArchiveId = machineId;
  document.querySelector("[data-archive-title]").textContent = `Archive ${machine.name}?`;
  document.querySelector("[data-archive-dialog]").showModal();
  document.body.classList.add("is-modal-open");
  document.querySelector("[data-cancel-archive]").focus({ preventScroll: true });
}

function confirmArchiveWorkout() {
  const machine = state.machines.find(item => item.id === pendingArchiveId);
  if (!machine) return;
  if (!state.archivedMachineIds.includes(machine.id)) state.archivedMachineIds.push(machine.id);
  if (state.expandedId === machine.id) state.expandedId = "";
  undoArchiveId = machine.id;
  saveState();
  if (backendReady) queueWrite("setMachineArchived", { id: machine.id, archived: true });
  document.querySelector("[data-archive-dialog]").close();
  render();
  const notice = document.querySelector("[data-archive-notice]");
  notice.querySelector("[data-archive-message]").textContent = `${machine.name} archived. History kept.`;
  notice.hidden = false;
  notice.querySelector("[data-undo-archive]").focus({ preventScroll: true });
}

function restoreWorkout(machineId) {
  if (backendReady) queueWrite("setMachineArchived", { id: machineId, archived: false });
  state.archivedMachineIds = state.archivedMachineIds.filter(id => id !== machineId);
  if (undoArchiveId === machineId) {
    undoArchiveId = "";
    document.querySelector("[data-archive-notice]").hidden = true;
  }
  saveState();
  render();
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
        <div class="detail-panel" data-detail-panel="${escapeHtml(machine.id)}" data-initial-weight="${escapeHtml(String(todayLog?.weight || previous || "").trim())}" data-initial-note="${escapeHtml(String(todayLog?.note || "").trim())}" data-initial-setup="${escapeHtml(String(machine.setupNotes || "").trim())}">
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
              <input data-today-note type="text" value="${escapeHtml(todayLog?.note || "")}">
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
  if (!state.settings.highlightMissedWorkouts) return { recentDates: [], suggestedIds: new Set() };
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
  if (machine.valueLabel === "Time") return `type="text" inputmode="text"`;
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
  if (!userWritable()) return;
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
  if (!userWritable()) return;
  const machine = state.machines.find((item) => item.id === machineId);
  const panel = document.querySelector(`[data-detail-panel="${CSS.escape(machineId)}"]`);
  if (!machine || !panel) return;

  const setupNotes = panel.querySelector("[data-setup-notes]").value.trim();
  const weight = panel.querySelector("[data-today-weight]").value.trim();
  const note = panel.querySelector("[data-today-note]").value.trim();
  const date = state.expandedDate || isoDate(new Date());
  const setupChanged = setupNotes !== panel.dataset.initialSetup;
  const logChanged = Boolean(weight || note)
    && (panel.dataset.initialWeight !== weight || panel.dataset.initialNote !== note);

  const updatedMachine = setupChanged ? { ...machine, setupNotes } : machine;
  state.machines = state.machines.map((item) => item.id === machineId ? updatedMachine : item);
  if (logChanged) appendLogForDate(updatedMachine, date, { weight, note }, { renderAfter: false });
  state.expandedId = "";
  saveState();
  if (options.renderAfter !== false) render();
  if (setupChanged) syncMachine(backendReady ? { id: machineId, setupNotes } : updatedMachine);
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
    id: state.activeUserId === "tal" ? uniqueMachineId(name) : `${state.activeUserId}-${crypto.randomUUID()}`,
    userId: state.activeUserId,
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
  if (!userWritable()) return;
  const previousEvent = latestEventFor(machine.id, date);
  const createdAt = new Date(Math.max(Date.now(), (Date.parse(previousEvent?.createdAt) || 0) + 1)).toISOString();
  const log = {
    id: crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`,
    date,
    createdAt,
    userId: state.activeUserId,
    profileName: currentUser().name,
    machineId: machine.id,
    machineName: machine.name,
    weight: values.weight ?? "",
    reps: values.reps ?? "",
    effort: values.effort ?? "",
    rir: values.rir ?? "",
    note: values.deleted ? DELETE_MARKER : values.note || "",
    deleted: Boolean(values.deleted)
  };
  state.logs.push(log);
  saveState();
  if (options.renderAfter !== false) render();
  syncLog(log);
  return log;
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
    let response = await backendRequest("snapshot", {}, requestedUserId || state.activeUserId);
    if (!response?.ok && requestedUserId) {
      requestedUserId = "";
      response = await backendRequest("snapshot", {}, state.activeUserId);
    }
    if (response && response.ok) {
      applySnapshot(response, { renderAfter: true });
      if (!options.quiet) setSyncNote("Synced");
      flushWrites();
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

function queueWrite(action, payload, userId = state.activeUserId) {
  pendingWrites.push({ id: crypto.randomUUID(), action, payload, userId });
  saveState();
  startAutoSync();
  flushWrites();
}

async function flushWrites() {
  if (flushingWrites) return pendingWrites.length === 0;
  if (!state.settings.backendUrl) return pendingWrites.length === 0;
  flushingWrites = true;
  try {
    while (pendingWrites.length) {
      const write = pendingWrites.find(item => (backendReady || item.userId === "tal") &&
        (!backendReady || !boolValue(state.users.find(user => user.id === item.userId)?.archived)));
      if (!write) return false;
      const response = await backendRequest(write.action, write.payload, write.userId);
      if (!response?.ok) throw new Error(response?.error || "Sync issue");
      pendingWrites = pendingWrites.filter(item => item.id !== write.id);
      applySnapshot(response, { renderAfter: true });
      setSyncNote("Synced");
    }
    return true;
  } catch (error) { setSyncNote(`Saved on this device; sync pending. ${error.message}`); return false; }
  finally { flushingWrites = false; saveState(); }
}

function syncMachine(machine) { queueWrite("saveMachine", { machine: { ...machine, userId: state.activeUserId } }); }
function syncLog(log) { queueWrite("logSet", { log }, log.userId || state.activeUserId); }

function applySnapshot(response, options = {}) {
  cacheProfile();
  if (Number(response.schemaVersion) >= 2) {
    backendReady = true;
    if (response.backupUrl) {
      const backupLink = document.querySelector("[data-migration-backup]");
      backupLink.href = response.backupUrl;
      backupLink.hidden = false;
    }
    if (Array.isArray(response.users)) state.users = response.users;
    // Queue device-local Tal metadata/archives/unsynced logs once, durably.
    const tal = profiles.tal;
    if (tal && !tal.migrationPrepared && response.userId === "tal") {
      const serverLogIds = new Set((response.logs || []).map(log => log.id));
      tal.machines.forEach(machine => pendingWrites.push({ id: crypto.randomUUID(), userId: "tal", action: "saveMachine", payload: { machine: { ...machine, userId: "tal" }, metadataOnly: true } }));
      tal.archivedMachineIds.forEach(id => pendingWrites.push({ id: crypto.randomUUID(), userId: "tal", action: "setMachineArchived", payload: { id, archived: true } }));
      tal.logs.filter(log => !serverLogIds.has(log.id)).forEach(log => pendingWrites.push({ id: crypto.randomUUID(), userId: "tal", action: "logSet", payload: { log: { ...log, userId: "tal" } } }));
      tal.migrationPrepared = true;
    }
  }
  const userId = Number(response.schemaVersion) >= 2 ? response.userId : "tal";
  if (!userId) return;
  const cached = profiles[userId] || emptyProfile(userId);
  const data = { ...cached };
  if (Array.isArray(response.machines)) data.machines = mergeMachines(response.machines, cached.machines, userId);
  if (Array.isArray(response.logs)) data.logs = mergeLogs(response.logs, cached.logs);
  if (Number(response.schemaVersion) >= 2) {
    const archived = new Set(data.machines.filter(machine => boolValue(machine.archived)).map(machine => machine.id));
    pendingWrites.filter(write => write.userId === userId && write.action === "setMachineArchived").forEach(write => write.payload.archived ? archived.add(write.payload.id) : archived.delete(write.payload.id));
    data.archivedMachineIds = [...archived];
    pendingWrites.filter(write => write.userId === userId && write.action === "saveMachine" && !write.payload.metadataOnly).forEach(write => {
      const index = data.machines.findIndex(machine => machine.id === write.payload.machine.id);
      if (index >= 0) data.machines[index] = { ...data.machines[index], ...write.payload.machine };
      else data.machines.push(write.payload.machine);
    });
  }
  profiles[userId] = data;
  if (!backendReady && state.activeUserId !== "tal") {
    activateProfile("tal");
  } else if (state.activeUserId === userId) {
    state.machines = data.machines;
    state.logs = data.logs;
    state.extraDates = data.extraDates;
    state.archivedMachineIds = data.archivedMachineIds;
  }
  if (requestedUserId && requestedUserId === userId && backendReady) {
    requestedUserId = "";
    if (!boolValue(state.users.find(user => user.id === userId)?.archived)) activateProfile(userId);
  }
  saveState();
  if (options.renderAfter !== false) renderAfterSnapshot();
  else renderUserSettings();
  // A response for a different user is cached, never rendered into this profile.
  if (backendReady && !profileBusy && boolValue(currentUser().archived)) {
    const next = state.users.find(user => !boolValue(user.archived));
    if (next) switchUser(next.id);
  }
  if (!flushingWrites && backendReady && pendingWrites.length) flushWrites();
}

function backendRequest(action, payload = {}, userId = state.activeUserId) {
  return new Promise((resolve, reject) => {
    const callbackName = `workoutCallback_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const url = new URL(state.settings.backendUrl);
    url.searchParams.set("action", action);
    url.searchParams.set("userId", userId);
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

function mergeMachines(incoming, existing = state.machines, userId = state.activeUserId) {
  const seeds = userId === "tal" && !backendReady ? DEFAULT_MACHINES : [];
  const byId = new Map(seeds.map((machine) => [machine.id, { ...machine }]));
  existing.forEach((machine) => byId.set(machine.id, { ...(byId.get(machine.id) || {}), ...machine }));
  incoming.forEach((machine) => {
    if (!machine.id) return;
    const fallback = byId.get(machine.id) || {};
    byId.set(machine.id, {
      ...fallback,
      ...machine,
      group: machine.group || fallback.group || (DEFAULT_MACHINES.find(item => item.id === machine.id)?.group) || "Other",
      valueLabel: machine.valueLabel || fallback.valueLabel || (machine.id === "plank" ? "Time" : "Weight"),
      seedWeight: machine.seedWeight || fallback.seedWeight || machine.targetWeight || ""
    });
  });
  return [...byId.values()];
}

function mergeLogs(incoming, existing = state.logs) {
  const byId = new Map(existing.filter(log => !isLegacySampleLog(log)).map(log => [log.id, log]));
  incoming.forEach(log => { if (log.id) byId.set(log.id, { ...log, date: normalizeDate(log.date) }); });
  return [...byId.values()];
}

function isDeleteMarker(log) {
  return Boolean(log?.deleted) || log?.note === DELETE_MARKER;
}

function isLegacySampleLog(log) {
  return Boolean(log?._demo) || String(log?.id || "").startsWith("demo-week-");
}

function setSyncNote(message) {
  els.syncNote.textContent = message;
  document.querySelector("[data-user-sync-note]").textContent = message;
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
  if (newUserDraft && !document.querySelector("[data-new-user-name]").value) {
    document.querySelector("[data-new-user-name]").value = newUserDraft.name;
    document.querySelector("[data-new-user-start]").value = newUserDraft.copyTal ? "copy" : "empty";
  }
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
  state.settings.autoSync = els.autoSync.checked;
  state.settings.reduceMotion = els.reduceMotion.checked;
  state.settings.hideTodayNotes = !els.showNotes.checked;
  state.settings.showSetupNotes = els.showSetup.checked;
  state.settings.highlightMissedWorkouts = els.highlightMissed.checked;
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

function resetSettings() {
  const backendUrl = state.settings.backendUrl;
  state.settings = { ...DEFAULT_SETTINGS, backendUrl };
  saveState();
  renderSettings();
  render();
  if (state.settings.autoSync) triggerAutoSync();
  else stopAutoSync();
  setSyncNote("Default settings restored");
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

function profileLink() {
  const url = new URL(".", window.location.href);
  url.searchParams.set("user", state.activeUserId);
  return url.toString();
}

function renderShareDetails() {
  const input = document.querySelector("[data-share-url]");
  const link = profileLink();
  if (input.value !== link) document.querySelector("[data-copy-status]").textContent = "";
  input.value = link;
  document.querySelector("[data-share-profile]").textContent = `This link opens ${currentUser().name}’s workouts.`;
  document.querySelector("[data-install-app]").hidden = !installPrompt;
}

function openShareDialog() {
  closeExpandedDetail();
  renderShareDetails();
  document.querySelector("[data-copy-status]").textContent = "";
  document.querySelector("[data-share-dialog]").showModal();
  document.body.classList.add("is-modal-open");
  document.querySelector("[data-close-share]").focus({ preventScroll: true });
}

async function copyProfileLink() {
  const url = profileLink();
  const status = document.querySelector("[data-copy-status]");
  try {
    if (!navigator.clipboard?.writeText) throw new Error("Use selection");
    await navigator.clipboard.writeText(url);
    status.textContent = "Link copied.";
  } catch {
    const input = document.querySelector("[data-share-url]");
    input.value = url;
    input.focus();
    input.select();
    let copied = false;
    try { copied = document.execCommand("copy"); } catch { /* Manual copy remains available. */ }
    status.textContent = copied ? "Link copied." : "Link selected. Touch and hold to copy, or use your keyboard’s Copy command.";
  }
}

async function shareProfileLink() {
  if (!navigator.share) { await copyProfileLink(); return; }
  try { await navigator.share({ title: `Workout — ${currentUser().name}`, url: profileLink() }); }
  catch (error) { if (error.name !== "AbortError") await copyProfileLink(); }
}

function updateInstallManifest() {
  // A stable HTTPS manifest URL lets installed apps fetch future updates.
  // The tiny install worker serves only profile-specific manifests; no page/data caching.
  const controller = navigator.serviceWorker?.controller;
  if (!controller || new URL(controller.scriptURL).pathname !== new URL("install-worker.js", window.location.href).pathname) return;
  const link = document.querySelector('link[rel="manifest"]');
  const manifest = new URL("manifest.webmanifest", window.location.href);
  manifest.searchParams.set("user", state.activeUserId);
  manifest.searchParams.set("v", "20261015-share");
  if (link.href !== manifest.toString()) link.href = manifest.toString();
}

function setupInstallSupport() {
  window.addEventListener("beforeinstallprompt", event => {
    event.preventDefault();
    installPrompt = event;
    document.querySelector("[data-install-app]").hidden = false;
  });
  window.addEventListener("appinstalled", () => {
    installPrompt = null;
    document.querySelector("[data-install-app]").hidden = true;
  });
  if ("serviceWorker" in navigator && /^https?:$/.test(window.location.protocol)) {
    navigator.serviceWorker.addEventListener("controllerchange", updateInstallManifest);
    navigator.serviceWorker.register("./install-worker.js").then(() => navigator.serviceWorker.ready).then(updateInstallManifest).catch(() => {});
  }
}

function bindEvents() {
  const shareDialog = document.querySelector("[data-share-dialog]");
  document.querySelector("[data-open-share]").addEventListener("click", openShareDialog);
  document.querySelector("[data-close-share]").addEventListener("click", () => shareDialog.close());
  shareDialog.addEventListener("click", event => { if (event.target === shareDialog) shareDialog.close(); });
  shareDialog.addEventListener("close", () => {
    if (els.settingsModal.hidden && els.workoutModal.hidden) document.body.classList.remove("is-modal-open");
    document.querySelector("[data-open-share]").focus({ preventScroll: true });
  });
  document.querySelector("[data-copy-link]").addEventListener("click", copyProfileLink);
  document.querySelector("[data-native-share]").addEventListener("click", shareProfileLink);
  document.querySelector("[data-install-app]").addEventListener("click", async () => {
    if (!installPrompt) return;
    const prompt = installPrompt;
    installPrompt = null;
    document.querySelector("[data-install-app]").hidden = true;
    await prompt.prompt();
  });
  document.querySelector("[data-open-settings]").addEventListener("click", openSettings);
  document.querySelector("[data-close-settings]").addEventListener("click", closeSettings);
  document.querySelector("[data-save-settings]").addEventListener("click", saveSettings);
  document.querySelector("[data-reset-site]").addEventListener("click", resetSettings);
  els.settingsBackdrop.addEventListener("click", closeSettings);
  document.querySelector("[data-close-workout]").addEventListener("click", closeWorkoutModal);
  document.querySelector("[data-cancel-workout]").addEventListener("click", closeWorkoutModal);
  document.querySelector("[data-save-workout]").addEventListener("click", saveWorkoutModal);
  els.workoutBackdrop.addEventListener("click", closeWorkoutModal);
  document.querySelector("[data-user-select]").addEventListener("change", event => switchUser(event.target.value));
  document.querySelector("[data-create-user]").addEventListener("click", createUser);
  document.querySelector("[data-check-users]").addEventListener("click", () => syncNow());
  document.querySelector("[data-archive-user]").addEventListener("click", () => setUserArchived(state.activeUserId, true));
  els.settingsModal.addEventListener("click", event => {
    const restoreUser = event.target.closest("[data-restore-user]");
    if (restoreUser) setUserArchived(restoreUser.dataset.restoreUser, false);
    const restore = event.target.closest("[data-restore-workout]");
    if (restore) {
      restoreWorkout(restore.dataset.restoreWorkout);
      const next = els.settingsModal.querySelector("[data-restore-workout]") || els.settingsModal.querySelector("[data-archived-settings] summary");
      next.focus({ preventScroll: true });
    }
    if (event.target === els.settingsModal) closeSettings();
    const button = event.target.closest("button[data-theme]");
    if (button) {
      state.settings.theme = button.dataset.theme;
      saveState();
      applyAppearance();
      document.querySelectorAll("button[data-theme]").forEach(item => item.setAttribute("aria-pressed", String(item === button)));
    }
  });
  const dayDialog = document.querySelector("[data-delete-day-dialog]");
  document.querySelectorAll("[data-cancel-day-delete], [data-close-day-delete]").forEach(button => button.addEventListener("click", () => dayDialog.close()));
  document.querySelector("[data-confirm-day-delete]").addEventListener("click", confirmDayDeletion);
  document.querySelector("[data-undo-day-delete]").addEventListener("click", undoDayDeletion);
  dayDialog.addEventListener("click", event => { if (event.target === dayDialog) dayDialog.close(); });
  dayDialog.addEventListener("close", () => {
    pendingDayDeletion = null;
    if (els.settingsModal.hidden && els.workoutModal.hidden) document.body.classList.remove("is-modal-open");
  });
  els.dayActions.addEventListener("click", event => {
    const button = event.target.closest("[data-delete-day]");
    if (button && !button.disabled) { event.stopPropagation(); openDayDeletion(button.dataset.deleteDay); }
  });
  const archiveDialog = document.querySelector("[data-archive-dialog]");
  document.querySelectorAll("[data-cancel-archive], [data-close-archive]").forEach(button => button.addEventListener("click", () => archiveDialog.close()));
  document.querySelector("[data-confirm-archive]").addEventListener("click", confirmArchiveWorkout);
  archiveDialog.addEventListener("click", event => { if (event.target === archiveDialog) archiveDialog.close(); });
  archiveDialog.addEventListener("close", () => {
    pendingArchiveId = "";
    if (els.settingsModal.hidden && els.workoutModal.hidden) document.body.classList.remove("is-modal-open");
  });
  document.querySelector("[data-undo-archive]").addEventListener("click", () => {
    const machineId = undoArchiveId;
    restoreWorkout(machineId);
    document.querySelector(`[data-archive-workout="${CSS.escape(machineId)}"]`)?.focus({ preventScroll: true });
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
    const archiveButton = event.target.closest("[data-archive-workout]");
    if (archiveButton) {
      event.stopPropagation();
      openArchiveConfirmation(archiveButton.dataset.archiveWorkout);
      return;
    }
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
  setupInstallSupport();
  if (state.settings.autoSync) {
    triggerAutoSync();
  } else {
    setIdleSyncNote();
  }
}

init();
