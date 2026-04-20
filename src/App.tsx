import React, { useState, useEffect, useMemo } from 'react';
import { 
  Plus, Trash2, Save, Users, Calculator, GraduationCap, 
  ChevronRight, ChevronDown, Info, Cloud, CloudCheck, ExternalLink, 
  Loader2, Search, FileText, CheckCircle2, Clock, User, Upload, 
  BookOpen, Settings, X, Menu, LayoutDashboard
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  collection, onSnapshot, doc, setDoc, updateDoc, 
  deleteDoc, query, where, getDocs 
} from 'firebase/firestore';
import { onAuthStateChanged, User as FirebaseUser } from 'firebase/auth';
import { db, auth, signInWithGoogle } from './lib/firebase';

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
  courseKey: string;
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

interface Assignment {
  id: string;
  title: string;
  description: string;
  maxScore: number;
  courseKey: string;
}

interface Submission {
  id: string;
  assignmentId: string;
  studentId: string;
  fileUrl: string;
  fileName: string;
  status: 'pending' | 'graded';
  score: number;
  submittedAt: string;
}

interface AppData {
  subjects: Subject[];
  classRooms: ClassRoom[];
  courses: Record<string, Student[]>;
  assignments: Assignment[];
  submissions: Submission[];
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
  const a1 = (student.assignment1?.part1 || 0) + (student.assignment1?.part2 || 0) + (student.assignment1?.part3 || 0);
  const a2 = (student.assignment2?.part1 || 0) + (student.assignment2?.part2 || 0) + (student.assignment2?.part3 || 0);
  const a3 = (student.assignment3?.part1 || 0) + (student.assignment3?.part2 || 0) + (student.assignment3?.part3 || 0);
  
  return (
    (student.behavior || 0) +
    (student.attendance || 0) +
    a1 + a2 + a3 +
    (student.midterm || 0) +
    (student.final || 0)
  );
};

const getGrade = (total: number): string => {
  for (const scale of GRADING_SCALE) {
    if (total >= scale.min) return scale.grade;
  }
  return '0';
};

export default function App() {
  const [appData, setAppData] = useState<AppData>({
    subjects: [],
    classRooms: [],
    courses: {},
    assignments: [],
    submissions: []
  });

  const [selectedSubjectId, setSelectedSubjectId] = useState('');
  const [selectedClassId, setSelectedClassId] = useState('');
  const [user, setUser] = useState<FirebaseUser | null>(null);

  // Firebase Auth Listener
  useEffect(() => {
    return onAuthStateChanged(auth, (u) => {
      setUser(u);
    });
  }, []);

  // Firebase Real-time listeners
  useEffect(() => {
    // Subjects
    const unsubSubjects = onSnapshot(collection(db, 'subjects'), (snap) => {
      const subjects = snap.docs.map(d => d.data() as Subject);
      setAppData(prev => ({ ...prev, subjects }));
      if (!selectedSubjectId && subjects.length > 0) setSelectedSubjectId(subjects[0].id);
    });

    // Classrooms
    const unsubClasses = onSnapshot(collection(db, 'classRooms'), (snap) => {
      const classRooms = snap.docs.map(d => d.data() as ClassRoom);
      setAppData(prev => ({ ...prev, classRooms }));
      if (!selectedClassId && classRooms.length > 0) setSelectedClassId(classRooms[0].id);
    });

    // Assignments
    const unsubAssignments = onSnapshot(collection(db, 'assignments'), (snap) => {
      setAppData(prev => ({ ...prev, assignments: snap.docs.map(d => d.data() as Assignment) }));
    });

    // Submissions - Conditional to avoid Permission Denied
    let unsubSubmissions = () => {};
    const isTeacher = user?.email === 'watcharaphon_pa@t-tech.ac.th';

    if (isTeacher) {
      unsubSubmissions = onSnapshot(collection(db, 'submissions'), (snap) => {
        setAppData(prev => ({ ...prev, submissions: snap.docs.map(d => d.data() as Submission) }));
      });
    } else if (user) {
      // If student logged in, only see their own
      const q = query(collection(db, 'submissions'), where('studentId', '==', user.uid));
      unsubSubmissions = onSnapshot(q, (snap) => {
        setAppData(prev => ({ ...prev, submissions: snap.docs.map(d => d.data() as Submission) }));
      });
    }

    // Students (Combined into courses locally for compatibility with existing UI)
    const unsubStudents = onSnapshot(collection(db, 'students'), (snap) => {
      const allStudents = snap.docs.map(d => d.data() as Student);
      
      // Sort numerically by 'no'
      allStudents.sort((a, b) => (Number(a.no) || 0) - (Number(b.no) || 0));

      const courses: Record<string, Student[]> = {};
      allStudents.forEach(s => {
        if (!courses[s.courseKey]) courses[s.courseKey] = [];
        courses[s.courseKey].push(s);
      });
      setAppData(prev => ({ ...prev, courses }));
    });

    return () => {
      unsubSubjects();
      unsubClasses();
      unsubAssignments();
      unsubSubmissions();
      unsubStudents();
    };
  }, [user]); // Re-run when user changes to update submission listener
  const [isManageModalOpen, setIsManageModalOpen] = useState(false);
  const [manageType, setManageType] = useState<'subject' | 'class' | 'assignment'>('subject');
  const [newItemName, setNewItemName] = useState('');
  const [newAssignmentDesc, setNewAssignmentDesc] = useState('');
  const [newAssignmentScore, setNewAssignmentScore] = useState(10);

  const currentCourseKey = `${selectedSubjectId}-${selectedClassId}`;
  const students = useMemo(() => (appData.courses || {})[currentCourseKey] || [], [appData.courses, currentCourseKey]);
  const currentAssignments = useMemo(() => (appData.assignments || []).filter(a => a.courseKey === currentCourseKey), [appData.assignments, currentCourseKey]);

  const [isUploading, setIsUploading] = useState<Record<string, boolean>>({});

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
  const [teacherTab, setTeacherTab] = useState<'grades' | 'assignments' | 'submissions'>('grades');

  // Student Portal State
  const [searchId, setSearchId] = useState('');
  const [foundStudent, setFoundStudent] = useState<Student | null>(null);

  // Remove LocalStorage sync
  // useEffect(() => {
  //   localStorage.setItem('student-tracker-data', JSON.stringify(appData));
  // }, [appData]);

  useEffect(() => {
    const checkAuth = async () => {
      try {
        const res = await fetch('/api/auth/status');
        const data = await res.json();
        setIsGoogleAuth(!!data.isAuthenticated);
      } catch (err) {
        console.error('Failed to check auth status', err);
      }
    };
    checkAuth();

    const handleMessage = (event: MessageEvent) => {
      if (event.data === 'OAUTH_AUTH_SUCCESS' || event.data?.type === 'OAUTH_AUTH_SUCCESS') {
        setIsGoogleAuth(true);
        alert('✅ เชื่อมต่อ Google Sheets สำเร็จ!');
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

  const handleFirebaseLogin = async () => {
    try {
      await signInWithGoogle();
    } catch (err: any) {
      console.error('Firebase Login Error:', err);
      // Give more specific error message to help the user fix deployment issues
      if (err.code === 'auth/unauthorized-domain') {
        alert('❌ เข้าสู่ระบบไม่สำเร็จ: โดเมนนี้ยังไม่ได้รับอนุญาตใน Firebase Console\n\nวิธีแก้ไข:\n1. ไปที่ Firebase Console\n2. เข้าเมนู Authentication > Settings > Authorized domains\n3. เพิ่มโดเมน vercel.app ของคุณเข้าไป');
      } else {
        alert(`เข้าสู่ระบบไม่สำเร็จ: ${err.message || 'กรุณาลองใหม่อีกครั้ง'}`);
      }
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

  const addStudent = async () => {
    const id = crypto.randomUUID();
    const newStudent: Student = {
      id,
      no: (students.length + 1).toString(),
      studentId: '',
      name: '',
      courseKey: currentCourseKey,
      behavior: 0,
      attendance: 0,
      assignment1: { part1: 0, part2: 0, part3: 0 },
      assignment2: { part1: 0, part2: 0, part3: 0 },
      assignment3: { part1: 0, part2: 0, part3: 0 },
      midterm: 0,
      final: 0
    };
    await setDoc(doc(db, 'students', id), newStudent);
  };

  const removeStudent = async (id: string) => {
    await deleteDoc(doc(db, 'students', id));
  };

  const removeAllStudents = async () => {
    if (students.length === 0) return;
    
    const isTeacher = user?.email === 'watcharaphon_pa@t-tech.ac.th';
    if (!isTeacher) {
      alert('⚠️ เฉพาะครูที่เข้าสู่ระบบเท่านั้นที่สามารถลบรายชื่อนักเรียนได้');
      return;
    }

    if (window.confirm(`⚠️ คำเตือน: คุณกำลังจะลบรายชื่อนักเรียนทั้งหมดในห้องนี้ (${students.length} คน)\n\nการดำเนินการนี้ไม่สามารถย้อนกลับได้ ยืนยันที่จะลบหรือไม่?`)) {
      try {
        const promises = students.map(s => deleteDoc(doc(db, 'students', s.id)));
        await Promise.all(promises);
        alert('✅ ลบรายชื่อนักเรียนทั้งหมดเรียบร้อยแล้ว');
      } catch (err: any) {
        console.error('Error removing all students:', err);
        alert(`❌ เกิดข้อผิดพลาด: ${err.message || 'ไม่สามารถลบข้อมูลได้'}`);
      }
    }
  };

  const updateStudent = async (id: string, field: string, value: any) => {
    const studentRef = doc(db, 'students', id);
    const s = students.find(st => st.id === id);
    if (!s) return;

    let updateData: any = {};

    // Handle nested assignment updates
    if (field.includes('.')) {
      const [obj, part] = field.split('.');
      const assignmentKey = obj as keyof Student;
      const currentAssignment = (s[assignmentKey] || { part1: 0, part2: 0, part3: 0 }) as SubScores;
      
      updateData[assignmentKey] = {
        ...currentAssignment,
        [part]: Math.min(5, Math.max(0, Number(value) || 0))
      };
    } else {
      // Handle direct field updates
      if (typeof s[field as keyof Student] === 'number') {
        const max = MAX_SCORES[field as keyof typeof MAX_SCORES] || 100;
        const numVal = Math.min(max, Math.max(0, Number(value) || 0));
        updateData[field] = numVal;
      } else {
        updateData[field] = value;
      }
    }

    await updateDoc(studentRef, updateData);
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

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (event) => {
      const text = event.target?.result as string;
      const lines = text.split('\n');
      let count = 0;

      // Simple CSV parsing: No, StudentId, Name
      for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;
        const parts = line.split(',').map(p => p.trim());
        if (parts.length < 3) continue;

        const id = crypto.randomUUID();
        const newStudent: Student = {
          id,
          no: parts[0],
          studentId: parts[1],
          name: parts[2],
          courseKey: currentCourseKey,
          behavior: 0,
          attendance: 0,
          assignment1: { part1: 0, part2: 0, part3: 0 },
          assignment2: { part1: 0, part2: 0, part3: 0 },
          assignment3: { part1: 0, part2: 0, part3: 0 },
          midterm: 0,
          final: 0
        };
        await setDoc(doc(db, 'students', id), newStudent);
        count++;
      }
      alert(`นำเข้าข้อมูลนักเรียน ${count} คน เรียบร้อยแล้ว`);
    };
    reader.readAsText(file);
  };

  const addSubject = async () => {
    if (!newItemName.trim()) return;
    const id = `s-${Date.now()}`;
    await setDoc(doc(db, 'subjects', id), { id, name: newItemName.trim() });
    setNewItemName('');
  };

  const addClass = async () => {
    if (!newItemName.trim()) return;
    const id = `c-${Date.now()}`;
    await setDoc(doc(db, 'classRooms', id), { id, name: newItemName.trim() });
    setNewItemName('');
  };

  const addAssignment = async () => {
    if (!newItemName.trim()) return;
    const id = `a-${Date.now()}`;
    const newAssignment: Assignment = {
      id,
      title: newItemName.trim(),
      description: newAssignmentDesc.trim(),
      maxScore: newAssignmentScore,
      courseKey: currentCourseKey
    };
    await setDoc(doc(db, 'assignments', id), newAssignment);
    setNewItemName('');
    setNewAssignmentDesc('');
    setNewAssignmentScore(10);
  };

  const removeAssignment = async (id: string) => {
    if (window.confirm('ยืนยันการลบงาน? ข้อมูลการส่งงานจะหายไปด้วย')) {
      await deleteDoc(doc(db, 'assignments', id));
      // Optionally delete submissions for this assignment as well
      const toDelete = (appData.submissions || []).filter(s => s.assignmentId === id);
      for (const sub of toDelete) {
        await deleteDoc(doc(db, 'submissions', sub.id));
      }
    }
  };

  const handleStudentFileUpload = async (e: React.ChangeEvent<HTMLInputElement>, assignmentId: string, student: Student) => {
    const file = e.target.files?.[0];
    if (!file) return;

    console.log('Starting file upload for:', file.name, 'Student:', student.studentId);

    if (!isGoogleAuth) {
      console.warn('Upload attempted without Google Auth');
      alert('⚠️ กรุณาเชื่อมต่อ Google Drive ก่อนส่งงาน\n\nโหมดนักเรียนจำเป็นต้องให้อาจารย์เข้าสู่ระบบและ "เชื่อมต่อ Google Sheets" ก่อน เพื่อเปิดพื้นที่รับงานใน Drive');
      e.target.value = ''; // Reset input
      return;
    }

    setIsUploading(prev => ({ ...prev, [assignmentId]: true }));
    
    const formData = new FormData();
    formData.append('file', file);
    formData.append('studentId', student.studentId);
    formData.append('studentName', student.name);
    formData.append('assignmentId', assignmentId);

    try {
      console.log('Sending request to /api/drive/upload...');
      const res = await fetch('/api/drive/upload', {
        method: 'POST',
        body: formData
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        console.error('Server error during upload:', errorData);
        throw new Error(errorData.error || 'Upload failed');
      }
      
      const data = await res.json();
      console.log('Upload successful! File URL:', data.url);
      
      const subId = crypto.randomUUID();
      const newSubmission: Submission = {
        id: subId,
        assignmentId,
        studentId: student.studentId,
        fileUrl: data.url,
        fileName: file.name,
        status: 'pending',
        score: 0,
        submittedAt: new Date().toISOString()
      };

      await setDoc(doc(db, 'submissions', subId), newSubmission);

      alert('✅ ส่งงานเรียบร้อยแล้ว!\nงานของคุณถูกบันทึกใน Google Drive ของอาจารย์เรียบร้อย');
    } catch (err: any) {
      console.error('Final upload error:', err);
      alert(`❌ เกิดข้อผิดพลาด: ${err.message || 'ไม่สามารถติดต่อเซิร์ฟเวอร์ได้'}\n\nกรุณาลองใหม่อีกครั้ง หรือติดต่ออาจารย์ผู้สอน`);
    } finally {
      setIsUploading(prev => ({ ...prev, [assignmentId]: false }));
      if (e.target) e.target.value = ''; // Reset input to allow re-selection
    }
  };

  const updateSubmissionScore = async (submissionId: string, score: number) => {
    await updateDoc(doc(db, 'submissions', submissionId), { score, status: 'graded' });
  };

  const removeSubject = async (id: string) => {
    if ((appData.subjects || []).length <= 1) return;
    if (window.confirm('ยืนยันการลบวิชา? ข้อมูลนักเรียนและงานทั้งหมดในวิชานี้จะยังคงอยู่ในฐานข้อมูลแต่อาจเข้าถึงยากขึ้น')) {
      await deleteDoc(doc(db, 'subjects', id));
      if (selectedSubjectId === id) {
        setSelectedSubjectId(appData.subjects.find(s => s.id !== id)?.id || '');
      }
    }
  };

  const removeClass = async (id: string) => {
    if ((appData.classRooms || []).length <= 1) return;
    if (window.confirm('ยืนยันการลบห้องเรียน?')) {
      await deleteDoc(doc(db, 'classRooms', id));
      if (selectedClassId === id) {
        setSelectedClassId(appData.classRooms.find(c => c.id !== id)?.id || '');
      }
    }
  };

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    // Search across all courses
    let found: Student | null = null;
    for (const key in (appData.courses || {})) {
      const student = (appData.courses || {})[key].find(s => s.studentId === searchId);
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
          
          <div className="flex flex-wrap items-center gap-3">
            {user ? (
              <div className="flex items-center gap-2 bg-white border border-slate-200 rounded-xl px-3 py-1.5 shadow-sm">
                <img src={user.photoURL || ''} alt={user.displayName || ''} className="w-6 h-6 rounded-full" />
                <span className="text-sm font-medium hidden sm:inline">{user.displayName}</span>
                <button onClick={() => auth.signOut()} className="text-xs text-slate-400 hover:text-red-500 transition-colors">ออกระบบ</button>
              </div>
            ) : (
              <button 
                onClick={handleFirebaseLogin}
                className="flex items-center gap-2 bg-indigo-600 text-white px-4 py-2 rounded-xl font-medium hover:bg-indigo-700 transition-all shadow-sm"
              >
                <User className="w-4 h-4" />
                เข้าสู่ระบบครู
              </button>
            )}

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
        </div>

          {view === 'teacher' && (
            <div className="flex items-center bg-slate-100 p-1 rounded-xl border border-slate-200">
              <button 
                onClick={() => setTeacherTab('grades')}
                className={`px-4 py-2 rounded-lg font-medium transition-all ${
                  teacherTab === 'grades' ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                ตารางคะแนน
              </button>
              <button 
                onClick={() => setTeacherTab('assignments')}
                className={`px-4 py-2 rounded-lg font-medium transition-all ${
                  teacherTab === 'assignments' ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                จัดการงาน
              </button>
              <button 
                onClick={() => setTeacherTab('submissions')}
                className={`px-4 py-2 rounded-lg font-medium transition-all ${
                  teacherTab === 'submissions' ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                ตรวจงาน ({(appData.submissions || []).filter(s => s.status === 'pending').length})
              </button>
            </div>
          )}

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

              {students.length > 0 && (
                <button 
                  onClick={removeAllStudents}
                  className="flex items-center gap-2 bg-white hover:bg-rose-50 text-rose-600 border border-rose-200 px-4 py-2.5 rounded-xl font-medium transition-all shadow-sm hover:shadow-md active:scale-95"
                >
                  <Trash2 className="w-5 h-5" />
                  ลบรายชื่อทั้งหมด
                </button>
              )}
            </div>
          )}
        </header>

        {view === 'teacher' ? (
          <>
            {teacherTab === 'grades' && (
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
                                      {((student.assignment1?.part1 || 0) + (student.assignment1?.part2 || 0) + (student.assignment1?.part3 || 0) +
                                       (student.assignment2?.part1 || 0) + (student.assignment2?.part2 || 0) + (student.assignment2?.part3 || 0) +
                                       (student.assignment3?.part1 || 0) + (student.assignment3?.part2 || 0) + (student.assignment3?.part3 || 0))}
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
                                            const score = student[key] || { part1: 0, part2: 0, part3: 0 };
                                            const sum = (score.part1 || 0) + (score.part2 || 0) + (score.part3 || 0);
                                            
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
                                                        value={score[part as keyof SubScores] || 0}
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
            )}

            {teacherTab === 'assignments' && (
              <div className="max-w-4xl mx-auto space-y-8">
                <div className="bg-white p-8 rounded-3xl border border-slate-200 shadow-sm space-y-6">
                  <div className="flex items-center gap-3 border-b border-slate-100 pb-4">
                    <div className="p-3 bg-indigo-50 text-indigo-600 rounded-2xl">
                      <FileText className="w-6 h-6" />
                    </div>
                    <div>
                      <h2 className="text-2xl font-bold text-slate-800">สั่งงานใหม่</h2>
                      <p className="text-slate-500 text-sm">มอบหมายภาระงานให้กับนักเรียนในห้องเรียนที่เลือก</p>
                    </div>
                  </div>
                  
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="space-y-2">
                      <label className="text-sm font-bold text-slate-600">หัวข้องาน</label>
                      <input 
                        type="text" 
                        placeholder="เช่น ใบงานที่ 1 การเขียนโปรแกรม..."
                        value={newItemName}
                        onChange={(e) => setNewItemName(e.target.value)}
                        className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 outline-none focus:ring-2 focus:ring-indigo-500 text-lg font-medium"
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-sm font-bold text-slate-600">คะแนนเต็ม</label>
                      <input 
                        type="number" 
                        value={newAssignmentScore}
                        onChange={(e) => setNewAssignmentScore(Number(e.target.value))}
                        className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 outline-none focus:ring-2 focus:ring-indigo-500 text-lg font-medium"
                      />
                    </div>
                  </div>
                  
                  <div className="space-y-2">
                    <label className="text-sm font-bold text-slate-600">รายละเอียด / คำสั่ง</label>
                    <textarea 
                      placeholder="อธิบายรายละเอียดงาน เช่น ขั้นตอนการทำ หรือเกณฑ์การให้คะแนน..."
                      value={newAssignmentDesc}
                      onChange={(e) => setNewAssignmentDesc(e.target.value)}
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 outline-none focus:ring-2 focus:ring-indigo-500 min-h-[120px]"
                    />
                  </div>

                  <button 
                    onClick={addAssignment}
                    className="w-full bg-indigo-600 text-white py-4 rounded-2xl font-bold hover:bg-indigo-700 transition-all shadow-lg shadow-indigo-200 active:scale-[0.98] flex items-center justify-center gap-2 text-lg"
                  >
                    <Plus className="w-6 h-6" />
                    ยืนยันการมอบหมายงาน
                  </button>
                </div>

                <div className="bg-white p-8 rounded-3xl border border-slate-200 shadow-sm space-y-6">
                  <h3 className="text-xl font-bold text-slate-700 border-b border-slate-100 pb-4">รายการงานที่สั่งแล้ว</h3>
                  <div className="grid grid-cols-1 gap-4">
                    {currentAssignments.map(a => (
                      <div key={a.id} className="flex items-center justify-between p-6 bg-slate-50 rounded-2xl border border-slate-100 hover:border-indigo-200 transition-all group">
                        <div className="flex items-center gap-4">
                          <div className="w-12 h-12 bg-white rounded-xl flex items-center justify-center text-indigo-600 border border-slate-200 shadow-sm">
                            <FileText className="w-6 h-6" />
                          </div>
                          <div>
                            <p className="font-bold text-slate-800 text-lg">{a.title}</p>
                            <div className="flex items-center gap-4 text-sm text-slate-500">
                              <span className="flex items-center gap-1 font-medium">คะแนนเต็ม: <span className="text-indigo-600">{a.maxScore}</span></span>
                              {a.description && <span className="border-l border-slate-300 pl-4">{a.description}</span>}
                            </div>
                          </div>
                        </div>
                        <button 
                          onClick={() => removeAssignment(a.id)}
                          className="p-3 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-xl transition-all"
                          title="ลบงาน"
                        >
                          <Trash2 className="w-5 h-5" />
                        </button>
                      </div>
                    ))}
                    {currentAssignments.length === 0 && (
                      <div className="text-center py-12 text-slate-400 bg-slate-50/50 rounded-2xl border-2 border-dashed border-slate-200">
                        ยังไม่มีการสั่งงานในห้องเรียนนี้
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

            {teacherTab === 'submissions' && (
              /* Submissions View */
              <div className="space-y-6">
                <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
                  <h2 className="text-xl font-bold text-slate-800 flex items-center gap-2 mb-4">
                    <FileText className="w-6 h-6 text-indigo-600" />
                    รายการส่งงานที่รอการตรวจ
                  </h2>
                  <div className="space-y-4">
                    {(appData.submissions || []).filter(s => s.status === 'pending').map(sub => {
                      const assignment = (appData.assignments || []).find(a => a.id === sub.assignmentId);
                      // Search across all courses for the student
                      let student: Student | undefined;
                      for (const key in (appData.courses || {})) {
                        student = (appData.courses || {})[key].find(s => s.studentId === sub.studentId);
                        if (student) break;
                      }
                      
                      return (
                        <div key={sub.id} className="flex flex-col md:flex-row md:items-center justify-between p-6 bg-slate-50 rounded-2xl border border-slate-100 gap-4">
                          <div className="space-y-1">
                            <div className="flex items-center gap-2">
                              <span className="font-bold text-slate-800">{student?.name || 'ไม่ทราบชื่อ'}</span>
                              <span className="text-xs text-slate-400">({sub.studentId})</span>
                            </div>
                            <p className="text-sm font-medium text-indigo-600">{assignment?.title}</p>
                            <div className="flex items-center gap-3 mt-2">
                              <a href={sub.fileUrl} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 text-xs font-bold text-indigo-600 bg-indigo-50 px-3 py-1.5 rounded-lg border border-indigo-100 hover:bg-indigo-100 transition-colors">
                                <ExternalLink className="w-3.5 h-3.5" />
                                เปิดดูงานใน Drive
                              </a>
                              <span className="text-xs text-slate-400">ส่งเมื่อ: {new Date(sub.submittedAt).toLocaleString('th-TH')}</span>
                            </div>
                          </div>

                          <div className="flex items-center gap-3">
                            <div className="flex items-center gap-2">
                              <input 
                                type="number" 
                                placeholder="คะแนน"
                                max={assignment?.maxScore || 10}
                                className="w-20 bg-white border border-slate-200 rounded-lg px-3 py-2 text-center outline-none focus:ring-2 focus:ring-indigo-500"
                                onBlur={(e) => {
                                  if (e.target.value) {
                                    updateSubmissionScore(sub.id, Number(e.target.value));
                                  }
                                }}
                              />
                              <span className="text-sm font-bold text-slate-400">/ {assignment?.maxScore}</span>
                            </div>
                            <button 
                              onClick={() => {
                                const score = prompt(`กรอกคะแนนสำหรับ ${student?.name} (เต็ม ${assignment?.maxScore})`);
                                if (score !== null) updateSubmissionScore(sub.id, Number(score));
                              }}
                              className="bg-emerald-600 text-white px-4 py-2 rounded-xl font-bold hover:bg-emerald-700 transition-colors shadow-sm"
                            >
                              บันทึกคะแนน
                            </button>
                          </div>
                        </div>
                      );
                    })}
                    {(appData.submissions || []).filter(s => s.status === 'pending').length === 0 && (
                      <div className="text-center py-12 space-y-3">
                        <div className="w-16 h-16 bg-emerald-50 text-emerald-500 rounded-full flex items-center justify-center mx-auto">
                          <CheckCircle2 className="w-8 h-8" />
                        </div>
                        <p className="text-slate-500 font-medium">ไม่มีงานค้างตรวจในขณะนี้</p>
                      </div>
                    )}
                  </div>
                </div>

                {/* Graded Submissions */}
                <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
                  <h3 className="text-lg font-bold text-slate-700 mb-4">งานที่ตรวจแล้ว</h3>
                  <div className="space-y-2">
                    {(appData.submissions || []).filter(s => s.status === 'graded').map(sub => {
                      const assignment = (appData.assignments || []).find(a => a.id === sub.assignmentId);
                      // Search across all courses for the student
                      let student: Student | undefined;
                      for (const key in (appData.courses || {})) {
                        student = (appData.courses || {})[key].find(s => s.studentId === sub.studentId);
                        if (student) break;
                      }
                      return (
                        <div key={sub.id} className="flex items-center justify-between p-3 bg-slate-50 rounded-xl border border-slate-100 text-sm">
                          <div className="flex items-center gap-4">
                            <span className="font-bold text-slate-700">{student?.name}</span>
                            <span className="text-slate-400">{assignment?.title}</span>
                          </div>
                          <div className="flex items-center gap-4">
                            <span className="font-bold text-emerald-600">{sub.score} / {assignment?.maxScore}</span>
                            <button 
                              onClick={() => updateSubmissionScore(sub.id, 0)} // Reset to pending for re-grading
                              className="text-slate-400 hover:text-indigo-600"
                            >
                              <Clock className="w-4 h-4" />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}
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
                      งานที่ได้รับมอบหมาย
                    </h3>
                    <div className="grid grid-cols-1 gap-4">
                      {(appData.assignments || []).filter(a => {
                        // Find which course this student belongs to
                        // For simplicity, we assume the student is in the currently selected class/subject if they were found
                        // But better to check all courses
                        return true; // Show all for now, or filter by student's course
                      }).map(assignment => {
                        const submission = appData.submissions.find(s => s.assignmentId === assignment.id && s.studentId === foundStudent.studentId);
                        const isDone = !!submission;
                        const uploading = isUploading[assignment.id];

                        return (
                          <div key={assignment.id} className="flex flex-col md:flex-row md:items-center justify-between p-6 bg-slate-50 rounded-2xl border border-slate-100 gap-4">
                            <div className="flex items-start gap-4">
                              <div className={`w-12 h-12 rounded-xl flex items-center justify-center shrink-0 ${
                                isDone ? 'bg-emerald-100 text-emerald-600' : 'bg-amber-100 text-amber-600'
                              }`}>
                                {isDone ? <CheckCircle2 className="w-6 h-6" /> : <Clock className="w-6 h-6" />}
                              </div>
                              <div className="space-y-1">
                                <h4 className="font-bold text-slate-800">{assignment.title}</h4>
                                <p className="text-sm text-slate-500">{assignment.description}</p>
                                {isDone && (
                                  <div className="flex items-center gap-2 mt-2">
                                    <span className={`text-xs font-bold px-2 py-0.5 rounded ${
                                      submission.status === 'graded' ? 'bg-emerald-100 text-emerald-700' : 'bg-blue-100 text-blue-700'
                                    }`}>
                                      {submission.status === 'graded' ? `คะแนน: ${submission.score} / ${assignment.maxScore}` : 'รอการตรวจ'}
                                    </span>
                                    <a href={submission.fileUrl} target="_blank" rel="noreferrer" className="text-xs text-indigo-600 hover:underline flex items-center gap-1">
                                      <ExternalLink className="w-3 h-3" /> ดูไฟล์ที่ส่ง
                                    </a>
                                  </div>
                                )}
                              </div>
                            </div>
                            
                            <div className="flex items-center gap-2">
                              {!isDone ? (
                                <label className={`flex items-center gap-2 px-6 py-3 rounded-xl font-bold text-sm transition-all cursor-pointer ${
                                  uploading ? 'bg-slate-200 text-slate-400' : 'bg-indigo-600 text-white hover:bg-indigo-700 shadow-sm'
                                }`}>
                                  {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                                  {uploading ? 'กำลังอัปโหลด...' : 'ส่งงาน (Upload)'}
                                  <input 
                                    type="file" 
                                    className="hidden" 
                                    disabled={uploading}
                                    onChange={(e) => handleStudentFileUpload(e, assignment.id, foundStudent)} 
                                  />
                                </label>
                              ) : (
                                <button className="px-6 py-3 rounded-xl font-bold text-sm bg-emerald-50 text-emerald-600 border border-emerald-100 cursor-default flex items-center gap-2">
                                  <CheckCircle2 className="w-4 h-4" />
                                  ส่งงานแล้ว
                                </button>
                              )}
                            </div>
                          </div>
                        );
                      })}
                      {(appData.assignments || []).length === 0 && (
                        <p className="text-center text-slate-400 py-8">ยังไม่มีงานที่ได้รับมอบหมาย</p>
                      )}
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
              className="relative w-full max-w-lg bg-white rounded-3xl shadow-2xl border border-slate-200 overflow-hidden"
            >
              <div className="p-6 border-b border-slate-100 flex justify-between items-center">
                <h3 className="text-xl font-bold text-slate-800">
                  {manageType === 'subject' ? 'จัดการวิชา' : manageType === 'class' ? 'จัดการห้องเรียน' : 'สั่งงานใหม่'}
                </h3>
                <button onClick={() => setIsManageModalOpen(false)} className="p-2 hover:bg-slate-100 rounded-xl transition-colors">
                  <X className="w-5 h-5 text-slate-400" />
                </button>
              </div>
              
              <div className="p-6 space-y-6">
                {manageType === 'subject' || manageType === 'class' ? (
                  <>
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
                  </>
                ) : null}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
