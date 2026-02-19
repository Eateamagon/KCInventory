// --- CONFIGURATION ---
var ALLOWED_USERS = ['etruslow@waynesboro.k12.va.us', 'ahenshaw@waynesboro.k12.va.us'];
var SHEET_ID = SpreadsheetApp.getActiveSpreadsheet().getId();

// --- CONSTANTS ---
var SHEET_NAME_INVENTORY = "Inventory";
var SHEET_NAME_REPLACEMENT_POOL = "Replacement_Pool";
var SHEET_NAME_TEACHERS = "Teachers";
var SHEET_NAME_AUDIT_LOG = "Audit_Log";

// --- ERROR HANDLING HELPER ---
function safeExecute(fn) {
  try {
    return fn();
  } catch (e) {
    Logger.log('Error: ' + e.message + ' | Stack: ' + (e.stack || ''));
    throw new Error(e.message || 'An unexpected error occurred.');
  }
}

// --- CACHE HELPERS ---
var CACHE_TTL = 300; // 5 minutes
var CACHE_KEY = 'appData';

function getCachedAppData() {
  try {
    var cached = CacheService.getScriptCache().get(CACHE_KEY);
    return cached ? JSON.parse(cached) : null;
  } catch (e) {
    Logger.log('Cache read error: ' + e.message);
    return null;
  }
}

function setCachedAppData(data) {
  try {
    var json = JSON.stringify(data);
    if (json.length <= 100000) {
      CacheService.getScriptCache().put(CACHE_KEY, json, CACHE_TTL);
    }
  } catch (e) {
    Logger.log('Cache write error: ' + e.message);
  }
}

function invalidateCache() {
  try {
    CacheService.getScriptCache().remove(CACHE_KEY);
  } catch (e) {
    Logger.log('Cache invalidation error: ' + e.message);
  }
}

// --- AUDIT LOGGING ---
function logAudit(action, target, details) {
  try {
    var ss = SpreadsheetApp.openById(SHEET_ID);
    var logSheet = ss.getSheetByName(SHEET_NAME_AUDIT_LOG);

    if (!logSheet) {
      logSheet = ss.insertSheet(SHEET_NAME_AUDIT_LOG);
      logSheet.appendRow(["Timestamp", "User", "Action", "Target", "Details"]);
      logSheet.getRange(1, 1, 1, 5).setFontWeight("bold");
      logSheet.setColumnWidth(1, 160);
      logSheet.setColumnWidth(5, 400);
    }

    var user = Session.getActiveUser().getEmail() || 'unknown';
    logSheet.appendRow([new Date(), user, action, target, details]);
  } catch (e) {
    // Audit logging should never break the main operation
    Logger.log('Audit log error: ' + e.message);
  }
}

function doGet() {
  var user = Session.getActiveUser().getEmail();

  // Security Check
  if (ALLOWED_USERS.indexOf(user) === -1) {
    return HtmlService.createHtmlOutput("<h3>Access Denied</h3><p>You are not authorized to view this application.</p>");
  }

  return HtmlService.createTemplateFromFile('Index')
      .evaluate()
      .setTitle('KCMS Chromebook Tracker')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
      .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

// --- API: GET DATA ---
function getAppData() {
  return safeExecute(function() {
    // Check cache first for fast path
    var cached = getCachedAppData();
    if (cached) {
      cached.user = Session.getActiveUser().getEmail();
      return cached;
    }

    var ss = SpreadsheetApp.openById(SHEET_ID);

    // 1. Get Inventory
    var invSheet = ss.getSheetByName(SHEET_NAME_INVENTORY);
    if (!invSheet) throw new Error("Inventory sheet not found. Please check your spreadsheet.");

    var invData = [];
    if (invSheet.getLastRow() > 1) {
      invData = invSheet.getRange(2, 1, invSheet.getLastRow() - 1, 7).getValues();
    }

    // 2. Get Replacement Pool
    var poolSheet = ss.getSheetByName(SHEET_NAME_REPLACEMENT_POOL);
    if (!poolSheet) throw new Error("Replacement_Pool sheet not found. Please check your spreadsheet.");

    var poolData = [];
    if (poolSheet.getLastRow() > 1) {
      poolData = poolSheet.getRange(2, 1, poolSheet.getLastRow() - 1, 3).getValues();
    }

    // Filter for only AVAILABLE replacements
    var availableReplacements = poolData
      .filter(function(row) { return row[2] === "Available"; })
      .map(function(row) { return { serial: row[0], model: row[1] }; });

    // 3. Get Chromecart-Room mappings (sheet may not exist yet)
    var teacherRooms = {};
    var teacherSheet = ss.getSheetByName(SHEET_NAME_TEACHERS);
    if (teacherSheet && teacherSheet.getLastRow() > 1) {
      var teacherData = teacherSheet.getRange(2, 1, teacherSheet.getLastRow() - 1, 3).getValues();
      teacherData.forEach(function(row) {
        if (row[0]) teacherRooms[row[0]] = { room: row[1] || '', cartNumber: String(row[2] || '') };
      });
    }

    // Process Inventory into nested object
    var groupedData = {};
    invData.forEach(function(row, index) {
      var teacher = row[0];
      if (!groupedData[teacher]) groupedData[teacher] = [];

      groupedData[teacher].push({
        rowIndex: index + 2,
        teacher: row[0],
        model: row[1],
        slot: row[2],
        serial: row[3],
        status: row[4],
        replacement: row[5]
      });
    });

    var result = {
      inventory: groupedData,
      replacements: availableReplacements,
      teacherRooms: teacherRooms
    };

    // Store in cache (without user field, as that varies per user)
    setCachedAppData(result);

    result.user = Session.getActiveUser().getEmail();
    return result;
  });
}

// --- API: SAVE TEACHER ---
function saveTeacher(formObject) {
  return safeExecute(function() {
    var ss = SpreadsheetApp.openById(SHEET_ID);

    var teacherSheet = ss.getSheetByName(SHEET_NAME_TEACHERS);
    if (!teacherSheet) {
      teacherSheet = ss.insertSheet(SHEET_NAME_TEACHERS);
      teacherSheet.appendRow(["Name", "Room", "Cart Number"]);
      teacherSheet.getRange(1, 1, 1, 3).setFontWeight("bold");
    }

    var name = (formObject.teacherName || '').toString().trim();
    var room = (formObject.roomNumber || '').toString().trim();
    var cartNumber = (formObject.cartNumber || '').toString().trim();

    if (!name) return { status: "error", message: "Cart name is required." };
    if (name.length > 100) return { status: "error", message: "Cart name is too long." };
    if (room.length > 20) return { status: "error", message: "Room number is too long." };

    // Update existing row if chromecart already exists (case-insensitive)
    var data = teacherSheet.getDataRange().getValues();
    for (var i = 1; i < data.length; i++) {
      if (data[i][0].toString().toLowerCase() === name.toLowerCase()) {
        teacherSheet.getRange(i + 1, 1).setValue(name);
        teacherSheet.getRange(i + 1, 2).setValue(room);
        teacherSheet.getRange(i + 1, 3).setValue(cartNumber);
        logAudit('Chromecart Updated', name, 'Room: ' + (room || '(none)') + ', Cart #' + (cartNumber || '(none)'));
        invalidateCache();
        return { status: "updated", teacher: name, room: room, cartNumber: cartNumber };
      }
    }

    // Otherwise append a new row
    teacherSheet.appendRow([name, room, cartNumber]);
    logAudit('Chromecart Added', name, 'Room: ' + (room || '(none)') + ', Cart #' + (cartNumber || '(none)'));
    invalidateCache();
    return { status: "added", teacher: name, room: room, cartNumber: cartNumber };
  });
}

// --- API: DELETE TEACHER ---
function deleteTeacher(teacherName) {
  return safeExecute(function() {
    if (!teacherName || !teacherName.toString().trim()) {
      return { status: "error", message: "Cart name is required." };
    }

    var ss = SpreadsheetApp.openById(SHEET_ID);
    var teacherSheet = ss.getSheetByName(SHEET_NAME_TEACHERS);
    if (!teacherSheet || teacherSheet.getLastRow() <= 1) return { status: "not_found" };

    var data = teacherSheet.getDataRange().getValues();
    for (var i = 1; i < data.length; i++) {
      if (data[i][0].toString().toLowerCase() === teacherName.toLowerCase()) {
        teacherSheet.deleteRow(i + 1);
        logAudit('Chromecart Deleted', teacherName, 'Chromecart removed from system');
        invalidateCache();
        return { status: "deleted" };
      }
    }
    return { status: "not_found" };
  });
}

// --- API: UPDATE CHROMECART (full edit with devices) ---
function updateChromecart(data) {
  return safeExecute(function() {
    var ss = SpreadsheetApp.openById(SHEET_ID);
    var originalName = (data.originalName || '').toString().trim();
    var name = (data.name || '').toString().trim();
    var room = (data.room || '').toString().trim();
    var cartNumber = (data.cartNumber || '').toString().trim();
    var devices = data.devices || [];
    var deletedRows = data.deletedRows || [];

    if (!name) throw new Error("Cart name is required.");

    // 1. Update Teachers sheet
    var teacherSheet = ss.getSheetByName(SHEET_NAME_TEACHERS);
    if (teacherSheet && teacherSheet.getLastRow() > 1) {
      var tData = teacherSheet.getDataRange().getValues();
      for (var i = 1; i < tData.length; i++) {
        if (tData[i][0].toString().toLowerCase() === originalName.toLowerCase()) {
          teacherSheet.getRange(i + 1, 1).setValue(name);
          teacherSheet.getRange(i + 1, 2).setValue(room);
          teacherSheet.getRange(i + 1, 3).setValue(cartNumber);
          break;
        }
      }
    }

    var invSheet = ss.getSheetByName(SHEET_NAME_INVENTORY);
    if (!invSheet) throw new Error("Inventory sheet not found.");

    // 2. If name changed, update all inventory rows
    if (originalName.toLowerCase() !== name.toLowerCase() && invSheet.getLastRow() > 1) {
      var invData = invSheet.getRange(2, 1, invSheet.getLastRow() - 1, 1).getValues();
      for (var j = 0; j < invData.length; j++) {
        if (invData[j][0].toString().toLowerCase() === originalName.toLowerCase()) {
          invSheet.getRange(j + 2, 1).setValue(name);
        }
      }
    }

    // 3. Delete removed device rows (highest index first to preserve positions)
    var sortedDeleted = deletedRows.slice().sort(function(a, b) { return b - a; });
    for (var d = 0; d < sortedDeleted.length; d++) {
      var rowIdx = parseInt(sortedDeleted[d], 10);
      if (!isNaN(rowIdx) && rowIdx >= 2 && rowIdx <= invSheet.getLastRow()) {
        invSheet.deleteRow(rowIdx);
      }
    }

    // 4. Update existing / add new device rows
    for (var k = 0; k < devices.length; k++) {
      var dev = devices[k];
      var slot = (dev.slot || '').toString().trim();
      var serial = (dev.serial || '').toString().trim();
      var model = (dev.model || '').toString().trim();

      if (dev.rowIndex) {
        // Update existing row
        var ri = parseInt(dev.rowIndex, 10);
        if (!isNaN(ri) && ri >= 2) {
          invSheet.getRange(ri, 2).setValue(model);
          invSheet.getRange(ri, 3).setValue(slot);
          invSheet.getRange(ri, 4).setValue(serial);
          invSheet.getRange(ri, 7).setValue(new Date());
        }
      } else if (slot || serial) {
        // Add new device row
        invSheet.appendRow([name, model, slot, serial, "Working", "", new Date()]);
      }
    }

    logAudit('Chromecart Updated', name, 'Full edit: Room ' + (room || '(none)') + ', Cart #' + (cartNumber || '(none)') + ', ' + devices.length + ' devices, ' + deletedRows.length + ' removed');
    invalidateCache();
    return { status: "success" };
  });
}

// --- API: HANDLE UPDATE ---
function submitUpdate(formObject) {
  return safeExecute(function() {
    var ss = SpreadsheetApp.openById(SHEET_ID);
    var invSheet = ss.getSheetByName(SHEET_NAME_INVENTORY);
    if (!invSheet) throw new Error("Inventory sheet not found.");

    var rowIndex = parseInt(formObject.rowIndex, 10);
    if (isNaN(rowIndex) || rowIndex < 2 || rowIndex > invSheet.getLastRow()) {
      throw new Error("Invalid row reference. The data may have changed. Please reload.");
    }

    var status = (formObject.status || '').toString().trim();
    if (status !== 'Working' && status !== 'Broken') {
      throw new Error("Invalid status value.");
    }

    var newSerial = (formObject.replacementSerial || '').toString().trim();
    var isCustom = formObject.isCustomSerial === 'true';

    // 1. Update Inventory Row
    invSheet.getRange(rowIndex, 5).setValue(status);
    invSheet.getRange(rowIndex, 7).setValue(new Date());

    if (newSerial && newSerial !== "") {
      invSheet.getRange(rowIndex, 6).setValue(newSerial);

      // 2. Only mark as Deployed in pool if serial came from the pool
      if (!isCustom) {
        var poolSheet = ss.getSheetByName(SHEET_NAME_REPLACEMENT_POOL);
        if (poolSheet && poolSheet.getLastRow() > 1) {
          var poolData = poolSheet.getDataRange().getValues();
          for (var i = 0; i < poolData.length; i++) {
            if (poolData[i][0] == newSerial) {
              poolSheet.getRange(i + 1, 3).setValue("Deployed");
              break;
            }
          }
        }
      }
    }

    // 3. Audit log with context
    var currentRow = invSheet.getRange(rowIndex, 1, 1, 7).getValues()[0];
    var targetDesc = currentRow[0] + ' / ' + currentRow[2] + ' (' + currentRow[3] + ')';
    var detailsMsg = 'Status set to ' + status;
    if (newSerial) {
      detailsMsg += '. Replacement assigned: ' + newSerial + (isCustom ? ' (custom)' : ' (from pool)');
    }
    logAudit('Status Update', targetDesc, detailsMsg);

    invalidateCache();
    return "Success";
  });
}

// --- API: GET AUDIT LOG ---
function getAuditLog(count) {
  return safeExecute(function() {
    var ss = SpreadsheetApp.openById(SHEET_ID);
    var logSheet = ss.getSheetByName(SHEET_NAME_AUDIT_LOG);

    if (!logSheet || logSheet.getLastRow() <= 1) {
      return [];
    }

    var numRows = logSheet.getLastRow() - 1;
    var limit = Math.min(parseInt(count, 10) || 50, 200);
    var startRow = Math.max(2, logSheet.getLastRow() - limit + 1);
    var rowCount = logSheet.getLastRow() - startRow + 1;

    var data = logSheet.getRange(startRow, 1, rowCount, 5).getValues();

    // Return in reverse chronological order (newest first)
    var entries = [];
    for (var i = data.length - 1; i >= 0; i--) {
      entries.push({
        timestamp: data[i][0],
        user: data[i][1],
        action: data[i][2],
        target: data[i][3],
        details: data[i][4]
      });
    }

    return entries;
  });
}

function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}
