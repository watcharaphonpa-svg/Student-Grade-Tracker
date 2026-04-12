/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useMemo, useEffect } from 'react';
import { 
  Plus, 
  Trash2, 
  Save, 
  Download, 
  Calculator, 
  Users, 
  GraduationCap,
  ChevronRight,
  ChevronDown,
  Info,
  Cloud,
  CloudCheck,
  ExternalLink,
  Loader2
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

// --- Types ---

interface SubScores {
  part1: number;
  part2: number;
  part3: number;
}

interface Student {
  id: string;
  no: string;
  studentId: string;
  name: string;
  behavior: number; // Max 10
  attendance: number; // Max 10
  assignment1: SubScores; // Max 15 (5+5+5)
  assignment2: SubScores; // Max 15 (5+5+5)
  assignment3: SubScores; // Max 15 (5+5+5)
  midterm: number; // Max 15
  final: number; // Max 20
}

// --- Constants ---

const MAX_SCORES = {
  behavior: 10,
  attendance: 10,
  assignmentPart: 5,
  midterm: 15,
  final: 20,
};

const GRADING_SCALE = [
  { min: 80, grade: '4.0' },
  { min: 75, grade: '3.5' },
  { min: 70, grade: '3.0' },
  { min: 65, grade: '2.5' },
  { min: 60, grade: '2.0' },
  { min: 55, grade: '1.5' },
  { min: 50, grade: '1.0' },
  { min: 0, grade: '0' },
];

// --- Helper Functions ---

const calculateTotal = (student: Student): number => {
  const a1 = student.assignment1.part1 + student.assignment1.part2 + student.assignment1.part3;
  const a2 = student.assignment2.part1 + student.assignment2.part2 + student.assignment2.part3;
  const a3 = student.assignment3.part1 + student.assignment3.part2 + student.assignment3.part3;
  
  return (
    student.behavior +
    student.attendance +
    a1 + a2 + a3 +
    student.midterm +
    student.final
  );
};

const getGrade = (total: number): string => {
  for (const scale of GRADING_SCALE) {
    if (total >= scale.min) return scale.grade;
  }
  return '0';
};

export default function App() {
  const [students, setStudents] = useState<Student[]>(() => {
    const saved = localStorage.getItem('student-grades');
    return saved ? JSON.parse(saved) : [
      {
        id: crypto.randomUUID(),
        no: '1',
        studentId: '66001',
        name: 'สมชาย ใจดี',
        behavior: 10,
        attendance: 10,
        assignment1: { part1: 5, part2: 5, part3: 5 },
        assignment2: { part1: 5, part2: 5, part3: 5 },
        assignment3: { part1: 5, part2: 5, part3: 5 },
        midterm: 12,
        final: 18,
      }
    ];
  });

  const [isExpanded, setIsExpanded] = useState<Record<string, boolean>>({});
  const [isGoogleAuth, setIsGoogleAuth] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [spreadsheetUrl, setSpreadsheetUrl] = useState<string | null>(null);

  useEffect(() => {
    localStorage.setItem('student-grades', JSON.stringify(students));
  }, [students]);

  useEffect(() => {
    checkAuthStatus();
    
    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === 'OAUTH_AUTH_SUCCESS') {
        setIsGoogleAuth(true);
      }
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  const checkAuthStatus = async () => {
    try {
      const res = await fetch('/api/auth/status');
      const data = await res.json();
      setIsGoogleAuth(data.isAuthenticated);
    } catch (err) {
      console.error("Auth status check failed", err);
    }
  };

  const handleGoogleConnect = async () => {
    // 1. Open a blank popup immediately to satisfy browser security (especially on iPad/Safari)
    const authWindow = window.open('', 'google_oauth', 'width=600,height=700');
    
    if (!authWindow) {
      alert("เบราว์เซอร์ของคุณบล็อกหน้าต่างป๊อปอัป กรุณาอนุญาตป๊อปอัปในหน้าการตั้งค่า (Settings > Safari > Block Pop-ups) แล้วลองใหม่อีกครั้ง");
      return;
    }

    // Show a loading message in the popup
    authWindow.document.write('<p style="font-family: sans-serif; text-align: center; margin-top: 50px;">กำลังเตรียมการเชื่อมต่อ Google...</p>');

    try {
      const res = await fetch('/api/auth/google/url');
      const data = await res.json();
      
      if (!res.ok) {
        throw new Error(data.details || data.error || "ไม่สามารถดึงข้อมูลเชื่อมต่อได้");
      }
      
      if (!data.url) throw new Error("ไม่ได้รับ URL สำหรับเชื่อมต่อ");
      
      // 2. Update the popup location with the real Google Auth URL
      authWindow.location.href = data.url;
    } catch (err) {
      console.error("Failed to get auth URL", err);
      authWindow.close();
      alert("เกิดข้อผิดพลาด: " + (err instanceof Error ? err.message : String(err)));
    }
  };

  const handleSyncToSheets = async () => {
    if (!isGoogleAuth) return handleGoogleConnect();
    
    setIsSyncing(true);
    try {
      const res = await fetch('/api/sheets/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ students })
      });
      const data = await res.json();
      if (data.success) {
        setSpreadsheetUrl(data.url);
      } else {
        throw new Error(data.error);
      }
    } catch (err) {
      console.error("Sync failed", err);
      alert("Sync failed: " + (err instanceof Error ? err.message : String(err)));
    } finally {
      setIsSyncing(false);
    }
  };

  const addStudent = () => {
    const newStudent: Student = {
      id: crypto.randomUUID(),
      no: (students.length + 1).toString(),
      studentId: '',
      name: '',
      behavior: 0,
      attendance: 0,
      assignment1: { part1: 0, part2: 0, part3: 0 },
      assignment2: { part1: 0, part2: 0, part3: 0 },
      assignment3: { part1: 0, part2: 0, part3: 0 },
      midterm: 0,
      final: 0,
    };
    setStudents([...students, newStudent]);
  };

  const removeStudent = (id: string) => {
    setStudents(students.filter(s => s.id !== id));
  };

  const updateStudent = (id: string, field: keyof Student | string, value: any) => {
    setStudents(prev => prev.map(s => {
      if (s.id !== id) return s;
      
      // Handle nested assignment updates
      if (field.includes('.')) {
        const [main, sub] = field.split('.');
        const mainKey = main as 'assignment1' | 'assignment2' | 'assignment3';
        const subKey = sub as keyof SubScores;
        
        // Clamp sub-score
        const numVal = Math.min(MAX_SCORES.assignmentPart, Math.max(0, Number(value) || 0));
        
        return {
          ...s,
          [mainKey]: {
            ...s[mainKey],
            [subKey]: numVal
          }
        };
      }

      // Handle direct field updates
      if (typeof s[field as keyof Student] === 'number') {
        const max = MAX_SCORES[field as keyof typeof MAX_SCORES] || 100;
        const numVal = Math.min(max, Math.max(0, Number(value) || 0));
        return { ...s, [field]: numVal };
      }

      return { ...s, [field]: value };
    }));
  };

  const toggleExpand = (id: string) => {
    setIsExpanded(prev => ({ ...prev, [id]: !prev[id] }));
  };

  const stats = useMemo(() => {
    if (students.length === 0) return { avg: 0, passRate: 0 };
    const totals = students.map(calculateTotal);
    const avg = totals.reduce((a, b) => a + b, 0) / students.length;
    const passCount = totals.filter(t => t >= 50).length;
    return {
      avg: avg.toFixed(2),
      passRate: ((passCount / students.length) * 100).toFixed(1)
    };
  }, [students]);

  return (
    <div className="min-h-screen bg-[#f8fafc] text-slate-900 font-sans p-4 md:p-8">
      <div className="max-w-7xl mx-auto space-y-8">
        
        {/* Header */}
        <header className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-indigo-600">
              <GraduationCap className="w-8 h-8" />
              <h1 className="text-3xl font-bold tracking-tight">Student Grade Tracker</h1>
            </div>
            <p className="text-slate-500">ระบบบันทึกและคำนวณคะแนนนักเรียนอัตโนมัติ</p>
          </div>
          
          <div className="flex items-center gap-3">
            {isGoogleAuth ? (
              <div className="flex items-center gap-2">
                {spreadsheetUrl && (
                  <a 
                    href={spreadsheetUrl} 
                    target="_blank" 
                    rel="noopener noreferrer"
                    className="flex items-center gap-1.5 text-xs font-bold text-emerald-600 bg-emerald-50 px-3 py-2 rounded-xl border border-emerald-100 hover:bg-emerald-100 transition-colors"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                    เปิด Google Sheets
                  </a>
                )}
                <button 
                  onClick={handleSyncToSheets}
                  disabled={isSyncing}
                  className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2.5 rounded-xl font-medium transition-all shadow-sm hover:shadow-md active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isSyncing ? <Loader2 className="w-5 h-5 animate-spin" /> : <CloudCheck className="w-5 h-5" />}
                  {isSyncing ? 'กำลังซิงค์...' : 'ซิงค์ข้อมูล'}
                </button>
              </div>
            ) : (
              <button 
                onClick={handleGoogleConnect}
                className="flex items-center gap-2 bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 px-4 py-2.5 rounded-xl font-medium transition-all shadow-sm hover:shadow-md active:scale-95"
              >
                <Cloud className="w-5 h-5 text-indigo-600" />
                เชื่อมต่อ Google Sheets
              </button>
            )}
            <button 
              onClick={addStudent}
              className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2.5 rounded-xl font-medium transition-all shadow-sm hover:shadow-md active:scale-95"
            >
              <Plus className="w-5 h-5" />
              เพิ่มนักเรียน
            </button>
            <button 
              className="p-2.5 text-slate-600 hover:bg-slate-100 rounded-xl transition-colors border border-slate-200"
              title="Export to CSV"
            >
              <Download className="w-5 h-5" />
            </button>
          </div>
        </header>

        {/* Stats Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm flex items-center gap-4">
            <div className="p-3 bg-indigo-50 text-indigo-600 rounded-xl">
              <Users className="w-6 h-6" />
            </div>
            <div>
              <p className="text-sm font-medium text-slate-500">นักเรียนทั้งหมด</p>
              <p className="text-2xl font-bold">{students.length} คน</p>
            </div>
          </div>
          <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm flex items-center gap-4">
            <div className="p-3 bg-emerald-50 text-emerald-600 rounded-xl">
              <Calculator className="w-6 h-6" />
            </div>
            <div>
              <p className="text-sm font-medium text-slate-500">คะแนนเฉลี่ย</p>
              <p className="text-2xl font-bold">{stats.avg} / 100</p>
            </div>
          </div>
          <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm flex items-center gap-4">
            <div className="p-3 bg-amber-50 text-amber-600 rounded-xl">
              <Info className="w-6 h-6" />
            </div>
            <div>
              <p className="text-sm font-medium text-slate-500">อัตราการผ่าน</p>
              <p className="text-2xl font-bold">{stats.passRate}%</p>
            </div>
          </div>
        </div>

        {/* Main Table */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse min-w-[1000px]">
              <thead>
                <tr className="bg-slate-50/50 border-b border-slate-200">
                  <th className="p-4 font-semibold text-slate-600 text-sm w-16">เลขที่</th>
                  <th className="p-4 font-semibold text-slate-600 text-sm w-32">รหัสประจำตัว</th>
                  <th className="p-4 font-semibold text-slate-600 text-sm">ชื่อ-นามสกุล</th>
                  <th className="p-4 font-semibold text-slate-600 text-sm text-center">พฤติกรรม (10)</th>
                  <th className="p-4 font-semibold text-slate-600 text-sm text-center">เข้าเรียน (10)</th>
                  <th className="p-4 font-semibold text-slate-600 text-sm text-center">งาน 1-3 (45)</th>
                  <th className="p-4 font-semibold text-slate-600 text-sm text-center">กลางภาค (15)</th>
                  <th className="p-4 font-semibold text-slate-600 text-sm text-center">ปลายภาค (20)</th>
                  <th className="p-4 font-semibold text-indigo-600 text-sm text-center">รวม (100)</th>
                  <th className="p-4 font-semibold text-indigo-600 text-sm text-center">เกรด</th>
                  <th className="p-4 w-16"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                <AnimatePresence initial={false}>
                  {students.map((student) => {
                    const total = calculateTotal(student);
                    const grade = getGrade(total);
                    const isExp = isExpanded[student.id];

                    return (
                      <React.Fragment key={student.id}>
                        <motion.tr 
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          exit={{ opacity: 0 }}
                          className="hover:bg-slate-50/30 transition-colors group"
                        >
                          <td className="p-4">
                            <input 
                              type="text" 
                              value={student.no}
                              onChange={(e) => updateStudent(student.id, 'no', e.target.value)}
                              className="w-full bg-transparent border-none focus:ring-0 text-slate-600 font-medium text-center"
                            />
                          </td>
                          <td className="p-4">
                            <input 
                              type="text" 
                              placeholder="รหัส..."
                              value={student.studentId}
                              onChange={(e) => updateStudent(student.id, 'studentId', e.target.value)}
                              className="w-full bg-transparent border-none focus:ring-0 text-slate-600"
                            />
                          </td>
                          <td className="p-4">
                            <input 
                              type="text" 
                              placeholder="ชื่อ-นามสกุล..."
                              value={student.name}
                              onChange={(e) => updateStudent(student.id, 'name', e.target.value)}
                              className="w-full bg-transparent border-none focus:ring-0 font-medium"
                            />
                          </td>
                          <td className="p-4 text-center">
                            <input 
                              type="number" 
                              value={student.behavior}
                              max={10}
                              onChange={(e) => updateStudent(student.id, 'behavior', e.target.value)}
                              className="w-16 bg-slate-100/50 border border-slate-200 rounded-lg px-2 py-1 text-center focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none"
                            />
                          </td>
                          <td className="p-4 text-center">
                            <input 
                              type="number" 
                              value={student.attendance}
                              max={10}
                              onChange={(e) => updateStudent(student.id, 'attendance', e.target.value)}
                              className="w-16 bg-slate-100/50 border border-slate-200 rounded-lg px-2 py-1 text-center focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none"
                            />
                          </td>
                          <td className="p-4 text-center">
                            <button 
                              onClick={() => toggleExpand(student.id)}
                              className="flex items-center justify-center gap-1 mx-auto bg-indigo-50 text-indigo-600 px-3 py-1 rounded-full text-sm font-semibold hover:bg-indigo-100 transition-colors"
                            >
                              {student.assignment1.part1 + student.assignment1.part2 + student.assignment1.part3 +
                               student.assignment2.part1 + student.assignment2.part2 + student.assignment2.part3 +
                               student.assignment3.part1 + student.assignment3.part2 + student.assignment3.part3}
                              {isExp ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                            </button>
                          </td>
                          <td className="p-4 text-center">
                            <input 
                              type="number" 
                              value={student.midterm}
                              max={15}
                              onChange={(e) => updateStudent(student.id, 'midterm', e.target.value)}
                              className="w-16 bg-slate-100/50 border border-slate-200 rounded-lg px-2 py-1 text-center focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none"
                            />
                          </td>
                          <td className="p-4 text-center">
                            <input 
                              type="number" 
                              value={student.final}
                              max={20}
                              onChange={(e) => updateStudent(student.id, 'final', e.target.value)}
                              className="w-16 bg-slate-100/50 border border-slate-200 rounded-lg px-2 py-1 text-center focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none"
                            />
                          </td>
                          <td className="p-4 text-center font-bold text-indigo-600 text-lg">
                            {total}
                          </td>
                          <td className="p-4 text-center">
                            <span className={`px-3 py-1 rounded-full text-sm font-bold ${
                              Number(grade) >= 3 ? 'bg-emerald-100 text-emerald-700' : 
                              Number(grade) >= 1 ? 'bg-amber-100 text-amber-700' : 
                              'bg-rose-100 text-rose-700'
                            }`}>
                              {grade}
                            </span>
                          </td>
                          <td className="p-4">
                            <button 
                              onClick={() => removeStudent(student.id)}
                              className="p-2 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-all opacity-0 group-hover:opacity-100"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </td>
                        </motion.tr>

                        {/* Expanded Sub-scores */}
                        <AnimatePresence>
                          {isExp && (
                            <motion.tr
                              initial={{ height: 0, opacity: 0 }}
                              animate={{ height: 'auto', opacity: 1 }}
                              exit={{ height: 0, opacity: 0 }}
                              className="bg-indigo-50/20 overflow-hidden"
                            >
                              <td colSpan={11} className="p-6">
                                <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
                                  {[1, 2, 3].map((num) => {
                                    const key = `assignment${num}` as 'assignment1' | 'assignment2' | 'assignment3';
                                    const score = student[key];
                                    const sum = score.part1 + score.part2 + score.part3;
                                    
                                    return (
                                      <div key={key} className="space-y-3 bg-white p-4 rounded-xl border border-indigo-100 shadow-sm">
                                        <div className="flex justify-between items-center border-b border-indigo-50 pb-2">
                                          <h4 className="font-bold text-indigo-700">งานที่ {num}</h4>
                                          <span className="text-sm font-bold text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded">
                                            {sum} / 15
                                          </span>
                                        </div>
                                        <div className="grid grid-cols-3 gap-2">
                                          {['part1', 'part2', 'part3'].map((part, idx) => (
                                            <div key={part} className="space-y-1">
                                              <label className="text-[10px] uppercase tracking-wider text-slate-400 font-bold">ส่วน {idx + 1}</label>
                                              <input 
                                                type="number"
                                                max={5}
                                                value={score[part as keyof SubScores]}
                                                onChange={(e) => updateStudent(student.id, `${key}.${part}`, e.target.value)}
                                                className="w-full bg-slate-50 border border-slate-200 rounded-lg px-2 py-1.5 text-center text-sm focus:ring-2 focus:ring-indigo-500 outline-none"
                                              />
                                            </div>
                                          ))}
                                        </div>
                                      </div>
                                    );
                                  })}
                                </div>
                              </td>
                            </motion.tr>
                          )}
                        </AnimatePresence>
                      </React.Fragment>
                    );
                  })}
                </AnimatePresence>
              </tbody>
            </table>
          </div>

          {students.length === 0 && (
            <div className="p-12 text-center space-y-4">
              <div className="mx-auto w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center text-slate-400">
                <Users className="w-8 h-8" />
              </div>
              <div className="space-y-1">
                <p className="text-slate-900 font-medium">ยังไม่มีข้อมูลนักเรียน</p>
                <p className="text-slate-500 text-sm">คลิกปุ่ม "เพิ่มนักเรียน" เพื่อเริ่มบันทึกคะแนน</p>
              </div>
              <button 
                onClick={addStudent}
                className="inline-flex items-center gap-2 bg-indigo-600 text-white px-4 py-2 rounded-xl font-medium hover:bg-indigo-700 transition-colors"
              >
                <Plus className="w-5 h-5" />
                เพิ่มนักเรียนคนแรก
              </button>
            </div>
          )}
        </div>

        {/* Footer Info */}
        <footer className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
          <div className="flex flex-col md:flex-row justify-between gap-6">
            <div className="space-y-3">
              <h3 className="font-bold text-slate-800 flex items-center gap-2">
                <Info className="w-5 h-5 text-indigo-600" />
                เกณฑ์การตัดเกรด
              </h3>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {GRADING_SCALE.map((s, i) => (
                  <div key={i} className="text-xs flex justify-between bg-slate-50 p-2 rounded-lg border border-slate-100">
                    <span className="text-slate-500 font-medium">≥ {s.min}</span>
                    <span className="font-bold text-indigo-600">เกรด {s.grade}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="flex items-end">
              <div className="text-right space-y-1">
                <p className="text-xs text-slate-400 font-medium uppercase tracking-widest">Auto-saved to Local Storage</p>
                <div className="flex items-center justify-end gap-2 text-emerald-600">
                  <Save className="w-4 h-4" />
                  <span className="text-sm font-bold">บันทึกข้อมูลเรียบร้อย</span>
                </div>
              </div>
            </div>
          </div>
        </footer>
      </div>
    </div>
  );
}
