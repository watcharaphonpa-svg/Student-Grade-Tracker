import express from "express";
import path from "path";
import { google } from "googleapis";
import cookieParser from "cookie-parser";
import dotenv from "dotenv";
import multer from "multer";
import { Readable } from "stream";
import fs from "fs";

dotenv.config();

const TOKENS_FILE = path.join(process.cwd(), "google_tokens.json");

const app = express();
const PORT = 3000;

app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));
app.use(cookieParser());

const oauth2Client = new google.auth.OAuth2();

function getOAuth2Client(req: express.Request) {
  let clientId = (process.env.GOOGLE_CLIENT_ID || "").trim();
  let clientSecret = (process.env.GOOGLE_CLIENT_SECRET || "").trim();
  
  let appUrl = (process.env.APP_URL || "").trim().replace(/[()]/g, "");
  if (appUrl && appUrl.startsWith("https:/") && !appUrl.startsWith("https://")) {
    appUrl = appUrl.replace("https:/", "https://");
  }

  let redirectUri = (process.env.GOOGLE_REDIRECT_URI || "").trim();
  if (!redirectUri) {
    if (appUrl) {
      redirectUri = `${appUrl}/api/auth/google/callback`;
    } else {
      const protocol = req.headers["x-forwarded-proto"] || "https";
      const host = req.headers.host;
      redirectUri = `${protocol}://${host}/api/auth/google/callback`;
    }
  }

  return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
}

const SCOPES = [
  "https://www.googleapis.com/auth/spreadsheets",
  "https://www.googleapis.com/auth/drive.file"
];

const upload = multer({ storage: multer.memoryStorage() });

// --- Routes ---
app.get("/api/health", (req, res) => {
  res.json({ status: "ok" });
});

app.get("/api/auth/google/url", (req, res) => {
  try {
    const client = getOAuth2Client(req);
    if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
      return res.status(500).json({ error: "Missing Google OAuth credentials" });
    }
    const url = client.generateAuthUrl({ access_type: "offline", scope: SCOPES, prompt: "consent" });
    res.json({ url });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.get(["/auth/google/callback", "/api/auth/google/callback"], async (req, res) => {
  const { code } = req.query;
  try {
    const client = getOAuth2Client(req);
    const { tokens } = await client.getToken(code as string);
    res.cookie("google_tokens", JSON.stringify(tokens), {
      httpOnly: true,
      secure: true,
      sameSite: "none",
      maxAge: 30 * 24 * 60 * 60 * 1000,
    });
    
    // Also backup tokens to local file system so students on separate devices can access teacher's storage fallback
    try {
      fs.writeFileSync(TOKENS_FILE, JSON.stringify(tokens), "utf8");
    } catch (saveError) {
      console.error("Failed to write TOKENS_FILE:", saveError);
    }
    
    res.send(`<html><body><script>if(window.opener){window.opener.postMessage({type:'OAUTH_AUTH_SUCCESS'},'*');window.close();}else{window.location.href='/';}</script></body></html>`);
  } catch (error) {
    res.status(500).send("Authentication failed");
  }
});

app.get("/api/auth/status", (req, res) => {
  const hasCookie = !!req.cookies.google_tokens;
  const hasFile = fs.existsSync(TOKENS_FILE);
  res.json({ isAuthenticated: hasCookie || hasFile });
});

app.post("/api/auth/logout", (req, res) => {
  res.clearCookie("google_tokens", { secure: true, sameSite: "none" });
  try {
    if (fs.existsSync(TOKENS_FILE)) {
      fs.unlinkSync(TOKENS_FILE);
    }
  } catch (err) {
    console.error("Failed to delete TOKENS_FILE on logout:", err);
  }
  res.json({ success: true });
});

app.post("/api/sheets/sync", async (req, res) => {
  const tokensStr = req.cookies.google_tokens || (fs.existsSync(TOKENS_FILE) ? fs.readFileSync(TOKENS_FILE, "utf8") : null);
  if (!tokensStr) return res.status(401).json({ error: "Not authenticated" });
  try {
    const tokens = JSON.parse(tokensStr);
    const client = getOAuth2Client(req);
    client.setCredentials(tokens);
    const sheets = google.sheets({ version: "v4", auth: client });
    const { students = [], submissions, spreadsheetId, sheetName, customSettings } = req.body;
    const drive = google.drive({ version: "v3", auth: client });
    const MASTER_FILE_NAME = "Student Grade Database";
    
    let targetSpreadsheetId = spreadsheetId;
    let targetSheetName = sheetName || "Sheet1";

    // 1. Find or Create Master Spreadsheet
    if (!targetSpreadsheetId) {
      try {
        const searchRes = await drive.files.list({
          q: `name = '${MASTER_FILE_NAME}' and mimeType = 'application/vnd.google-apps.spreadsheet' and trashed = false`,
          fields: "files(id, name)",
        });
        const existingFile = searchRes.data.files?.[0];
        if (existingFile) {
          targetSpreadsheetId = existingFile.id;
        } else {
          const spreadsheet = await sheets.spreadsheets.create({
            requestBody: { properties: { title: MASTER_FILE_NAME } },
          });
          targetSpreadsheetId = spreadsheet.data.spreadsheetId;
        }
      } catch (e) {
        return res.status(500).json({ error: "Failed to access Google Drive" });
      }
    }

    // 2. Verify spreadsheet and manage sheets (tabs)
    let spreadsheetData;
    try {
      spreadsheetData = await sheets.spreadsheets.get({ spreadsheetId: targetSpreadsheetId! });
    } catch (e) {
      return res.status(400).json({ error: "Invalid Spreadsheet ID" });
    }

    const sheetExists = spreadsheetData.data.sheets?.some(s => s.properties?.title === targetSheetName);
    if (!sheetExists) {
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId: targetSpreadsheetId!,
        requestBody: {
          requests: [{ addSheet: { properties: { title: targetSheetName } } }]
        }
      });
      spreadsheetData = await sheets.spreadsheets.get({ spreadsheetId: targetSpreadsheetId! });
    }

    const sheet = spreadsheetData.data.sheets?.find(s => s.properties?.title === targetSheetName);
    const sheetId = sheet?.properties?.sheetId || 0;

    // Clear existing cells in this sheet tab first to prevent residual text
    try {
      await sheets.spreadsheets.values.clear({
        spreadsheetId: targetSpreadsheetId!,
        range: `'${targetSheetName}'!A1:Z500`,
      });
    } catch (clearErr) {
      console.warn("Notice: Clear sheet values warning:", clearErr);
    }

    // 1. Reset sheet: Unmerge all previous merged cells, reset textRotation & formats across A1:Z300
    const batchRequests: any[] = [
      {
        unmergeCells: {
          range: { sheetId, startRowIndex: 0, endRowIndex: 300, startColumnIndex: 0, endColumnIndex: 26 }
        }
      },
      {
        repeatCell: {
          range: { sheetId, startRowIndex: 0, endRowIndex: 300, startColumnIndex: 0, endColumnIndex: 26 },
          cell: {
            userEnteredFormat: {
              backgroundColor: { red: 1, green: 1, blue: 1 },
              textFormat: { bold: false, fontSize: 10, foregroundColor: { red: 0, green: 0, blue: 0 } },
              textRotation: { angle: 0 },
              horizontalAlignment: "CENTER",
              verticalAlignment: "MIDDLE",
              wrapStrategy: "OVERFLOW"
            }
          },
          fields: "userEnteredFormat(backgroundColor,textFormat,textRotation,horizontalAlignment,verticalAlignment,wrapStrategy)"
        }
      },
      {
        updateDimensionProperties: {
          range: { sheetId, dimension: "ROWS", startIndex: 0, endIndex: 300 },
          properties: { pixelSize: 28 },
          fields: "pixelSize"
        }
      }
    ];

    // Clear existing values
    try {
      await sheets.spreadsheets.values.clear({
        spreadsheetId: targetSpreadsheetId!,
        range: `'${targetSheetName}'!A1:Z500`,
      });
    } catch (clearErr) {
      console.warn("Notice: Clear sheet values warning:", clearErr);
    }

    // Customization extraction
    const colOpts = customSettings?.columns || {
      no: true, studentId: true, name: true, behavior: true, attendance: true,
      assignment1: true, assignment2: true, assignment3: true, midterm: true,
      final: true, total: true, grade: true, status: true
    };

    const includeDroppedOut = customSettings?.includeDroppedOut ?? false;
    const includeFullScoreRow = customSettings?.includeFullScoreRow ?? true;
    const includeSummaryRows = customSettings?.includeSummaryRows ?? true;
    const institutionName = customSettings?.institutionName || "วิทยาลัยเทคโนโลยี / สถาบันการศึกษา";
    const headerNote = customSettings?.headerNote || "แบบบันทึกคะแนนและประเมินผลการเรียนรายวิชา";
    const customInstructor = customSettings?.customInstructor || "ครูผู้สอน";
    const academicYear = customSettings?.academicYear || "2569";
    const semester = customSettings?.semester || "1";

    // 3. Build Column Header Row
    const headerCols: string[] = [];
    if (colOpts.no) headerCols.push("ลำดับ");
    if (colOpts.studentId) headerCols.push("รหัสประจำตัว");
    if (colOpts.name) headerCols.push("ชื่อ-นามสกุล");
    if (colOpts.behavior) headerCols.push("จิตพิสัย");
    if (colOpts.attendance) headerCols.push("เวลาเรียน");
    if (colOpts.assignment1) headerCols.push("งานที่ 1 (15)");
    if (colOpts.assignment2) headerCols.push("งานที่ 2 (15)");
    if (colOpts.assignment3) headerCols.push("งานที่ 3 (15)");
    if (colOpts.midterm) headerCols.push("กลางภาค (15)");
    if (colOpts.final) headerCols.push("ปลายภาค (20)");
    if (colOpts.total) headerCols.push("รวมคะแนน (100)");
    if (colOpts.grade) headerCols.push("เกรด");
    if (colOpts.status) headerCols.push("สถานะ");

    const totalCols = Math.max(headerCols.length, 1);

    // Apply specific Column Widths
    headerCols.forEach((colName, colIdx) => {
      let width = 75;
      if (colName.includes("ลำดับ")) width = 55;
      else if (colName.includes("รหัส")) width = 125;
      else if (colName.includes("ชื่อ") || colName.includes("นามสกุล")) width = 230;
      else if (colName.includes("รวม") || colName.includes("100")) width = 95;
      else if (colName.includes("สถานะ")) width = 90;

      batchRequests.push({
        updateDimensionProperties: {
          range: { sheetId, dimension: "COLUMNS", startIndex: colIdx, endIndex: colIdx + 1 },
          properties: { pixelSize: width },
          fields: "pixelSize"
        }
      });
    });

    // Build Sheet Rows Array
    const allFormattedRows: any[] = [];

    // Title Metadata Rows (Row 0, 1, 2)
    const titleRow1 = new Array(totalCols).fill("");
    titleRow1[0] = institutionName;
    allFormattedRows.push({
      values: titleRow1.map((val) => ({
        userEnteredValue: { stringValue: String(val) },
        userEnteredFormat: {
          backgroundColor: { red: 30/255, green: 41/255, blue: 59/255 }, // Dark slate
          horizontalAlignment: "CENTER",
          verticalAlignment: "MIDDLE",
          textRotation: { angle: 0 },
          textFormat: { bold: true, fontSize: 12, foregroundColor: { red: 1, green: 1, blue: 1 } }
        }
      }))
    });

    const titleRow2 = new Array(totalCols).fill("");
    titleRow2[0] = `${headerNote} รายวิชา: ${targetSheetName}`;
    allFormattedRows.push({
      values: titleRow2.map((val) => ({
        userEnteredValue: { stringValue: String(val) },
        userEnteredFormat: {
          backgroundColor: { red: 51/255, green: 65/255, blue: 85/255 }, // Slate-700
          horizontalAlignment: "CENTER",
          verticalAlignment: "MIDDLE",
          textRotation: { angle: 0 },
          textFormat: { bold: true, fontSize: 10, foregroundColor: { red: 1, green: 1, blue: 1 } }
        }
      }))
    });

    const titleRow3 = new Array(totalCols).fill("");
    titleRow3[0] = `ภาคเรียนที่ ${semester}/${academicYear} | อาจารย์ผู้สอน: ${customInstructor}`;
    allFormattedRows.push({
      values: titleRow3.map((val) => ({
        userEnteredValue: { stringValue: String(val) },
        userEnteredFormat: {
          backgroundColor: { red: 241/255, green: 245/255, blue: 249/255 }, // Light slate
          horizontalAlignment: "CENTER",
          verticalAlignment: "MIDDLE",
          textRotation: { angle: 0 },
          textFormat: { bold: false, fontSize: 9.5, foregroundColor: { red: 51/255, green: 65/255, blue: 85/255 } }
        }
      }))
    });

    // Separator Row (Row 3)
    allFormattedRows.push({
      values: new Array(totalCols).fill({
        userEnteredValue: { stringValue: "" },
        userEnteredFormat: {
          backgroundColor: { red: 1, green: 1, blue: 1 },
          textRotation: { angle: 0 }
        }
      })
    });

    // Column Headers Row (Row 4)
    allFormattedRows.push({
      values: headerCols.map((colName) => ({
        userEnteredValue: { stringValue: colName },
        userEnteredFormat: {
          backgroundColor: { red: 226/255, green: 232/255, blue: 240/255 },
          horizontalAlignment: "CENTER",
          verticalAlignment: "MIDDLE",
          textRotation: { angle: 0 },
          textFormat: { bold: true, fontSize: 10, foregroundColor: { red: 15/255, green: 23/255, blue: 42/255 } }
        }
      }))
    });

    // Full Score Benchmark Row (Row 5)
    if (includeFullScoreRow) {
      const fullScoreVals: any[] = [];
      if (colOpts.no) fullScoreVals.push({ val: "-", type: "str" });
      if (colOpts.studentId) fullScoreVals.push({ val: "-", type: "str" });
      if (colOpts.name) fullScoreVals.push({ val: "คะแนนเต็ม", type: "str" });
      if (colOpts.behavior) fullScoreVals.push({ val: 10, type: "num" });
      if (colOpts.attendance) fullScoreVals.push({ val: 10, type: "num" });
      if (colOpts.assignment1) fullScoreVals.push({ val: 15, type: "num" });
      if (colOpts.assignment2) fullScoreVals.push({ val: 15, type: "num" });
      if (colOpts.assignment3) fullScoreVals.push({ val: 15, type: "num" });
      if (colOpts.midterm) fullScoreVals.push({ val: 15, type: "num" });
      if (colOpts.final) fullScoreVals.push({ val: 20, type: "num" });
      if (colOpts.total) fullScoreVals.push({ val: 100, type: "num" });
      if (colOpts.grade) fullScoreVals.push({ val: "4.0", type: "str" });
      if (colOpts.status) fullScoreVals.push({ val: "-", type: "str" });

      allFormattedRows.push({
        values: fullScoreVals.map((item) => ({
          userEnteredValue: item.type === "num" ? { numberValue: Number(item.val) } : { stringValue: String(item.val) },
          userEnteredFormat: {
            backgroundColor: { red: 254/255, green: 243/255, blue: 199/255 },
            horizontalAlignment: "CENTER",
            verticalAlignment: "MIDDLE",
            textRotation: { angle: 0 },
            textFormat: { bold: true, foregroundColor: { red: 146/255, green: 64/255, blue: 14/255 } }
          }
        }))
      });
    }

    // Filter Students
    const exportStudents = includeDroppedOut ? students : students.filter((s: any) => !s.isDroppedOut);

    // Student Data Rows
    exportStudents.forEach((s: any) => {
      const a1 = (s.assignment1?.part1 || 0) + (s.assignment1?.part2 || 0) + (s.assignment1?.part3 || 0);
      const a2 = (s.assignment2?.part1 || 0) + (s.assignment2?.part2 || 0) + (s.assignment2?.part3 || 0);
      const a3 = (s.assignment3?.part1 || 0) + (s.assignment3?.part2 || 0) + (s.assignment3?.part3 || 0);
      const total = calculateTotal(s);
      const grade = getGrade(total);
      const isDropped = Boolean(s.isDroppedOut);

      const studentVals: any[] = [];
      if (colOpts.no) studentVals.push({ val: s.no || "", type: "num" });
      if (colOpts.studentId) studentVals.push({ val: s.studentId || "", type: "str" });
      if (colOpts.name) studentVals.push({ val: s.name || "", type: "str", align: "LEFT" });
      if (colOpts.behavior) studentVals.push({ val: isDropped ? "-" : (s.behavior || 0), type: isDropped ? "str" : "num" });
      if (colOpts.attendance) studentVals.push({ val: isDropped ? "-" : (s.attendance || 0), type: isDropped ? "str" : "num" });
      if (colOpts.assignment1) studentVals.push({ val: isDropped ? "-" : a1, type: isDropped ? "str" : "num" });
      if (colOpts.assignment2) studentVals.push({ val: isDropped ? "-" : a2, type: isDropped ? "str" : "num" });
      if (colOpts.assignment3) studentVals.push({ val: isDropped ? "-" : a3, type: isDropped ? "str" : "num" });
      if (colOpts.midterm) studentVals.push({ val: isDropped ? "-" : (s.midterm || 0), type: isDropped ? "str" : "num" });
      if (colOpts.final) studentVals.push({ val: isDropped ? "-" : (s.final || 0), type: isDropped ? "str" : "num" });
      if (colOpts.total) studentVals.push({ val: isDropped ? "-" : total, type: isDropped ? "str" : "num", bold: true });
      if (colOpts.grade) studentVals.push({ val: isDropped ? "-" : grade, type: "str", bold: true });
      if (colOpts.status) studentVals.push({ val: isDropped ? "จำหน่ายออก" : "ปกติ", type: "str" });

      allFormattedRows.push({
        values: studentVals.map((item) => ({
          userEnteredValue: item.type === "num" ? { numberValue: Number(item.val) } : { stringValue: String(item.val) },
          userEnteredFormat: {
            backgroundColor: isDropped ? { red: 254/255, green: 226/255, blue: 226/255 } : { red: 1, green: 1, blue: 1 },
            horizontalAlignment: item.align || "CENTER",
            verticalAlignment: "MIDDLE",
            textRotation: { angle: 0 },
            textFormat: { bold: item.bold || false, color: isDropped ? { red: 190/255, green: 18/255, blue: 60/255 } : undefined }
          }
        }))
      });
    });

    // Summary Rows
    if (includeSummaryRows && exportStudents.filter((s: any) => !s.isDroppedOut).length > 0) {
      const activeOnly = exportStudents.filter((s: any) => !s.isDroppedOut);
      const totals = activeOnly.map((s: any) => calculateTotal(s));
      const avg = (totals.reduce((a: number, b: number) => a + b, 0) / activeOnly.length).toFixed(2);
      const maxScore = Math.max(...totals);
      const minScore = Math.min(...totals);

      // Blank separator
      allFormattedRows.push({
        values: new Array(totalCols).fill({
          userEnteredValue: { stringValue: "" },
          userEnteredFormat: { textRotation: { angle: 0 } }
        })
      });

      const avgVals = new Array(totalCols).fill({ userEnteredValue: { stringValue: "" }, userEnteredFormat: { textRotation: { angle: 0 } } });
      avgVals[0] = { userEnteredValue: { stringValue: "คะแนนเฉลี่ย (Average)" }, userEnteredFormat: { textFormat: { bold: true }, textRotation: { angle: 0 } } };
      if (colOpts.total) {
        const totalIdx = headerCols.indexOf("รวมคะแนน (100)");
        if (totalIdx !== -1) {
          avgVals[totalIdx] = { userEnteredValue: { numberValue: Number(avg) }, userEnteredFormat: { textFormat: { bold: true }, horizontalAlignment: "CENTER", textRotation: { angle: 0 } } };
        }
      }
      allFormattedRows.push({ values: avgVals });

      const maxVals = new Array(totalCols).fill({ userEnteredValue: { stringValue: "" }, userEnteredFormat: { textRotation: { angle: 0 } } });
      maxVals[0] = { userEnteredValue: { stringValue: "คะแนนสูงสุด (Max)" }, userEnteredFormat: { textFormat: { bold: true }, textRotation: { angle: 0 } } };
      if (colOpts.total) {
        const totalIdx = headerCols.indexOf("รวมคะแนน (100)");
        if (totalIdx !== -1) {
          maxVals[totalIdx] = { userEnteredValue: { numberValue: maxScore }, userEnteredFormat: { textFormat: { bold: true }, horizontalAlignment: "CENTER", textRotation: { angle: 0 } } };
        }
      }
      allFormattedRows.push({ values: maxVals });

      const minVals = new Array(totalCols).fill({ userEnteredValue: { stringValue: "" }, userEnteredFormat: { textRotation: { angle: 0 } } });
      minVals[0] = { userEnteredValue: { stringValue: "คะแนนต่ำสุด (Min)" }, userEnteredFormat: { textFormat: { bold: true }, textRotation: { angle: 0 } } };
      if (colOpts.total) {
        const totalIdx = headerCols.indexOf("รวมคะแนน (100)");
        if (totalIdx !== -1) {
          minVals[totalIdx] = { userEnteredValue: { numberValue: minScore }, userEnteredFormat: { textFormat: { bold: true }, horizontalAlignment: "CENTER", textRotation: { angle: 0 } } };
        }
      }
      allFormattedRows.push({ values: minVals });
    }

    // Set Specific Row Heights
    batchRequests.push(
      { updateDimensionProperties: { range: { sheetId, dimension: "ROWS", startIndex: 0, endIndex: 1 }, properties: { pixelSize: 34 }, fields: "pixelSize" } },
      { updateDimensionProperties: { range: { sheetId, dimension: "ROWS", startIndex: 1, endIndex: 2 }, properties: { pixelSize: 30 }, fields: "pixelSize" } },
      { updateDimensionProperties: { range: { sheetId, dimension: "ROWS", startIndex: 2, endIndex: 3 }, properties: { pixelSize: 26 }, fields: "pixelSize" } },
      { updateDimensionProperties: { range: { sheetId, dimension: "ROWS", startIndex: 3, endIndex: 4 }, properties: { pixelSize: 12 }, fields: "pixelSize" } },
      { updateDimensionProperties: { range: { sheetId, dimension: "ROWS", startIndex: 4, endIndex: 5 }, properties: { pixelSize: 36 }, fields: "pixelSize" } }
    );

    // Push updateCells to batch
    batchRequests.push(
      {
        updateCells: {
          range: { sheetId, startRowIndex: 0, endRowIndex: allFormattedRows.length, startColumnIndex: 0, endColumnIndex: totalCols },
          rows: allFormattedRows,
          fields: "userEnteredValue,userEnteredFormat(backgroundColor,horizontalAlignment,verticalAlignment,textFormat,textRotation)"
        }
      },
      {
        updateBorders: {
          range: { sheetId, startRowIndex: 4, endRowIndex: allFormattedRows.length, startColumnIndex: 0, endColumnIndex: totalCols },
          top: { style: "SOLID", width: 1, color: { red: 203/255, green: 213/255, blue: 225/255 } },
          bottom: { style: "SOLID", width: 1, color: { red: 203/255, green: 213/255, blue: 225/255 } },
          left: { style: "SOLID", width: 1, color: { red: 203/255, green: 213/255, blue: 225/255 } },
          right: { style: "SOLID", width: 1, color: { red: 203/255, green: 213/255, blue: 225/255 } },
          innerHorizontal: { style: "SOLID", width: 1, color: { red: 226/255, green: 232/255, blue: 240/255 } },
          innerVertical: { style: "SOLID", width: 1, color: { red: 226/255, green: 232/255, blue: 240/255 } },
        }
      }
    );

    // Merge title metadata rows across table width cleanly
    if (totalCols > 1) {
      batchRequests.push(
        { mergeCells: { range: { sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: totalCols }, mergeType: "MERGE_ALL" } },
        { mergeCells: { range: { sheetId, startRowIndex: 1, endRowIndex: 2, startColumnIndex: 0, endColumnIndex: totalCols }, mergeType: "MERGE_ALL" } },
        { mergeCells: { range: { sheetId, startRowIndex: 2, endRowIndex: 3, startColumnIndex: 0, endColumnIndex: totalCols }, mergeType: "MERGE_ALL" } }
      );
    }

    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: targetSpreadsheetId!,
      requestBody: { requests: batchRequests }
    });

    res.json({ success: true, spreadsheetId: targetSpreadsheetId, url: `https://docs.google.com/spreadsheets/d/${targetSpreadsheetId}` });
  } catch (error: any) {
    console.error("Sheets Sync Error:", error);
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/drive/upload", upload.single("file"), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "No file was uploaded." });
  }

  const tokensStr = req.cookies.google_tokens || (fs.existsSync(TOKENS_FILE) ? fs.readFileSync(TOKENS_FILE, "utf8") : null);
  const { studentId, assignmentId, studentName } = req.body;

  if (!tokensStr) {
    console.log("Student Upload: No Google tokens found. Depositing to local storage fallback...");
    try {
      const filename = `${Date.now()}_student_${studentId || 'unknown'}_${req.file.originalname}`;
      const filePath = path.join(UPLOADS_DIR, filename);
      fs.writeFileSync(filePath, req.file.buffer);

      const protocol = req.headers["x-forwarded-proto"] || "https";
      const host = req.headers.host;
      const downloadUrl = `${protocol}://${host}/api/uploads/${encodeURIComponent(filename)}`;

      console.log(`Student Upload: Successfully saved locally at '${filePath}'. URL: ${downloadUrl}`);
      return res.json({ success: true, url: downloadUrl, isLocal: true });
    } catch (err: any) {
      console.error("Student Upload: Local file saving failed.", err);
      return res.status(500).json({ error: `Local file saving failed: ${err.message}` });
    }
  }

  // Google Drive upload when authenticated
  try {
    const tokens = JSON.parse(tokensStr);
    const client = getOAuth2Client(req);
    client.setCredentials(tokens);
    const drive = google.drive({ version: "v3", auth: client });
    
    const fileName = `${studentId || 'unknown'}_${studentName || 'unknown'}_${assignmentId || 'unknown'}_${req.file.originalname}`;
    const file = await drive.files.create({
      requestBody: { name: fileName },
      media: { mimeType: req.file.mimetype, body: Readable.from(req.file.buffer) },
      fields: "id, webViewLink",
    });

    // Make the student file public so teachers and anyone can view it
    try {
      await drive.permissions.create({
        fileId: file.data.id!,
        requestBody: {
          role: "reader",
          type: "anyone",
        },
      });
      console.log(`Student Upload: Drive file ${file.data.id} made public.`);
    } catch (permError: any) {
      console.warn("Student Upload: Unable to make Drive file public:", permError.message);
    }

    res.json({ success: true, fileId: file.data.id, url: file.data.webViewLink });
  } catch (error: any) {
    console.warn(`Student Upload: Google Drive upload failed (${error.message}). Falling back to local storage...`);
    try {
      const filename = `${Date.now()}_student_${studentId || 'unknown'}_${req.file.originalname}`;
      const filePath = path.join(UPLOADS_DIR, filename);
      fs.writeFileSync(filePath, req.file.buffer);

      const protocol = req.headers["x-forwarded-proto"] || "https";
      const host = req.headers.host;
      const downloadUrl = `${protocol}://${host}/api/uploads/${encodeURIComponent(filename)}`;

      console.log(`Student Upload Fallback (Local): Successfully saved locally. URL: ${downloadUrl}`);
      res.json({ success: true, url: downloadUrl, isLocal: true, warn: error.message });
    } catch (err: any) {
      console.error("Student Upload Fallback: Saving locally failed.", err);
      res.status(500).json({ error: `Upload failed: ${error.message} | Local error: ${err.message}` });
    }
  }
});

const UPLOADS_DIR = "/tmp/uploads";
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

// Upload teaching materials - Supports both Google Drive (when authorized) and Local server storage as fallback
app.post("/api/drive/upload-material", upload.single("file"), async (req, res) => {
  if (!req.file) {
    console.error("Upload Material: No file present in request.");
    return res.status(400).json({ error: "No file was uploaded." });
  }

  console.log(`Upload Material: Received file '${req.file.originalname}' (${req.file.size} bytes, type: ${req.file.mimetype})`);

  const tokensStr = req.cookies.google_tokens || (fs.existsSync(TOKENS_FILE) ? fs.readFileSync(TOKENS_FILE, "utf8") : null);
  if (!tokensStr) {
    console.log("Upload Material: No Google tokens found. Depositing to local storage fallback...");
    // Local fallback when not logged in to Google Workspace
    try {
      const filename = `${Date.now()}_${req.file.originalname}`;
      const filePath = path.join(UPLOADS_DIR, filename);
      fs.writeFileSync(filePath, req.file.buffer);

      const protocol = req.headers["x-forwarded-proto"] || "https";
      const host = req.headers.host;
      const downloadUrl = `${protocol}://${host}/api/uploads/${encodeURIComponent(filename)}`;

      console.log(`Upload Material: Successfully saved locally at '${filePath}'. URL: ${downloadUrl}`);
      return res.json({ success: true, url: downloadUrl, isLocal: true });
    } catch (err: any) {
      console.error("Upload Material: Local file saving failed.", err);
      return res.status(500).json({ error: `Local file saving failed: ${err.message}` });
    }
  }

  // Google Drive upload when authenticated
  try {
    const tokens = JSON.parse(tokensStr);
    const client = getOAuth2Client(req);
    client.setCredentials(tokens);
    const drive = google.drive({ version: "v3", auth: client });

    console.log("Upload Material: Attempting Google Drive upload...");
    const file = await drive.files.create({
      requestBody: { name: req.file.originalname },
      media: { mimeType: req.file.mimetype, body: Readable.from(req.file.buffer) },
      fields: "id, webViewLink",
    });

    console.log(`Upload Material: Drive file created with ID: ${file.data.id}`);

    // Make the material public so students can access it
    try {
      await drive.permissions.create({
        fileId: file.data.id!,
        requestBody: {
          role: "reader",
          type: "anyone",
        },
      });
      console.log("Upload Material: File made public to anyone with link.");
    } catch (permError: any) {
      console.warn("Upload Material: Unable to make Drive file public:", permError.message);
    }

    const downloadUrl = file.data.webViewLink;
    console.log(`Upload Material: Google Drive upload successful. Link: ${downloadUrl}`);
    res.json({ success: true, fileId: file.data.id, url: downloadUrl, isLocal: false });
  } catch (error: any) {
    console.warn(`Upload Material: Google Drive upload failed (${error.message}). Falling back to local storage...`);
    // Google Drive fail fallback -> local upload
    try {
      const filename = `${Date.now()}_${req.file.originalname}`;
      const filePath = path.join(UPLOADS_DIR, filename);
      fs.writeFileSync(filePath, req.file.buffer);

      const protocol = req.headers["x-forwarded-proto"] || "https";
      const host = req.headers.host;
      const downloadUrl = `${protocol}://${host}/api/uploads/${encodeURIComponent(filename)}`;

      console.log(`Upload Material Fallback: Successfully saved locally at '${filePath}' after GDrive fail. URL: ${downloadUrl}`);
      return res.json({ success: true, url: downloadUrl, isLocal: true, warn: error.message });
    } catch (err: any) {
      console.error("Upload Material: Both Google Drive and Local Storage fallback failed.", err);
      res.status(500).json({ error: `Upload failed. Drive error: ${error.message} | Local storage error: ${err.message}` });
    }
  }
});

// Download endpoint for local upload fallback
app.get("/api/uploads/:filename", (req, res) => {
  const filepath = path.join(UPLOADS_DIR, req.params.filename);
  if (fs.existsSync(filepath)) {
    res.sendFile(filepath);
  } else {
    res.status(404).send("File not found");
  }
});

function calculateTotal(s: any) {
  const a1 = (s.assignment1?.part1 || 0) + (s.assignment1?.part2 || 0) + (s.assignment1?.part3 || 0);
  const a2 = (s.assignment2?.part1 || 0) + (s.assignment2?.part2 || 0) + (s.assignment2?.part3 || 0);
  const a3 = (s.assignment3?.part1 || 0) + (s.assignment3?.part2 || 0) + (s.assignment3?.part3 || 0);
  
  return (s.behavior || 0) + (s.attendance || 0) + a1 + a2 + a3 + (s.midterm || 0) + (s.final || 0);
}

function getGrade(t: number) {
  if (t >= 80) return "4.0"; if (t >= 75) return "3.5"; if (t >= 70) return "3.0";
  if (t >= 65) return "2.5"; if (t >= 60) return "2.0"; if (t >= 55) return "1.5";
  if (t >= 50) return "1.0"; return "0";
}

// Global Express Error Handler to prevent HTML error responses
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error("API Error:", err);
  res.status(err.status || 500).json({ error: err.message || "เกิดข้อผิดพลาดภายในเซิร์ฟเวอร์" });
});

export default app;
