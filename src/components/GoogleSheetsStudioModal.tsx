import React, { useState } from 'react';
import { 
  FileSpreadsheet, Download, Copy, Check, Image, Building, User, 
  Settings, X, Cloud, CloudCheck, Eye, Layers, Rows, Table,
  CheckCircle2, Sparkles, Upload, FileText, AlertCircle, RefreshCw
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import * as XLSX from 'xlsx';

interface Student {
  id: string;
  no: string;
  studentId: string;
  name: string;
  behavior: number;
  attendance: number;
  assignment1: { part1: number; part2: number; part3: number };
  assignment2: { part1: number; part2: number; part3: number };
  assignment3: { part1: number; part2: number; part3: number };
  midterm: number;
  final: number;
  isDroppedOut?: boolean;
}

interface Subject {
  id: string;
  code: string;
  name: string;
  credits: number;
}

interface ClassRoom {
  id: string;
  name: string;
  level: string;
}

interface GoogleSheetsStudioModalProps {
  isOpen: boolean;
  onClose: () => void;
  students: Student[];
  currentSubject?: Subject;
  currentClass?: ClassRoom;
  teacherName?: string;
  isGoogleAuth: boolean;
  spreadsheetUrl: string | null;
  onSyncSheets: (customSettings?: any) => Promise<void>;
  showAlert: (title: string, message: string, type?: 'success' | 'error' | 'warning' | 'info') => void;
}

export function GoogleSheetsStudioModal({
  isOpen,
  onClose,
  students,
  currentSubject,
  currentClass,
  teacherName = 'ครูผู้สอน',
  isGoogleAuth,
  spreadsheetUrl,
  onSyncSheets,
  showAlert
}: GoogleSheetsStudioModalProps) {
  // Document and Header Customization States
  const [fileName, setFileName] = useState<string>(
    `ใบคะแนน_${currentSubject?.code || 'SUBJECT'}_${currentClass?.name || 'CLASS'}`
  );
  const [sheetName, setSheetName] = useState<string>(
    `${currentSubject?.name || 'รายวิชา'} - ${currentClass?.name || 'ห้องเรียน'}`
  );
  
  // Header Details
  const [institutionName, setInstitutionName] = useState<string>('วิทยาลัยเทคโนโลยี / สถาบันการศึกษา');
  const [academicYear, setAcademicYear] = useState<string>('2569');
  const [semester, setSemester] = useState<string>('1');
  const [customInstructor, setCustomInstructor] = useState<string>(teacherName);
  const [headerNote, setHeaderNote] = useState<string>('แบบบันทึกคะแนนและประเมินผลการเรียนรายวิชา');

  // Institute Logo Settings
  const [showLogo, setShowLogo] = useState<boolean>(true);
  const [logoPosition, setLogoPosition] = useState<'top-left' | 'center'>('top-left');
  const [logoUrl, setLogoUrl] = useState<string>('https://images.unsplash.com/photo-1592280771190-3e2e4d571952?w=150&auto=format&fit=crop&q=80');
  const [logoSize, setLogoSize] = useState<'small' | 'medium' | 'large'>('medium');

  // Columns Options
  const [columns, setColumns] = useState({
    no: true,
    studentId: true,
    name: true,
    behavior: true,
    attendance: true,
    assignment1: true,
    assignment2: true,
    assignment3: true,
    midterm: true,
    final: true,
    total: true,
    grade: true,
    status: true,
  });

  // Row and Display Options
  const [includeDroppedOut, setIncludeDroppedOut] = useState<boolean>(false);
  const [includeFullScoreRow, setIncludeFullScoreRow] = useState<boolean>(true);
  const [includeSummaryRows, setIncludeSummaryRows] = useState<boolean>(true);
  const [includeSignatureBlock, setIncludeSignatureBlock] = useState<boolean>(true);

  // Active Tab for Modal UI
  const [activeTab, setActiveTab] = useState<'header' | 'columns' | 'rows' | 'preview'>('header');
  const [isCopied, setIsCopied] = useState<boolean>(false);
  const [isSyncingLocal, setIsSyncingLocal] = useState<boolean>(false);

  // Filtered Students according to settings
  const exportStudents = React.useMemo(() => {
    if (includeDroppedOut) return students;
    return students.filter(s => !s.isDroppedOut);
  }, [students, includeDroppedOut]);

  // Helpers for score calculation
  const calculateTotal = (s: Student) => {
    if (s.isDroppedOut) return 0;
    const a1 = (s.assignment1?.part1 || 0) + (s.assignment1?.part2 || 0) + (s.assignment1?.part3 || 0);
    const a2 = (s.assignment2?.part1 || 0) + (s.assignment2?.part2 || 0) + (s.assignment2?.part3 || 0);
    const a3 = (s.assignment3?.part1 || 0) + (s.assignment3?.part2 || 0) + (s.assignment3?.part3 || 0);
    return (s.behavior || 0) + (s.attendance || 0) + a1 + a2 + a3 + (s.midterm || 0) + (s.final || 0);
  };

  const getGrade = (t: number) => {
    if (t >= 80) return "4.0"; if (t >= 75) return "3.5"; if (t >= 70) return "3.0";
    if (t >= 65) return "2.5"; if (t >= 60) return "2.0"; if (t >= 55) return "1.5";
    if (t >= 50) return "1.0"; return "0";
  };

  // Custom Logo File Upload
  const handleLogoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        if (event.target?.result) {
          setLogoUrl(event.target.result as string);
        }
      };
      reader.readAsDataURL(file);
    }
  };

  // Copy Formatted Data for Google Sheets Paste (HTML / TSV)
  const handleCopyForSheets = () => {
    const activeStudents = exportStudents;
    
    let htmlContent = `
      <table border="1" style="border-collapse:collapse; font-family:sans-serif; text-align:center;">
        <tr>
          <td colspan="12" style="font-weight:bold; font-size:16px; background-color:#f1f5f9; padding:8px;">${institutionName}</td>
        </tr>
        <tr>
          <td colspan="12" style="font-weight:bold; font-size:14px; padding:6px;">${headerNote} รายวิชา ${currentSubject?.code || ''} ${currentSubject?.name || ''}</td>
        </tr>
        <tr>
          <td colspan="12" style="padding:4px; font-size:12px;">ระดับชั้น/ห้อง: ${currentClass?.name || '-'} | ภาคเรียนที่ ${semester}/${academicYear} | อาจารย์ผู้สอน: ${customInstructor}</td>
        </tr>
        <tr style="background-color:#e2e8f0; font-weight:bold;">
          ${columns.no ? '<th>ลำดับ</th>' : ''}
          ${columns.studentId ? '<th>รหัสประจำตัว</th>' : ''}
          ${columns.name ? '<th>ชื่อ-นามสกุล</th>' : ''}
          ${columns.behavior ? '<th>จิตพิสัย</th>' : ''}
          ${columns.attendance ? '<th>เวลาเรียน</th>' : ''}
          ${columns.assignment1 ? '<th>งานที่ 1</th>' : ''}
          ${columns.assignment2 ? '<th>งานที่ 2</th>' : ''}
          ${columns.assignment3 ? '<th>งานที่ 3</th>' : ''}
          ${columns.midterm ? '<th>กลางภาค</th>' : ''}
          ${columns.final ? '<th>ปลายภาค</th>' : ''}
          ${columns.total ? '<th>รวมคะแนน</th>' : ''}
          ${columns.grade ? '<th>เกรด</th>' : ''}
          ${columns.status ? '<th>สถานะ</th>' : ''}
        </tr>
    `;

    if (includeFullScoreRow) {
      htmlContent += `
        <tr style="background-color:#fef3c7; font-weight:bold;">
          ${columns.no ? '<td>-</td>' : ''}
          ${columns.studentId ? '<td>-</td>' : ''}
          ${columns.name ? '<td>คะแนนเต็ม</td>' : ''}
          ${columns.behavior ? '<td>10</td>' : ''}
          ${columns.attendance ? '<td>10</td>' : ''}
          ${columns.assignment1 ? '<td>15</td>' : ''}
          ${columns.assignment2 ? '<td>15</td>' : ''}
          ${columns.assignment3 ? '<td>15</td>' : ''}
          ${columns.midterm ? '<td>15</td>' : ''}
          ${columns.final ? '<td>20</td>' : ''}
          ${columns.total ? '<td>100</td>' : ''}
          ${columns.grade ? '<td>4.0</td>' : ''}
          ${columns.status ? '<td>-</td>' : ''}
        </tr>
      `;
    }

    activeStudents.forEach((s) => {
      const a1 = (s.assignment1?.part1 || 0) + (s.assignment1?.part2 || 0) + (s.assignment1?.part3 || 0);
      const a2 = (s.assignment2?.part1 || 0) + (s.assignment2?.part2 || 0) + (s.assignment2?.part3 || 0);
      const a3 = (s.assignment3?.part1 || 0) + (s.assignment3?.part2 || 0) + (s.assignment3?.part3 || 0);
      const tot = calculateTotal(s);
      const gr = getGrade(tot);
      const isDropped = s.isDroppedOut;

      htmlContent += `
        <tr style="${isDropped ? 'background-color:#ffe4e6; color:#be123c;' : ''}">
          ${columns.no ? `<td>${s.no}</td>` : ''}
          ${columns.studentId ? `<td>${s.studentId}</td>` : ''}
          ${columns.name ? `<td style="text-align:left;">${s.name}</td>` : ''}
          ${columns.behavior ? `<td>${isDropped ? '-' : s.behavior}</td>` : ''}
          ${columns.attendance ? `<td>${isDropped ? '-' : s.attendance}</td>` : ''}
          ${columns.assignment1 ? `<td>${isDropped ? '-' : a1}</td>` : ''}
          ${columns.assignment2 ? `<td>${isDropped ? '-' : a2}</td>` : ''}
          ${columns.assignment3 ? `<td>${isDropped ? '-' : a3}</td>` : ''}
          ${columns.midterm ? `<td>${isDropped ? '-' : s.midterm}</td>` : ''}
          ${columns.final ? `<td>${isDropped ? '-' : s.final}</td>` : ''}
          ${columns.total ? `<td><b>${isDropped ? '-' : tot}</b></td>` : ''}
          ${columns.grade ? `<td><b>${isDropped ? '-' : gr}</b></td>` : ''}
          ${columns.status ? `<td>${isDropped ? 'จำหน่ายออก' : 'ปกติ'}</td>` : ''}
        </tr>
      `;
    });

    htmlContent += `</table>`;

    try {
      const blob = new Blob([htmlContent], { type: 'text/html' });
      const clipboardItem = new ClipboardItem({ 'text/html': blob });
      navigator.clipboard.write([clipboardItem]).then(() => {
        setIsCopied(true);
        showAlert('คัดลอกสำเร็จ!', 'คัดลอกตารางจัดรูปแบบเรียบร้อยแล้ว ท่านสามารถไปที่ Google Sheets แล้วกด Ctrl+V วางได้ทันที', 'success');
        setTimeout(() => setIsCopied(false), 2500);
      });
    } catch (err) {
      // Fallback to TSV text copy
      let tsvText = `${institutionName}\n${headerNote} ${currentSubject?.name}\n\n`;
      tsvText += [
        columns.no && 'ลำดับ',
        columns.studentId && 'รหัสประจำตัว',
        columns.name && 'ชื่อ-นามสกุล',
        columns.behavior && 'จิตพิสัย',
        columns.attendance && 'เวลาเรียน',
        columns.assignment1 && 'งานที่ 1',
        columns.assignment2 && 'งานที่ 2',
        columns.assignment3 && 'งานที่ 3',
        columns.midterm && 'กลางภาค',
        columns.final && 'ปลายภาค',
        columns.total && 'รวมคะแนน',
        columns.grade && 'เกรด',
        columns.status && 'สถานะ'
      ].filter(Boolean).join('\t') + '\n';

      activeStudents.forEach((s) => {
        tsvText += [
          columns.no && s.no,
          columns.studentId && s.studentId,
          columns.name && s.name,
          columns.behavior && (s.isDroppedOut ? '-' : s.behavior),
          columns.attendance && (s.isDroppedOut ? '-' : s.attendance),
          columns.assignment1 && (s.isDroppedOut ? '-' : ((s.assignment1?.part1 || 0) + (s.assignment1?.part2 || 0) + (s.assignment1?.part3 || 0))),
          columns.assignment2 && (s.isDroppedOut ? '-' : ((s.assignment2?.part1 || 0) + (s.assignment2?.part2 || 0) + (s.assignment2?.part3 || 0))),
          columns.assignment3 && (s.isDroppedOut ? '-' : ((s.assignment3?.part1 || 0) + (s.assignment3?.part2 || 0) + (s.assignment3?.part3 || 0))),
          columns.midterm && (s.isDroppedOut ? '-' : s.midterm),
          columns.final && (s.isDroppedOut ? '-' : s.final),
          columns.total && (s.isDroppedOut ? '-' : calculateTotal(s)),
          columns.grade && (s.isDroppedOut ? '-' : getGrade(calculateTotal(s))),
          columns.status && (s.isDroppedOut ? 'จำหน่ายออก' : 'ปกติ')
        ].filter(Boolean).join('\t') + '\n';
      });

      navigator.clipboard.writeText(tsvText);
      setIsCopied(true);
      showAlert('คัดลอกสำเร็จ!', 'คัดลอกตารางข้อมูลสำหรับ Google Sheets เรียบร้อยแล้ว สามารถวางได้ทันที', 'success');
      setTimeout(() => setIsCopied(false), 2500);
    }
  };

  // Export to Excel (.xlsx) using SheetJS
  const handleExportXLSX = () => {
    const wb = XLSX.utils.book_new();
    const rowsData: any[] = [];

    // Header Metadata Rows
    rowsData.push([institutionName]);
    rowsData.push([`${headerNote} รายวิชา: ${currentSubject?.code || ''} ${currentSubject?.name || ''}`]);
    rowsData.push([`ห้องเรียน/กลุ่มเรียน: ${currentClass?.name || '-'} | ภาคเรียนที่ ${semester}/${academicYear} | อาจารย์ผู้สอน: ${customInstructor}`]);
    rowsData.push([]); // Empty row space

    // Column Headers
    const headerRow: string[] = [];
    if (columns.no) headerRow.push('ลำดับ');
    if (columns.studentId) headerRow.push('รหัสประจำตัว');
    if (columns.name) headerRow.push('ชื่อ-นามสกุล');
    if (columns.behavior) headerRow.push('จิตพิสัย (10)');
    if (columns.attendance) headerRow.push('เวลาเรียน (10)');
    if (columns.assignment1) headerRow.push('งานที่ 1 (15)');
    if (columns.assignment2) headerRow.push('งานที่ 2 (15)');
    if (columns.assignment3) headerRow.push('งานที่ 3 (15)');
    if (columns.midterm) headerRow.push('กลางภาค (15)');
    if (columns.final) headerRow.push('ปลายภาค (20)');
    if (columns.total) headerRow.push('รวมคะแนน (100)');
    if (columns.grade) headerRow.push('เกรด');
    if (columns.status) headerRow.push('สถานะ');
    rowsData.push(headerRow);

    // Full score benchmark row
    if (includeFullScoreRow) {
      const fullScoreRow: any[] = [];
      if (columns.no) fullScoreRow.push('-');
      if (columns.studentId) fullScoreRow.push('-');
      if (columns.name) fullScoreRow.push('คะแนนเต็ม');
      if (columns.behavior) fullScoreRow.push(10);
      if (columns.attendance) fullScoreRow.push(10);
      if (columns.assignment1) fullScoreRow.push(15);
      if (columns.assignment2) fullScoreRow.push(15);
      if (columns.assignment3) fullScoreRow.push(15);
      if (columns.midterm) fullScoreRow.push(15);
      if (columns.final) fullScoreRow.push(20);
      if (columns.total) fullScoreRow.push(100);
      if (columns.grade) fullScoreRow.push('4.0');
      if (columns.status) fullScoreRow.push('-');
      rowsData.push(fullScoreRow);
    }

    // Student Data Rows
    exportStudents.forEach((s) => {
      const a1 = (s.assignment1?.part1 || 0) + (s.assignment1?.part2 || 0) + (s.assignment1?.part3 || 0);
      const a2 = (s.assignment2?.part1 || 0) + (s.assignment2?.part2 || 0) + (s.assignment2?.part3 || 0);
      const a3 = (s.assignment3?.part1 || 0) + (s.assignment3?.part2 || 0) + (s.assignment3?.part3 || 0);
      const tot = calculateTotal(s);
      const gr = getGrade(tot);
      const isDropped = Boolean(s.isDroppedOut);

      const row: any[] = [];
      if (columns.no) row.push(s.no);
      if (columns.studentId) row.push(s.studentId);
      if (columns.name) row.push(s.name);
      if (columns.behavior) row.push(isDropped ? '-' : s.behavior);
      if (columns.attendance) row.push(isDropped ? '-' : s.attendance);
      if (columns.assignment1) row.push(isDropped ? '-' : a1);
      if (columns.assignment2) row.push(isDropped ? '-' : a2);
      if (columns.assignment3) row.push(isDropped ? '-' : a3);
      if (columns.midterm) row.push(isDropped ? '-' : s.midterm);
      if (columns.final) row.push(isDropped ? '-' : s.final);
      if (columns.total) row.push(isDropped ? '-' : tot);
      if (columns.grade) row.push(isDropped ? '-' : gr);
      if (columns.status) row.push(isDropped ? 'จำหน่ายออก/พ้นสภาพ' : 'ปกติ');

      rowsData.push(row);
    });

    // Summary Rows
    if (includeSummaryRows && exportStudents.filter(s => !s.isDroppedOut).length > 0) {
      const activeOnly = exportStudents.filter(s => !s.isDroppedOut);
      const totals = activeOnly.map(s => calculateTotal(s));
      const avg = (totals.reduce((a, b) => a + b, 0) / activeOnly.length).toFixed(2);
      const maxScore = Math.max(...totals);
      const minScore = Math.min(...totals);

      rowsData.push([]);
      const summaryAvgRow: any[] = [];
      if (columns.no) summaryAvgRow.push('');
      if (columns.studentId) summaryAvgRow.push('');
      if (columns.name) summaryAvgRow.push('คะแนนเฉลี่ย (Average)');
      if (columns.total) summaryAvgRow.push(Number(avg));
      rowsData.push(summaryAvgRow);

      const summaryMaxRow: any[] = [];
      if (columns.no) summaryMaxRow.push('');
      if (columns.studentId) summaryMaxRow.push('');
      if (columns.name) summaryMaxRow.push('คะแนนสูงสุด (Max)');
      if (columns.total) summaryMaxRow.push(maxScore);
      rowsData.push(summaryMaxRow);

      const summaryMinRow: any[] = [];
      if (columns.no) summaryMinRow.push('');
      if (columns.studentId) summaryMinRow.push('');
      if (columns.name) summaryMinRow.push('คะแนนต่ำสุด (Min)');
      if (columns.total) summaryMinRow.push(minScore);
      rowsData.push(summaryMinRow);
    }

    // Signature Block
    if (includeSignatureBlock) {
      rowsData.push([]);
      rowsData.push([]);
      rowsData.push(['', '', 'ลงชื่อ.............................................................. ครูผู้สอน']);
      rowsData.push(['', '', `(${customInstructor})`]);
      rowsData.push(['', '', `วันที่......... เดือน........................... พ.ศ. .........`]);
    }

    const ws = XLSX.utils.aoa_to_sheet(rowsData);

    // Auto Column Widths
    const colWidths = headerRow.map(() => ({ wch: 16 }));
    colWidths[2] = { wch: 28 }; // Name column width
    ws['!cols'] = colWidths;

    XLSX.utils.book_append_sheet(wb, ws, sheetName.substring(0, 30));
    XLSX.writeFile(wb, `${fileName}.xlsx`);
    showAlert('สร้างไฟล์สำเร็จ!', `ดาวน์โหลดไฟล์ "${fileName}.xlsx" เรียบร้อยแล้ว`, 'success');
  };

  const handleTriggerSync = async () => {
    setIsSyncingLocal(true);
    try {
      await onSyncSheets({
        fileName,
        sheetName,
        institutionName,
        customInstructor,
        academicYear,
        semester,
        showLogo,
        logoPosition,
        logoUrl,
        columns,
        includeDroppedOut,
        includeFullScoreRow,
        includeSummaryRows
      });
    } finally {
      setIsSyncingLocal(false);
    }
  };

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/60 backdrop-blur-md flex items-center justify-center p-3 sm:p-5">
        <motion.div
          initial={{ opacity: 0, scale: 0.96, y: 15 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.96, y: 15 }}
          className="bg-white w-full max-w-5xl rounded-[2.5rem] shadow-2xl border border-slate-100 overflow-hidden flex flex-col my-auto max-h-[92vh]"
        >
          {/* Header */}
          <div className="bg-gradient-to-r from-emerald-600 via-teal-600 to-emerald-700 p-6 sm:p-7 text-white flex items-center justify-between relative overflow-hidden shrink-0">
            <div className="absolute -right-10 -bottom-10 w-48 h-48 bg-white/10 rounded-full blur-2xl pointer-events-none" />
            <div className="flex items-center gap-4 relative z-10">
              <div className="p-3.5 bg-white/15 backdrop-blur-md rounded-2xl border border-white/20 shadow-inner">
                <FileSpreadsheet className="w-7 h-7 text-emerald-100" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="px-2.5 py-0.5 bg-emerald-500/40 text-emerald-100 rounded-full text-[10px] font-extrabold uppercase tracking-wider border border-emerald-400/30">
                    Google Sheets & Excel Studio
                  </span>
                  <span className="flex items-center gap-1 text-[11px] font-bold text-emerald-200">
                    <Sparkles className="w-3.5 h-3.5 text-amber-300" /> ปรับแต่งสมบูรณ์แบบ
                  </span>
                </div>
                <h3 className="text-xl sm:text-2xl font-black mt-1 tracking-tight">
                  ระบบจัดเตรียม & ปรับแต่งไฟล์ Google Sheets / Excel
                </h3>
              </div>
            </div>
            <button
              onClick={onClose}
              className="p-2.5 hover:bg-white/15 rounded-2xl transition-colors text-white/80 hover:text-white cursor-pointer relative z-10"
            >
              <X className="w-6 h-6" />
            </button>
          </div>

          {/* Sub Navigation Tabs */}
          <div className="bg-slate-50 border-b border-slate-200/80 px-6 py-2.5 flex items-center gap-2 overflow-x-auto shrink-0">
            <button
              onClick={() => setActiveTab('header')}
              className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer whitespace-nowrap ${
                activeTab === 'header'
                  ? 'bg-emerald-600 text-white shadow-md shadow-emerald-100 font-extrabold'
                  : 'text-slate-600 hover:bg-white hover:text-slate-800'
              }`}
            >
              <Building className="w-4 h-4" />
              หัวเอกสาร & โลโก้สถาบัน
            </button>
            <button
              onClick={() => setActiveTab('columns')}
              className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer whitespace-nowrap ${
                activeTab === 'columns'
                  ? 'bg-emerald-600 text-white shadow-md shadow-emerald-100 font-extrabold'
                  : 'text-slate-600 hover:bg-white hover:text-slate-800'
              }`}
            >
              <Table className="w-4 h-4" />
              เลือกคอลัมน์ ({Object.values(columns).filter(Boolean).length}/13)
            </button>
            <button
              onClick={() => setActiveTab('rows')}
              className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer whitespace-nowrap ${
                activeTab === 'rows'
                  ? 'bg-emerald-600 text-white shadow-md shadow-emerald-100 font-extrabold'
                  : 'text-slate-600 hover:bg-white hover:text-slate-800'
              }`}
            >
              <Rows className="w-4 h-4" />
              จัดการแถว & สรุปคะแนน
            </button>
            <button
              onClick={() => setActiveTab('preview')}
              className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer whitespace-nowrap ${
                activeTab === 'preview'
                  ? 'bg-emerald-600 text-white shadow-md shadow-emerald-100 font-extrabold'
                  : 'text-slate-600 hover:bg-white hover:text-slate-800'
              }`}
            >
              <Eye className="w-4 h-4" />
              ตัวอย่างแผ่นงาน (Live Preview)
            </button>
          </div>

          {/* Modal Body Content */}
          <div className="p-6 sm:p-8 overflow-y-auto space-y-6 flex-1">
            {/* TAB 1: HEADER & LOGO CUSTOMIZATION */}
            {activeTab === 'header' && (
              <div className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                  {/* Document & Sheet Title */}
                  <div className="p-5 bg-slate-50 border border-slate-200/70 rounded-2xl space-y-4">
                    <h4 className="text-sm font-extrabold text-slate-800 flex items-center gap-2">
                      <FileText className="w-4 h-4 text-emerald-600" />
                      การตั้งชื่อไฟล์และแผ่นงาน
                    </h4>
                    <div>
                      <label className="block text-xs font-bold text-slate-600 mb-1">
                        ชื่อไฟล์ดาวน์โหลด (File Name)
                      </label>
                      <input
                        type="text"
                        value={fileName}
                        onChange={(e) => setFileName(e.target.value)}
                        className="w-full bg-white border border-slate-200 rounded-xl px-3.5 py-2 text-xs font-bold text-slate-800 focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none"
                        placeholder="กรอกชื่อไฟล์..."
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-slate-600 mb-1">
                        ชื่อเวิร์กชีต / แท็บใน Google Sheets
                      </label>
                      <input
                        type="text"
                        value={sheetName}
                        onChange={(e) => setSheetName(e.target.value)}
                        className="w-full bg-white border border-slate-200 rounded-xl px-3.5 py-2 text-xs font-bold text-slate-800 focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none"
                        placeholder="กรอกชื่อแผ่นงาน..."
                      />
                    </div>
                  </div>

                  {/* Institution Details */}
                  <div className="p-5 bg-slate-50 border border-slate-200/70 rounded-2xl space-y-4">
                    <h4 className="text-sm font-extrabold text-slate-800 flex items-center gap-2">
                      <Building className="w-4 h-4 text-emerald-600" />
                      รายละเอียดสถาบัน & ผู้สอน
                    </h4>
                    <div>
                      <label className="block text-xs font-bold text-slate-600 mb-1">
                        ชื่อสถาบัน / โรงเรียน / วิทยาลัย
                      </label>
                      <input
                        type="text"
                        value={institutionName}
                        onChange={(e) => setInstitutionName(e.target.value)}
                        className="w-full bg-white border border-slate-200 rounded-xl px-3.5 py-2 text-xs font-bold text-slate-800 focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none"
                        placeholder="เช่น วิทยาลัยเทคโนโลยี..."
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs font-bold text-slate-600 mb-1">
                          ภาคเรียน
                        </label>
                        <input
                          type="text"
                          value={semester}
                          onChange={(e) => setSemester(e.target.value)}
                          className="w-full bg-white border border-slate-200 rounded-xl px-3.5 py-2 text-xs font-bold text-slate-800 focus:ring-2 focus:ring-emerald-500 outline-none"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-bold text-slate-600 mb-1">
                          ปีการศึกษา
                        </label>
                        <input
                          type="text"
                          value={academicYear}
                          onChange={(e) => setAcademicYear(e.target.value)}
                          className="w-full bg-white border border-slate-200 rounded-xl px-3.5 py-2 text-xs font-bold text-slate-800 focus:ring-2 focus:ring-emerald-500 outline-none"
                        />
                      </div>
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-slate-600 mb-1">
                        ชื่อครูผู้สอน / อาจารย์
                      </label>
                      <input
                        type="text"
                        value={customInstructor}
                        onChange={(e) => setCustomInstructor(e.target.value)}
                        className="w-full bg-white border border-slate-200 rounded-xl px-3.5 py-2 text-xs font-bold text-slate-800 focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none"
                      />
                    </div>
                  </div>
                </div>

                {/* Institution Logo Setup Section */}
                <div className="p-5 bg-emerald-50/50 border border-emerald-100 rounded-2xl space-y-4">
                  <div className="flex items-center justify-between">
                    <h4 className="text-sm font-extrabold text-emerald-900 flex items-center gap-2">
                      <Image className="w-4 h-4 text-emerald-600" />
                      ตั้งค่าโลโก้สถาบัน (มุมบนซ้ายมือ)
                    </h4>
                    <label className="relative inline-flex items-center cursor-pointer">
                      <input
                        type="checkbox"
                        checked={showLogo}
                        onChange={(e) => setShowLogo(e.target.checked)}
                        className="sr-only peer"
                      />
                      <div className="w-11 h-6 bg-slate-300 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-emerald-600" />
                    </label>
                  </div>

                  {showLogo && (
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-2">
                      <div className="flex flex-col items-center justify-center p-3 bg-white rounded-xl border border-slate-200">
                        <span className="text-[10px] font-extrabold uppercase text-slate-400 mb-2">แสดงผลตัวอย่างโลโก้</span>
                        <img 
                          src={logoUrl} 
                          alt="Institution Logo" 
                          className={`object-contain rounded-lg border border-slate-100 shadow-sm ${
                            logoSize === 'small' ? 'w-12 h-12' : logoSize === 'medium' ? 'w-16 h-16' : 'w-20 h-20'
                          }`} 
                        />
                      </div>
                      <div className="sm:col-span-2 space-y-3">
                        <div>
                          <label className="block text-xs font-bold text-slate-700 mb-1">
                            อัปโหลดโลโก้สถาบันของคุณ (PNG/JPG)
                          </label>
                          <label className="flex items-center justify-center gap-2 w-full bg-white border border-dashed border-emerald-300 hover:border-emerald-500 py-2.5 rounded-xl cursor-pointer text-xs font-bold text-emerald-700 hover:bg-emerald-50/50 transition-colors">
                            <Upload className="w-4 h-4 text-emerald-600" />
                            เลือกไฟล์รูปภาพโลโก้สถาบัน...
                            <input type="file" accept="image/*" onChange={handleLogoUpload} className="hidden" />
                          </label>
                        </div>
                        <div className="flex items-center gap-4">
                          <div>
                            <span className="block text-[11px] font-bold text-slate-600 mb-1">ขนาดโลโก้</span>
                            <div className="flex gap-1">
                              {(['small', 'medium', 'large'] as const).map((sz) => (
                                <button
                                  key={sz}
                                  type="button"
                                  onClick={() => setLogoSize(sz)}
                                  className={`px-3 py-1 rounded-lg text-xs font-extrabold capitalize cursor-pointer transition-all ${
                                    logoSize === sz
                                      ? 'bg-emerald-600 text-white shadow-xs'
                                      : 'bg-white text-slate-600 hover:bg-slate-100 border border-slate-200'
                                  }`}
                                >
                                  {sz === 'small' ? 'เล็ก' : sz === 'medium' ? 'กลาง' : 'ใหญ่'}
                                </button>
                              ))}
                            </div>
                          </div>
                          <div>
                            <span className="block text-[11px] font-bold text-slate-600 mb-1">ตำแหน่ง</span>
                            <span className="inline-flex items-center gap-1 text-xs font-bold text-emerald-800 bg-white px-3 py-1.5 rounded-lg border border-slate-200">
                              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                              มุมบนซ้ายมือ (Top-Left)
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                {/* Additional Header Note */}
                <div className="p-5 bg-slate-50 border border-slate-200/70 rounded-2xl">
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    คำอธิบายเพิ่มเติมส่วนหัวรายงาน
                  </label>
                  <input
                    type="text"
                    value={headerNote}
                    onChange={(e) => setHeaderNote(e.target.value)}
                    className="w-full bg-white border border-slate-200 rounded-xl px-3.5 py-2 text-xs font-bold text-slate-800 focus:ring-2 focus:ring-emerald-500 outline-none"
                    placeholder="เช่น แบบรายงานผลสัมฤทธิ์ทางการเรียน..."
                  />
                </div>
              </div>
            )}

            {/* TAB 2: COLUMNS SELECTION */}
            {activeTab === 'columns' && (
              <div className="space-y-4">
                <div className="p-4 bg-emerald-50 border border-emerald-200/60 rounded-2xl flex items-center justify-between">
                  <div>
                    <h4 className="text-xs font-extrabold text-emerald-900">
                      เลือกแสดง/ซ่อน คอลัมน์ข้อมูลที่จะส่งออกไปยัง Google Sheets / Excel
                    </h4>
                    <p className="text-[11px] text-emerald-700 mt-0.5">
                      ติ๊กถูกคอลัมน์ที่ต้องการนำออก และปลดออกสำหรับคอลัมน์ที่ไม่ต้องการ
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setColumns({
                        no: true, studentId: true, name: true, behavior: true, attendance: true,
                        assignment1: true, assignment2: true, assignment3: true, midterm: true,
                        final: true, total: true, grade: true, status: true
                      })}
                      className="px-3 py-1.5 bg-emerald-600 text-white rounded-lg text-xs font-extrabold hover:bg-emerald-700 cursor-pointer transition-colors shadow-xs"
                    >
                      เลือกทั้งหมด
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                  {[
                    { key: 'no', label: 'ลำดับ / เลขที่', desc: 'คอลัมน์แสดงลำดับที่' },
                    { key: 'studentId', label: 'รหัสประจำตัวนักเรียน', desc: 'รหัสนักศึกษา/รหัสประจำตัว' },
                    { key: 'name', label: 'ชื่อ - นามสกุล', desc: 'ชื่อเต็มของนักเรียน' },
                    { key: 'behavior', label: 'คะแนนจิตพิสัย (10)', desc: 'จิตพิสัยและความประพฤติ' },
                    { key: 'attendance', label: 'เวลาเรียน / การเข้าเรียน (10)', desc: 'คะแนนเวลาเรียน' },
                    { key: 'assignment1', label: 'คะแนนเก็บ ชุดที่ 1 (15)', desc: 'ใบงาน/ชิ้นงานชุดที่ 1' },
                    { key: 'assignment2', label: 'คะแนนเก็บ ชุดที่ 2 (15)', desc: 'ใบงาน/ชิ้นงานชุดที่ 2' },
                    { key: 'assignment3', label: 'คะแนนเก็บ ชุดที่ 3 (15)', desc: 'ใบงาน/ชิ้นงานชุดที่ 3' },
                    { key: 'midterm', label: 'คะแนนสอบกลางภาค (15)', desc: 'คะแนนทดสอบกลางภาค' },
                    { key: 'final', label: 'คะแนนสอบปลายภาค (20)', desc: 'คะแนนทดสอบปลายภาค' },
                    { key: 'total', label: 'รวมคะแนนสุทธิ (100)', desc: 'รวมคะแนนทุกหมวด' },
                    { key: 'grade', label: 'เกรดเฉลี่ยประเมินผล', desc: 'ผลเกรด 0 - 4.0' },
                    { key: 'status', label: 'สถานะนักเรียน', desc: 'ปกติ หรือ จำหน่ายออก' },
                  ].map((col) => {
                    const isChecked = (columns as any)[col.key];
                    return (
                      <div
                        key={col.key}
                        onClick={() => setColumns(prev => ({ ...prev, [col.key]: !(prev as any)[col.key] }))}
                        className={`p-3.5 rounded-2xl border cursor-pointer transition-all flex items-start gap-3 select-none ${
                          isChecked
                            ? 'bg-emerald-50/40 border-emerald-300 ring-2 ring-emerald-100'
                            : 'bg-slate-50 border-slate-200/80 hover:bg-slate-100/60 opacity-60'
                        }`}
                      >
                        <div className={`mt-0.5 w-5 h-5 rounded-lg border flex items-center justify-center shrink-0 transition-colors ${
                          isChecked ? 'bg-emerald-600 border-emerald-600 text-white' : 'border-slate-300 bg-white'
                        }`}>
                          {isChecked && <Check className="w-3.5 h-3.5 stroke-[3]" />}
                        </div>
                        <div>
                          <p className="text-xs font-bold text-slate-800">{col.label}</p>
                          <p className="text-[10px] text-slate-500 mt-0.5">{col.desc}</p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* TAB 3: ROWS & SUMMARY SETUP */}
            {activeTab === 'rows' && (
              <div className="space-y-5">
                <div className="p-5 bg-slate-50 border border-slate-200/70 rounded-2xl space-y-4">
                  <h4 className="text-xs font-extrabold text-slate-800 flex items-center gap-2">
                    <Rows className="w-4 h-4 text-emerald-600" />
                    การกรองและการจัดการแถวข้อมูล
                  </h4>

                  <div className="space-y-3">
                    {/* Include Dropped Out toggle */}
                    <div className="flex items-center justify-between p-3.5 bg-white rounded-xl border border-slate-200">
                      <div>
                        <p className="text-xs font-bold text-slate-800">รวมรายชื่อนักเรียน "จำหน่ายออก / พ้นสภาพ"</p>
                        <p className="text-[10px] text-slate-500">หากปิด จะแสดงเฉพาะนักเรียนสถานะปกติในการส่งออก</p>
                      </div>
                      <label className="relative inline-flex items-center cursor-pointer">
                        <input
                          type="checkbox"
                          checked={includeDroppedOut}
                          onChange={(e) => setIncludeDroppedOut(e.target.checked)}
                          className="sr-only peer"
                        />
                        <div className="w-11 h-6 bg-slate-300 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-emerald-600" />
                      </label>
                    </div>

                    {/* Full Score Benchmark Row */}
                    <div className="flex items-center justify-between p-3.5 bg-white rounded-xl border border-slate-200">
                      <div>
                        <p className="text-xs font-bold text-slate-800">เพิ่มแถว "คะแนนเต็มประจำหมวด" ด้านบนตาราง</p>
                        <p className="text-[10px] text-slate-500">แสดงเกณฑ์คะแนนเต็ม 10, 10, 15, 15, 15, 20 = 100</p>
                      </div>
                      <label className="relative inline-flex items-center cursor-pointer">
                        <input
                          type="checkbox"
                          checked={includeFullScoreRow}
                          onChange={(e) => setIncludeFullScoreRow(e.target.checked)}
                          className="sr-only peer"
                        />
                        <div className="w-11 h-6 bg-slate-300 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-emerald-600" />
                      </label>
                    </div>

                    {/* Include Summary Rows */}
                    <div className="flex items-center justify-between p-3.5 bg-white rounded-xl border border-slate-200">
                      <div>
                        <p className="text-xs font-bold text-slate-800">เพิ่มแถว "สรุปสถิติท้ายตาราง" (คะแนนเฉลี่ย, สูงสุด, ต่ำสุด)</p>
                        <p className="text-[10px] text-slate-500">คำนวณสถิติภาพรวมวิชาให้อัตโนมัติที่ท้ายแผ่นงาน</p>
                      </div>
                      <label className="relative inline-flex items-center cursor-pointer">
                        <input
                          type="checkbox"
                          checked={includeSummaryRows}
                          onChange={(e) => setIncludeSummaryRows(e.target.checked)}
                          className="sr-only peer"
                        />
                        <div className="w-11 h-6 bg-slate-300 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-emerald-600" />
                      </label>
                    </div>

                    {/* Include Teacher Signature Block */}
                    <div className="flex items-center justify-between p-3.5 bg-white rounded-xl border border-slate-200">
                      <div>
                        <p className="text-xs font-bold text-slate-800">เพิ่มบล็อก "ลงชื่อครูผู้สอน" ท้ายรายงาน</p>
                        <p className="text-[10px] text-slate-500">สำหรับพิมพ์เอกสารลงนามกำกับทางการ</p>
                      </div>
                      <label className="relative inline-flex items-center cursor-pointer">
                        <input
                          type="checkbox"
                          checked={includeSignatureBlock}
                          onChange={(e) => setIncludeSignatureBlock(e.target.checked)}
                          className="sr-only peer"
                        />
                        <div className="w-11 h-6 bg-slate-300 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-emerald-600" />
                      </label>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* TAB 4: LIVE PREVIEW */}
            {activeTab === 'preview' && (
              <div className="space-y-4">
                <div className="p-3.5 bg-slate-100 rounded-xl flex items-center justify-between text-slate-700 text-xs">
                  <span className="font-bold flex items-center gap-1.5">
                    <Eye className="w-4 h-4 text-emerald-600" />
                    ตัวอย่างโครงสร้าง Google Sheet / Excel แบบเรียลไทม์
                  </span>
                  <span className="text-[11px] text-slate-500">
                    แสดงข้อมูล {exportStudents.length} คน (คอลัมน์เลือกอยู่ {Object.values(columns).filter(Boolean).length} ช่อง)
                  </span>
                </div>

                {/* Sheet Visual Canvas */}
                <div className="border border-slate-300 rounded-2xl bg-white shadow-inner overflow-hidden text-xs">
                  {/* Sheet Title Bar */}
                  <div className="bg-emerald-700 text-white px-4 py-2 font-bold flex items-center justify-between">
                    <span className="flex items-center gap-2 font-mono text-xs">
                      <FileSpreadsheet className="w-4 h-4 text-emerald-200" />
                      {fileName}.xlsx
                    </span>
                    <span className="bg-emerald-800/80 px-2.5 py-0.5 rounded text-[10px]">
                      [Tab: {sheetName}]
                    </span>
                  </div>

                  {/* Header Content with Logo */}
                  <div className="p-5 border-b border-slate-200 bg-slate-50/30">
                    <div className="flex items-start gap-4">
                      {showLogo && (
                        <div className="shrink-0 p-1 bg-white border border-slate-200 rounded-xl shadow-xs">
                          <img src={logoUrl} alt="Logo" className="w-14 h-14 object-contain rounded-lg" />
                        </div>
                      )}
                      <div className="flex-1 text-left space-y-1">
                        <h3 className="font-extrabold text-sm text-slate-900">{institutionName}</h3>
                        <p className="font-bold text-xs text-emerald-700">{headerNote} รายวิชา {currentSubject?.code} {currentSubject?.name}</p>
                        <p className="text-[11px] text-slate-500">
                          ห้อง/กลุ่มเรียน: <span className="font-bold text-slate-700">{currentClass?.name || '-'}</span> | ภาคเรียนที่ {semester}/{academicYear} | อาจารย์ผู้สอน: <span className="font-bold text-slate-700">{customInstructor}</span>
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* Data Grid Table Preview */}
                  <div className="overflow-x-auto">
                    <table className="w-full text-center border-collapse text-xs">
                      <thead>
                        <tr className="bg-slate-200/80 text-slate-800 font-extrabold border-b border-slate-300">
                          {columns.no && <th className="p-2 border-r border-slate-300">ลำดับ</th>}
                          {columns.studentId && <th className="p-2 border-r border-slate-300">รหัสประจำตัว</th>}
                          {columns.name && <th className="p-2 border-r border-slate-300 text-left">ชื่อ-นามสกุล</th>}
                          {columns.behavior && <th className="p-2 border-r border-slate-300">จิตพิสัย (10)</th>}
                          {columns.attendance && <th className="p-2 border-r border-slate-300">เวลาเรียน (10)</th>}
                          {columns.assignment1 && <th className="p-2 border-r border-slate-300">งานที่ 1 (15)</th>}
                          {columns.assignment2 && <th className="p-2 border-r border-slate-300">งานที่ 2 (15)</th>}
                          {columns.assignment3 && <th className="p-2 border-r border-slate-300">งานที่ 3 (15)</th>}
                          {columns.midterm && <th className="p-2 border-r border-slate-300">กลางภาค (15)</th>}
                          {columns.final && <th className="p-2 border-r border-slate-300">ปลายภาค (20)</th>}
                          {columns.total && <th className="p-2 border-r border-slate-300 bg-amber-100/60">รวม (100)</th>}
                          {columns.grade && <th className="p-2 border-r border-slate-300 bg-emerald-100/60">เกรด</th>}
                          {columns.status && <th className="p-2">สถานะ</th>}
                        </tr>
                      </thead>
                      <tbody>
                        {includeFullScoreRow && (
                          <tr className="bg-amber-50 font-bold border-b border-slate-200 text-amber-900">
                            {columns.no && <td className="p-1.5 border-r border-slate-200">-</td>}
                            {columns.studentId && <td className="p-1.5 border-r border-slate-200">-</td>}
                            {columns.name && <td className="p-1.5 border-r border-slate-200 text-left">คะแนนเต็ม</td>}
                            {columns.behavior && <td className="p-1.5 border-r border-slate-200">10</td>}
                            {columns.attendance && <td className="p-1.5 border-r border-slate-200">10</td>}
                            {columns.assignment1 && <td className="p-1.5 border-r border-slate-200">15</td>}
                            {columns.assignment2 && <td className="p-1.5 border-r border-slate-200">15</td>}
                            {columns.assignment3 && <td className="p-1.5 border-r border-slate-200">15</td>}
                            {columns.midterm && <td className="p-1.5 border-r border-slate-200">15</td>}
                            {columns.final && <td className="p-1.5 border-r border-slate-200">20</td>}
                            {columns.total && <td className="p-1.5 border-r border-slate-200 font-black">100</td>}
                            {columns.grade && <td className="p-1.5 border-r border-slate-200 font-black">4.0</td>}
                            {columns.status && <td className="p-1.5">-</td>}
                          </tr>
                        )}

                        {exportStudents.slice(0, 5).map((s) => {
                          const a1 = (s.assignment1?.part1 || 0) + (s.assignment1?.part2 || 0) + (s.assignment1?.part3 || 0);
                          const a2 = (s.assignment2?.part1 || 0) + (s.assignment2?.part2 || 0) + (s.assignment2?.part3 || 0);
                          const a3 = (s.assignment3?.part1 || 0) + (s.assignment3?.part2 || 0) + (s.assignment3?.part3 || 0);
                          const tot = calculateTotal(s);
                          const gr = getGrade(tot);
                          const isDropped = s.isDroppedOut;

                          return (
                            <tr key={s.id} className={`border-b border-slate-200 ${isDropped ? 'bg-rose-50/80 text-rose-700' : 'hover:bg-slate-50'}`}>
                              {columns.no && <td className="p-1.5 border-r border-slate-200">{s.no}</td>}
                              {columns.studentId && <td className="p-1.5 border-r border-slate-200 font-mono">{s.studentId}</td>}
                              {columns.name && <td className={`p-1.5 border-r border-slate-200 text-left font-bold ${isDropped ? 'line-through' : ''}`}>{s.name}</td>}
                              {columns.behavior && <td className="p-1.5 border-r border-slate-200">{isDropped ? '-' : s.behavior}</td>}
                              {columns.attendance && <td className="p-1.5 border-r border-slate-200">{isDropped ? '-' : s.attendance}</td>}
                              {columns.assignment1 && <td className="p-1.5 border-r border-slate-200">{isDropped ? '-' : a1}</td>}
                              {columns.assignment2 && <td className="p-1.5 border-r border-slate-200">{isDropped ? '-' : a2}</td>}
                              {columns.assignment3 && <td className="p-1.5 border-r border-slate-200">{isDropped ? '-' : a3}</td>}
                              {columns.midterm && <td className="p-1.5 border-r border-slate-200">{isDropped ? '-' : s.midterm}</td>}
                              {columns.final && <td className="p-1.5 border-r border-slate-200">{isDropped ? '-' : s.final}</td>}
                              {columns.total && <td className="p-1.5 border-r border-slate-200 font-extrabold text-indigo-700 bg-indigo-50/30">{isDropped ? '-' : tot}</td>}
                              {columns.grade && <td className="p-1.5 border-r border-slate-200 font-extrabold text-emerald-700 bg-emerald-50/30">{isDropped ? '-' : gr}</td>}
                              {columns.status && <td className="p-1.5 font-bold">{isDropped ? 'จำหน่ายออก' : 'ปกติ'}</td>}
                            </tr>
                          );
                        })}

                        {exportStudents.length > 5 && (
                          <tr className="bg-slate-50 text-slate-400 italic">
                            <td colSpan={13} className="p-2 text-center text-[11px]">
                              ... และอีก {exportStudents.length - 5} รายการนักเรียน ...
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>

                  {/* Signature Block Preview */}
                  {includeSignatureBlock && (
                    <div className="p-4 bg-slate-50 border-t border-slate-200 flex justify-end text-right">
                      <div className="text-center space-y-1 font-medium text-slate-600 text-[11px]">
                        <p>ลงชื่อ.............................................................. ครูผู้สอน</p>
                        <p className="font-bold text-slate-800">({customInstructor})</p>
                        <p className="text-slate-400">วันที่......... เดือน........................... พ.ศ. .........</p>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Modal Footer Controls */}
          <div className="p-5 sm:p-6 bg-slate-50 border-t border-slate-200 flex flex-wrap items-center justify-between gap-3 shrink-0">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleCopyForSheets}
                className="px-4 py-2.5 bg-slate-800 hover:bg-slate-900 text-white rounded-xl text-xs font-bold transition-all flex items-center gap-2 cursor-pointer shadow-sm active:scale-95"
              >
                {isCopied ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
                {isCopied ? 'คัดลอกตารางแล้ว!' : 'คัดลอกตารางไปวาง Sheets'}
              </button>

              <button
                type="button"
                onClick={handleExportXLSX}
                className="px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold transition-all flex items-center gap-2 cursor-pointer shadow-md shadow-emerald-100 active:scale-95"
              >
                <Download className="w-4 h-4" />
                ดาวน์โหลดไฟล์ Excel (.xlsx)
              </button>
            </div>

            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2.5 rounded-xl text-xs font-bold text-slate-600 hover:bg-slate-200 transition-colors cursor-pointer"
              >
                ยกเลิก
              </button>

              <button
                type="button"
                onClick={handleTriggerSync}
                disabled={isSyncingLocal}
                className="px-6 py-2.5 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white rounded-xl font-extrabold text-xs transition-all shadow-lg shadow-emerald-200 cursor-pointer flex items-center gap-2 active:scale-95 disabled:opacity-50"
              >
                {isSyncingLocal ? (
                  <RefreshCw className="w-4 h-4 animate-spin" />
                ) : (
                  <Cloud className="w-4 h-4" />
                )}
                {isSyncingLocal ? 'กำลังซิงค์ Google Sheets...' : 'อัปเดต / ซิงค์ Google Sheets'}
              </button>
            </div>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
