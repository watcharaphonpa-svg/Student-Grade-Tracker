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

// Export app for serverless environments (like Vercel)
export default app;

const oauth2Client = new google.auth.OAuth2();

function getOAuth2Client(req: express.Request) {
  const clientId = (process.env.GOOGLE_CLIENT_ID || "").trim();
  const clientSecret = (process.env.GOOGLE_CLIENT_SECRET || "").trim();
  
  // Try to determine the redirect URI dynamically if not set in ENV
  let redirectUri = process.env.GOOGLE_REDIRECT_URI;
  if (!redirectUri) {
    const protocol = req.headers["x-forwarded-proto"] || "http";
    const host = req.headers.host;
    redirectUri = `${protocol}://${host}/api/auth/google/callback`;
  }

  oauth2Client.setCredentials({
    // We only need the client config here for generating URLs
  });
  
  // Note: oauth2Client constructor parameters are preferred for full functionality
  // but we can update the config dynamically
  (oauth2Client as any)._clientId = clientId;
  (oauth2Client as any)._clientSecret = clientSecret;
  (oauth2Client as any).redirectUri = redirectUri;
  
  return oauth2Client;
}

const SCOPES = [
  "https://www.googleapis.com/auth/spreadsheets",
  "https://www.googleapis.com/auth/drive.file"
];

const upload = multer({ storage: multer.memoryStorage() });

// --- OAuth Routes ---

app.use((req, res, next) => {
  console.log(`${req.method} ${req.url}`);
  next();
});

app.get("/api/health", (req, res) => {
  res.json({ status: "ok", env: { 
    hasClientId: !!process.env.GOOGLE_CLIENT_ID,
    hasClientSecret: !!process.env.GOOGLE_CLIENT_SECRET,
    redirectUri: process.env.GOOGLE_REDIRECT_URI || "using-default"
  }});
});

app.get("/api/auth/google/url", (req, res) => {
  try {
    const client = getOAuth2Client(req);
    
    if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
      return res.status(500).json({ 
        error: "Missing Google OAuth credentials",
        details: "Please ensure GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are set in your environment variables (AI Studio Secrets or Vercel Environment Variables)."
      });
    }

    const url = client.generateAuthUrl({
      access_type: "offline",
      scope: SCOPES,
      prompt: "consent",
    });
    res.json({ url });
  } catch (error: any) {
    console.error("Error generating auth URL:", error);
    res.status(500).json({ error: "Failed to generate auth URL", details: error.message });
  }
});

app.get(["/auth/google/callback", "/auth/google/callback/", "/api/auth/google/callback"], async (req, res) => {
  const { code } = req.query;
  try {
    const client = getOAuth2Client(req);
    const { tokens } = await client.getToken(code as string);
    
    // Store tokens in a cookie
    res.cookie("google_tokens", JSON.stringify(tokens), {
      httpOnly: true,
      secure: true,
      sameSite: "none",
      maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
    });

    res.send(`
      <html>
        <body>
          <script>
            if (window.opener) {
              window.opener.postMessage({ type: 'OAUTH_AUTH_SUCCESS' }, '*');
              window.close();
            } else {
              window.location.href = '/';
            }
          </script>
          <p>Authentication successful. This window should close automatically.</p>
        </body>
      </html>
    `);
  } catch (error) {
    console.error("Error exchanging code for tokens:", error);
    res.status(500).send("Authentication failed");
  }
});

app.get("/api/auth/status", (req, res) => {
  const tokens = req.cookies.google_tokens;
  res.json({ isAuthenticated: !!tokens });
});

app.post("/api/auth/logout", (req, res) => {
  res.clearCookie("google_tokens", {
    secure: true,
    sameSite: "none",
  });
  res.json({ success: true });
});

// --- Sheets API Routes ---

app.post("/api/sheets/sync", async (req, res) => {
  const tokensStr = req.cookies.google_tokens;
  if (!tokensStr) {
    return res.status(401).json({ error: "Not authenticated" });
  }

  const tokens = JSON.parse(tokensStr);
  const client = getOAuth2Client(req);
  client.setCredentials(tokens);

  const { students, spreadsheetId, sheetName } = req.body;

  try {
    const sheets = google.sheets({ version: "v4", auth: oauth2Client });

    // If no spreadsheetId, create a new one
    let targetSpreadsheetId = spreadsheetId;
    let targetSheetName = sheetName || "Sheet1";

    if (!targetSpreadsheetId) {
      const spreadsheet = await sheets.spreadsheets.create({
        requestBody: {
          properties: {
            title: `Student Grade Tracker - ${new Date().toLocaleString('th-TH')}`,
          },
        },
      });
      targetSpreadsheetId = spreadsheet.data.spreadsheetId;
      // Get the actual name of the first sheet created
      if (spreadsheet.data.sheets && spreadsheet.data.sheets.length > 0) {
        targetSheetName = spreadsheet.data.sheets[0].properties?.title || "Sheet1";
      }
    }

    // Prepare data
    const header = [
      "เลขที่", "รหัสประจำตัว", "ชื่อ-นามสกุล", 
      "พฤติกรรม", "เข้าเรียน", 
      "งาน 1 (ส่วน 1)", "งาน 1 (ส่วน 2)", "งาน 1 (ส่วน 3)",
      "งาน 2 (ส่วน 1)", "งาน 2 (ส่วน 2)", "งาน 2 (ส่วน 3)",
      "งาน 3 (ส่วน 1)", "งาน 3 (ส่วน 2)", "งาน 3 (ส่วน 3)",
      "กลางภาค", "ปลายภาค", "รวม", "เกรด"
    ];

    const rows = students.map((s: any) => [
      s.no, s.studentId, s.name,
      s.behavior, s.attendance,
      s.assignment1.part1, s.assignment1.part2, s.assignment1.part3,
      s.assignment2.part1, s.assignment2.part2, s.assignment2.part3,
      s.assignment3.part1, s.assignment3.part2, s.assignment3.part3,
      s.midterm, s.final,
      calculateTotal(s),
      getGrade(calculateTotal(s))
    ]);

    const values = [header, ...rows];

    // Update the sheet
    await sheets.spreadsheets.values.update({
      spreadsheetId: targetSpreadsheetId!,
      range: `${targetSheetName}!A1`,
      valueInputOption: "RAW",
      requestBody: { values },
    });

    res.json({ 
      success: true, 
      spreadsheetId: targetSpreadsheetId,
      url: `https://docs.google.com/spreadsheets/d/${targetSpreadsheetId}`
    });
  } catch (error: any) {
    console.error("Sheets API error:", error);
    res.status(500).json({ error: error.message });
  }
});

// --- Drive API Routes ---

app.post("/api/drive/upload", upload.single("file"), async (req, res) => {
  const tokensStr = req.cookies.google_tokens;
  if (!tokensStr) {
    return res.status(401).json({ error: "Not authenticated" });
  }

  if (!req.file) {
    return res.status(400).json({ error: "No file uploaded" });
  }

  const tokens = JSON.parse(tokensStr);
  const client = getOAuth2Client(req);
  client.setCredentials(tokens);

  try {
    const drive = google.drive({ version: "v3", auth: client });
    
    const { studentId, assignmentId, studentName } = req.body;
    console.log('Server: Receiving upload request from:', studentId, studentName);
    
    const fileName = `${studentId}_${studentName}_${assignmentId}_${req.file.originalname}`;
    console.log('Server: Uploading as:', fileName);

    const fileMetadata = {
      name: fileName,
      // Optional: You could create a specific folder for assignments
    };

    const media = {
      mimeType: req.file.mimetype,
      body: Readable.from(req.file.buffer),
    };

    const file = await drive.files.create({
      requestBody: fileMetadata,
      media: media,
      fields: "id, webViewLink",
    });

    res.json({ 
      success: true, 
      fileId: file.data.id,
      url: file.data.webViewLink 
    });
  } catch (error: any) {
    console.error("Drive API error:", error);
    res.status(500).json({ error: error.message });
  }
});

// Helper functions (mirrored from frontend for server-side calculation if needed)
function calculateTotal(student: any) {
  const a1 = (student.assignment1?.part1 || 0) + (student.assignment1?.part2 || 0) + (student.assignment1?.part3 || 0);
  const a2 = (student.assignment2?.part1 || 0) + (student.assignment2?.part2 || 0) + (student.assignment2?.part3 || 0);
  const a3 = (student.assignment3?.part1 || 0) + (student.assignment3?.part2 || 0) + (student.assignment3?.part3 || 0);
  return (student.behavior || 0) + (student.attendance || 0) + a1 + a2 + a3 + (student.midterm || 0) + (student.final || 0);
}

function getGrade(total: number) {
  const scale = [
    { min: 80, grade: '4.0' }, { min: 75, grade: '3.5' }, { min: 70, grade: '3.0' },
    { min: 65, grade: '2.5' }, { min: 60, grade: '2.0' }, { min: 55, grade: '1.5' },
    { min: 50, grade: '1.0' }, { min: 0, grade: '0' },
  ];
  for (const s of scale) { if (total >= s.min) return s.grade; }
  return '0';
}

// --- Vite Middleware ---

async function startServer() {
  // Only use Vite middleware in local development (AI Studio)
  if (process.env.NODE_ENV !== "production" && !process.env.VERCEL) {
    try {
      const { createServer: createViteServer } = await import("vite");
      const vite = await createViteServer({
        server: { middlewareMode: true },
        appType: "spa",
      });
      app.use(vite.middlewares);
    } catch (e) {
      console.error("Failed to start Vite server:", e);
    }
  } else {
    const distPath = path.join(process.cwd(), "dist");
    if (fs.existsSync(distPath)) {
      app.use(express.static(distPath));
      app.get("*", (req, res) => {
        res.sendFile(path.join(distPath, "index.html"));
      });
    }
  }

  // Only start listening if not in a serverless environment (like Vercel)
  if (!process.env.VERCEL) {
    app.listen(PORT, "0.0.0.0", () => {
      console.log(`Server running on http://localhost:${PORT}`);
    });
  }
}

startServer();
