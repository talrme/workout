const MACHINE_SHEET = 'Machines';
const LOG_SHEET = 'Logs';

const DEFAULT_MACHINES = [
  ['leg-press', 'Leg Press', 180, 'Seat comfortable, knees tracking straight.'],
  ['chest-press', 'Chest Press', 70, 'Seat so handles start around mid-chest.'],
  ['lat-pulldown', 'Lat Pulldown', 80, 'Thigh pad snug, pull toward upper chest.'],
  ['seated-row', 'Seated Row', 75, 'Chest tall, no leaning back.'],
  ['shoulder-press', 'Shoulder Press', 45, 'Seat so handles start around ear height.'],
  ['leg-curl', 'Leg Curl', 65, 'Knee aligned with pivot point.'],
  ['leg-extension', 'Leg Extension', 70, 'Pad just above ankle, controlled tempo.']
];

function doGet(e) {
  const callback = e.parameter.callback || 'callback';
  const action = e.parameter.action || 'snapshot';
  const payload = JSON.parse(e.parameter.payload || '{}');
  const lock = LockService.getScriptLock();
  lock.waitLock(5000);

  try {
    setupSheets_();

    if (action === 'saveMachine') {
      saveMachine_(payload.machine || {});
    }

    if (action === 'logSet') {
      appendLog_(payload.log || {});
    }

    return jsonp_(callback, {
      ok: true,
      machines: readMachines_(),
      logs: readLogs_()
    });
  } catch (error) {
    return jsonp_(callback, { ok: false, error: String(error) });
  } finally {
    lock.releaseLock();
  }
}

function setupSheets_() {
  const ss = SpreadsheetApp.getActive();
  let machines = ss.getSheetByName(MACHINE_SHEET);
  if (!machines) {
    machines = ss.insertSheet(MACHINE_SHEET);
    machines.appendRow(['id', 'name', 'targetWeight', 'setupNotes', 'updatedAt']);
    DEFAULT_MACHINES.forEach(function(machine) {
      machines.appendRow([machine[0], machine[1], machine[2], machine[3], new Date()]);
    });
  }

  let logs = ss.getSheetByName(LOG_SHEET);
  if (!logs) {
    logs = ss.insertSheet(LOG_SHEET);
    logs.appendRow(['id', 'date', 'createdAt', 'profileName', 'machineId', 'machineName', 'weight', 'reps', 'effort', 'rir', 'note']);
  }
}

function readMachines_() {
  const sheet = SpreadsheetApp.getActive().getSheetByName(MACHINE_SHEET);
  return sheet.getDataRange().getValues().slice(1).filter(function(row) {
    return row[0];
  }).map(function(row) {
    return {
      id: row[0],
      name: row[1],
      targetWeight: row[2],
      setupNotes: row[3],
      updatedAt: row[4]
    };
  });
}

function readLogs_() {
  const sheet = SpreadsheetApp.getActive().getSheetByName(LOG_SHEET);
  return sheet.getDataRange().getValues().slice(1).filter(function(row) {
    return row[0];
  }).map(function(row) {
    return {
      id: row[0],
      date: row[1],
      createdAt: row[2],
      profileName: row[3],
      machineId: row[4],
      machineName: row[5],
      weight: row[6],
      reps: row[7],
      effort: row[8],
      rir: row[9],
      note: row[10]
    };
  });
}

function saveMachine_(machine) {
  if (!machine.id) return;
  const sheet = SpreadsheetApp.getActive().getSheetByName(MACHINE_SHEET);
  const values = sheet.getDataRange().getValues();
  for (let i = 1; i < values.length; i += 1) {
    if (values[i][0] === machine.id) {
      sheet.getRange(i + 1, 1, 1, 5).setValues([[
        machine.id,
        machine.name || values[i][1],
        machine.targetWeight || '',
        machine.setupNotes || '',
        new Date()
      ]]);
      return;
    }
  }
  sheet.appendRow([machine.id, machine.name || machine.id, machine.targetWeight || '', machine.setupNotes || '', new Date()]);
}

function appendLog_(log) {
  if (!log.id) return;
  const sheet = SpreadsheetApp.getActive().getSheetByName(LOG_SHEET);
  sheet.appendRow([
    log.id,
    log.date || '',
    log.createdAt || new Date().toISOString(),
    log.profileName || '',
    log.machineId || '',
    log.machineName || '',
    log.weight || '',
    log.reps || '',
    log.effort || '',
    log.rir || '',
    log.note || ''
  ]);
}

function jsonp_(callback, data) {
  const safeCallback = String(callback).replace(/[^\w.$]/g, '');
  return ContentService
    .createTextOutput(`${safeCallback}(${JSON.stringify(data)});`)
    .setMimeType(ContentService.MimeType.JAVASCRIPT);
}

