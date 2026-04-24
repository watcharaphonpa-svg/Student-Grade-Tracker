import React, { useState, useEffect, useMemo } from 'react';
import { 
  Plus, Trash2, Save, Users, Calculator, GraduationCap, 
  ChevronRight, ChevronDown, Info, Cloud, CloudCheck, ExternalLink, 
  Loader2, Search, FileText, CheckCircle2, Clock, User, Upload, 
  BookOpen, Settings, X, Menu, LayoutDashboard, Monitor, AlertCircle,
  Link, Check, MoreVertical, LogOut, FileDown, Download
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
  targetAssignment?: number;
  targetPart?: number;
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

interface Attendance {
  id: string;
  studentId: string;
  date: string;
  status: 'present' | 'late' | 'absent' | 'leave';
  courseKey: string;
  timestamp: string;
}

interface AppData {
  subjects: Subject[];
  classRooms: ClassRoom[];
  courses: Record<string, Student[]>;
  assignments: Assignment[];
  submissions: Submission[];
  attendance: Attendance[];
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
    submissions: [],
    attendance: []
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

    // Attendance
    const unsubAttendance = onSnapshot(collection(db, 'attendance'), (snap) => {
      setAppData(prev => ({ ...prev, attendance: snap.docs.map(d => d.data() as Attendance) }));
    });

    return () => {
      unsubSubjects();
      unsubClasses();
      unsubAssignments();
      unsubSubmissions();
      unsubStudents();
      unsubAttendance();
    };
  }, [user]); // Re-run when user changes to update submission listener

  const [isManageModalOpen, setIsManageModalOpen] = useState(false);
  const [manageType, setManageType] = useState<'subject' | 'class' | 'assignment'>('subject');
  const [newItemName, setNewItemName] = useState('');
  const [newAssignmentDesc, setNewAssignmentDesc] = useState('');
  const [newAssignmentScore, setNewAssignmentScore] = useState(10);
  const [newTargetAssignment, setNewTargetAssignment] = useState(1);
  const [newTargetPart, setNewTargetPart] = useState(1);

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
  const [isLockedStudentView, setIsLockedStudentView] = useState(false);
  const [isActionsMenuOpen, setIsActionsMenuOpen] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('portal') === 'student') {
      setView('student');
      setIsLockedStudentView(true);
    }
  }, []);

  const [teacherTab, setTeacherTab] = useState<'grades' | 'assignments' | 'submissions' | 'attendance' | 'attendanceSummary'>('grades');
  const [attendanceDate, setAttendanceDate] = useState(new Date().toISOString().split('T')[0]);
  const [currentAttendance, setCurrentAttendance] = useState<Record<string, 'present' | 'late' | 'absent' | 'leave'>>({});

  // Student Portal State
  const [searchId, setSearchId] = useState('');
  const [foundStudent, setFoundStudent] = useState<Student | null>(null);
  const [hasSearched, setHasSearched] = useState(false);

  // Student-specific submission listener when searching
  useEffect(() => {
    if (!foundStudent || user?.email === 'watcharaphon_pa@t-tech.ac.th') return;

    const q = query(collection(db, 'submissions'), where('studentId', '==', foundStudent.studentId));
    const unsub = onSnapshot(q, (snap) => {
      setAppData(prev => ({ 
        ...prev, 
        submissions: snap.docs.map(d => d.data() as Submission) 
      }));
    });
    return unsub;
  }, [foundStudent, user]);

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

  const handleGoogleAuth = async () => {
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
    const currentSubject = appData.subjects.find(s => s.id === selectedSubjectId);
    const currentClass = appData.classRooms.find(c => c.id === selectedClassId);
    const courseTitle = `${currentSubject?.name || 'Unknown'} - ${currentClass?.name || 'Unknown'}`;

    try {
      const res = await fetch('/api/sheets/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          students,
          submissions: appData.submissions,
          sheetName: courseTitle
        })
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
    const totals = students.map(s => calculateTotal(s));
    const avg = totals.reduce((a, b) => a + b, 0) / students.length;
    const passCount = totals.filter(t => t >= 50).length;
    return {
      avg: avg.toFixed(2),
      passRate: ((passCount / students.length) * 100).toFixed(1)
    };
  }, [students, appData.submissions]);

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
      courseKey: currentCourseKey,
      targetAssignment: newTargetAssignment,
      targetPart: newTargetPart
    };
    await setDoc(doc(db, 'assignments', id), newAssignment);
    setNewItemName('');
    setNewAssignmentDesc('');
    setNewAssignmentScore(10);
    setNewTargetAssignment(1);
    setNewTargetPart(1);
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
    // 1. Update the submission status/score
    await updateDoc(doc(db, 'submissions', submissionId), { score, status: 'graded' });

    // 2. Find the submission in state to get meta info
    const submission = appData.submissions.find(s => s.id === submissionId);
    if (!submission) return;

    // 3. Find the assignment to know where to map the score
    const assignment = appData.assignments.find(a => a.id === submission.assignmentId);
    if (!assignment || !assignment.targetAssignment || !assignment.targetPart) return;

    // 4. Update the student's manual field
    const q = query(collection(db, 'students'), where('studentId', '==', submission.studentId));
    const snap = await getDocs(q);
    
    if (!snap.empty) {
      const studentDoc = snap.docs[0];
      const fieldPath = `assignment${assignment.targetAssignment}.part${assignment.targetPart}`;
      await updateDoc(studentDoc.ref, {
        [fieldPath]: score
      });
      console.log(`Mapped score ${score} to student ${submission.studentId} field ${fieldPath}`);
    }
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

  const handleSaveAttendance = async () => {
    const isTeacher = user?.email === 'watcharaphon_pa@t-tech.ac.th';
    if (!isTeacher) {
      alert('❌ เฉพาะอาจารย์ที่ได้รับอนุญาตเท่านั้นที่สามารถบันทึกข้อมูลได้');
      return;
    }

    setIsSyncing(true);
    try {
      const promises = Object.entries(currentAttendance).map(([studentId, status]) => {
        const id = `${studentId}-${attendanceDate}`;
        const record: Attendance = {
          id,
          studentId,
          date: attendanceDate,
          status: status as 'present' | 'late' | 'absent' | 'leave',
          courseKey: currentCourseKey,
          timestamp: new Date().toISOString()
        };
        return setDoc(doc(db, 'attendance', id), record);
      });
      await Promise.all(promises);
      alert('✅ บันทึกการเช็คชื่อเรียบร้อยแล้ว');
    } catch (err: any) {
      console.error('Attendance save error:', err);
      alert(`❌ เกิดข้อผิดพลาดในการบันทึก: ${err.message || 'กรุณาตรวจสอบสิทธิ์การเข้าถึง'}`);
    } finally {
      setIsSyncing(false);
    }
  };

  useEffect(() => {
    const records = (appData.attendance || []).filter(a => a.date === attendanceDate && a.courseKey === currentCourseKey);
    const map: Record<string, 'present' | 'late' | 'absent' | 'leave'> = {};
    records.forEach(r => {
      map[r.studentId] = r.status as 'present' | 'late' | 'absent' | 'leave';
    });
    setCurrentAttendance(map);
  }, [attendanceDate, currentCourseKey, appData.attendance]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setHasSearched(true);
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
  };

  return (
    <div className="min-h-screen bg-[#f8fafc] text-slate-900 font-sans p-4 md:p-8">
      <div className="max-w-7xl mx-auto space-y-6">
        
        {/* Header */}
        <header className="flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div className="space-y-1">
            <div className="flex items-center gap-3 text-indigo-600">
              <GraduationCap className="w-10 h-10" />
              <h1 className="text-3xl font-black tracking-tight text-slate-800">Student Tracker</h1>
            </div>
            <p className="text-slate-500 font-medium">ระบบบันทึกและคำนวณคะแนนนักเรียนอัตโนมัติ</p>
          </div>
          
          <div className="flex flex-wrap items-center gap-3">
            {!isLockedStudentView && (
              <div className="flex items-center gap-3">
                <div className="flex items-center bg-slate-200/50 p-1 rounded-2xl border border-slate-200 shadow-inner">
                  <button 
                    onClick={() => setView('teacher')}
                    className={`flex items-center gap-2 px-5 py-2.5 rounded-xl font-bold transition-all text-sm ${
                      view === 'teacher' ? 'bg-white text-indigo-600 shadow-md' : 'text-slate-500 hover:text-slate-700'
                    }`}
                  >
                    <Users className="w-4 h-4" />
                    หน้าครู
                  </button>
                  <button 
                    onClick={() => setView('student')}
                    className={`flex items-center gap-2 px-5 py-2.5 rounded-xl font-bold transition-all text-sm ${
                      view === 'student' ? 'bg-white text-indigo-600 shadow-md' : 'text-slate-500 hover:text-slate-700'
                    }`}
                  >
                    <User className="w-4 h-4" />
                    หน้าเด็ก
                  </button>
                </div>

                {user ? (
                  <div className="relative">
                    <button 
                      onClick={() => setIsActionsMenuOpen(!isActionsMenuOpen)}
                      className="p-3 bg-white border border-slate-200 rounded-2xl hover:bg-slate-50 transition-all shadow-sm hover:shadow-md active:scale-95"
                    >
                      <MoreVertical className="w-5 h-5 text-slate-500" />
                    </button>
                    
                    <AnimatePresence>
                      {isActionsMenuOpen && (
                        <>
                          <div className="fixed inset-0 z-40" onClick={() => setIsActionsMenuOpen(false)} />
                          <motion.div 
                            initial={{ opacity: 0, scale: 0.95, y: 10 }}
                            animate={{ opacity: 1, scale: 1, y: 0 }}
                            exit={{ opacity: 0, scale: 0.95, y: 10 }}
                            className="absolute right-0 top-full mt-3 w-64 bg-white rounded-3xl border border-slate-200 shadow-2xl z-50 overflow-hidden py-3"
                          >
                            <div className="px-5 py-4 border-b border-slate-100 flex items-center gap-3 bg-slate-50/50">
                              <img src={user.photoURL || ''} alt="" className="w-10 h-10 rounded-full border-2 border-white shadow-sm" />
                              <div className="flex flex-col overflow-hidden">
                                <span className="text-sm font-bold text-slate-800 truncate">{user.displayName}</span>
                                <span className="text-[10px] text-slate-400 truncate">{user.email}</span>
                              </div>
                            </div>

                            <div className="py-2">
                              {/* Secondary Actions */}
                              <label className="flex items-center gap-3 px-5 py-3 hover:bg-indigo-50 text-slate-600 hover:text-indigo-600 text-sm cursor-pointer transition-colors group">
                                <FileDown className="w-4 h-4 text-slate-400 group-hover:text-indigo-500" />
                                <span className="font-bold">นำเข้าไฟล์ (CSV)</span>
                                <input type="file" accept=".csv" onChange={handleFileUpload} className="hidden" />
                              </label>

                              {isGoogleAuth ? (
                                spreadsheetUrl && (
                                  <a 
                                    href={spreadsheetUrl} target="_blank" rel="noopener noreferrer"
                                    className="flex items-center gap-3 px-5 py-3 hover:bg-emerald-50 text-emerald-600 text-sm transition-colors"
                                  >
                                    <CloudCheck className="w-4 h-4" />
                                    <span className="font-bold">เปิด Google Sheets</span>
                                  </a>
                                )
                              ) : (
                                <button 
                                  onClick={handleGoogleAuth}
                                  className="w-full flex items-center gap-3 px-5 py-3 hover:bg-indigo-50 text-indigo-600 text-sm transition-colors text-left"
                                >
                                  <Cloud className="w-4 h-4" />
                                  <span className="font-bold">เชื่อมต่อ Sheets</span>
                                </button>
                              )}

                              <button 
                                onClick={() => {
                                  if(window.confirm('ยืนยันเลิกเชื่อมต่อ Google?')) setIsGoogleAuth(false);
                                  setIsActionsMenuOpen(false);
                                }}
                                className="w-full flex items-center gap-3 px-5 py-3 hover:bg-slate-50 text-slate-400 text-sm transition-colors text-left"
                              >
                                <Settings className="w-4 h-4" />
                                <span className="font-bold">ตั้งค่ากูเกิล</span>
                              </button>

                              {students.length > 0 && (
                                <button 
                                  onClick={() => {
                                    if(window.confirm('⚠️ ยืนยันการลบรายชื่อนักเรียนทั้งหมดในวิชานี้?')) removeAllStudents();
                                    setIsActionsMenuOpen(false);
                                  }}
                                  className="w-full flex items-center gap-3 px-5 py-3 hover:bg-rose-50 text-rose-600 text-sm transition-colors text-left"
                                >
                                  <Trash2 className="w-4 h-4" />
                                  <span className="font-bold">ลบรายชื่อทั้งหมด</span>
                                </button>
                              )}
                            </div>

                            <div className="mt-2 pt-2 border-t border-slate-100">
                              <button 
                                onClick={() => auth.signOut()} 
                                className="w-full flex items-center gap-3 px-5 py-3 hover:bg-slate-50 text-slate-400 text-sm transition-colors text-left"
                              >
                                <LogOut className="w-4 h-4" />
                                <span className="font-bold">ออกจากระบบ</span>
                              </button>
                            </div>
                          </motion.div>
                        </>
                      )}
                    </AnimatePresence>
                  </div>
                ) : (
                  <button 
                    onClick={handleFirebaseLogin}
                    className="flex items-center gap-2 bg-indigo-600 text-white px-6 py-3 rounded-2xl font-bold hover:bg-indigo-700 transition-all shadow-xl shadow-indigo-100 active:scale-95"
                  >
                    <User className="w-4 h-4" />
                    เข้าสู่ระบบครู
                  </button>
                )}
              </div>
            )}
          </div>
        </header>

        {view === 'teacher' && (
          <div className="space-y-6">
            <motion.div 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="flex flex-col xl:flex-row xl:items-center justify-between gap-6"
            >
              {/* Tab Navigation */}
              <div className="flex items-center bg-slate-200/50 p-1.5 rounded-2xl border border-slate-200 shadow-inner w-fit">
                <button 
                  onClick={() => setTeacherTab('grades')}
                  className={`flex items-center gap-2 px-6 py-3 rounded-xl font-bold transition-all text-sm ${
                    teacherTab === 'grades' ? 'bg-white text-indigo-600 shadow-md' : 'text-slate-500 hover:text-slate-700'
                  }`}
                >
                  <Calculator className="w-4 h-4" />
                  ตารางคะแนน
                </button>
                <button 
                  onClick={() => setTeacherTab('assignments')}
                  className={`flex items-center gap-2 px-6 py-3 rounded-xl font-bold transition-all text-sm ${
                    teacherTab === 'assignments' ? 'bg-white text-indigo-600 shadow-md' : 'text-slate-500 hover:text-slate-700'
                  }`}
                >
                  <LayoutDashboard className="w-4 h-4" />
                  จัดการงาน
                </button>
                <button 
                  onClick={() => setTeacherTab('submissions')}
                  className={`flex items-center gap-2 px-6 py-3 rounded-xl font-bold transition-all text-sm relative ${
                    teacherTab === 'submissions' ? 'bg-white text-indigo-600 shadow-md' : 'text-slate-500 hover:text-slate-700'
                  }`}
                >
                  <Monitor className="w-4 h-4" />
                  ตรวจงาน
                  {(appData.submissions || []).filter(s => s.status === 'pending').length > 0 && (
                    <span className="absolute -top-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full bg-rose-500 text-[10px] font-bold text-white ring-2 ring-white">
                      {(appData.submissions || []).filter(s => s.status === 'pending').length}
                    </span>
                  )}
                </button>
                <button 
                  onClick={() => setTeacherTab('attendance')}
                  className={`flex items-center gap-2 px-6 py-3 rounded-xl font-bold transition-all text-sm ${
                    teacherTab === 'attendance' ? 'bg-white text-indigo-600 shadow-md' : 'text-slate-500 hover:text-slate-700'
                  }`}
                >
                  <CheckCircle2 className="w-4 h-4" />
                  เช็คชื่อ
                </button>
                <button 
                  onClick={() => setTeacherTab('attendanceSummary')}
                  className={`flex items-center gap-2 px-6 py-3 rounded-xl font-bold transition-all text-sm ${
                    teacherTab === 'attendanceSummary' ? 'bg-white text-indigo-600 shadow-md' : 'text-slate-500 hover:text-slate-700'
                  }`}
                >
                  <Users className="w-4 h-4" />
                  สรุปเช็คชื่อ
                </button>
              </div>

              {/* Context Selectors */}
              <div className="flex flex-wrap items-center gap-4">
                <div className="flex items-center gap-2 bg-white border border-slate-200 rounded-2xl px-5 py-3 shadow-sm focus-within:ring-2 focus-within:ring-indigo-500 transition-all">
                  <BookOpen className="w-4 h-4 text-indigo-600" />
                  <select 
                    value={selectedSubjectId}
                    onChange={(e) => setSelectedSubjectId(e.target.value)}
                    className="bg-transparent border-none outline-none text-sm font-bold text-slate-700 pr-4 min-w-[120px]"
                  >
                    {appData.subjects.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                  <button onClick={() => { setManageType('subject'); setIsManageModalOpen(true); }} className="hover:bg-slate-100 p-2 rounded-xl transition-colors">
                    <Settings className="w-4 h-4 text-slate-400" />
                  </button>
                </div>

                <div className="flex items-center gap-2 bg-white border border-slate-200 rounded-2xl px-5 py-3 shadow-sm focus-within:ring-2 focus-within:ring-indigo-500 transition-all">
                  <Users className="w-4 h-4 text-indigo-600" />
                  <select 
                    value={selectedClassId}
                    onChange={(e) => setSelectedClassId(e.target.value)}
                    className="bg-transparent border-none outline-none text-sm font-bold text-slate-700 pr-4 min-w-[80px]"
                  >
                    {appData.classRooms.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                  <button onClick={() => { setManageType('class'); setIsManageModalOpen(true); }} className="hover:bg-slate-100 p-2 rounded-xl transition-colors">
                    <Settings className="w-4 h-4 text-slate-400" />
                  </button>
                </div>
              </div>
            </motion.div>

            {teacherTab === 'grades' && (
              <motion.div 
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="flex flex-col sm:flex-row items-center justify-between gap-4 p-5 bg-white rounded-3xl border border-slate-200 shadow-sm"
              >
                <div className="flex flex-wrap items-center gap-3">
                  <button 
                    onClick={addStudent}
                    className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white px-6 py-3 rounded-2xl font-bold transition-all shadow-lg shadow-indigo-100 active:scale-95"
                  >
                    <Plus className="w-5 h-5" />
                    เพิ่มนักเรียน
                  </button>
                  <button 
                    onClick={() => {
                      const url = new URL(window.location.href);
                      url.searchParams.set('portal', 'student');
                      navigator.clipboard.writeText(url.toString());
                      alert('คัดลอกลิงก์สำหรับส่งให้นักเรียนเรียบร้อยแล้ว!');
                    }}
                    className="flex items-center gap-2 bg-emerald-50 hover:bg-emerald-100 text-emerald-600 border border-emerald-200 px-6 py-3 rounded-2xl font-bold transition-all active:scale-95"
                  >
                    <Link className="w-5 h-5" />
                    แชร์ลิงก์ให้เด็ก
                  </button>
                </div>

                <div className="flex items-center gap-3">
                  {isGoogleAuth && (
                    <button 
                      onClick={handleSyncToSheets}
                      disabled={isSyncing}
                      className="flex items-center gap-2 bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 px-6 py-3 rounded-2xl font-bold transition-all active:scale-95 disabled:opacity-50"
                    >
                      {isSyncing ? <Loader2 className="w-5 h-5 animate-spin" /> : <CloudCheck className="w-5 h-5 text-indigo-500" />}
                      อัปเดต Google Sheets
                    </button>
                  )}
                </div>
              </motion.div>
            )}
          </div>
        )}

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
                                      {(() => {
                                        return (student.assignment1?.part1 || 0) + (student.assignment1?.part2 || 0) + (student.assignment1?.part3 || 0) +
                                               (student.assignment2?.part1 || 0) + (student.assignment2?.part2 || 0) + (student.assignment2?.part3 || 0) +
                                               (student.assignment3?.part1 || 0) + (student.assignment3?.part2 || 0) + (student.assignment3?.part3 || 0);
                                      })()}
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
                                                      <label className="text-[10px] uppercase tracking-wider text-slate-400 font-bold">แบบฝึกหัดที่ {(num - 1) * 3 + (idx + 1)}</label>
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

                                        {/* Digital Assignments Section */}
                                        <div className="mt-8 pt-6 border-t border-slate-100">
                                          <div className="flex items-center justify-between mb-4">
                                            <h4 className="text-sm font-bold text-slate-500 flex items-center gap-2">
                                              <Monitor className="w-4 h-4 text-indigo-500" />
                                              งานที่มอบหมายระบบออนไลน์
                                            </h4>
                                          </div>
                                          
                                          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
                                            {(appData.assignments || []).filter(a => a.courseKey === currentCourseKey).map(assignment => {
                                              const submission = (appData.submissions || []).find(s => s.assignmentId === assignment.id && s.studentId === student.studentId);
                                              return (
                                                <div key={assignment.id} className="bg-slate-50/50 p-4 rounded-xl border border-slate-100 hover:border-indigo-100 transition-all">
                                                  <div className="flex flex-col h-full justify-between gap-3">
                                                    <div>
                                                      <p className="text-[10px] font-bold text-slate-400 uppercase tracking-tighter mb-1 truncate">{assignment.title}</p>
                                                      <div className="flex items-baseline gap-1">
                                                        <span className="text-xl font-black text-slate-700">
                                                          {submission?.status === 'graded' ? submission.score : 0}
                                                        </span>
                                                        <span className="text-xs text-slate-400">/ {assignment.maxScore}</span>
                                                      </div>
                                                    </div>
                                                    
                                                    {!submission ? (
                                                      <span className="text-[10px] font-bold text-slate-400 bg-slate-100 px-2 py-0.5 rounded flex items-center gap-1 w-fit">
                                                        <Clock className="w-2.5 h-2.5" /> ยังไม่ส่ง
                                                      </span>
                                                    ) : submission.status === 'pending' ? (
                                                      <span className="text-[10px] font-bold text-amber-600 bg-amber-50 px-2 py-0.5 rounded flex items-center gap-1 w-fit">
                                                        <AlertCircle className="w-2.5 h-2.5" /> รอตรวจ
                                                      </span>
                                                    ) : (
                                                      <span className="text-[10px] font-bold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded flex items-center gap-1 w-fit">
                                                        <CheckCircle2 className="w-2.5 h-2.5" /> ตรวจแล้ว
                                                      </span>
                                                    )}
                                                  </div>
                                                </div>
                                              );
                                            })}
                                            {(appData.assignments || []).filter(a => a.courseKey === currentCourseKey).length === 0 && (
                                              <p className="text-xs text-slate-400 col-span-full">ทำรายการมอบหมายงานออนไลน์ที่แถบเมนู "จัดการงานมอบหมาย"</p>
                                            )}
                                          </div>
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

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="space-y-2">
                      <label className="text-sm font-bold text-slate-600">เก็บคะแนนในช่อง (งานที่)</label>
                      <select 
                        value={newTargetAssignment}
                        onChange={(e) => setNewTargetAssignment(Number(e.target.value))}
                        className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 outline-none focus:ring-2 focus:ring-indigo-500 font-medium"
                      >
                        <option value={1}>งานที่ 1</option>
                        <option value={2}>งานที่ 2</option>
                        <option value={3}>งานที่ 3</option>
                      </select>
                    </div>
                    <div className="space-y-2">
                      <label className="text-sm font-bold text-slate-600">แบบฝึกหัดที่</label>
                      <select 
                        value={newTargetPart}
                        onChange={(e) => setNewTargetPart(Number(e.target.value))}
                        className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 outline-none focus:ring-2 focus:ring-indigo-500 font-medium"
                      >
                        <option value={1}>แบบฝึกหัดที่ {(newTargetAssignment - 1) * 3 + 1}</option>
                        <option value={2}>แบบฝึกหัดที่ {(newTargetAssignment - 1) * 3 + 2}</option>
                        <option value={3}>แบบฝึกหัดที่ {(newTargetAssignment - 1) * 3 + 3}</option>
                      </select>
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
                          <div className="flex flex-col">
                            <p className="font-bold text-slate-800 text-lg">{a.title}</p>
                            <div className="flex items-center gap-4 text-sm text-slate-500">
                              <span className="flex items-center gap-1 font-medium">คะแนนเต็ม: <span className="text-indigo-600">{a.maxScore}</span></span>
                              <span className="flex items-center gap-1 bg-indigo-50 px-2 py-0.5 rounded text-indigo-600 text-xs font-bold">
                                ลงช่อง: งานที่ {a.targetAssignment || 1} แบบฝึกหัดที่ {((a.targetAssignment || 1) - 1) * 3 + (a.targetPart || 1)}
                              </span>
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
            {teacherTab === 'attendanceSummary' && (
              <div className="space-y-6">
                <motion.div 
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="bg-white p-8 rounded-3xl border border-slate-200 shadow-sm space-y-6"
                >
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 bg-indigo-50 rounded-2xl flex items-center justify-center text-indigo-600 border border-indigo-100">
                      <GraduationCap className="w-6 h-6" />
                    </div>
                    <div>
                      <h2 className="text-2xl font-bold text-slate-800">สรุปการมาเรียนปลายเทอม</h2>
                      <p className="text-slate-500 font-medium text-sm">เกณฑ์: สาย 4 ครั้ง = ขาด 1 | ลา 2 ครั้ง = ขาด 1 | ขาดได้ไม่เกิน 13/64 ครั้ง</p>
                    </div>
                  </div>

                  <div className="overflow-hidden border border-slate-100 rounded-2xl">
                    <table className="w-full text-left border-collapse">
                      <thead className="bg-slate-50">
                        <tr className="italic">
                          <th className="p-4 text-[11px] uppercase tracking-wider text-slate-400 font-bold">ชื่อ-นามสกุล</th>
                          <th className="p-4 text-[11px] uppercase tracking-wider text-slate-400 font-bold text-center">มา</th>
                          <th className="p-4 text-[11px] uppercase tracking-wider text-slate-400 font-bold text-center">สาย</th>
                          <th className="p-4 text-[11px] uppercase tracking-wider text-slate-400 font-bold text-center">ขาด</th>
                          <th className="p-4 text-[11px] uppercase tracking-wider text-slate-400 font-bold text-center">ลา</th>
                          <th className="p-4 text-[11px] uppercase tracking-wider text-indigo-500 font-black text-center">รวมขาดสะสม</th>
                          <th className="p-4 text-[11px] uppercase tracking-wider text-slate-400 font-bold text-center">สถานะ</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-50">
                        {students.map(student => {
                          const records = (appData.attendance || []).filter(r => r.studentId === student.studentId && r.courseKey === currentCourseKey);
                          const counts = {
                            present: records.filter(r => r.status === 'present').length,
                            late: records.filter(r => r.status === 'late').length,
                            absent: records.filter(r => r.status === 'absent').length,
                            leave: records.filter(r => r.status === 'leave').length,
                          };
                          const effectiveAbsents = counts.absent + Math.floor(counts.late / 4) + Math.floor(counts.leave / 2);
                          const isFailed = effectiveAbsents > 13;
                          const isWarning = effectiveAbsents >= 10;

                          return (
                            <tr key={student.id} className="hover:bg-slate-50 transition-colors">
                              <td className="p-4">
                                <div className="font-bold text-slate-700">{student.name}</div>
                                <div className="text-[10px] text-slate-400 font-mono italic">เรียนแล้ว {records.length} / 64 ครั้ง</div>
                              </td>
                              <td className="p-4 text-center font-mono text-emerald-600 font-bold">{counts.present}</td>
                              <td className="p-4 text-center font-mono text-amber-600 font-bold">{counts.late}</td>
                              <td className="p-4 text-center font-mono text-rose-600 font-bold">{counts.absent}</td>
                              <td className="p-4 text-center font-mono text-indigo-600 font-bold">{counts.leave}</td>
                              <td className="p-4 text-center">
                                <span className={`text-xl font-black ${isFailed ? 'text-rose-600' : isWarning ? 'text-amber-500' : 'text-indigo-600'}`}>
                                  {effectiveAbsents}
                                </span>
                                <span className="text-[10px] text-slate-300 ml-1">/ 13</span>
                              </td>
                              <td className="p-4 text-center">
                                {isFailed ? (
                                  <span className="bg-rose-100 text-rose-700 px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-tighter">ไม่มีสิทธิ์สอบ</span>
                                ) : isWarning ? (
                                  <span className="bg-amber-100 text-amber-700 px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-tighter">เริ่มเสี่ยง</span>
                                ) : (
                                  <span className="bg-emerald-100 text-emerald-700 px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-tighter">ปกติ</span>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </motion.div>
              </div>
            )}
            {teacherTab === 'attendance' && (
              /* Attendance View */
              <div className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-12 gap-6">
                  {/* Internal Check-in System */}
                  <motion.div 
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="md:col-span-8 bg-white p-8 rounded-3xl border border-slate-200 shadow-sm space-y-6"
                  >
                    <div className="flex flex-col md:flex-row md:items-end justify-between gap-6">
                      <div className="space-y-4">
                        <div className="flex items-center gap-3">
                          <div className="w-12 h-12 bg-indigo-50 rounded-2xl flex items-center justify-center text-indigo-600 border border-indigo-100">
                            <CheckCircle2 className="w-6 h-6" />
                          </div>
                          <div>
                            <h2 className="text-2xl font-bold text-slate-800">ระบบเช็คชื่อภายใน</h2>
                            <p className="text-slate-500 font-medium text-sm">บันทึกข้อมูลเข้าฐานข้อมูลของวิชานี้โดยตรง</p>
                          </div>
                        </div>
                        
                        <div className="flex items-center gap-3 bg-slate-50 p-2 rounded-2xl border border-slate-100 w-fit">
                          <div className="px-3 py-1.5 text-xs font-bold text-slate-400 uppercase tracking-wider pl-4">วันที่เช็คชื่อ</div>
                          <input 
                            type="date"
                            value={attendanceDate}
                            onChange={(e) => setAttendanceDate(e.target.value)}
                            className="bg-white border border-slate-200 rounded-xl px-4 py-2 text-sm font-bold text-slate-700 outline-none focus:ring-2 focus:ring-indigo-500 transition-all cursor-pointer"
                          />
                        </div>
                      </div>

                      <div className="flex gap-3">
                        <button 
                          onClick={handleSaveAttendance}
                          disabled={isSyncing || students.length === 0}
                          className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white px-8 py-4 rounded-2xl font-bold transition-all shadow-lg shadow-indigo-100 active:scale-95"
                        >
                          {isSyncing ? <Loader2 className="w-5 h-5 animate-spin" /> : <Save className="w-5 h-5" />}
                          บันทึกข้อมูลวันนี้
                        </button>
                      </div>
                    </div>

                    <div className="overflow-hidden border border-slate-100 rounded-2xl">
                      <table className="w-full text-left border-collapse">
                        <thead>
                          <tr className="bg-slate-50/80 border-b border-slate-100 italic">
                            <th className="p-4 text-[11px] uppercase tracking-wider text-slate-400 font-bold">เลขที่</th>
                            <th className="p-4 text-[11px] uppercase tracking-wider text-slate-400 font-bold">ชื่อ-นามสกุล</th>
                            <th className="p-4 text-[11px] uppercase tracking-wider text-slate-400 font-bold text-center">สถานะ</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-50">
                          {(students || []).map((student) => (
                            <motion.tr 
                              key={student.id} 
                              initial={{ opacity: 0 }}
                              animate={{ opacity: 1 }}
                              className="hover:bg-slate-50/50 transition-all group"
                            >
                              <td className="p-4 font-mono text-sm text-slate-400 group-hover:text-indigo-600 w-16">{student.no}</td>
                              <td className="p-4">
                                <p className="font-bold text-slate-700 leading-tight">{student.name}</p>
                                <p className="text-[10px] text-slate-400 font-mono">{student.studentId}</p>
                              </td>
                              <td className="p-4">
                                <div className="flex justify-center items-center gap-1.5">
                                  {[
                                    { id: 'present', label: 'มา', color: 'bg-emerald-500', active: 'bg-emerald-500 text-white ring-4 ring-emerald-100' },
                                    { id: 'late', label: 'สาย', color: 'bg-amber-500', active: 'bg-amber-500 text-white ring-4 ring-amber-100' },
                                    { id: 'absent', label: 'ขาด', color: 'bg-rose-500', active: 'bg-rose-500 text-white ring-4 ring-rose-100' },
                                    { id: 'leave', label: 'ลา', color: 'bg-indigo-500', active: 'bg-indigo-500 text-white ring-4 ring-indigo-100' }
                                  ].map((btn) => (
                                    <button
                                      key={btn.id}
                                      onClick={() => setCurrentAttendance(prev => ({ ...prev, [student.studentId]: btn.id as any }))}
                                      className={`px-3 py-2 rounded-xl text-[10px] font-bold transition-all ${
                                        currentAttendance[student.studentId] === btn.id 
                                          ? btn.active 
                                          : 'bg-slate-100 text-slate-400 hover:text-slate-600'
                                      }`}
                                    >
                                      {btn.label}
                                    </button>
                                  ))}
                                </div>
                              </td>
                            </motion.tr>
                          ))}
                        </tbody>
                      </table>
                      {students.length === 0 && (
                        <div className="p-12 text-center text-slate-400">
                          ไม่มีรายชื่อนักเรียนในห้องนี้
                        </div>
                      )}
                    </div>
                  </motion.div>

                  {/* External Check-in Option */}
                  <motion.div 
                    initial={{ opacity: 0, x: 20 }}
                    animate={{ opacity: 1, x: 0 }}
                    className="md:col-span-4 bg-gradient-to-br from-indigo-600 to-indigo-800 p-8 rounded-3xl text-white shadow-xl flex flex-col gap-6 self-start"
                  >
                    <div className="space-y-6">
                      <div className="w-16 h-16 bg-white/20 rounded-2xl flex items-center justify-center backdrop-blur-md">
                        <ExternalLink className="w-8 h-8" />
                      </div>
                      <div className="space-y-2">
                        <h3 className="text-2xl font-black leading-tight">ใช้ระบบภายนอก (Check-in Pro)</h3>
                        <p className="text-indigo-100 text-sm leading-relaxed">
                          หากต้องการใช้ระบบเช็คชื่ออื่นที่คุณถนัด สามารถกดเปิดลิงก์ด้านล่างเพื่อใช้งานควบคู่กันได้
                        </p>
                      </div>
                    </div>

                    <div className="space-y-4">
                       <a 
                         href="https://check-in-pro.vercel.app/" 
                         target="_blank" 
                         rel="noreferrer"
                         className="flex items-center justify-center gap-3 bg-white text-indigo-600 w-full py-4 rounded-2xl font-black text-sm hover:bg-slate-50 transition-all shadow-lg active:scale-95"
                       >
                         <Monitor className="w-5 h-5" />
                         เปิดระบบ Check-in Pro
                       </a>
                       <p className="text-[10px] text-center text-indigo-300 font-medium">
                         * ระบบภายนอกจะไม่เชื่อมต่อคะแนนเข้ากับตัวจัดการนี้โดยอัตโนมัติ
                       </p>
                    </div>
                  </motion.div>
                </div>
              </div>
            )}
          </>
        ) : (
          /* Student View */
          <div className="max-w-3xl mx-auto space-y-10 py-10">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className="relative overflow-hidden bg-white p-10 rounded-[3rem] border border-slate-200 shadow-2xl shadow-indigo-100/50 space-y-8"
            >
              <div className="absolute top-0 right-0 -mr-12 -mt-12 w-48 h-48 bg-indigo-50 rounded-full blur-3xl opacity-50" />
              <div className="absolute bottom-0 left-0 -ml-12 -mb-12 w-48 h-48 bg-emerald-50 rounded-full blur-3xl opacity-50" />

              <div className="text-center space-y-3 relative">
                <div className="inline-flex p-4 bg-indigo-600 text-white rounded-3xl shadow-lg shadow-indigo-200 mb-2">
                  <Search className="w-8 h-8" />
                </div>
                <h2 className="text-3xl font-black text-slate-800 tracking-tight">Student Portal</h2>
                <p className="text-slate-500 font-medium max-w-sm mx-auto leading-relaxed">
                  กรอกรหัสประจำตัวเพื่อตรวจสอบคะแนน <br /> และประวัติการส่งงานของคุณ
                </p>
              </div>

              <form onSubmit={handleSearch} className="flex flex-col sm:flex-row gap-3 relative">
                <div className="relative flex-1">
                  <User className="absolute left-5 top-1/2 -translate-y-1/2 w-5 h-5 text-indigo-400" />
                  <input 
                    type="text" 
                    placeholder="รหัสประจำตัว (เช่น 66001)"
                    value={searchId}
                    onChange={(e) => {
                      setSearchId(e.target.value);
                      setHasSearched(false);
                      if (foundStudent) setFoundStudent(null);
                    }}
                    className="w-full pl-14 pr-6 py-5 bg-slate-50 border-2 border-slate-100 rounded-[2rem] focus:ring-4 focus:ring-indigo-100 focus:border-indigo-500 outline-none text-xl font-bold transition-all placeholder:text-slate-300 placeholder:font-medium"
                  />
                </div>
                <button 
                  type="submit"
                  className="bg-indigo-600 hover:bg-indigo-700 text-white px-10 py-5 rounded-[2rem] font-black text-lg transition-all shadow-xl shadow-indigo-100 active:scale-95 group flex items-center justify-center gap-2"
                >
                  ค้นหา
                  <ChevronRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
                </button>
              </form>
            </motion.div>

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
                  <div className="bg-white p-10 rounded-[3rem] border border-slate-200 shadow-xl overflow-hidden relative">
                    <div className="absolute top-0 right-0 p-8">
                       <GraduationCap className="w-24 h-24 text-slate-50 opacity-60" />
                    </div>

                    <div className="flex flex-col md:flex-row items-start md:items-center gap-8 relative">
                      <div className="w-24 h-24 bg-gradient-to-br from-indigo-500 to-indigo-700 text-white rounded-[2.5rem] flex items-center justify-center shadow-2xl shadow-indigo-200 relative group transition-transform hover:scale-105">
                        <User className="w-10 h-10" />
                        <div className="absolute -bottom-2 -right-2 bg-emerald-500 text-white p-2 rounded-2xl shadow-lg ring-4 ring-white">
                          <CheckCircle2 className="w-4 h-4" />
                        </div>
                      </div>

                      <div className="space-y-1">
                        <p className="text-[10px] font-black text-indigo-400 uppercase tracking-[0.3em] mb-1">Authenticated Student</p>
                        <h3 className="text-4xl font-black text-slate-800 leading-tight tracking-tight">{foundStudent.name}</h3>
                        <div className="flex flex-wrap items-center gap-4 mt-3">
                          <div className="flex items-center gap-3 bg-slate-100/80 px-4 py-2 rounded-2xl border border-slate-200/50">
                            <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">ID</span>
                            <span className="text-sm font-black text-slate-700 leading-none">{foundStudent.studentId}</span>
                          </div>
                          <div className="flex items-center gap-3 bg-slate-100/80 px-4 py-2 rounded-2xl border border-slate-200/50">
                            <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">NO</span>
                            <span className="text-sm font-black text-slate-700 leading-none">{foundStudent.no}</span>
                          </div>
                        </div>
                      </div>

                      <div className="flex-1" />

                      <div className="bg-white border-2 border-indigo-50 p-8 rounded-[3rem] shadow-2xl shadow-indigo-100/50 w-full md:w-auto text-center relative overflow-hidden group">
                        <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-indigo-500 to-emerald-500" />
                        <p className="text-[10px] font-black text-slate-400 uppercase tracking-[0.3em] mb-2">Grade Status</p>
                        <div className="text-7xl font-black bg-gradient-to-br from-indigo-600 to-indigo-800 bg-clip-text text-transparent mb-1">
                          {getGrade(calculateTotal(foundStudent))}
                        </div>
                        <div className="flex items-center justify-center gap-2">
                           <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
                           <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">{calculateTotal(foundStudent)} / 100 PTS</p>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Summary Bento Grid */}
                  <div className="grid grid-cols-1 md:grid-cols-12 gap-6">
                    {/* Individual Exercises Card */}
                    <div className="md:col-span-8 bg-white p-10 rounded-[3rem] border border-slate-200 shadow-xl space-y-8">
                       <div className="flex items-center justify-between">
                         <h3 className="text-2xl font-black text-slate-800 flex items-center gap-3">
                           <div className="p-2.5 bg-indigo-50 text-indigo-600 rounded-2xl">
                             <FileText className="w-6 h-6" />
                           </div>
                           คะแนนแบบฝึกหัด
                         </h3>
                         <span className="text-sm font-bold text-slate-400 bg-slate-50 px-4 py-2 rounded-xl border border-slate-100">
                           ทั้งหมด {(foundStudent.assignment1?.part1 || 0) + (foundStudent.assignment1?.part2 || 0) + (foundStudent.assignment1?.part3 || 0) + 
                                  (foundStudent.assignment2?.part1 || 0) + (foundStudent.assignment2?.part2 || 0) + (foundStudent.assignment2?.part3 || 0) +
                                  (foundStudent.assignment3?.part1 || 0) + (foundStudent.assignment3?.part2 || 0) + (foundStudent.assignment3?.part3 || 0)} / 45
                         </span>
                       </div>

                       <div className="space-y-6">
                         {[1, 2, 3].map(num => {
                           const key = `assignment${num}` as 'assignment1' | 'assignment2' | 'assignment3';
                           const score = foundStudent[key] || { part1: 0, part2: 0, part3: 0 };
                           return (
                             <div key={num} className="bg-slate-50/50 p-6 rounded-[2.5rem] border border-slate-100/80">
                               <div className="flex justify-between items-center mb-4 px-2">
                                 <p className="text-xs font-black text-slate-400 uppercase tracking-[0.2em]">ชุดที่ {num}</p>
                                 <div className="h-px flex-1 mx-4 bg-slate-200" />
                                 <p className="text-sm font-black text-indigo-600">{(score.part1 || 0) + (score.part2 || 0) + (score.part3 || 0)} / 15</p>
                               </div>
                               <div className="grid grid-cols-3 gap-3">
                                 {[1, 2, 3].map(pIdx => {
                                   const pKey = `part${pIdx}` as keyof SubScores;
                                   const exNum = (num - 1) * 3 + pIdx;
                                   return (
                                     <div key={pIdx} className="bg-white p-4 rounded-2xl border border-slate-100 shadow-sm text-center group hover:border-indigo-200 transition-all">
                                       <p className="text-[9px] font-black text-slate-300 uppercase mb-2 group-hover:text-indigo-400 transition-colors">EX {exNum}</p>
                                       <p className="text-2xl font-black text-slate-700">{score[pKey] || 0}</p>
                                     </div>
                                   );
                                 })}
                               </div>
                             </div>
                           );
                         })}
                       </div>
                    </div>

                    {/* Detailed Attendance Card */}
                    <div className="md:col-span-4 bg-white p-8 rounded-[3rem] border border-slate-200 shadow-xl space-y-6 h-full flex flex-col relative overflow-hidden group">
                       <div className="flex items-center justify-between relative z-10">
                         <h3 className="text-xl font-black text-slate-800 flex items-center gap-3">
                           <div className="p-2.5 bg-indigo-50 text-indigo-600 rounded-2xl">
                             <CheckCircle2 className="w-5 h-5" />
                           </div>
                           สรุปการเข้าเรียน
                         </h3>
                       </div>

                       {(() => {
                         const studentRecords = (appData.attendance || []).filter(a => a.studentId === foundStudent.studentId);
                         const counts = {
                           present: studentRecords.filter(a => a.status === 'present').length,
                           late: studentRecords.filter(a => a.status === 'late').length,
                           absent: studentRecords.filter(a => a.status === 'absent').length,
                           leave: studentRecords.filter(a => a.status === 'leave').length,
                         };
                         const effectiveAbsents = counts.absent + Math.floor(counts.late / 4) + Math.floor(counts.leave / 2);
                         const isFailed = effectiveAbsents > 13;
                         const isWarning = effectiveAbsents >= 10;
                         const progress = Math.min((studentRecords.length / 64) * 100, 100);

                         return (
                           <>
                             <div className="grid grid-cols-2 gap-3">
                               <div className="bg-emerald-50/50 p-3 rounded-2xl border border-emerald-100/50 text-center">
                                 <p className="text-[9px] font-black text-emerald-600 uppercase tracking-widest">มา</p>
                                 <p className="text-xl font-black text-emerald-700">{counts.present}</p>
                               </div>
                               <div className="bg-amber-50/50 p-3 rounded-2xl border border-amber-100/50 text-center">
                                 <p className="text-[9px] font-black text-amber-600 uppercase tracking-widest">สาย</p>
                                 <p className="text-xl font-black text-amber-700">{counts.late}</p>
                               </div>
                               <div className="bg-rose-50/50 p-3 rounded-2xl border border-rose-100/50 text-center">
                                 <p className="text-[9px] font-black text-rose-600 uppercase tracking-widest">ขาด</p>
                                 <p className="text-xl font-black text-rose-700">{counts.absent}</p>
                               </div>
                               <div className="bg-indigo-50/50 p-3 rounded-2xl border border-indigo-100/50 text-center">
                                 <p className="text-[9px] font-black text-indigo-600 uppercase tracking-widest">ลา</p>
                                 <p className="text-xl font-black text-indigo-700">{counts.leave}</p>
                               </div>
                             </div>

                             <div className={`p-5 rounded-[2rem] border-2 space-y-3 transition-all ${
                               isFailed ? 'bg-rose-50 border-rose-100' : 
                               isWarning ? 'bg-amber-50 border-amber-100' : 
                               'bg-slate-50 border-slate-100'
                             }`}>
                               <p className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] text-center">คำนวณขาดสะสมเทียบเท่า</p>
                               <div className="text-center">
                                 <span className={`text-5xl font-black ${isFailed ? 'text-rose-600' : isWarning ? 'text-amber-500' : 'text-slate-800'}`}>
                                   {effectiveAbsents}
                                 </span>
                                 <span className="text-slate-300 text-sm font-bold ml-1">/ 13</span>
                               </div>
                               <div className="flex justify-center">
                                 {isFailed ? (
                                   <span className="bg-rose-600 text-white px-3 py-1 rounded-full text-[10px] font-black uppercase">ไม่มีสิทธิ์สอบ</span>
                                 ) : isWarning ? (
                                   <span className="bg-amber-500 text-white px-3 py-1 rounded-full text-[10px] font-black uppercase">ระวังตัว</span>
                                 ) : (
                                   <span className="bg-emerald-500 text-white px-3 py-1 rounded-full text-[10px] font-black uppercase">ปกติ</span>
                                 )}
                               </div>
                             </div>

                             <div className="space-y-2 mt-auto">
                               <div className="flex justify-between text-[9px] font-black text-slate-400 uppercase">
                                 <span>เรียนแล้ว {studentRecords.length} / 64 ครั้ง</span>
                                 <span>{Math.round(progress)}%</span>
                               </div>
                               <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                                  <motion.div 
                                    initial={{ width: 0 }}
                                    animate={{ width: `${progress}%` }}
                                    className={`h-full ${isFailed ? 'bg-rose-500' : 'bg-indigo-600'}`}
                                  />
                               </div>
                               <p className="text-[8px] text-slate-400 font-medium italic leading-tight">
                                 * สาย 4 = ขาด 1 | ลา 2 = ขาด 1 | ขาดสะสมห้ามเกิน 13 (20%)
                               </p>
                             </div>
                           </>
                         );
                       })()}
                    </div>

                    {/* Online Assignments Card */}
                    <div className="md:col-span-12 bg-white p-10 rounded-[3rem] border border-slate-200 shadow-xl flex flex-col">
                      <h3 className="text-2xl font-black text-slate-800 flex items-center gap-3 mb-8">
                        <div className="p-2.5 bg-emerald-50 text-emerald-600 rounded-2xl">
                          <Upload className="w-6 h-6" />
                        </div>
                        งานออนไลน์
                      </h3>

                      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                        {(appData.assignments || []).map(assignment => {
                          const submission = appData.submissions.find(s => s.assignmentId === assignment.id && s.studentId === foundStudent.studentId);
                          const isDone = !!submission;
                          const uploading = isUploading[assignment.id];

                          return (
                            <div key={assignment.id} className={`p-6 rounded-[2.5rem] border transition-all ${
                              isDone ? 'bg-emerald-50/50 border-emerald-100' : 'bg-slate-50 border-slate-100 hover:border-indigo-100'
                            }`}>
                              <div className="space-y-4">
                                <div>
                                  <h4 className="font-black text-slate-800 leading-tight mb-1">{assignment.title}</h4>
                                  <p className="text-[10px] font-bold text-slate-400 line-clamp-2">{assignment.description}</p>
                                </div>

                                {isDone ? (
                                  <div className="space-y-3">
                                    <div className="flex items-center justify-between text-xs font-bold">
                                      <span className="text-emerald-600 flex items-center gap-1.5">
                                        <CheckCircle2 className="w-3.5 h-3.5" /> ส่งแล้ว
                                      </span>
                                      <span className="text-slate-400">{submission.status === 'graded' ? `${submission.score}/${assignment.maxScore}` : 'รอตรวจ'}</span>
                                    </div>
                                    <a 
                                      href={submission.fileUrl} target="_blank" rel="noreferrer" 
                                      className="block w-full text-center py-3 bg-white text-emerald-600 rounded-2xl border border-emerald-100 text-[10px] font-black uppercase hover:bg-emerald-100 transition-colors"
                                    >
                                      View Submission
                                    </a>
                                  </div>
                                ) : (
                                  <label className={`block w-full text-center py-4 rounded-2xl font-black text-[10px] uppercase tracking-widest transition-all cursor-pointer ${
                                    uploading ? 'bg-slate-200 text-slate-400' : 'bg-indigo-600 text-white hover:bg-indigo-700 shadow-lg shadow-indigo-100'
                                  }`}>
                                    {uploading ? 'Uploading...' : 'ส่งงานตอนนี้'}
                                    <input 
                                      type="file" 
                                      className="hidden" 
                                      disabled={uploading}
                                      onChange={(e) => handleStudentFileUpload(e, assignment.id, foundStudent)} 
                                    />
                                  </label>
                                )}
                              </div>
                            </div>
                          );
                        })}

                        {(appData.assignments || []).length === 0 && (
                          <div className="md:col-span-3 text-center py-12">
                            <div className="w-16 h-16 bg-slate-50 rounded-[2rem] flex items-center justify-center mx-auto mb-4 border border-dashed border-slate-200 text-slate-300">
                              <Clock className="w-8 h-8" />
                            </div>
                            <p className="text-sm font-bold text-slate-400">ยังไม่มีงานออนไลน์</p>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </motion.div>
              ) : hasSearched && !foundStudent && (
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
