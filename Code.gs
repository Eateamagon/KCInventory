// --- CONFIGURATION ---
var ALLOWED_USERS = ['etruslow@waynesboro.k12.va.us', 'ahenshaw@waynesboro.k12.va.us'];
var SHEET_ID = SpreadsheetApp.getActiveSpreadsheet().getId();

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
  var ss = SpreadsheetApp.openById(SHEET_ID);

  // 1. Get Inventory
  var invSheet = ss.getSheetByName("Inventory");
  // Assumes headers in row 1. Data starts row 2.
  // Columns: Teacher(A), Model(B), Slot(C), Serial(D), Status(E), ReplaceSerial(F), LastAudit(G)
  var invData = invSheet.getRange(2, 1, invSheet.getLastRow()-1, 7).getValues();

  // 2. Get Replacement Pool
  var poolSheet = ss.getSheetByName("Replacement_Pool");
  // Columns: Serial(A), Model(B), Status(C)
  var poolData = poolSheet.getRange(2, 1, poolSheet.getLastRow()-1, 3).getValues();

  // Filter for only AVAILABLE replacements, return serial + model for sorting/searching
  var availableReplacements = poolData
    .filter(function(row) { return row[2] === "Available"; })
    .map(function(row) { return { serial: row[0], model: row[1] }; });

  // 3. Get Teacher-Room mappings (sheet may not exist yet)
  var teacherRooms = {};
  var teacherSheet = ss.getSheetByName("Teachers");
  if (teacherSheet && teacherSheet.getLastRow() > 1) {
    // Columns: Name(A), Room(B)
    var teacherData = teacherSheet.getRange(2, 1, teacherSheet.getLastRow()-1, 2).getValues();
    teacherData.forEach(function(row) {
      if (row[0]) teacherRooms[row[0]] = row[1] || '';
    });
  }

  // Process Inventory into a nested object: { "TeacherName": [ {row data}, {row data} ] }
  var groupedData = {};
  invData.forEach(function(row, index) {
    var teacher = row[0];
    if (!groupedData[teacher]) groupedData[teacher] = [];

    groupedData[teacher].push({
      rowIndex: index + 2, // Store real sheet row number for updates
      teacher: row[0],
      model: row[1],
      slot: row[2],
      serial: row[3],
      status: row[4],
      replacement: row[5]
    });
  });

  return {
    inventory: groupedData,
    replacements: availableReplacements,
    teacherRooms: teacherRooms,
    user: Session.getActiveUser().getEmail()
  };
}

// --- API: SAVE TEACHER ---
function saveTeacher(formObject) {
  var ss = SpreadsheetApp.openById(SHEET_ID);

  // Create Teachers sheet if it doesn't exist
  var teacherSheet = ss.getSheetByName("Teachers");
  if (!teacherSheet) {
    teacherSheet = ss.insertSheet("Teachers");
    teacherSheet.appendRow(["Name", "Room"]);
    teacherSheet.getRange(1, 1, 1, 2).setFontWeight("bold");
  }

  var name = (formObject.teacherName || '').toString().trim();
  var room = (formObject.roomNumber || '').toString().trim();

  if (!name) return { status: "error", message: "Teacher name is required." };

  // Update existing row if the teacher already exists (case-insensitive)
  var data = teacherSheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (data[i][0].toString().toLowerCase() === name.toLowerCase()) {
      teacherSheet.getRange(i + 1, 1).setValue(name); // normalise capitalisation
      teacherSheet.getRange(i + 1, 2).setValue(room);
      return { status: "updated", teacher: name, room: room };
    }
  }

  // Otherwise append a new row
  teacherSheet.appendRow([name, room]);
  return { status: "added", teacher: name, room: room };
}

// --- API: DELETE TEACHER ---
function deleteTeacher(teacherName) {
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var teacherSheet = ss.getSheetByName("Teachers");
  if (!teacherSheet || teacherSheet.getLastRow() <= 1) return { status: "not_found" };

  var data = teacherSheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (data[i][0].toString().toLowerCase() === teacherName.toLowerCase()) {
      teacherSheet.deleteRow(i + 1);
      return { status: "deleted" };
    }
  }
  return { status: "not_found" };
}

// --- API: HANDLE UPDATE ---
function submitUpdate(formObject) {
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var invSheet = ss.getSheetByName("Inventory");
  var poolSheet = ss.getSheetByName("Replacement_Pool");
  
  var rowIndex = parseInt(formObject.rowIndex);
  var status = formObject.status;
  var newSerial = formObject.replacementSerial;
  
  // 1. Update Inventory Row
  // Column E is Status (5), Column F is Replacement (6), Column G is Audit (7)
  invSheet.getRange(rowIndex, 5).setValue(status);
  invSheet.getRange(rowIndex, 7).setValue(new Date()); // Timestamp
  
  if (newSerial && newSerial !== "") {
    invSheet.getRange(rowIndex, 6).setValue(newSerial);
    
    // 2. Update Pool Status (Find the replacement and mark Deployed)
    var poolData = poolSheet.getDataRange().getValues();
    for (var i = 0; i < poolData.length; i++) {
      if (poolData[i][0] == newSerial) { // Column A is Serial
        poolSheet.getRange(i + 1, 3).setValue("Deployed"); // Column C is Status
        break;
      }
    }
  }
  
  return "Success";
}

function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}
