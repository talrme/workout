const SCHEMA_VERSION = 2;
const TAL_ID = 'tal';
const HEADERS = {
  Users: ['id', 'name', 'archived', 'createdAt', 'updatedAt'],
  Machines: ['id', 'name', 'targetWeight', 'setupNotes', 'updatedAt', 'userId', 'group', 'valueLabel', 'seedWeight', 'archived'],
  Logs: ['id', 'date', 'createdAt', 'profileName', 'machineId', 'machineName', 'weight', 'reps', 'effort', 'rir', 'note', 'userId']
};
const DEFAULT_ROWS = [
  ['leg-press', 'Leg Press', 180, 'Seat comfortable, knees tracking straight.', 'Legs'],
  ['leg-curl', 'Leg Curl', 65, 'Knee aligned with pivot point.', 'Legs'],
  ['leg-extension', 'Leg Extension', 70, 'Pad just above ankle, controlled tempo.', 'Legs'],
  ['chest-press', 'Chest Press', 70, 'Seat so handles start around mid-chest.', 'Upper body'],
  ['lat-pulldown', 'Lat Pulldown', 80, 'Thigh pad snug, pull toward upper chest.', 'Upper body'],
  ['seated-row', 'Seated Row', 75, 'Chest tall, no leaning back.', 'Upper body'],
  ['shoulder-press', 'Shoulder Press', 45, 'Seat so handles start around ear height.', 'Upper body'],
  ['plank', 'Plank', '30s', 'Start with 30 seconds. Keep hips steady and breathe.', 'Core']
];

// Run this once in the Apps Script editor BEFORE deploying the new version.
// A complete spreadsheet copy is made before any schema/data changes.
function setupWorkoutUsers() {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    migrate_();
    console.log('Ready. Backup: ' + backupUrl_());
    return { ok: true, schemaVersion: SCHEMA_VERSION, backupUrl: backupUrl_() };
  } finally { lock.releaseLock(); }
}

function doGet(e) {
  const params = e && e.parameter || {};
  const callback = params.callback || 'callback';
  const lock = LockService.getScriptLock();
  let acquired = false;
  try {
    lock.waitLock(30000);
    acquired = true;
    migrate_();
    const payload = JSON.parse(params.payload || '{}');
    const action = params.action || 'snapshot';
    const userId = params.userId || TAL_ID; // Older websites continue to use Tal only.
    let targetId = userId;
    if (action === 'createUser') targetId = createUser_(payload);
    else {
      requireUser_(userId, action === 'snapshot');
      if (action === 'saveMachine') saveMachine_(userId, payload.machine || {}, !!payload.metadataOnly);
      else if (action === 'logSet') appendLog_(userId, payload.log || {});
      else if (action === 'setMachineArchived') setMachineArchived_(userId, payload);
      else if (action === 'setUserArchived') setUserArchived_(payload);
      else if (action !== 'snapshot') throw new Error('Unknown action');
    }
    return jsonp_(callback, snapshot_(targetId));
  } catch (error) { return jsonp_(callback, { ok: false, error: String(error) }); }
  finally { if (acquired) lock.releaseLock(); }
}

function ss_() { return SpreadsheetApp.getActive(); }
function props_() { return PropertiesService.getScriptProperties(); }
function key_(suffix) { return 'workout_' + ss_().getId() + '_' + suffix; }
function backupUrl_() { return props_().getProperty(key_('backup_url')) || ''; }
function truth_(value) { return value === true || String(value).toLowerCase() === 'true'; }
function now_() { return new Date().toISOString(); }

function migrate_() {
  if (props_().getProperty(key_('schema')) === String(SCHEMA_VERSION)) return;
  if (!backupUrl_()) {
    const backup = ss_().copy('Workout backup before users ' + now_().replace(/[:.]/g, '-'));
    props_().setProperty(key_('backup_url'), backup.getUrl());
  }
  const hadMachines = !!ss_().getSheetByName('Machines');
  Object.keys(HEADERS).forEach(ensureSheet_);
  if (!rows_('Users').some(row => row.id === TAL_ID)) append_('Users', { id: TAL_ID, name: 'Tal', archived: false, createdAt: now_(), updatedAt: now_() });
  if (!hadMachines) DEFAULT_ROWS.forEach(row => append_('Machines', { id: row[0], name: row[1], targetWeight: row[2], setupNotes: row[3], updatedAt: now_(), userId: TAL_ID, group: row[4], valueLabel: row[0] === 'plank' ? 'Time' : 'Weight', seedWeight: row[2], archived: false }));
  ['Machines', 'Logs'].forEach(name => {
    const sheet = ss_().getSheetByName(name);
    const headers = headers_(sheet);
    const count = sheet.getLastRow() - 1;
    if (count < 1) return;
    const column = headers.indexOf('userId') + 1;
    // Write ONLY the newly added ownership column; preserve every legacy cell.
    const owners = sheet.getRange(2, column, count, 1).getValues();
    const ids = sheet.getRange(2, headers.indexOf('id') + 1, count, 1).getValues();
    owners.forEach((row, i) => { if (ids[i][0] && !row[0]) row[0] = TAL_ID; });
    sheet.getRange(2, column, count, 1).setValues(owners);
  });
  // Populate only new metadata cells for the known legacy exercises.
  rows_('Machines').forEach(machine => {
    const seed = DEFAULT_ROWS.find(row => row[0] === machine.id);
    if (!seed || machine.userId !== TAL_ID) return;
    const patch = {};
    if (machine.group === '') patch.group = seed[4];
    if (machine.valueLabel === '') patch.valueLabel = machine.id === 'plank' ? 'Time' : 'Weight';
    if (machine.seedWeight === '') patch.seedWeight = machine.targetWeight === '' ? seed[2] : machine.targetWeight;
    if (Object.keys(patch).length) patch_('Machines', machine.id, patch);
  });
  SpreadsheetApp.flush();
  props_().setProperty(key_('schema'), String(SCHEMA_VERSION));
}

function headers_(sheet) { return sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(String); }
function ensureSheet_(name) {
  let sheet = ss_().getSheetByName(name);
  if (!sheet) sheet = ss_().insertSheet(name);
  if (!sheet.getLastRow()) { sheet.appendRow(HEADERS[name]); return; }
  const current = headers_(sheet);
  HEADERS[name].forEach(header => { if (current.indexOf(header) < 0) current.push(header); });
  sheet.getRange(1, 1, 1, current.length).setValues([current]);
}
function rows_(name) {
  const values = ss_().getSheetByName(name).getDataRange().getValues();
  const headers = values.shift();
  return values.filter(row => row[headers.indexOf('id')]).map(row => {
    const object = {};
    headers.forEach((key, i) => object[key] = row[i]);
    return object;
  });
}
function append_(name, object) {
  const sheet = ss_().getSheetByName(name);
  sheet.appendRow(headers_(sheet).map(key => object[key] == null ? '' : object[key]));
}
function patch_(name, id, patch) {
  const sheet = ss_().getSheetByName(name);
  const headers = headers_(sheet);
  const values = sheet.getDataRange().getValues();
  for (let i = 1; i < values.length; i++) if (String(values[i][headers.indexOf('id')]) === String(id)) {
    // Update individual named cells; don't replace unrelated columns or formulas.
    Object.keys(patch).forEach(key => {
      const column = headers.indexOf(key);
      if (column >= 0) sheet.getRange(i + 1, column + 1).setValue(patch[key]);
    });
    return;
  }
  throw new Error('Record not found: ' + id);
}
function requireUser_(id, allowArchived) {
  const user = rows_('Users').find(row => row.id === id);
  if (!user || (!allowArchived && truth_(user.archived))) throw new Error('User is unavailable');
  return user;
}
function snapshot_(userId) {
  return { ok: true, schemaVersion: SCHEMA_VERSION, userId: userId, users: rows_('Users'),
    machines: rows_('Machines').filter(row => row.userId === userId),
    logs: rows_('Logs').filter(row => row.userId === userId), backupUrl: backupUrl_() };
}
function saveMachine_(userId, machine, metadataOnly) {
  if (!machine.id) throw new Error('Missing exercise ID');
  if (machine.userId && machine.userId !== userId) throw new Error('Exercise owner mismatch');
  const existing = rows_('Machines').find(row => row.id === machine.id);
  if (existing && existing.userId !== userId) throw new Error('Exercise belongs to a different user');
  const patch = {};
  const fields = ['name', 'targetWeight', 'setupNotes', 'group', 'valueLabel', 'seedWeight'];
  fields.forEach(field => {
    if (machine[field] == null) return;
    if (!metadataOnly || !existing || (['group', 'valueLabel', 'seedWeight'].indexOf(field) >= 0 && existing[field] === '')) patch[field] = machine[field];
  });
  if (existing) { if (Object.keys(patch).length) { patch.updatedAt = now_(); patch_('Machines', machine.id, patch); } }
  else append_('Machines', Object.assign({ id: machine.id, userId: userId, archived: false, updatedAt: now_() }, patch));
}
function appendLog_(userId, log) {
  if (!log.id || !log.machineId) throw new Error('Missing log/exercise ID');
  if (log.userId && log.userId !== userId) throw new Error('Log owner mismatch');
  const duplicate = rows_('Logs').find(row => row.id === log.id);
  if (duplicate) { if (duplicate.userId !== userId) throw new Error('Log belongs to another user'); return; }
  const machine = rows_('Machines').find(row => row.id === log.machineId && row.userId === userId);
  if (!machine) throw new Error('Exercise not found for this user');
  append_('Logs', Object.assign({}, log, { userId: userId, note: log.deleted ? '__WORKOUT_DELETE__' : log.note || '', createdAt: log.createdAt || now_() }));
}
function createUser_(payload) {
  const id = String(payload.id || '');
  const name = String(payload.name || '').trim();
  if (!/^user-[a-zA-Z0-9-]{8,}$/.test(id) || !name || name.length > 80) throw new Error('Enter a name (up to 80 characters)');
  const existing = rows_('Users').find(row => row.id === id);
  if (existing && existing.name !== name) throw new Error('User ID already used');
  const timestamp = now_();
  if (!existing) append_('Users', { id: id, name: name, archived: false, createdAt: timestamp, updatedAt: timestamp });
  if (payload.copyTal) rows_('Machines').filter(row => row.userId === TAL_ID && !truth_(row.archived)).forEach(row => {
    // Deterministic clone IDs make a retried request safe.
    const cloneId = id + '-' + row.id;
    if (!rows_('Machines').some(machine => machine.id === cloneId)) append_('Machines', Object.assign({}, row, { id: cloneId, userId: id, archived: false, updatedAt: timestamp }));
  });
  return id;
}
function setMachineArchived_(userId, payload) {
  const machine = rows_('Machines').find(row => row.id === payload.id && row.userId === userId);
  if (!machine) throw new Error('Exercise not found for this user');
  patch_('Machines', machine.id, { archived: !!payload.archived, updatedAt: now_() });
}
function setUserArchived_(payload) {
  const user = requireUser_(payload.id, true);
  const archived = !!payload.archived;
  if (archived && !truth_(user.archived) && rows_('Users').filter(row => !truth_(row.archived)).length <= 1) throw new Error('Keep at least one active user');
  patch_('Users', user.id, { archived: archived, updatedAt: now_() });
}
function jsonp_(callback, data) {
  const safe = String(callback).replace(/[^\w.$]/g, '');
  return ContentService.createTextOutput(safe + '(' + JSON.stringify(data) + ');').setMimeType(ContentService.MimeType.JAVASCRIPT);
}
