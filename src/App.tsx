import React, { useState, useEffect, useMemo } from 'react';
import { 
  Plus, 
  Trash2, 
  Save, 
  Download, 
  Users, 
  Calculator, 
  GraduationCap,
  ChevronRight,
  ChevronDown,
  Info,
  Cloud,
  CloudCheck,
  ExternalLink,
  Loader2,
  Search,
  FileText,
  CheckCircle2,
  Clock,
  User,
  Upload,
  BookOpen,
  Settings,
  X
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
  behavior: number;
  attendance: number;
  assignment1: SubScores;
  assignment2: SubScores;
  assignment3: SubScores;
  midterm: number;
  final: number;
}

interface Subject {
  id: string;
  name: string;
}

interface ClassRoom {
  id: string;
  name: string;
}

interface AppData {
  subjects: Subject[];
  classRooms: ClassRoom[];
  courses: Record<string, Student[]>;
}

// --- Constants ---
const GRADING_SCALE = [
  { min: 80, grade: '4' },
  { min: 75, grade: '3.5' },
  { min: 70, grade: '3' },
  { min: 65, grade: '2.5' },
  { min: 60, grade: '2' },
  { min: 55, grade: '1.5' },
  { min: 50, grade: '1' },
  { min: 0, grade: '0' },
];

const MAX_SCORES = {
  behavior: 10,
  attendance: 10,
  assignment: 15, // per assignment
  midterm: 15,
  final: 20
};

// --- Helpers ---
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
  const [appData, setAppData] = useState<AppData>(() => {
    const saved = localStorage.getItem('student-tracker-data');
    if (saved) return JSON.parse(saved);
    
    // Default initial data
    const defaultSubject = { id: 's1', name: 'วิชาพื้นฐาน' };
    const defaultClass = { id: 'c1', name: 'ม.6/1' };
    return {
      subjects: [defaultSubject],
      classRooms: [defaultClass],
      courses: {
        [`${defaultSubject.id}-${defaultClass.id}`]: [
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
            final: 18
          }
        ]
      }
    };
  });

  const [selectedSubjectId, setSelectedSubjectId] = useState(appData.subjects[0]?.id || '');
  const [selectedClassId, setSelectedClassId] = useState(appData.classRooms[0]?.id || '');
  const [isManageModalOpen, setIsManageModalOpen] = useState(false);
  const [manageType, setManageType] = useState<'subject' | 'class'>('subject');
  const [newItemName, setNewItemName] = useState('');

  const currentCourseKey = `${selectedSubjectId}-${selectedClassId}`;
  const students = useMemo(() => appData.courses[currentCourseKey] || [], [appData.courses, currentCourseKey]);

  const setStudents = (newStudents: Student[]) => {
    setAppData(prev => ({
      ...prev,
      courses: {
        ...prev.courses,
        [currentCourseKey]: newStudents
      }
    }));
  };

  const [isExpanded, setIsExpanded] = useState<Record<string, boolean>>({});
  const [isGoogleAuth, setIsGoogleAuth] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [spreadsheetUrl, setSpreadsheetUrl] = useState<string | null>(null);
  const [view, setView] = useState<'teacher' | 'student'>('teacher');

  // Student Portal State
  const [searchId, setSearchId] = useState('');
  const [foundStudent, setFoundStudent] = useState<Student | null>(null);

  useEffect(() => {
    localStorage.setItem('student-tracker-data', JSON.stringify(appData));
  }, [appData]);

  useEffect(() => {
    const checkAuth = async () => {
      try {
        const res = await fetch('/api/auth/status');
        const data = await res.json();
        setIsGoogleAuth(data.authenticated);
      } catch (err) {
        console.error('Failed to check auth status', err);
      }
    };
    checkAuth();

    const handleMessage = (event: MessageEvent) => {
      if (event.data === 'OAUTH_AUTH_SUCCESS') {
        setIsGoogleAuth(true);
        alert('เชื่อมต่อ Google Sheets สำเร็จ!');
      }
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  const handleGoogleConnect = async () => {
    const popup = window.open('', 'GoogleOAuth', 'width=600,height=700');
    if (!popup) {
      alert('กรุณาอนุญาตให้เปิดหน้าต่าง Pop-up เพื่อเชื่อมต่อ Google');
      return;
    }
    popup.document.write('<div style="font-family:sans-serif;text-align:center;padding-top:100px;"><h2>กำลังเตรียมการเชื่อมต่อ Google...</h2><p>กรุณารอสักครู่</p></div>');

    try {
      const res = await fetch('/api/auth/google/url');
      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.error || 'Failed to get auth URL');
      }
      const { url } = await res.json();
      popup.location.href = url;
    } catch (err) {
      console.error('Connection error:', err);
      popup.close();
      alert(`ไม่สามารถเชื่อมต่อได้: ${err instanceof Error ? err.message : 'Unknown error'}`);
    }
  };

  const handleSyncToSheets = async () => {
    setIsSyncing(true);
    try {
      const res = await fetch('/api/sheets/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ students })
      });
      
      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.error || 'Sync failed');
      }
      
      const data = await res.json();
      setSpreadsheetUrl(data.url);
      alert('ซิงค์ข้อมูลไปยัง Google Sheets เรียบร้อยแล้ว!');
    } catch (err) {
      console.error('Sync error:', err);
      alert(`เกิดข้อผิดพลาดในการซิงค์: ${err instanceof Error ? err.message : 'Unknown error'}`);
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
      final: 0
    };
    setStudents([...students, newStudent]);
  };

  const removeStudent = (id: string) => {
    setStudents(students.filter(s => s.id !== id));
  };

  const updateStudent = (id: string, field: string, value: any) => {
    setStudents(students.map(s => {
      if (s.id !== id) return s;
      
      // Handle nested assignment updates
      if (field.includes('.')) {
        const [obj, part] = field.split('.');
        const assignmentKey = obj as keyof Student;
        const currentAssignment = s[assignmentKey] as SubScores;
        
        return {
          ...s,
          [assignmentKey]: {
            ...currentAssignment,
            [part]: Math.min(5, Math.max(0, Number(value) || 0))
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

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result as string;
      const lines = text.split('\n');
      const newStudents: Student[] = [...students];

      // Simple CSV parsing: No, StudentId, Name
      for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;
        const parts = line.split(',').map(p => p.trim());
        if (parts.length < 3) continue;

        newStudents.push({
          id: crypto.randomUUID(),
          no: parts[0],
          studentId: parts[1],
          name: parts[2],
          behavior: 0,
          attendance: 0,
          assignment1: { part1: 0, part2: 0, part3: 0 },
          assignment2: { part1: 0, part2: 0, part3: 0 },
          assignment3: { part1: 0, part2: 0, part3: 0 },
          midterm: 0,
          final: 0
        });
      }
      setStudents(newStudents);
      alert(`นำเข้าข้อมูลนักเรียน ${newStudents.length - students.length} คน เรียบร้อยแล้ว`);
    };
    reader.readAsText(file);
  };

  const addSubject = () => {
    if (!newItemName.trim()) return;
    const id = `s-${Date.now()}`;
    setAppData(prev => ({
      ...prev,
      subjects: [...prev.subjects, { id, name: newItemName.trim() }]
    }));
    setNewItemName('');
  };

  const addClass = () => {
    if (!newItemName.trim()) return;
    const id = `c-${Date.now()}`;
    setAppData(prev => ({
      ...prev,
      classRooms: [...prev.classRooms, { id, name: newItemName.trim() }]
    }));
    setNewItemName('');
  };

  const removeSubject = (id: string) => {
    if (appData.subjects.length <= 1) return;
    
    setAppData(prev => {
      const newCourses = { ...prev.courses };
      Object.keys(newCourses).forEach(key => {
        if (key.startsWith(`${id}-`)) delete newCourses[key];
      });
      
      const newSubjects = prev.subjects.filter(s => s.id !== id);
      
      // Update selected subject if the deleted one was selected
      if (selectedSubjectId === id) {
        setSelectedSubjectId(newSubjects[0]?.id || '');
      }

      return {
        ...prev,
        subjects: newSubjects,
        courses: newCourses
      };
    });
  };

  const removeClass = (id: string) => {
    if (appData.classRooms.length <= 1) return;

    setAppData(prev => {
      const newCourses = { ...prev.courses };
      Object.keys(newCourses).forEach(key => {
        if (key.endsWith(`-${id}`)) delete newCourses[key];
      });
      
      const newClassRooms = prev.classRooms.filter(c => c.id !== id);

      // Update selected class if the deleted one was selected
      if (selectedClassId === id) {
        setSelectedClassId(newClassRooms[0]?.id || '');
      }

      return {
        ...prev,
        classRooms: newClassRooms,
        courses: newCourses
      };
    });
  };

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    // Search across all courses
    let found: Student | null = null;
    for (const key in appData.courses) {
      const student = appData.courses[key].find(s => s.studentId === searchId);
      if (student) {
        found = student;
        break;
      }
    }
    setFoundStudent(found);
    if (!found && searchId) {
      alert("ไม่พบข้อมูลนักเรียนรหัสนี้");
    }
  };

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
          
          <div className="flex items-center bg-slate-100 p-1 rounded-xl border border-slate-200">
            <button 
              onClick={() => setView('teacher')}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-all ${
                view === 'teacher' ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              <Users className="w-4 h-4" />
              สำหรับครู
            </button>
            <button 
              onClick={() => setView('student')}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-all ${
                view === 'student' ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              <User className="w-4 h-4" />
              สำหรับนักเรียน
            </button>
          </div>

          {view === 'teacher' && (
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-2 bg-white border border-slate-200 rounded-xl px-3 py-1.5 shadow-sm">
                <BookOpen className="w-4 h-4 text-indigo-600" />
                <select 
                  value={selectedSubjectId}
                  onChange={(e) => setSelectedSubjectId(e.target.value)}
                  className="bg-transparent border-none outline-none text-sm font-bold text-slate-700 pr-8"
                >
                  {appData.subjects.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
                <button 
                  onClick={() => { setManageType('subject'); setIsManageModalOpen(true); }}
                  className="p-1 hover:bg-slate-100 rounded-lg transition-colors"
                >
                  <Settings className="w-4 h-4 text-slate-400" />
                </button>
              </div>

              <div className="flex items-center gap-2 bg-white border border-slate-200 rounded-xl px-3 py-1.5 shadow-sm">
                <Users className="w-4 h-4 text-indigo-600" />
                <select 
                  value={selectedClassId}
                  onChange={(e) => setSelectedClassId(e.target.value)}
                  className="bg-transparent border-none outline-none text-sm font-bold text-slate-700 pr-8"
                >
                  {appData.classRooms.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
                <button 
                  onClick={() => { setManageType('class'); setIsManageModalOpen(true); }}
                  className="p-1 hover:bg-slate-100 rounded-lg transition-colors"
                >
                  <Settings className="w-4 h-4 text-slate-400" />
                </button>
              </div>

              <div className="h-8 w-px bg-slate-200 mx-1 hidden md:block" />

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

              <label 
                className="flex items-center gap-2 bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 px-4 py-2.5 rounded-xl font-medium transition-all shadow-sm hover:shadow-md active:scale-95 cursor-pointer"
                title="รูปแบบไฟล์: เลขที่, รหัสประจำตัว, ชื่อ-นามสกุล"
              >
                <Upload className="w-5 h-5 text-indigo-600" />
                นำเข้าไฟล์ CSV
                <input type="file" accept=".csv" onChange={handleFileUpload} className="hidden" />
              </label>
            </div>
          )}
        </header>

        {view === 'teacher' ? (
          <>
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
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden mt-8">
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
          </>
        ) : (
          /* Student View */
          <div className="max-w-3xl mx-auto space-y-8">
            <div className="bg-white p-8 rounded-3xl border border-slate-200 shadow-sm space-y-6">
              <div className="text-center space-y-2">
                <h2 className="text-2xl font-bold text-slate-800">ระบบติดตามงานสำหรับนักเรียน</h2>
                <p className="text-slate-500">กรอกรหัสประจำตัวเพื่อตรวจสอบคะแนนและสถานะการส่งงาน</p>
              </div>

              <form onSubmit={handleSearch} className="flex gap-2">
                <div className="relative flex-1">
                  <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                  <input 
                    type="text" 
                    placeholder="กรอกรหัสประจำตัวนักเรียน (เช่น 66001)"
                    value={searchId}
                    onChange={(e) => setSearchId(e.target.value)}
                    className="w-full pl-12 pr-4 py-4 bg-slate-50 border border-slate-200 rounded-2xl focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none text-lg font-medium"
                  />
                </div>
                <button 
                  type="submit"
                  className="bg-indigo-600 hover:bg-indigo-700 text-white px-8 py-4 rounded-2xl font-bold transition-all shadow-sm hover:shadow-md active:scale-95"
                >
                  ค้นหา
                </button>
              </form>
            </div>

            <AnimatePresence mode="wait">
              {foundStudent ? (
                <motion.div 
                  key={foundStudent.id}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -20 }}
                  className="space-y-6"
                >
                  {/* Student Info Card */}
                  <div className="bg-white p-8 rounded-3xl border border-slate-200 shadow-sm grid grid-cols-1 md:grid-cols-2 gap-8">
                    <div className="space-y-4">
                      <div className="flex items-center gap-4">
                        <div className="w-16 h-16 bg-indigo-100 text-indigo-600 rounded-2xl flex items-center justify-center">
                          <User className="w-8 h-8" />
                        </div>
                        <div>
                          <p className="text-sm font-bold text-indigo-600 uppercase tracking-wider">ข้อมูลนักเรียน</p>
                          <h3 className="text-2xl font-bold text-slate-800">{foundStudent.name}</h3>
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-4">
                        <div className="bg-slate-50 p-3 rounded-xl border border-slate-100">
                          <p className="text-xs text-slate-400 font-bold uppercase">รหัสประจำตัว</p>
                          <p className="font-bold text-slate-700">{foundStudent.studentId}</p>
                        </div>
                        <div className="bg-slate-50 p-3 rounded-xl border border-slate-100">
                          <p className="text-xs text-slate-400 font-bold uppercase">เลขที่</p>
                          <p className="font-bold text-slate-700">{foundStudent.no}</p>
                        </div>
                      </div>
                    </div>

                    <div className="flex flex-col items-center justify-center bg-indigo-50/50 rounded-3xl p-6 border border-indigo-100">
                      <p className="text-sm font-bold text-indigo-600 uppercase tracking-wider mb-1">เกรดเฉลี่ยปัจจุบัน</p>
                      <div className="text-6xl font-black text-indigo-600 mb-2">
                        {getGrade(calculateTotal(foundStudent))}
                      </div>
                      <p className="text-sm text-indigo-400 font-medium">คะแนนรวม {calculateTotal(foundStudent)} / 100</p>
                    </div>
                  </div>

                  {/* Assignment Status */}
                  <div className="bg-white p-8 rounded-3xl border border-slate-200 shadow-sm space-y-6">
                    <h3 className="text-xl font-bold text-slate-800 flex items-center gap-2">
                      <FileText className="w-6 h-6 text-indigo-600" />
                      สถานะการส่งงาน
                    </h3>
                    <div className="grid grid-cols-1 gap-4">
                      {[1, 2, 3].map(num => {
                        const key = `assignment${num}` as 'assignment1' | 'assignment2' | 'assignment3';
                        const score = foundStudent[key];
                        const total = score.part1 + score.part2 + score.part3;
                        const isDone = total > 0;

                        return (
                          <div key={num} className="flex items-center justify-between p-4 bg-slate-50 rounded-2xl border border-slate-100">
                            <div className="flex items-center gap-4">
                              <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${
                                isDone ? 'bg-emerald-100 text-emerald-600' : 'bg-amber-100 text-amber-600'
                              }`}>
                                {isDone ? <CheckCircle2 className="w-6 h-6" /> : <Clock className="w-6 h-6" />}
                              </div>
                              <div>
                                <h4 className="font-bold text-slate-800">งานที่ {num}</h4>
                                <p className="text-sm text-slate-500">
                                  {isDone ? `ได้รับคะแนนแล้ว: ${total} / 15` : 'ยังไม่ได้ส่งงาน หรือยังไม่ได้รับคะแนน'}
                                </p>
                              </div>
                            </div>
                            <button 
                              className={`px-4 py-2 rounded-xl font-bold text-sm transition-all ${
                                isDone 
                                ? 'bg-emerald-50 text-emerald-600 border border-emerald-100 cursor-default' 
                                : 'bg-indigo-600 text-white hover:bg-indigo-700 shadow-sm'
                              }`}
                            >
                              {isDone ? 'ส่งแล้ว' : 'ส่งงานที่นี่'}
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </motion.div>
              ) : searchId && (
                <motion.div 
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="text-center p-12 bg-white rounded-3xl border border-slate-200 shadow-sm space-y-4"
                >
                  <div className="w-20 h-20 bg-slate-100 rounded-full flex items-center justify-center mx-auto text-slate-400">
                    <Search className="w-10 h-10" />
                  </div>
                  <div className="space-y-1">
                    <h3 className="text-xl font-bold text-slate-800">ไม่พบข้อมูลนักเรียน</h3>
                    <p className="text-slate-500">กรุณาตรวจสอบรหัสประจำตัวอีกครั้ง หรือติดต่ออาจารย์ผู้สอน</p>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )}

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

      {/* Management Modal */}
      <AnimatePresence>
        {isManageModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsManageModalOpen(false)}
              className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="relative w-full max-w-md bg-white rounded-3xl shadow-2xl border border-slate-200 overflow-hidden"
            >
              <div className="p-6 border-b border-slate-100 flex justify-between items-center">
                <h3 className="text-xl font-bold text-slate-800">
                  จัดการ{manageType === 'subject' ? 'วิชา' : 'ห้องเรียน'}
                </h3>
                <button onClick={() => setIsManageModalOpen(false)} className="p-2 hover:bg-slate-100 rounded-xl transition-colors">
                  <X className="w-5 h-5 text-slate-400" />
                </button>
              </div>
              
              <div className="p-6 space-y-6">
                <div className="flex gap-2">
                  <input 
                    type="text" 
                    placeholder={`ชื่อ${manageType === 'subject' ? 'วิชา' : 'ห้อง'}ใหม่...`}
                    value={newItemName}
                    onChange={(e) => setNewItemName(e.target.value)}
                    className="flex-1 bg-slate-50 border border-slate-200 rounded-xl px-4 py-2 outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                  <button 
                    onClick={manageType === 'subject' ? addSubject : addClass}
                    className="bg-indigo-600 text-white px-4 py-2 rounded-xl font-bold hover:bg-indigo-700 transition-colors"
                  >
                    เพิ่ม
                  </button>
                </div>

                <div className="space-y-2 max-h-60 overflow-y-auto pr-2">
                  {(manageType === 'subject' ? appData.subjects : appData.classRooms).map(item => (
                    <div key={item.id} className="flex items-center justify-between p-3 bg-slate-50 rounded-xl border border-slate-100">
                      <span className="font-medium text-slate-700">{item.name}</span>
                      <button 
                        onClick={() => manageType === 'subject' ? removeSubject(item.id) : removeClass(item.id)}
                        className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-all"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
