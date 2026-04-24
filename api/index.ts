import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { google } from "googleapis";
import cookieParser from "cookie-parser";
import dotenv from "dotenv";
import multer from "multer";
import { Readable } from "stream";
import fs from "fs";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 3000;

app.use(express.json());
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
    res.send(`<html><body><script>if(window.opener){window.opener.postMessage({type:'OAUTH_AUTH_SUCCESS'},'*');window.close();}else{window.location.href='/';}</script></body></html>`);
  } catch (error) {
    res.status(500).send("Authentication failed");
  }
});

app.get("/api/auth/status", (req, res) => {
  res.json({ isAuthenticated: !!req.cookies.google_tokens });
});

app.post("/api/auth/logout", (req, res) => {
  res.clearCookie("google_tokens", { secure: true, sameSite: "none" });
  res.json({ success: true });
});

app.post("/api/sheets/sync", async (req, res) => {
  const tokensStr = req.cookies.google_tokens;
  if (!tokensStr) return res.status(401).json({ error: "Not authenticated" });
  try {
    const tokens = JSON.parse(tokensStr);
    const client = getOAuth2Client(req);
    client.setCredentials(tokens);
    const sheets = google.sheets({ version: "v4", auth: client });
    const { students, submissions, spreadsheetId, sheetName } = req.body;
    
    let targetSpreadsheetId = spreadsheetId;
    let targetSheetName = sheetName;

    // If we have an ID, verify the spreadsheet and get the correct sheet name
    if (targetSpreadsheetId) {
      try {
        const spreadsheet = await sheets.spreadsheets.get({ spreadsheetId: targetSpreadsheetId });
        if (!targetSheetName) {
          targetSheetName = spreadsheet.data.sheets?.[0].properties?.title || "Sheet1";
        }
      } catch (e) {
        // If ID is invalid, clear it to create a new one
        targetSpreadsheetId = null;
      }
    }

    if (!targetSpreadsheetId) {
      const spreadsheet = await sheets.spreadsheets.create({
        requestBody: { properties: { title: `Student Grade Tracker - ${new Date().toLocaleString('th-TH')}` } },
      });
      targetSpreadsheetId = spreadsheet.data.spreadsheetId;
      targetSheetName = spreadsheet.data.sheets?.[0].properties?.title || "Sheet1";
    }

    const rows = students.map((s: any) => {
      const a1 = (s.assignment1?.part1 || 0) + (s.assignment1?.part2 || 0) + (s.assignment1?.part3 || 0);
      const a2 = (s.assignment2?.part1 || 0) + (s.assignment2?.part2 || 0) + (s.assignment2?.part3 || 0);
      const a3 = (s.assignment3?.part1 || 0) + (s.assignment3?.part2 || 0) + (s.assignment3?.part3 || 0);
      const total = calculateTotal(s);
      const grade = getGrade(total);
      
      const studentFields = [
        { value: s.no || "", type: "number" },
        { value: s.studentId || "", type: "string" },
        { value: s.name || "", type: "string" },
        { value: s.behavior || 0, type: "number" },
        { value: s.attendance || 0, type: "number" },
        { value: a1, type: "number", fail: a1 === 0 },
        { value: a2, type: "number", fail: a2 === 0 },
        { value: a3, type: "number", fail: a3 === 0 },
        { value: s.midterm || 0, type: "number", fail: s.midterm === 0 },
        { value: s.final || 0, type: "number", fail: (s.final || 0) < 10 },
        { value: total, type: "number", bold: false },
        { value: grade, type: "number", bold: true }
      ];

      return {
        values: studentFields.map(f => ({
          userEnteredValue: f.type === "number" ? { numberValue: Number(f.value) } : { stringValue: String(f.value) },
          userEnteredFormat: {
            backgroundColor: f.fail ? { red: 1, green: 0, blue: 0 } : undefined,
            horizontalAlignment: "CENTER",
            verticalAlignment: "MIDDLE",
            textFormat: { bold: f.bold || false }
          }
        }))
      };
    });

    const headerData = [
      ["", "", "", "", "", "งานที่ 1", "งานที่ 2", "งานที่ 3", "", "", "", ""],
      ["เลขที่", "รหัสนักศึกษา", "ชื่อ-นามสกุล", "พฤติกรรม", "การมาเรียน", "รวม 15 คะแนน", "รวม 15 คะแนน", "รวม 15 คะแนน", "สอบกลางภาค", "สอบปลายภาค", "รวม 100 คะแนน", "เกรดเฉลี่ย"],
      ["", "", "", "10", "10", "", "", "", "15", "20", "", ""]
    ];

    const spreadsheetData = await sheets.spreadsheets.get({ spreadsheetId: targetSpreadsheetId! });
    const sheet = spreadsheetData.data.sheets?.find(s => s.properties?.title === targetSheetName);
    const sheetId = sheet?.properties?.sheetId || 0;

    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: targetSpreadsheetId!,
      requestBody: {
        requests: [
          {
            updateCells: {
              range: { sheetId, startRowIndex: 1, endRowIndex: 4, startColumnIndex: 0, endColumnIndex: 12 },
              rows: headerData.map((rowData, rIdx) => ({
                values: rowData.map((cellValue, cIdx) => ({
                  userEnteredValue: { stringValue: String(cellValue) },
                  userEnteredFormat: {
                    backgroundColor: 
                      (cIdx <= 2) ? { red: 249/255, green: 203/255, blue: 156/255 } : // Peach
                      (cIdx === 11) ? { red: 1, green: 1, blue: 0 } : // Yellow
                      { red: 1, green: 1, blue: 1 }, // White
                    horizontalAlignment: "CENTER",
                    verticalAlignment: "MIDDLE",
                    textFormat: { bold: true },
                    textRotation: (rIdx === 1 && (cIdx === 0 || cIdx === 1 || cIdx === 3 || cIdx === 4 || cIdx === 8 || cIdx === 9 || cIdx === 10 || cIdx === 11)) ? { angle: 90 } : undefined
                  }
                }))
              })),
              fields: "userEnteredValue,userEnteredFormat(backgroundColor,horizontalAlignment,verticalAlignment,textFormat,textRotation)"
            }
          },
          {
            updateCells: {
              range: { sheetId, startRowIndex: 4, endRowIndex: 4 + students.length, startColumnIndex: 0, endColumnIndex: 12 },
              rows: rows,
              fields: "userEnteredValue,userEnteredFormat(backgroundColor,horizontalAlignment,verticalAlignment,textFormat)"
            }
          },
          {
            updateBorders: {
              range: { sheetId, startRowIndex: 1, endRowIndex: 4 + students.length, startColumnIndex: 0, endColumnIndex: 12 },
              top: { style: "SOLID", width: 1, color: { red: 0, green: 0, blue: 0 } },
              bottom: { style: "SOLID", width: 1, color: { red: 0, green: 0, blue: 0 } },
              left: { style: "SOLID", width: 1, color: { red: 0, green: 0, blue: 0 } },
              right: { style: "SOLID", width: 1, color: { red: 0, green: 0, blue: 0 } },
              innerHorizontal: { style: "SOLID", width: 1, color: { red: 0, green: 0, blue: 0 } },
              innerVertical: { style: "SOLID", width: 1, color: { red: 0, green: 0, blue: 0 } },
            }
          },
          {
            updateDimensionProperties: {
              range: { sheetId, dimension: "COLUMNS", startIndex: 2, endIndex: 3 },
              properties: { pixelSize: 250 },
              fields: "pixelSize"
            }
          }
        ]
      }
    });

    res.json({ success: true, spreadsheetId: targetSpreadsheetId, url: `https://docs.google.com/spreadsheets/d/${targetSpreadsheetId}` });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/drive/upload", upload.single("file"), async (req, res) => {
  const tokensStr = req.cookies.google_tokens;
  if (!tokensStr || !req.file) return res.status(401).json({ error: "Missing tokens or file" });
  try {
    const tokens = JSON.parse(tokensStr);
    const client = getOAuth2Client(req);
    client.setCredentials(tokens);
    const drive = google.drive({ version: "v3", auth: client });
    const { studentId, assignmentId, studentName } = req.body;
    const fileName = `${studentId}_${studentName}_${assignmentId}_${req.file.originalname}`;
    const file = await drive.files.create({
      requestBody: { name: fileName },
      media: { mimeType: req.file.mimetype, body: Readable.from(req.file.buffer) },
      fields: "id, webViewLink",
    });
    res.json({ success: true, fileId: file.data.id, url: file.data.webViewLink });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
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

async function startServer() {
  if (process.env.NODE_ENV !== "production" && !process.env.VERCEL) {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({ server: { middlewareMode: true }, appType: "spa" });
    app.use(vite.middlewares);
  } else if (!process.env.VERCEL) {
    const distPath = path.join(process.cwd(), "dist");
    if (fs.existsSync(distPath)) {
      app.use(express.static(distPath));
      app.get("*", (r, s) => s.sendFile(path.join(distPath, "index.html")));
    }
  }
  if (!process.env.VERCEL) app.listen(PORT, "0.0.0.0", () => console.log(`Server on ${PORT}`));
}
startServer();

export default app;
