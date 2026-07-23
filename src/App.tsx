import React, { useState, useEffect, useMemo } from 'react';
import { 
  Plus, Trash2, Save, Users, Calculator, GraduationCap, 
  ChevronRight, ChevronDown, Info, Cloud, CloudCheck, ExternalLink, 
  Loader2, Search, FileText, CheckCircle2, Clock, User, Upload, 
  BookOpen, Settings, X, Menu, LayoutDashboard, Monitor, AlertCircle,
  Link, Check, MoreVertical, LogOut, FileDown, Download, FileType,
  StickyNote, UserPlus, ArrowUpDown, UserX, UserMinus, FileSpreadsheet,
  Award, AlertTriangle
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import html2canvas from 'html2canvas';
import { GoogleSheetsStudioModal } from './components/GoogleSheetsStudioModal';

import { 
  collection, onSnapshot, doc, setDoc, updateDoc, 
  deleteDoc, query, where, getDocs, getDoc, writeBatch
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
  isDroppedOut?: boolean;
}

interface Subject {
  id: string;
  name: string;
  classroomIds?: string[];
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

interface TeacherNote {
  id: string;
  title: string;
  content: string;
  color: string;
  userId: string;
  updatedAt: string;
}

interface Material {
  id: string;
  title: string;
  description: string;
  url: string;
  type: 'pdf' | 'doc' | 'link' | 'video' | 'image';
  courseKey: string;
  createdAt: string;
}

interface AppData {
  subjects: Subject[];
  classRooms: ClassRoom[];
  courses: Record<string, Student[]>;
  assignments: Assignment[];
  submissions: Submission[];
  attendance: Attendance[];
  materials: Material[];
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

const parseCourseKey = (key: string) => {
  if (!key) return { subjectId: '', classroomId: '' };
  const cIndex = key.indexOf('-c-');
  if (cIndex !== -1) {
    return {
      subjectId: key.substring(0, cIndex),
      classroomId: key.substring(cIndex + 1)
    };
  }
  const parts = key.split('-');
  return {
    subjectId: parts[0] || '',
    classroomId: parts[1] || ''
  };
};

const matchCourseKey = (key: string, subjects: Subject[], classRooms: ClassRoom[]) => {
  if (!key) return null;
  const cleanKey = key.trim().toLowerCase();
  for (const subject of subjects) {
    for (const classroom of classRooms) {
      if (cleanKey === `${subject.id}-${classroom.id}`.toLowerCase()) {
        return { subject, classroom };
      }
    }
  }
  return null;
};

const studentCourseMatch = (itemCourseKey: string, studentCourseKey: string) => {
  if (!itemCourseKey || !studentCourseKey) return false;
  const k1 = itemCourseKey.trim().toLowerCase();
  const k2 = studentCourseKey.trim().toLowerCase();
  
  // 1. Exact match
  if (k1 === k2) return true;
  
  // 2. Fallback: match by subject ID
  const p1 = parseCourseKey(k1);
  const p2 = parseCourseKey(k2);
  
  if (p1.subjectId && p2.subjectId && p1.subjectId.trim().toLowerCase() === p2.subjectId.trim().toLowerCase()) {
    return true;
  }
  
  return false;
};

// --- Keyboard Navigation for Grade/Score Tables ---
function handleGridKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
  const key = e.key;
  if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter'].includes(key)) {
    return;
  }

  const currentInput = e.currentTarget;
  // Find closest container: table, form, modal, grid-container, or body
  const container = currentInput.closest('table') || currentInput.closest('.grid-container') || currentInput.closest('form') || document.body;
  const allInputs = Array.from(
    container.querySelectorAll('input:not([type="hidden"]):not([disabled]):not([type="file"]):not([type="checkbox"]):not([type="radio"])')
  ) as HTMLInputElement[];

  const currentIndex = allInputs.indexOf(currentInput);
  if (currentIndex === -1) return;

  const rowAttr = currentInput.getAttribute('data-row');
  const colAttr = currentInput.getAttribute('data-col');

  if (key === 'ArrowDown' || key === 'Enter') {
    e.preventDefault();
    currentInput.blur(); // Triggers onBlur and commits value

    if (rowAttr !== null && colAttr !== null) {
      const currentRow = parseInt(rowAttr, 10);
      for (let step = 1; step <= 50; step++) {
        const targetInput = container.querySelector<HTMLInputElement>(
          `input[data-row="${currentRow + step}"][data-col="${colAttr}"]:not([disabled])`
        );
        if (targetInput) {
          setTimeout(() => {
            targetInput.focus();
            targetInput.select();
          }, 10);
          return;
        }
      }
    }

    // Spatial fallback: move to input in row below
    const currentRect = currentInput.getBoundingClientRect();
    const currentCenterX = currentRect.left + currentRect.width / 2;
    let bestInput: HTMLInputElement | null = null;
    let minDistance = Infinity;

    for (const input of allInputs) {
      if (input === currentInput) continue;
      const rect = input.getBoundingClientRect();
      if (rect.top >= currentRect.bottom - 6) {
        const inputCenterX = rect.left + rect.width / 2;
        const dx = inputCenterX - currentCenterX;
        const dy = rect.top - currentRect.top;
        const dist = Math.abs(dx) * 3 + Math.abs(dy);
        if (dist < minDistance) {
          minDistance = dist;
          bestInput = input;
        }
      }
    }

    if (bestInput) {
      setTimeout(() => {
        bestInput!.focus();
        bestInput!.select();
      }, 10);
    } else if (key === 'Enter' && currentIndex < allInputs.length - 1) {
      const nextInput = allInputs[currentIndex + 1];
      setTimeout(() => {
        nextInput.focus();
        nextInput.select();
      }, 10);
    }
  } else if (key === 'ArrowUp') {
    e.preventDefault();
    currentInput.blur();

    if (rowAttr !== null && colAttr !== null) {
      const currentRow = parseInt(rowAttr, 10);
      for (let step = 1; step <= 50; step++) {
        const targetInput = container.querySelector<HTMLInputElement>(
          `input[data-row="${currentRow - step}"][data-col="${colAttr}"]:not([disabled])`
        );
        if (targetInput) {
          setTimeout(() => {
            targetInput.focus();
            targetInput.select();
          }, 10);
          return;
        }
      }
    }

    // Spatial fallback: move to input in row above
    const currentRect = currentInput.getBoundingClientRect();
    const currentCenterX = currentRect.left + currentRect.width / 2;
    let bestInput: HTMLInputElement | null = null;
    let minDistance = Infinity;

    for (const input of allInputs) {
      if (input === currentInput) continue;
      const rect = input.getBoundingClientRect();
      if (rect.bottom <= currentRect.top + 6) {
        const inputCenterX = rect.left + rect.width / 2;
        const dx = inputCenterX - currentCenterX;
        const dy = currentRect.top - rect.top;
        const dist = Math.abs(dx) * 3 + Math.abs(dy);
        if (dist < minDistance) {
          minDistance = dist;
          bestInput = input;
        }
      }
    }

    if (bestInput) {
      setTimeout(() => {
        bestInput!.focus();
        bestInput!.select();
      }, 10);
    }
  } else if (key === 'ArrowRight') {
    e.preventDefault();
    currentInput.blur();

    if (rowAttr !== null && colAttr !== null) {
      const currentCol = parseInt(colAttr, 10);
      const currentRow = parseInt(rowAttr, 10);
      for (let step = 1; step <= 10; step++) {
        const targetInput = container.querySelector<HTMLInputElement>(
          `input[data-row="${currentRow}"][data-col="${currentCol + step}"]:not([disabled])`
        );
        if (targetInput) {
          setTimeout(() => {
            targetInput.focus();
            targetInput.select();
          }, 10);
          return;
        }
      }
    }

    if (currentIndex < allInputs.length - 1) {
      const nextInput = allInputs[currentIndex + 1];
      setTimeout(() => {
        nextInput.focus();
        nextInput.select();
      }, 10);
    }
  } else if (key === 'ArrowLeft') {
    e.preventDefault();
    currentInput.blur();

    if (rowAttr !== null && colAttr !== null) {
      const currentCol = parseInt(colAttr, 10);
      const currentRow = parseInt(rowAttr, 10);
      for (let step = 1; step <= 10; step++) {
        const targetInput = container.querySelector<HTMLInputElement>(
          `input[data-row="${currentRow}"][data-col="${currentCol - step}"]:not([disabled])`
        );
        if (targetInput) {
          setTimeout(() => {
            targetInput.focus();
            targetInput.select();
          }, 10);
          return;
        }
      }
    }

    if (currentIndex > 0) {
      const prevInput = allInputs[currentIndex - 1];
      setTimeout(() => {
        prevInput.focus();
        prevInput.select();
      }, 10);
    }
  }
}

// --- Local State Controlled Inputs for Performance ---
interface EditableCellProps {
  initialValue: string;
  onCommit: (val: string) => void;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  onDisabledClick?: () => void;
  'data-row'?: number;
  'data-col'?: number;
}

function EditableCell({ initialValue, onCommit, placeholder, className, disabled, onDisabledClick, 'data-row': dataRow, 'data-col': dataCol }: EditableCellProps) {
  const [value, setValue] = React.useState(initialValue);

  React.useEffect(() => {
    setValue(initialValue);
  }, [initialValue]);

  const handleBlur = () => {
    if (value !== initialValue) {
      onCommit(value);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    handleGridKeyDown(e);
  };

  if (disabled) {
    return (
      <div 
        onClick={onDisabledClick}
        title="นักเรียนจำหน่ายออก/พ้นสภาพ - ไม่สามารถแก้ไขได้"
        className="cursor-not-allowed select-none w-full"
      >
        <input
          type="text"
          disabled
          value={value}
          placeholder={placeholder}
          data-row={dataRow}
          data-col={dataCol}
          className={`${className || ''} cursor-not-allowed opacity-60 line-through bg-rose-100/40 text-rose-700 border-rose-200 pointer-events-none`}
        />
      </div>
    );
  }

  return (
    <input
      type="text"
      placeholder={placeholder}
      value={value}
      data-row={dataRow}
      data-col={dataCol}
      onChange={(e) => setValue(e.target.value)}
      onBlur={handleBlur}
      onFocus={(e) => e.target.select()}
      onKeyDown={handleKeyDown}
      className={className}
    />
  );
}

interface EditableNumberCellProps {
  initialValue: number;
  onCommit: (val: number) => void;
  max?: number;
  min?: number;
  className?: string;
  disabled?: boolean;
  onDisabledClick?: () => void;
  'data-row'?: number;
  'data-col'?: number;
}

function EditableNumberCell({ initialValue, onCommit, max, min = 0, className, disabled, onDisabledClick, 'data-row': dataRow, 'data-col': dataCol }: EditableNumberCellProps) {
  const [value, setValue] = React.useState(initialValue !== undefined ? initialValue.toString() : '0');

  React.useEffect(() => {
    setValue(initialValue !== undefined ? initialValue.toString() : '0');
  }, [initialValue]);

  const handleBlur = () => {
    const numVal = Number(value);
    if (!isNaN(numVal) && numVal !== initialValue) {
      let finalVal = numVal;
      if (max !== undefined) finalVal = Math.min(max, finalVal);
      finalVal = Math.max(min, finalVal);
      onCommit(finalVal);
      setValue(finalVal.toString());
    } else {
      setValue(initialValue !== undefined ? initialValue.toString() : '0');
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    handleGridKeyDown(e);
  };

  if (disabled) {
    return (
      <div 
        onClick={onDisabledClick}
        title="นักเรียนจำหน่ายออก/พ้นสภาพ - ไม่สามารถกรอกคะแนนได้"
        className="cursor-not-allowed select-none inline-block"
      >
        <input
          type="text"
          disabled
          value="-"
          data-row={dataRow}
          data-col={dataCol}
          className="w-14 bg-rose-100/60 border border-rose-300 text-rose-600 rounded-lg py-1 text-center font-black outline-none cursor-not-allowed pointer-events-none"
        />
      </div>
    );
  }

  return (
    <input
      type="number"
      max={max}
      min={min}
      value={value}
      data-row={dataRow}
      data-col={dataCol}
      onChange={(e) => setValue(e.target.value)}
      onBlur={handleBlur}
      onFocus={(e) => e.target.select()}
      onKeyDown={handleKeyDown}
      className={className}
    />
  );
}

export default function App() {
  const [appData, setAppData] = useState<AppData>({
    subjects: [],
    classRooms: [],
    courses: {},
    assignments: [],
    submissions: [],
    attendance: [],
    materials: []
  });

  const [selectedSubjectId, setSelectedSubjectId] = useState('');
  const [selectedClassId, setSelectedClassId] = useState('');
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [teacherNotes, setTeacherNotes] = useState<TeacherNote[]>([]);

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

    // Submissions
    const unsubSubmissions = onSnapshot(collection(db, 'submissions'), (snap) => {
      setAppData(prev => ({ ...prev, submissions: snap.docs.map(d => d.data() as Submission) }));
    }, (error) => {
      console.error("Submissions listener error:", error);
    });

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

    // Learning Materials
    const unsubMaterials = onSnapshot(collection(db, 'materials'), (snap) => {
      setAppData(prev => ({ ...prev, materials: snap.docs.map(d => d.data() as Material) }));
    }, (error) => {
      console.error("Error reading materials listener: ", error);
    });

    // Teacher Notes
    let unsubNotes = () => {};
    if (user) {
      const qNotes = query(collection(db, 'teacherNotes'), where('userId', '==', user.uid));
      unsubNotes = onSnapshot(qNotes, (snap) => {
        const notes = snap.docs.map(d => d.data() as TeacherNote);
        notes.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
        setTeacherNotes(notes);
      });
    }

    return () => {
      unsubSubjects();
      unsubClasses();
      unsubAssignments();
      unsubSubmissions();
      unsubStudents();
      unsubAttendance();
      unsubMaterials();
      unsubNotes();
    };
  }, [user]); // Re-run when user changes to update submission listener

  const [isManageModalOpen, setIsManageModalOpen] = useState(false);
  const [isAddStudentModalOpen, setIsAddStudentModalOpen] = useState(false);
  const [addStudentTab, setAddStudentTab] = useState<'individual' | 'file' | 'excel'>('individual');
  const [singleStudentInput, setSingleStudentInput] = useState({
    no: '',
    studentId: '',
    name: '',
    isDroppedOut: false
  });
  const [excelPasteInput, setExcelPasteInput] = useState('');
  const [isNotesModalOpen, setIsNotesModalOpen] = useState(false);
  const [isSheetsStudioOpen, setIsSheetsStudioOpen] = useState(false);
  const [isGradingCriteriaModalOpen, setIsGradingCriteriaModalOpen] = useState(false);
  const [confirmModal, setConfirmModal] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    onConfirm: () => void;
    confirmLabel?: string;
    cancelLabel?: string;
    type?: 'danger' | 'warning' | 'info' | 'success';
    isAlert?: boolean;
  }>({
    isOpen: false,
    title: '',
    message: '',
    onConfirm: () => {},
  });

  const askConfirmation = (config: {
    title: string;
    message: string;
    onConfirm: () => void;
    confirmLabel?: string;
    cancelLabel?: string;
    type?: 'danger' | 'warning' | 'info' | 'success';
  }) => {
    setConfirmModal({ ...config, isOpen: true, isAlert: false });
  };

  const showAlert = (title: string, message: string, type: 'success' | 'info' | 'warning' | 'error' = 'info') => {
    setConfirmModal({
      isOpen: true,
      title,
      message,
      onConfirm: () => {},
      confirmLabel: 'ตกลง',
      type: type === 'error' ? 'danger' : type,
      isAlert: true
    });
  };
  const [manageType, setManageType] = useState<'subject' | 'class' | 'assignment'>('subject');
  const [newSubjectNameInput, setNewSubjectNameInput] = useState('');
  const [newClassNameInput, setNewClassNameInput] = useState('');
  const [selectedClassroomsForNewSubject, setSelectedClassroomsForNewSubject] = useState<string[]>([]);
  const [manageCenterTab, setManageCenterTab] = useState<'subject' | 'class'>('subject');
  const [newItemName, setNewItemName] = useState('');
  const [newAssignmentDesc, setNewAssignmentDesc] = useState('');
  const [newAssignmentScore, setNewAssignmentScore] = useState(10);
  const [newTargetAssignment, setNewTargetAssignment] = useState(1);
  const [newTargetPart, setNewTargetPart] = useState(1);

  const currentCourseKey = `${selectedSubjectId}-${selectedClassId}`;
  const students = useMemo(() => (appData.courses || {})[currentCourseKey] || [], [appData.courses, currentCourseKey]);
  const currentAssignments = useMemo(() => (appData.assignments || []).filter(a => a.courseKey === currentCourseKey), [appData.assignments, currentCourseKey]);

  const [studentFilter, setStudentFilter] = useState<'all' | 'normal' | 'dropped'>('all');

  const filteredStudents = useMemo(() => {
    if (studentFilter === 'dropped') {
      return students.filter(s => s.isDroppedOut);
    }
    if (studentFilter === 'normal') {
      return students.filter(s => !s.isDroppedOut);
    }
    return students;
  }, [students, studentFilter]);

  const [isUploading, setIsUploading] = useState<Record<string, boolean>>({});
  const [submissionScores, setSubmissionScores] = useState<Record<string, string>>({});

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
  const [isExporting, setIsExporting] = useState(false);
  const [isTabsCollapsed, setIsTabsCollapsed] = useState(false);

  // Materials Form States
  const [newMaterialTitle, setNewMaterialTitle] = useState('');
  const [newMaterialDesc, setNewMaterialDesc] = useState('');
  const [newMaterialUrl, setNewMaterialUrl] = useState('');
  const [newMaterialType, setNewMaterialType] = useState<'pdf' | 'doc' | 'link' | 'video' | 'image'>('link');
  const [isUploadingMaterial, setIsUploadingMaterial] = useState(false);

  const handleMaterialFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsUploadingMaterial(true);
    const formData = new FormData();
    formData.append('file', file);

    try {
      const res = await fetch('/api/drive/upload-material', {
        method: 'POST',
        body: formData
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || 'Upload failed');
      }

      const data = await res.json();
      setNewMaterialUrl(data.url);
      
      // Auto-detect type based on extension
      const ext = file.name.split('.').pop()?.toLowerCase();
      if (ext === 'pdf') {
        setNewMaterialType('pdf');
      } else if (['doc', 'docx', 'ppt', 'pptx', 'xls', 'xlsx'].includes(ext || '')) {
        setNewMaterialType('doc');
      } else if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'].includes(ext || '')) {
        setNewMaterialType('image');
      } else if (['mp4', 'mov', 'avi', 'mkv', 'webm'].includes(ext || '')) {
        setNewMaterialType('video');
      }

      // Auto-populate title if empty
      if (!newMaterialTitle.trim()) {
        const cleanName = file.name.substring(0, file.name.lastIndexOf('.')) || file.name;
        setNewMaterialTitle(cleanName);
      }

      showAlert('อัปโหลดไฟล์สำเร็จ!', '✅ ไฟล์สื่อการสอนได้รับการอัปโหลดเรียบร้อยและนำมาแปลงเป็นลิงก์ให้โดยอัตโนมัติแล้วครับ', 'success');
    } catch (err: any) {
      console.error('Material upload error:', err);
      showAlert('อัปโหลดล้มเหลว', `❌ ไม่สามารถอัปโหลดไฟล์ได้: ${err.message}`, 'error');
    } finally {
      setIsUploadingMaterial(false);
      e.target.value = '';
    }
  };

  const addMaterial = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedSubjectId || !selectedClassId) {
      showAlert('ข้อผิดพลาด', 'กรุณาเลือกวิชาและห้องเรียนก่อน', 'warning');
      return;
    }
    if (!newMaterialTitle.trim() || !newMaterialUrl.trim()) {
      showAlert('ข้อมูลไม่ครบถ้วน', 'กรุณากรอกหัวข้อสื่อและลิงก์ดาวน์โหลด/เข้าชม', 'warning');
      return;
    }

    let formattedUrl = newMaterialUrl.trim();
    if (!/^https?:\/\//i.test(formattedUrl)) {
      formattedUrl = 'https://' + formattedUrl;
    }

    try {
      const id = 'mat_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7);
      const newMat: Material = {
        id,
        title: newMaterialTitle.trim(),
        description: newMaterialDesc.trim(),
        url: formattedUrl,
        type: newMaterialType,
        courseKey: currentCourseKey,
        createdAt: new Date().toISOString()
      };

      await setDoc(doc(db, 'materials', id), newMat);
      
      // Clear form
      setNewMaterialTitle('');
      setNewMaterialDesc('');
      setNewMaterialUrl('');
      setNewMaterialType('link');
      showAlert('สำเร็จ', 'เพิ่มสื่อการสอนเรียบร้อยแล้ว', 'success');
    } catch (err) {
      console.error(err);
      showAlert('เกิดข้อผิดพลาด', 'ไม่สามารถบันทึกข้อมูลสื่อการสอนได้', 'error');
    }
  };

  const deleteMaterial = async (materialId: string) => {
    askConfirmation({
      title: 'ลบสื่อการสอน',
      message: 'คุณแน่ใจหรือไม่ว่าจะลบสื่อการสอนนี้? ข้อมูลนี้จะหายไปอย่างถาวร',
      type: 'danger',
      onConfirm: async () => {
        try {
          await deleteDoc(doc(db, 'materials', materialId));
          showAlert('สำเร็จ', 'ลบสื่อการสอนสำเร็จ', 'success');
        } catch (err) {
          console.error(err);
          showAlert('เกิดข้อผิดพลาด', 'ไม่สามารถลบสื่อการสอนได้', 'error');
        }
      }
    });
  };

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('portal') === 'student') {
      setView('student');
      setIsLockedStudentView(true);
    }
  }, []);

  const [teacherTab, setTeacherTab] = useState<'dashboard' | 'grades' | 'assignments' | 'submissions' | 'attendance' | 'materials' | 'admin'>('dashboard');
  const [attendanceDate, setAttendanceDate] = useState(new Date().toISOString().split('T')[0]);
  const [currentAttendance, setCurrentAttendance] = useState<Record<string, 'present' | 'late' | 'absent' | 'leave'>>({});

  // Database Admin Console States & Variables
  const [migrationSrcSubject, setMigrationSrcSubject] = useState('');
  const [migrationSrcClass, setMigrationSrcClass] = useState('');
  const [migrationDstSubject, setMigrationDstSubject] = useState('');
  const [migrationDstClass, setMigrationDstClass] = useState('');
  const [isAdminProcessing, setIsAdminProcessing] = useState(false);
  const [allSubmissionsCount, setAllSubmissionsCount] = useState(0);
  const [allAttendanceCount, setAllAttendanceCount] = useState(0);
  const [allStudentsCount, setAllStudentsCount] = useState(0);
  const [isBackupRestoring, setIsBackupRestoring] = useState(false);

  // Student Portal State
  const [searchId, setSearchId] = useState('');
  const [foundStudent, setFoundStudent] = useState<Student | null>(null);

  const matchingStudentRecords = useMemo(() => {
    if (!foundStudent?.studentId) return [];
    const matched: Student[] = [];
    const seenCourseKeys = new Set<string>();
    for (const key in (appData.courses || {})) {
      const records = (appData.courses || {})[key] || [];
      const s = records.find(item => item.studentId.trim().toLowerCase() === foundStudent.studentId.trim().toLowerCase());
      if (s && !seenCourseKeys.has(s.courseKey)) {
        // Only show if the subject and classroom actually exist in database
        const match = matchCourseKey(s.courseKey, appData.subjects, appData.classRooms);
        if (match) {
          seenCourseKeys.add(s.courseKey);
          matched.push(s);
        }
      }
    }
    return matched;
  }, [appData.courses, foundStudent?.studentId, appData.subjects, appData.classRooms]);

  const [hasSearched, setHasSearched] = useState(false);
  const [studentFilterSubjectId, setStudentFilterSubjectId] = useState('');
  const [studentFilterClassId, setStudentFilterClassId] = useState('');

  const [studentLinkInput, setStudentLinkInput] = useState<Record<string, string>>({});
  const [studentSubmissionMode, setStudentSubmissionMode] = useState<Record<string, 'file' | 'link'>>({});

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
        showAlert('ยินดีด้วย!', '✅ เชื่อมต่อ Google Sheets สำเร็จ!', 'success');
      }
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  const handleGoogleAuth = async () => {
    const popup = window.open('', 'GoogleOAuth', 'width=600,height=700');
    if (!popup) {
      showAlert('แจ้งเตือน', 'กรุณาอนุญาตให้เปิดหน้าต่าง Pop-up เพื่อเชื่อมต่อ Google', 'warning');
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
      showAlert('เกิดข้อผิดพลาด', `ไม่สามารถเชื่อมต่อได้: ${err instanceof Error ? err.message : 'Unknown error'}`, 'error');
    }
  };

  const handleFirebaseLogin = async () => {
    try {
      await signInWithGoogle();
    } catch (err: any) {
      console.error('Firebase Login Error:', err);
      // Give more specific error message to help the user fix deployment issues
      if (err.code === 'auth/unauthorized-domain') {
        showAlert('เข้าสู่ระบบไม่สำเร็จ', '❌ เข้าสู่ระบบไม่สำเร็จ: โดเมนนี้ยังไม่ได้ลงทะเบียนใน Firebase', 'error');
      } else {
        showAlert('เกิดข้อผิดพลาด', `❌ เกิดข้อผิดพลาด: ${err.message}`, 'error');
      }
    }
  };

  const handleSyncToSheets = async (customSettings?: any) => {
    setIsSyncing(true);
    const currentSubject = appData.subjects.find(s => s.id === selectedSubjectId);
    const currentClass = appData.classRooms.find(c => c.id === selectedClassId);
    const courseTitle = customSettings?.sheetName || `${currentSubject?.name || 'Unknown'} - ${currentClass?.name || 'Unknown'}`;

    try {
      const res = await fetch('/api/sheets/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          students,
          submissions: appData.submissions,
          sheetName: courseTitle,
          customSettings
        })
      });
      
      const responseText = await res.text();
      let responseData: any = {};
      try {
        responseData = JSON.parse(responseText);
      } catch (e) {
        if (!res.ok) {
          if (res.status === 401) {
            throw new Error('กรุณาเข้าสู่ระบบ Google ก่อนดำเนินการซิงค์ข้อมูล');
          }
          throw new Error(`เซิร์ฟเวอร์ตอบกลับผิดพลาด (${res.status}): ${responseText.slice(0, 150)}`);
        }
      }

      if (!res.ok) {
        throw new Error(responseData.error || 'การซิงค์ข้อมูลไม่สำเร็จ');
      }
      
      setSpreadsheetUrl(responseData.url);
      showAlert('สำเร็จ!', 'ซิงค์ข้อมูลและอัปเดต Google Sheets เรียบร้อยแล้ว!', 'success');
      if (isSheetsStudioOpen) {
        setIsSheetsStudioOpen(false);
      }
    } catch (err) {
      console.error('Sync error:', err);
      showAlert('เกิดข้อผิดพลาด', `เกิดข้อผิดพลาดในการซิงค์: ${err instanceof Error ? err.message : 'Unknown error'}`, 'error');
    } finally {
      setIsSyncing(false);
    }
  };

  const addNote = async () => {
    if (!user) return;
    const id = crypto.randomUUID();
    const colors = ['indigo', 'emerald', 'amber', 'rose', 'sky', 'violet'];
    const randomColor = colors[Math.floor(Math.random() * colors.length)];
    const newNote: TeacherNote = {
      id,
      title: 'โน๊ตใหม่',
      content: '',
      color: randomColor,
      userId: user.uid,
      updatedAt: new Date().toISOString()
    };
    await setDoc(doc(db, 'teacherNotes', id), newNote);
  };

  const updateNote = async (id: string, field: string, value: string) => {
    const noteRef = doc(db, 'teacherNotes', id);
    await updateDoc(noteRef, {
      [field]: value,
      updatedAt: new Date().toISOString()
    });
  };

  const deleteNote = async (id: string) => {
    askConfirmation({
      title: 'ลบโน๊ตส่วนตัว',
      message: 'ยืนยันการลบโน๊ตนี้? การดำเนินการนี้ไม่สามารถย้อนกลับได้',
      type: 'danger',
      onConfirm: async () => {
        await deleteDoc(doc(db, 'teacherNotes', id));
      }
    });
  };

  // Database Admin Diagnostics & Stats Loader
  const fetchAdminStats = async () => {
    try {
      const studentsSnap = await getDocs(collection(db, 'students'));
      const submissionsSnap = await getDocs(collection(db, 'submissions'));
      const attendanceSnap = await getDocs(collection(db, 'attendance'));
      setAllStudentsCount(studentsSnap.size);
      setAllSubmissionsCount(submissionsSnap.size);
      setAllAttendanceCount(attendanceSnap.size);
    } catch (err) {
      console.error("Failed to fetch admin stats:", err);
    }
  };

  useEffect(() => {
    if (teacherTab === 'admin') {
      fetchAdminStats();
    }
  }, [teacherTab]);

  const exportDatabaseJson = async () => {
    setIsAdminProcessing(true);
    try {
      const subjectsSnap = await getDocs(collection(db, 'subjects'));
      const classRoomsSnap = await getDocs(collection(db, 'classRooms'));
      const assignmentsSnap = await getDocs(collection(db, 'assignments'));
      const studentsSnap = await getDocs(collection(db, 'students'));
      const submissionsSnap = await getDocs(collection(db, 'submissions'));
      const attendanceSnap = await getDocs(collection(db, 'attendance'));
      const materialsSnap = await getDocs(collection(db, 'materials'));

      const dbBackup = {
        subjects: subjectsSnap.docs.map(d => d.data()),
        classRooms: classRoomsSnap.docs.map(d => d.data()),
        assignments: assignmentsSnap.docs.map(d => d.data()),
        students: studentsSnap.docs.map(d => d.data()),
        submissions: submissionsSnap.docs.map(d => d.data()),
        attendance: attendanceSnap.docs.map(d => d.data()),
        materials: materialsSnap.docs.map(d => d.data()),
        version: "1.0",
        exportedAt: new Date().toISOString()
      };

      const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(dbBackup, null, 2));
      const downloadAnchor = document.createElement('a');
      downloadAnchor.setAttribute("href", dataStr);
      downloadAnchor.setAttribute("download", `student_tracker_backup_${Date.now()}.json`);
      document.body.appendChild(downloadAnchor);
      downloadAnchor.click();
      downloadAnchor.remove();
      
      showAlert('สำเร็จ!', 'ส่งออกไฟล์สำรองข้อมูลฐานข้อมูลเรียบร้อยแล้ว', 'success');
    } catch (err: any) {
      console.error(err);
      showAlert('ล้มเหลว', `เกิดข้อผิดพลาดในการส่งออกข้อมูล: ${err.message}`, 'error');
    } finally {
      setIsAdminProcessing(false);
    }
  };

  const importDatabaseJson = async (file: File) => {
    setIsBackupRestoring(true);
    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const backup = JSON.parse(event.target?.result as string);
        if (!backup.subjects || !backup.students || !backup.classRooms) {
          throw new Error("รูปแบบไฟล์สำรองข้อมูลไม่ถูกต้อง");
        }

        const collectionsToRestore = [
          { name: 'subjects', data: backup.subjects },
          { name: 'classRooms', data: backup.classRooms },
          { name: 'assignments', data: backup.assignments || [] },
          { name: 'students', data: backup.students },
          { name: 'submissions', data: backup.submissions || [] },
          { name: 'attendance', data: backup.attendance || [] },
          { name: 'materials', data: backup.materials || [] }
        ];

        let totalCount = 0;
        let currentBatch = writeBatch(db);
        let batchOpCount = 0;

        for (const col of collectionsToRestore) {
          for (const item of col.data) {
            if (!item.id) continue;
            const docRef = doc(db, col.name, item.id);
            currentBatch.set(docRef, item);
            batchOpCount++;
            totalCount++;

            if (batchOpCount >= 400) {
              await currentBatch.commit();
              currentBatch = writeBatch(db);
              batchOpCount = 0;
            }
          }
        }

        if (batchOpCount > 0) {
          await currentBatch.commit();
        }

        showAlert('สำเร็จ!', `กู้คืนข้อมูลฐานข้อมูลสำเร็จ ทั้งหมด ${totalCount} รายการ`, 'success');
        fetchAdminStats();
      } catch (err: any) {
        console.error(err);
        showAlert('ล้มเหลว', `เกิดข้อผิดพลาดในการนำเข้าข้อมูล: ${err.message}`, 'error');
      } finally {
        setIsBackupRestoring(false);
      }
    };
    reader.readAsText(file);
  };

  const handleMigrateStudents = async (mode: 'move' | 'copy') => {
    if (!migrationSrcSubject || !migrationSrcClass || !migrationDstSubject || !migrationDstClass) {
      showAlert('ข้อมูลไม่ครบถ้วน', 'กรุณาเลือกวิชาและห้องเรียนต้นทางและปลายทางให้ครบถ้วน', 'warning');
      return;
    }

    const srcKey = `${migrationSrcSubject}-${migrationSrcClass}`;
    const dstKey = `${migrationDstSubject}-${migrationDstClass}`;

    if (srcKey === dstKey) {
      showAlert('เกิดข้อผิดพลาด', 'ต้นทางและปลายทางต้องไม่เป็นห้องเดียวกัน', 'warning');
      return;
    }

    setIsAdminProcessing(true);
    try {
      const q = query(collection(db, 'students'), where('courseKey', '==', srcKey));
      const snap = await getDocs(q);
      const srcStudents = snap.docs.map(d => d.data() as Student);

      if (srcStudents.length === 0) {
        showAlert('ไม่พบข้อมูล', 'ไม่พบรายชื่อนักเรียนในห้องเรียนต้นทาง', 'info');
        setIsAdminProcessing(false);
        return;
      }

      let batch = writeBatch(db);
      let count = 0;

      if (mode === 'move') {
        for (const s of srcStudents) {
          const sRef = doc(db, 'students', s.id);
          batch.update(sRef, { courseKey: dstKey });
          count++;

          const attQuery = query(collection(db, 'attendance'), where('studentId', '==', s.studentId), where('courseKey', '==', srcKey));
          const attSnap = await getDocs(attQuery);
          attSnap.docs.forEach(doc => {
            batch.update(doc.ref, { courseKey: dstKey });
          });
        }
      } else {
        for (const s of srcStudents) {
          const newId = crypto.randomUUID();
          const newStudent: Student = {
            ...s,
            id: newId,
            courseKey: dstKey,
            behavior: 0,
            attendance: 0,
            assignment1: { part1: 0, part2: 0, part3: 0 },
            assignment2: { part1: 0, part2: 0, part3: 0 },
            assignment3: { part1: 0, part2: 0, part3: 0 },
            midterm: 0,
            final: 0
          };
          const sRef = doc(db, 'students', newId);
          batch.set(sRef, newStudent);
          count++;
        }
      }

      await batch.commit();
      showAlert('สำเร็จ!', `${mode === 'move' ? 'ย้าย' : 'คัดลอก'} รายชื่อนักเรียนเรียบร้อยแล้ว จำนวน ${count} คน`, 'success');
      
      setMigrationSrcSubject('');
      setMigrationSrcClass('');
      setMigrationDstSubject('');
      setMigrationDstClass('');
      fetchAdminStats();
    } catch (err: any) {
      console.error(err);
      showAlert('ล้มเหลว', `เกิดข้อผิดพลาดในการจัดการข้อมูล: ${err.message}`, 'error');
    } finally {
      setIsAdminProcessing(false);
    }
  };

  const handlePurgeData = async (type: 'attendance' | 'submissions' | 'students') => {
    if (!selectedSubjectId || !selectedClassId) {
      showAlert('ข้อผิดพลาด', 'กรุณาเลือกวิชาและห้องเรียนที่ต้องการล้างข้อมูล', 'warning');
      return;
    }

    const targetKey = `${selectedSubjectId}-${selectedClassId}`;
    const subjectName = appData.subjects.find(s => s.id === selectedSubjectId)?.name || '';
    const className = appData.classRooms.find(c => c.id === selectedClassId)?.name || '';

    let typeText = '';
    if (type === 'attendance') typeText = 'ประวัติการเข้าเรียนทั้งหมด';
    else if (type === 'submissions') typeText = 'ประวัติการส่งงานออนไลน์ทั้งหมด';
    else if (type === 'students') typeText = 'รายชื่อนักเรียนและเกรดทั้งหมด';

    askConfirmation({
      title: `ล้างข้อมูล ${typeText}`,
      message: `คุณกำลังจะลบข้อมูล "${typeText}" ในรายวิชา "${subjectName} (${className})" การดำเนินการนี้ลบข้อมูลถาวรบนเซิร์ฟเวอร์และกู้คืนไม่ได้ ยืนยันหรือไม่?`,
      type: 'danger',
      onConfirm: async () => {
        setIsAdminProcessing(true);
        try {
          let count = 0;
          let batch = writeBatch(db);

          if (type === 'attendance') {
            const q = query(collection(db, 'attendance'), where('courseKey', '==', targetKey));
            const snap = await getDocs(q);
            snap.docs.forEach(doc => {
              batch.delete(doc.ref);
              count++;
            });
          } else if (type === 'submissions') {
            const assignmentsInCourse = appData.assignments.filter(a => a.courseKey === targetKey);
            for (const a of assignmentsInCourse) {
              const q = query(collection(db, 'submissions'), where('assignmentId', '==', a.id));
              const snap = await getDocs(q);
              snap.docs.forEach(doc => {
                batch.delete(doc.ref);
                count++;
              });
            }
          } else if (type === 'students') {
            const q = query(collection(db, 'students'), where('courseKey', '==', targetKey));
            const snap = await getDocs(q);
            snap.docs.forEach(doc => {
              batch.delete(doc.ref);
              count++;
            });
          }

          if (count > 0) {
            await batch.commit();
            showAlert('สำเร็จ!', `ล้างข้อมูล ${typeText} เรียบร้อยแล้ว จำนวน ${count} รายการ`, 'success');
          } else {
            showAlert('ไม่พบข้อมูล', `ไม่มีข้อมูล ${typeText} ในห้องนี้ให้ลบ`, 'info');
          }
          fetchAdminStats();
        } catch (err: any) {
          console.error(err);
          showAlert('ล้มเหลว', `เกิดข้อผิดพลาดในการล้างข้อมูล: ${err.message}`, 'error');
        } finally {
          setIsAdminProcessing(false);
        }
      }
    });
  };

  const exportToPDF = async () => {
    const reportElement = document.getElementById('grade-report-pdf');
    if (!reportElement) return;

    setIsExporting(true);
    try {
      // Temporarily show the report for capturing
      reportElement.style.display = 'block';
      
      const canvas = await html2canvas(reportElement, {
        scale: 2, // Higher quality
        useCORS: true,
        logging: false,
        backgroundColor: '#ffffff'
      });
      
      const imgData = canvas.toDataURL('image/png');
      const pdf = new jsPDF('p', 'mm', 'a4');
      const pdfWidth = pdf.internal.pageSize.getWidth();
      const pdfHeight = (canvas.height * pdfWidth) / canvas.width;
      
      pdf.addImage(imgData, 'PNG', 0, 0, pdfWidth, pdfHeight);
      
      const subject = appData.subjects.find(s => s.id === selectedSubjectId)?.name || 'Subject';
      const classroom = appData.classRooms.find(c => c.id === selectedClassId)?.name || 'Class';
      pdf.save(`รายงานคะแนน_${subject}_${classroom}.pdf`);
    } catch (error) {
      console.error('PDF Export Error:', error);
      showAlert('เกิดข้อผิดพลาด', 'เกิดข้อผิดพลาดในการสร้าง PDF', 'error');
    } finally {
      reportElement.style.display = 'none';
      setIsExporting(false);
    }
  };

  const addStudent = () => {
    setSingleStudentInput({
      no: (students.length + 1).toString(),
      studentId: '',
      name: '',
      isDroppedOut: false
    });
    setAddStudentTab('individual');
    setIsAddStudentModalOpen(true);
  };

  const handleSaveIndividualStudent = async (keepOpen: boolean) => {
    const sId = singleStudentInput.studentId.trim();
    const sName = singleStudentInput.name.trim();
    if (!sId || !sName) {
      showAlert('กรุณากรอกข้อมูล', 'ระบุรหัสนักเรียนและชื่อ-นามสุกล ให้ครบถ้วน', 'warning');
      return;
    }

    const id = crypto.randomUUID();
    const newStudent: Student = {
      id,
      no: (singleStudentInput.no || (students.length + 1).toString()).trim(),
      studentId: sId,
      name: sName,
      courseKey: currentCourseKey,
      behavior: 0,
      attendance: 0,
      assignment1: { part1: 0, part2: 0, part3: 0 },
      assignment2: { part1: 0, part2: 0, part3: 0 },
      assignment3: { part1: 0, part2: 0, part3: 0 },
      midterm: 0,
      final: 0,
      isDroppedOut: singleStudentInput.isDroppedOut
    };

    try {
      await setDoc(doc(db, 'students', id), newStudent);
      showAlert('สำเร็จ!', `เพิ่มข้อมูลนักเรียน ${sName} เข้าสู่ระบบสำเร็จ`, 'success');
      
      if (keepOpen) {
        setSingleStudentInput(prev => ({
          no: (Number(prev.no) ? Number(prev.no) + 1 : students.length + 2).toString(),
          studentId: '',
          name: '',
          isDroppedOut: prev.isDroppedOut
        }));
      } else {
        setIsAddStudentModalOpen(false);
      }
    } catch (err) {
      console.error(err);
      showAlert('เกิดข้อผิดพลาด', 'ไม่สามารถเพิ่มข้อมูลนักเรียนรายนี้ได้', 'error');
    }
  };

  const handleImportPastedText = async () => {
    const rawText = excelPasteInput.trim();
    if (!rawText) {
      showAlert('กรุณาวางข้อมูล', 'กรุณาวางรายชื่อนักเรียนจาก Excel หรือพิมพ์รูปแบบที่ถูกต้องก่อนกดยืนยัน', 'warning');
      return;
    }

    const lines = rawText.split('\n');
    let count = 0;
    const batchPromises = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      let parts = line.split('\t').map(p => p.trim());
      if (parts.length < 2) {
        parts = line.split(',').map(p => p.trim());
      }

      let no = '';
      let studentId = '';
      let name = '';

      if (parts.length >= 3) {
        no = parts[0];
        studentId = parts[1];
        name = parts[2];
      } else if (parts.length === 2) {
        no = (students.length + count + 1).toString();
        studentId = parts[0];
        name = parts[1];
      } else {
        no = (students.length + count + 1).toString();
        studentId = `std-${Date.now()}-${count}`;
        name = parts[0];
      }

      const id = crypto.randomUUID();
      const newStudent: Student = {
        id,
        no,
        studentId,
        name,
        courseKey: currentCourseKey,
        behavior: 0,
        attendance: 0,
        assignment1: { part1: 0, part2: 0, part3: 0 },
        assignment2: { part1: 0, part2: 0, part3: 0 },
        assignment3: { part1: 0, part2: 0, part3: 0 },
        midterm: 0,
        final: 0,
        isDroppedOut: singleStudentInput.isDroppedOut
      };

      batchPromises.push(setDoc(doc(db, 'students', id), newStudent));
      count++;
    }

    try {
      await Promise.all(batchPromises);
      showAlert('บันทึกสำเร็จ!', `นำเข้ารายชื่อนักเรียนสำเร็จ ${count} รายการ เรียบร้อยแล้ว`, 'success');
      setExcelPasteInput('');
      setIsAddStudentModalOpen(false);
    } catch (err) {
      console.error(err);
      showAlert('ผิดพลาด', 'เกิดข้อผิดพลาดระหว่างนำรายชื่อนักเรียนเข้าระบบ', 'error');
    }
  };

  const removeStudent = async (id: string) => {
    await deleteDoc(doc(db, 'students', id));
  };

  const removeAllStudents = async () => {
    if (students.length === 0) return;
    
    const isTeacher = user?.email === 'watcharaphon_pa@t-tech.ac.th';
    if (!isTeacher) {
      showAlert('เข้าถึงไม่ได้', '⚠️ เฉพาะครูที่เข้าสู่ระบบเท่านั้นที่สามารถลบรายชื่อนักเรียนได้', 'warning');
      return;
    }

    askConfirmation({
      title: 'แจ้งเตือนสำคัญ!',
      message: `คุณกำลังจะลบรายชื่อนักเรียนทั้งหมดในห้องนี้ (${students.length} คน) การดำเนินการนี้ไม่สามารถย้อนกลับได้ ยืนยันที่จะลบหรือไม่?`,
      type: 'danger',
      onConfirm: async () => {
        try {
          const promises = students.map(s => deleteDoc(doc(db, 'students', s.id)));
          await Promise.all(promises);
          // replace alert with a better UI or just leave it for now if requested
        } catch (err: any) {
          console.error('Error removing all students:', err);
        }
      }
    });
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
    const activeStudents = students.filter(s => !s.isDroppedOut);
    if (activeStudents.length === 0) return { avg: 0, passRate: 0 };
    const totals = activeStudents.map(s => calculateTotal(s));
    const avg = totals.reduce((a, b) => a + b, 0) / activeStudents.length;
    const passCount = totals.filter(t => t >= 50).length;
    return {
      avg: avg.toFixed(2),
      passRate: ((passCount / activeStudents.length) * 100).toFixed(1)
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
          final: 0,
          isDroppedOut: false
        };
        await setDoc(doc(db, 'students', id), newStudent);
        count++;
      }
      showAlert('สำเร็จ!', `นำเข้าข้อมูลนักเรียน ${count} คน เรียบร้อยแล้ว`, 'success');
    };
    reader.readAsText(file);
  };

  const addSubject = async (customName?: string) => {
    const targetName = (customName || newSubjectNameInput || newItemName).trim();
    if (!targetName) return;
    const id = `s-${Date.now()}`;
    const clIds = selectedClassroomsForNewSubject.length > 0 
      ? selectedClassroomsForNewSubject 
      : appData.classRooms.map(c => c.id);

    await setDoc(doc(db, 'subjects', id), { 
      id, 
      name: targetName,
      classroomIds: clIds
    });
    setNewSubjectNameInput('');
    setNewItemName('');
    setSelectedClassroomsForNewSubject([]);
  };

  const addClass = async (customName?: string) => {
    const targetName = (customName || newClassNameInput || newItemName).trim();
    if (!targetName) return;
    const id = `c-${Date.now()}`;
    await setDoc(doc(db, 'classRooms', id), { id, name: targetName });
    setNewClassNameInput('');
    setNewItemName('');
  };

  const toggleSubjectClassroom = async (subjectId: string, classroomId: string) => {
    const subject = appData.subjects.find(s => s.id === subjectId);
    if (!subject) return;

    let currentIds = subject.classroomIds;
    if (!currentIds || !Array.isArray(currentIds)) {
      currentIds = appData.classRooms.map(c => c.id);
    }

    let nextIds: string[];
    if (currentIds.includes(classroomId)) {
      nextIds = currentIds.filter(id => id !== classroomId);
    } else {
      nextIds = [...currentIds, classroomId];
    }

    await setDoc(doc(db, 'subjects', subjectId), {
      ...subject,
      classroomIds: nextIds
    }, { merge: true });
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
    askConfirmation({
      title: 'ลบงาน',
      message: 'ยืนยันการลบงาน? ข้อมูลการส่งงานจะหายไปด้วย',
      type: 'danger',
      onConfirm: async () => {
        await deleteDoc(doc(db, 'assignments', id));
        // Optionally delete submissions for this assignment as well
        const toDelete = (appData.submissions || []).filter(s => s.assignmentId === id);
        for (const sub of toDelete) {
          await deleteDoc(doc(db, 'submissions', sub.id));
        }
      }
    });
  };

  const handleStudentFileUpload = async (e: React.ChangeEvent<HTMLInputElement>, assignmentId: string, student: Student) => {
    const file = e.target.files?.[0];
    if (!file) return;

    console.log('Starting file upload for:', file.name, 'Student:', student.studentId);

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

      showAlert('ส่งงานสำเร็จ!', '✅ ส่งงานเรียบร้อยแล้ว!\nงานของคุณถูกบันทึกใน Google Drive ของอาจารย์เรียบร้อย', 'success');
    } catch (err: any) {
      console.error('Final upload error:', err);
      showAlert('เกิดข้อผิดพลาด', `❌ เกิดข้อผิดพลาด: ${err.message || 'ไม่สามารถติดต่อเซิร์ฟเวอร์ได้'}\n\nกรุณาลองใหม่อีกครั้ง หรือติดต่ออาจารย์ผู้สอน`, 'error');
    } finally {
      setIsUploading(prev => ({ ...prev, [assignmentId]: false }));
      if (e.target) e.target.value = ''; // Reset input to allow re-selection
    }
  };

  const handleStudentLinkSubmit = async (assignmentId: string, student: Student) => {
    let url = (studentLinkInput[assignmentId] || '').trim();
    if (!url) {
      showAlert('ข้อมูลไม่ครบถ้วน', 'กรุณากรอกลิงก์ส่งงานของคุณ', 'warning');
      return;
    }

    if (!/^https?:\/\//i.test(url)) {
      url = 'https://' + url;
    }

    setIsUploading(prev => ({ ...prev, [assignmentId]: true }));

    try {
      const subId = crypto.randomUUID();
      const newSubmission: Submission = {
        id: subId,
        assignmentId,
        studentId: student.studentId,
        fileUrl: url,
        fileName: 'ส่งงานด้วยลิงก์',
        status: 'pending',
        score: 0,
        submittedAt: new Date().toISOString()
      };

      await setDoc(doc(db, 'submissions', subId), newSubmission);
      showAlert('ส่งงานสำเร็จ!', '✅ ส่งงานเรียบร้อยแล้ว!\nลิงก์งานของคุณได้รับการบันทึกเรียบร้อย', 'success');
      
      // Clear input
      setStudentLinkInput(prev => ({ ...prev, [assignmentId]: '' }));
    } catch (err: any) {
      console.error('Link submit error:', err);
      showAlert('เกิดข้อผิดพลาด', `❌ เกิดข้อผิดพลาด: ${err.message || 'ไม่สามารถส่งลิงก์ได้'}`, 'error');
    } finally {
      setIsUploading(prev => ({ ...prev, [assignmentId]: false }));
    }
  };

  const updateSubmissionScore = async (submissionId: string, score: number) => {
    // 1. Update the submission status/score in Firestore
    await updateDoc(doc(db, 'submissions', submissionId), { score, status: 'graded' });

    // 2. Fetch the submission from Firestore directly to prevent state staleness issues
    const submissionSnap = await getDoc(doc(db, 'submissions', submissionId));
    if (!submissionSnap.exists()) {
      console.warn(`Submission ${submissionId} not found in Firestore`);
      return;
    }
    const submission = submissionSnap.data() as Submission;

    // 3. Find/Fetch the assignment to know where to map the score
    let assignment = appData.assignments.find(a => a.id === submission.assignmentId);
    if (!assignment) {
      const assignmentSnap = await getDoc(doc(db, 'assignments', submission.assignmentId));
      if (assignmentSnap.exists()) {
        assignment = assignmentSnap.data() as Assignment;
      }
    }
    if (!assignment) {
      console.warn(`Assignment does not exist for: ${submission.assignmentId}`);
      return;
    }

    const targetAssignment = assignment.targetAssignment || 1;
    const targetPart = assignment.targetPart || 1;

    // 4. Update the student's manual field matching studentId AND courseKey (using fallback helper)
    // Find matching student from local appData.courses cache to get their document ID (extremely fast & no reads!)
    const cleanSubStudentId = (submission.studentId || '').trim().toLowerCase();
    let matchedStudent: Student | null = null;

    // Try finding student matching studentId and courseKey
    for (const key in (appData.courses || {})) {
      if (studentCourseMatch(assignment.courseKey, key)) {
        const found = (appData.courses[key] || []).find(
          s => (s.studentId || '').trim().toLowerCase() === cleanSubStudentId
        );
        if (found) {
          matchedStudent = found;
          break;
        }
      }
    }

    // Fallback: search anywhere in our courses cache
    if (!matchedStudent) {
      for (const key in (appData.courses || {})) {
        const found = (appData.courses[key] || []).find(
          s => (s.studentId || '').trim().toLowerCase() === cleanSubStudentId
        );
        if (found) {
          matchedStudent = found;
          break;
        }
      }
    }

    if (matchedStudent) {
      const studentRef = doc(db, 'students', matchedStudent.id);
      const assignmentKey = `assignment${targetAssignment}` as keyof Student;
      const currentAssignment = (matchedStudent[assignmentKey] || { part1: 0, part2: 0, part3: 0 }) as SubScores;
      const partKey = `part${targetPart}`;
      
      const updatedAssignment = {
        ...currentAssignment,
        [partKey]: score
      };

      await updateDoc(studentRef, {
        [assignmentKey]: updatedAssignment
      });

      console.log(`Successfully mapped score ${score} to student ${submission.studentId} field ${assignmentKey}.${partKey}`);
    } else {
      // Final fallback: do a highly targeted query (only 1 read) rather than getDocs of entire table
      const q = query(collection(db, 'students'), where('studentId', '==', submission.studentId));
      const snap = await getDocs(q);
      if (!snap.empty) {
        const studentDoc = snap.docs[0];
        const studentData = studentDoc.data() as Student;
        const assignmentKey = `assignment${targetAssignment}` as keyof Student;
        const currentAssignment = (studentData[assignmentKey] || { part1: 0, part2: 0, part3: 0 }) as SubScores;
        const partKey = `part${targetPart}`;
        
        const updatedAssignment = {
          ...currentAssignment,
          [partKey]: score
        };

        await updateDoc(studentDoc.ref, {
          [assignmentKey]: updatedAssignment
        });
        console.log(`Successfully mapped score ${score} (via targeted query fallback) to student ${submission.studentId}`);
      } else {
        console.warn(`Could not find student matching studentId: "${submission.studentId}"`);
      }
    }
  };

  const removeSubject = async (id: string) => {
    if ((appData.subjects || []).length <= 1) return;
    askConfirmation({
      title: 'ลบวิชา',
      message: 'ยืนยันการลบวิชา? ข้อมูลนักเรียนและงานทั้งหมดในวิชานี้จะยังคงอยู่ในฐานข้อมูลแต่อาจเข้าถึงยากขึ้น',
      type: 'warning',
      onConfirm: async () => {
        await deleteDoc(doc(db, 'subjects', id));
        if (selectedSubjectId === id) {
          setSelectedSubjectId(appData.subjects.find(s => s.id !== id)?.id || '');
        }
      }
    });
  };

  const removeClass = async (id: string) => {
    if ((appData.classRooms || []).length <= 1) return;
    askConfirmation({
      title: 'ลบห้องเรียน',
      message: 'ยืนยันการลบห้องเรียน?',
      type: 'warning',
      onConfirm: async () => {
        await deleteDoc(doc(db, 'classRooms', id));
        if (selectedClassId === id) {
          setSelectedClassId(appData.classRooms.find(c => c.id !== id)?.id || '');
        }
      }
    });
  };

  const handleSaveAttendance = async () => {
    const isTeacher = user?.email === 'watcharaphon_pa@t-tech.ac.th';
    if (!isTeacher) {
      showAlert('เข้าถึงไม่ได้', '❌ เฉพาะอาจารย์ที่ได้รับอนุญาตเท่านั้นที่สามารถบันทึกข้อมูลได้', 'error');
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
      showAlert('สำเร็จ!', '✅ บันทึกการเช็คชื่อเรียบร้อยแล้ว', 'success');
    } catch (err: any) {
      console.error('Attendance save error:', err);
      showAlert('เกิดข้อผิดพลาด', `❌ เกิดข้อผิดพลาดในการบันทึก: ${err.message || 'กรุณาตรวจสอบสิทธิ์การเข้าถึง'}`, 'error');
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
    const cleanId = searchId.trim().toLowerCase();
    // Search across all courses
    let found: Student | null = null;
    for (const key in (appData.courses || {})) {
      // Validate that course is active in subjects & classrooms database
      const match = matchCourseKey(key, appData.subjects, appData.classRooms);
      if (!match) continue; // Skip deleted/inactive courses

      const student = (appData.courses || {})[key].find(
        s => (s.studentId || '').trim().toLowerCase() === cleanId ||
             (s.name || '').trim().toLowerCase().includes(cleanId) ||
             (s.no || '').trim().toLowerCase() === cleanId
      );
      if (student) {
        found = student;
        break;
      }
    }
    setFoundStudent(found);
  };

  return (
    <div className="min-h-screen bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-indigo-50/70 via-slate-50 to-slate-100/90 text-slate-900 font-sans p-4 md:p-8 relative overflow-hidden selection:bg-indigo-500 selection:text-white">
      {/* Decorative premium background blobs */}
      <div className="absolute top-0 left-1/4 w-96 h-96 bg-indigo-200/40 rounded-full blur-[100px] pointer-events-none -translate-y-1/2" />
      <div className="absolute top-1/3 right-1/4 w-96 h-96 bg-emerald-100/30 rounded-full blur-[100px] pointer-events-none" />
      <div className="absolute bottom-10 left-10 w-[500px] h-[500px] bg-purple-100/20 rounded-full blur-[120px] pointer-events-none" />

      <div className="max-w-7xl mx-auto space-y-6 relative z-10">
        
        {/* Header */}
        <header className="relative z-50 backdrop-blur-md bg-white/60 border border-white/40 shadow-xl shadow-slate-100/50 rounded-[2.5rem] p-6 md:p-8 flex flex-col md:flex-row md:items-center justify-between gap-6 transition-all duration-300">
          <div className="space-y-1">
            <div className="flex items-center gap-4">
              <div className="p-3 bg-gradient-to-tr from-indigo-500 to-indigo-650 text-white rounded-2xl shadow-lg shadow-indigo-200">
                <GraduationCap className="w-8 h-8" />
              </div>
              <div className="text-left">
                <h1 className="text-3xl font-black tracking-tight bg-gradient-to-r from-slate-800 via-indigo-950 to-slate-900 bg-clip-text text-transparent flex items-center gap-2 leading-none">
                  Student Tracker <span className="text-[10px] bg-indigo-100 text-indigo-700 px-2.5 py-1 rounded-lg font-black uppercase tracking-wider shadow-inner">Pro</span>
                </h1>
                <p className="text-slate-400 font-bold text-xs mt-1">ระบบบันทึกและคำนวณคะแนนนักเรียนอัตโนมัติแบบเรียลไทม์</p>
              </div>
            </div>
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

                              {/* Google Sheets Studio Customizer */}
                              <button 
                                onClick={() => {
                                  setIsSheetsStudioOpen(true);
                                  setIsActionsMenuOpen(false);
                                }}
                                className="w-full flex items-center gap-3 px-5 py-3 hover:bg-emerald-50 text-emerald-700 text-sm transition-colors text-left group"
                              >
                                <FileSpreadsheet className="w-4 h-4 text-emerald-600 group-hover:scale-110 transition-transform" />
                                <span className="font-extrabold">ปรับแต่ง & ส่งออก Sheets / Excel</span>
                              </button>

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

                              {/* Teacher Notes Access */}
                              <button 
                                onClick={() => {
                                  setIsNotesModalOpen(true);
                                  setIsActionsMenuOpen(false);
                                }}
                                className="w-full flex items-center gap-3 px-5 py-3 hover:bg-indigo-50 text-slate-600 hover:text-indigo-600 text-sm transition-colors text-left group"
                              >
                                <StickyNote className="w-4 h-4 text-slate-400 group-hover:text-indigo-500" />
                                <span className="font-bold">โน๊ตส่วนตัวของคุณครู</span>
                              </button>

                              <button 
                                onClick={() => {
                                  if (!isExporting) exportToPDF();
                                  setIsActionsMenuOpen(false);
                                }}
                                disabled={isExporting}
                                className="w-full flex items-center gap-3 px-5 py-3 hover:bg-indigo-50 text-indigo-600 text-sm transition-colors text-left disabled:opacity-50"
                              >
                                {isExporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileType className="w-4 h-4" />}
                                <span className="font-bold">{isExporting ? 'กำลังสร้างไฟล์...' : 'ส่งออกเป็นไฟล์ PDF'}</span>
                              </button>

                              {students.length > 0 && (
                                <button 
                                  onClick={() => {
                                    setIsActionsMenuOpen(false);
                                    removeAllStudents();
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
          <div className="space-y-6 relative z-10">
            <motion.div 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="flex flex-col xl:flex-row xl:items-center justify-between gap-6"
            >
              {/* Tab Navigation with Collapsible / Responsive Design */}
              {isTabsCollapsed ? (
                <div className="flex items-center gap-2 max-w-full">
                  <div className="flex items-center backdrop-blur-md bg-white/60 p-1.5 rounded-2xl border border-white/50 shadow-md shadow-indigo-50/50">
                    {(() => {
                      const tabs = [
                        { id: 'dashboard', label: 'หน้าแรก', icon: LayoutDashboard },
                        { id: 'grades', label: 'ตารางคะแนน', icon: Calculator },
                        { id: 'assignments', label: 'จัดการงาน', icon: FileText },
                        { id: 'submissions', label: 'ตรวจงาน', icon: Monitor },
                        { id: 'materials', label: 'สื่อการสอน', icon: Link },
                        { id: 'attendance', label: 'เช็คชื่อ', icon: CheckCircle2 },
                        ...(user ? [{ id: 'admin', label: 'ระบบหลังบ้าน', icon: Settings }] : [])
                      ];
                      const activeTabObj = tabs.find(t => t.id === teacherTab) || tabs[0];
                      const Icon = activeTabObj.icon;
                      const pendingSubmissions = activeTabObj.id === 'submissions' 
                        ? (appData.submissions || []).filter(s => s.status === 'pending').length 
                        : 0;

                      return (
                        <div className="flex items-center gap-2 px-4 py-2 bg-indigo-50 text-indigo-700 rounded-xl font-black text-sm">
                          <Icon className="w-4 h-4 text-indigo-600" />
                          <span>{activeTabObj.label}</span>
                          {pendingSubmissions > 0 && (
                            <span className="flex h-4.5 w-4.5 items-center justify-center rounded-full text-[10px] font-bold bg-rose-500 text-white shadow-sm px-1 min-w-[18px]">
                              {pendingSubmissions}
                            </span>
                          )}
                        </div>
                      );
                    })()}

                    <span className="w-px h-5 bg-slate-200 mx-2" />

                    <button
                      onClick={() => setIsTabsCollapsed(false)}
                      className="flex items-center gap-1.5 px-3.5 py-2 hover:bg-slate-50 text-slate-500 hover:text-indigo-650 rounded-xl font-bold text-xs transition-all cursor-pointer border border-transparent hover:border-slate-100"
                    >
                      <Menu className="w-3.5 h-3.5 text-indigo-500 animate-pulse" />
                      <span>แสดงเมนูทั้งหมด</span>
                      <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex items-center backdrop-blur-md bg-white/45 p-1.5 rounded-2xl border border-white/50 shadow-md shadow-slate-150/30 overflow-x-auto no-scrollbar max-w-full relative pr-12">
                  <div className="flex items-center gap-1">
                    {[
                      { id: 'dashboard', label: 'หน้าแรก', icon: LayoutDashboard },
                      { id: 'grades', label: 'ตารางคะแนน', icon: Calculator },
                      { id: 'assignments', label: 'จัดการงาน', icon: FileText },
                      { id: 'submissions', label: 'ตรวจงาน', icon: Monitor },
                      { id: 'materials', label: 'สื่อการสอน', icon: Link },
                      { id: 'attendance', label: 'เช็คชื่อ', icon: CheckCircle2 },
                      ...(user ? [{ id: 'admin', label: 'ระบบหลังบ้าน', icon: Settings }] : [])
                    ].map((tab) => {
                      const Icon = tab.icon;
                      const isActive = teacherTab === tab.id;
                      const pendingSubmissions = tab.id === 'submissions' 
                        ? (appData.submissions || []).filter(s => s.status === 'pending').length 
                        : 0;

                      const handleClick = () => {
                        setTeacherTab(tab.id as any);
                      };

                      return (
                        <button
                          key={tab.id}
                          onClick={handleClick}
                          className={`relative flex items-center gap-1.5 px-4 py-2.5 rounded-xl font-bold transition-all text-xs md:text-sm whitespace-nowrap min-w-fit cursor-pointer ${
                            isActive ? 'text-indigo-650' : 'text-slate-500 hover:text-slate-800 hover:bg-white/20'
                          }`}
                        >
                          {isActive && (
                            <motion.div
                              layoutId="activeTab"
                              className="absolute inset-0 bg-white shadow-md border border-white/60 rounded-xl"
                              transition={{ type: "spring", bounce: 0.2, duration: 0.6 }}
                            />
                          )}
                          
                          <span className="relative z-10 flex items-center gap-1.5">
                            <Icon className={`w-3.5 h-3.5 ${isActive ? 'text-indigo-600' : 'text-slate-400'}`} />
                            {tab.label}
                            {pendingSubmissions > 0 && (
                              <span className={`flex h-4.5 w-4.5 items-center justify-center rounded-full text-[10px] font-bold ${
                                isActive ? 'bg-indigo-600 text-white' : 'bg-rose-500 text-white'
                              } shadow-sm px-1 min-w-[18px]`}>
                                {pendingSubmissions}
                              </span>
                            )}
                          </span>
                        </button>
                      );
                    })}
                  </div>

                  {/* Collapse Toggle Button */}
                  <div className="absolute right-1.5 top-1/2 -translate-y-1/2 bg-white/80 backdrop-blur-md p-1 rounded-lg shadow-sm border border-slate-200/50 hover:bg-white hover:shadow transition-all">
                    <button
                      onClick={() => setIsTabsCollapsed(true)}
                      className="flex items-center justify-center p-1 text-slate-400 hover:text-indigo-600 transition-all cursor-pointer"
                      title="ย่อเมนูทั้งหมด"
                    >
                      <ChevronDown className="w-4 h-4 rotate-180 text-indigo-500" />
                    </button>
                  </div>
                </div>
              )}

            </motion.div>

            {teacherTab !== 'dashboard' && (
              <motion.div 
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                className="backdrop-blur-md bg-white/50 border border-white/60 rounded-2xl px-6 py-4.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-slate-700 shadow-md shadow-slate-100/30"
              >
                <div className="flex items-center gap-3">
                  <div className="p-2.5 bg-gradient-to-tr from-indigo-500 to-indigo-600 text-white rounded-xl shadow-md shadow-indigo-100">
                    <GraduationCap className="w-4 h-4" />
                  </div>
                  <div className="text-left">
                    <span className="text-[9px] font-black uppercase tracking-wider text-indigo-500 block leading-none mb-1">กำลังจัดการรายวิชา</span>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-extrabold text-slate-800 text-base">
                        {appData.subjects.find(s => s.id === selectedSubjectId)?.name || 'ยังเลือกวิชาไม่ได้'}
                      </span>
                      <span className="text-slate-300">|</span>
                      <span className="text-indigo-600 text-sm font-black bg-indigo-50/60 px-2.5 py-0.5 rounded-lg border border-indigo-100/30">
                        ห้อง {appData.classRooms.find(c => c.id === selectedClassId)?.name || 'ยังเลือกห้องไม่ได้'}
                      </span>
                    </div>
                  </div>
                </div>
                <button 
                  onClick={() => setTeacherTab('dashboard')}
                  className="flex items-center gap-1.5 text-xs font-black text-indigo-600 hover:text-indigo-800 bg-white hover:bg-slate-50 border border-slate-200/80 px-4 py-2.5 rounded-xl shadow-sm hover:shadow transition-all active:scale-95 cursor-pointer self-start sm:self-auto"
                >
                  <LayoutDashboard className="w-3.5 h-3.5" />
                  เปลี่ยนรายวิชา / ห้องเรียน
                </button>
              </motion.div>
            )}

            {teacherTab === 'dashboard' && (
              <motion.div 
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="space-y-12"
              >
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-100 pb-5">
                  <div className="space-y-1 text-left">
                    <h2 className="text-3xl font-black text-slate-800">รายวิชาทั้งหมด</h2>
                    <p className="text-slate-400 text-sm font-medium">เลือกวิชาและชั้นเรียนด้านล่าง เพื่อเข้าจัดการบันทึกคะแนน สื่อการสอน เช็คชื่อ หรือการบ้าน</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-3">
                    <button 
                      onClick={() => { 
                        setManageType('subject'); 
                        setManageCenterTab('subject');
                        setIsManageModalOpen(true); 
                      }}
                      className="flex items-center gap-2 bg-indigo-600 text-white px-5 py-3 rounded-2xl font-bold hover:bg-indigo-700 shadow-md shadow-indigo-100 transition-all active:scale-95 text-sm cursor-pointer"
                    >
                      <Settings className="w-4 h-4 text-white animate-spin-hover" />
                      ศูนย์ตั้งค่าวิชา & ห้องเรียนทั้งหมด
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
                  {(() => {
                    const activeCourses = appData.subjects.flatMap(subject => {
                      const hasIdsField = Array.isArray(subject.classroomIds);
                      const subjectClassrooms = hasIdsField
                        ? appData.classRooms.filter(c => subject.classroomIds!.includes(c.id))
                        : appData.classRooms;
                      return subjectClassrooms.map(classroom => ({ subject, classroom }));
                    });

                    if (activeCourses.length === 0) {
                      return (
                        <div className="col-span-full py-20 text-center space-y-6">
                           <div className="w-24 h-24 bg-slate-100 rounded-[2.5rem] flex items-center justify-center mx-auto text-slate-300">
                             <LayoutDashboard className="w-12 h-12" />
                           </div>
                           <div className="space-y-2">
                             <h3 className="text-2xl font-black text-slate-800">ยังไม่มีวิชาเรียนที่ผูกกับห้องทำงาน</h3>
                             <p className="text-slate-400 font-medium">กรุณาตั้งค่าเพื่อผูกวิชาเรียนของคุณเข้ากับห้องเรียน / แผนกที่เปิดสอน</p>
                           </div>
                           <button 
                             onClick={() => { 
                               setManageType('subject'); 
                               setManageCenterTab('subject');
                               setIsManageModalOpen(true); 
                             }}
                             className="bg-indigo-600 text-white px-8 py-4 rounded-[2rem] font-black shadow-xl shadow-indigo-100 hover:bg-indigo-700 transition-all active:scale-95 cursor-pointer text-sm"
                           >
                             ตั้งค่าการผูกวิชาและห้องเรียนตอนนี้
                           </button>
                        </div>
                      );
                    }

                    return activeCourses.map(({ subject, classroom }) => {
                      const courseKey = `${subject.id}-${classroom.id}`;
                      const studentCount = appData.courses[courseKey]?.length || 0;
                      
                      return (
                        <motion.div 
                          key={courseKey}
                          whileHover={{ y: -8, scale: 1.02 }}
                          className="bg-white rounded-[2.5rem] border border-slate-200 shadow-xl shadow-slate-100/50 overflow-hidden group cursor-pointer"
                          onClick={() => {
                            setSelectedSubjectId(subject.id);
                            setSelectedClassId(classroom.id);
                            setTeacherTab('grades');
                          }}
                        >
                          <div className="p-8 space-y-6 relative">
                            <div className="absolute top-0 right-0 -tr-12 -mt-12 w-48 h-48 bg-indigo-50/50 rounded-full blur-3xl opacity-0 group-hover:opacity-100 transition-opacity" />
                            
                            <div className="flex items-start justify-between relative">
                              <div className="p-4 bg-indigo-50 text-indigo-600 rounded-3xl shadow-sm group-hover:bg-indigo-600 group-hover:text-white transition-all duration-500">
                                <BookOpen className="w-8 h-8" />
                              </div>
                              <button 
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setManageType('subject');
                                  setManageCenterTab('subject');
                                  setIsManageModalOpen(true);
                                }}
                                className="p-3 hover:bg-slate-100 rounded-2xl transition-colors text-slate-300"
                              >
                                <Settings className="w-5 h-5" />
                              </button>
                            </div>

                            <div className="space-y-2">
                              <p className="text-[10px] font-black text-indigo-500 uppercase tracking-[0.3em]">Course Code: {subject.id}</p>
                              <h3 className="text-2xl font-black text-slate-800 leading-tight text-left">
                                {subject.name}
                              </h3>
                              <p className="text-slate-400 font-bold flex items-center gap-2">
                                <Users className="w-4 h-4" />
                                {classroom.name}
                              </p>
                            </div>

                            <div className="grid grid-cols-2 gap-4 pt-4 border-t border-slate-100 flex-row">
                              <div className="space-y-1 text-left">
                                <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">นักเรียน</p>
                                <p className="text-xl font-black text-slate-800">{studentCount} คน</p>
                              </div>
                              <div className="space-y-1 text-left">
                                <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">สรุปผล</p>
                                <p className="text-xl font-black text-slate-800">คลิกดู</p>
                              </div>
                            </div>
                          </div>
                          
                          <div className="px-8 py-5 bg-slate-50 border-t border-slate-100 flex items-center justify-between group-hover:bg-indigo-50 transition-colors">
                            <span className="text-sm font-bold text-slate-500 group-hover:text-indigo-650">เข้าสู่ระบบจัดการคะแนน</span>
                            <div className="p-2 bg-white rounded-xl shadow-sm text-slate-300 group-hover:text-indigo-600 transition-all duration-300">
                              <ChevronRight className="w-4 h-4 text-slate-400 group-hover:text-indigo-600" />
                            </div>
                          </div>
                        </motion.div>
                      );
                    });
                  })()}
                </div>
              </motion.div>
            )}

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
                      showAlert('คัดลอกลิงก์สำเร็จ', 'คัดลอกลิงก์สำหรับส่งให้นักเรียนเรียบร้อยแล้ว!', 'success');
                    }}
                    className="flex items-center gap-2 bg-emerald-50 hover:bg-emerald-100 text-emerald-600 border border-emerald-200 px-6 py-3 rounded-2xl font-bold transition-all active:scale-95"
                  >
                    <Link className="w-5 h-5" />
                    แชร์ลิงก์ให้เด็ก
                  </button>
                </div>

                <div className="flex items-center gap-3">
                  <button 
                    onClick={() => setIsSheetsStudioOpen(true)}
                    className="flex items-center gap-2 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white px-5 py-3 rounded-2xl font-extrabold text-sm transition-all shadow-lg shadow-emerald-100 active:scale-95 cursor-pointer"
                  >
                    <FileSpreadsheet className="w-5 h-5 text-emerald-100" />
                    Google Sheets Studio (ปรับแต่งไฟล์/โลโก้)
                  </button>

                  {isGoogleAuth && (
                    <button 
                      onClick={() => handleSyncToSheets()}
                      disabled={isSyncing}
                      className="flex items-center gap-2 bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 px-5 py-3 rounded-2xl font-bold text-sm transition-all active:scale-95 disabled:opacity-50 cursor-pointer"
                    >
                      {isSyncing ? <Loader2 className="w-5 h-5 animate-spin" /> : <CloudCheck className="w-5 h-5 text-emerald-600" />}
                      ซิงค์Sheets
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
                <div className="grid grid-cols-1 sm:grid-cols-4 gap-6">
                  <motion.div 
                    whileHover={{ y: -4, scale: 1.01 }}
                    className="backdrop-blur-md bg-white/70 border border-white/60 p-6 rounded-[2rem] shadow-md shadow-slate-100/40 flex items-center gap-4 transition-all duration-300"
                  >
                    <div className="p-3.5 bg-indigo-50/70 text-indigo-600 rounded-2xl border border-indigo-100/20 shadow-inner">
                      <Users className="w-6 h-6" />
                    </div>
                    <div className="text-left">
                      <p className="text-[10px] font-black uppercase tracking-wider text-slate-400">นักเรียนทั้งหมด</p>
                      <p className="text-3xl font-black text-slate-800 font-mono mt-0.5">{students.length} <span className="text-xs font-bold text-slate-400 font-sans">คน</span></p>
                    </div>
                  </motion.div>
                  <motion.div 
                    whileHover={{ y: -4, scale: 1.01 }}
                    className="backdrop-blur-md bg-white/70 border border-white/60 p-6 rounded-[2rem] shadow-md shadow-slate-100/40 flex items-center gap-4 transition-all duration-300"
                  >
                    <div className="p-3.5 bg-rose-50/70 text-rose-600 rounded-2xl border border-rose-100/20 shadow-inner">
                      <UserX className="w-6 h-6" />
                    </div>
                    <div className="text-left">
                      <p className="text-[10px] font-black uppercase tracking-wider text-slate-400">จำหน่ายออก / พ้นสภาพ</p>
                      <p className="text-3xl font-black text-slate-800 font-mono mt-0.5">{students.filter(s => s.isDroppedOut).length} <span className="text-xs font-bold text-slate-400 font-sans">คน</span></p>
                    </div>
                  </motion.div>
                  <motion.div 
                    whileHover={{ y: -4, scale: 1.01 }}
                    className="backdrop-blur-md bg-white/70 border border-white/60 p-6 rounded-[2rem] shadow-md shadow-slate-100/40 flex items-center gap-4 transition-all duration-300"
                  >
                    <div className="p-3.5 bg-emerald-50/70 text-emerald-600 rounded-2xl border border-emerald-100/20 shadow-inner">
                      <Calculator className="w-6 h-6" />
                    </div>
                    <div className="text-left">
                      <p className="text-[10px] font-black uppercase tracking-wider text-slate-400">คะแนนเฉลี่ย</p>
                      <p className="text-3xl font-black text-slate-800 font-mono mt-0.5">{stats.avg} <span className="text-xs font-bold text-slate-400 font-sans">/ 100</span></p>
                    </div>
                  </motion.div>
                  <motion.div 
                    whileHover={{ y: -4, scale: 1.01 }}
                    className="backdrop-blur-md bg-white/70 border border-white/60 p-6 rounded-[2rem] shadow-md shadow-slate-100/40 flex items-center gap-4 transition-all duration-300"
                  >
                    <div className="p-3.5 bg-amber-50/70 text-amber-600 rounded-2xl border border-amber-100/20 shadow-inner">
                      <Info className="w-6 h-6" />
                    </div>
                    <div className="text-left">
                      <p className="text-[10px] font-black uppercase tracking-wider text-slate-400">อัตราการผ่าน</p>
                      <p className="text-3xl font-black text-slate-800 font-mono mt-0.5">{stats.passRate}%</p>
                    </div>
                  </motion.div>
                </div>

                {/* Filter and Title Row */}
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mt-8 pb-1">
                  <div>
                    <h3 className="text-lg font-bold text-slate-800">รายชื่อบันทึกคะแนนในชั้นเรียน</h3>
                    <p className="text-xs text-slate-400 mt-0.5">รวมเกรดและคะแนนกิจกรรม ทั้งหมดในภาคเรียน</p>
                  </div>
                  <div className="flex items-center gap-1.5 bg-slate-100 p-1.5 rounded-2xl border border-slate-200/60 max-w-full overflow-x-auto self-start sm:self-auto">
                    <button
                      onClick={() => setStudentFilter('all')}
                      className={`px-4 py-2 rounded-xl text-xs font-black transition-all duration-205 ${
                        studentFilter === 'all'
                          ? 'bg-white text-slate-800 shadow-sm ring-1 ring-slate-100/50 scale-102 font-extrabold'
                          : 'text-slate-500 hover:text-slate-700 hover:bg-white/40'
                      }`}
                    >
                      นักเรียนทั้งหมด ({students.length})
                    </button>
                    <button
                      onClick={() => setStudentFilter('normal')}
                      className={`px-4 py-2 rounded-xl text-xs font-black transition-all duration-205 ${
                        studentFilter === 'normal'
                          ? 'bg-white text-slate-800 shadow-sm ring-1 ring-slate-100/50 scale-102 font-extrabold'
                          : 'text-slate-500 hover:text-slate-700 hover:bg-white/40'
                      }`}
                    >
                      ปกติ ({students.filter(s => !s.isDroppedOut).length})
                    </button>
                    <button
                      onClick={() => setStudentFilter('dropped')}
                      className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-black transition-all duration-205 ${
                        studentFilter === 'dropped'
                          ? 'bg-rose-600 text-white shadow-md shadow-rose-100 scale-102 font-extrabold'
                          : 'text-rose-600 hover:text-rose-700 hover:bg-rose-50/50'
                      }`}
                    >
                      <UserX className="w-3.5 h-3.5" />
                      จำหน่ายออก ({students.filter(s => s.isDroppedOut).length})
                    </button>
                  </div>
                </div>

                {/* Main Table */}
                <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden mt-4">
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
                          {filteredStudents.map((student, sIdx) => {
                            const total = calculateTotal(student);
                            const grade = getGrade(total);
                            const isExp = isExpanded[student.id];
                            const isDropped = Boolean(student.isDroppedOut);

                            const handleDisabledAlert = () => {
                              showAlert(
                                'นักเรียนจำหน่ายออก/พ้นสภาพ',
                                `นักเรียน ${student.name} (รหัส ${student.studentId || '-'}) มีสถานะ "จำหน่ายออก/พ้นสภาพ" ไม่สามารถบันทึกหรือแก้ไขคะแนนได้`,
                                'warning'
                              );
                            };

                            return (
                              <React.Fragment key={student.id}>
                                <motion.tr 
                                  initial={{ opacity: 0 }}
                                  animate={{ opacity: 1 }}
                                  exit={{ opacity: 0 }}
                                  className={`transition-colors group ${
                                    isDropped 
                                      ? 'bg-rose-50/70 hover:bg-rose-100/50 border-l-4 border-l-rose-500' 
                                      : 'hover:bg-slate-50/30'
                                  }`}
                                >
                                  <td className="p-2">
                                    <EditableCell 
                                      initialValue={student.no}
                                      data-row={sIdx}
                                      data-col={0}
                                      disabled={isDropped}
                                      onDisabledClick={handleDisabledAlert}
                                      onCommit={(val) => updateStudent(student.id, 'no', val)}
                                      className="w-12 mx-auto bg-transparent border border-transparent hover:border-slate-200 focus:bg-slate-50 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-150 rounded-lg py-1 text-center outline-none transition-all duration-200 text-slate-600 font-bold"
                                    />
                                  </td>
                                  <td className="p-2">
                                    <EditableCell 
                                      initialValue={student.studentId}
                                      data-row={sIdx}
                                      data-col={1}
                                      disabled={isDropped}
                                      onDisabledClick={handleDisabledAlert}
                                      onCommit={(val) => updateStudent(student.id, 'studentId', val)}
                                      placeholder="รหัส..."
                                      className="w-full bg-transparent border border-transparent hover:border-slate-200 focus:bg-slate-50 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-150 rounded-lg px-2 py-1 outline-none transition-all duration-200 text-slate-600 font-mono font-medium text-sm"
                                    />
                                  </td>
                                  <td className="p-2">
                                    <div className="flex items-center gap-2 group/name-container">
                                      <EditableCell 
                                        initialValue={student.name}
                                        data-row={sIdx}
                                        data-col={2}
                                        disabled={isDropped}
                                        onDisabledClick={handleDisabledAlert}
                                        onCommit={(val) => updateStudent(student.id, 'name', val)}
                                        placeholder="ชื่อ-นามสกุล..."
                                        className={`w-full bg-transparent border border-transparent hover:border-slate-200 focus:bg-indigo-50/40 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-150 rounded-lg px-3 py-1.5 outline-none transition-all duration-200 font-bold ${
                                          isDropped ? 'text-rose-700 line-through' : 'text-slate-800'
                                        }`}
                                      />
                                      <button
                                        onClick={() => updateStudent(student.id, 'isDroppedOut', !student.isDroppedOut)}
                                        className={`shrink-0 flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-extrabold transition-all border ${
                                          isDropped
                                            ? 'bg-rose-600 text-white border-rose-600 shadow-sm'
                                            : 'bg-slate-50 hover:bg-rose-50 text-slate-400 hover:text-rose-600 border-slate-200 hover:border-rose-200 opacity-0 group-hover/name-container:opacity-100 focus:opacity-100'
                                        }`}
                                        title={isDropped ? "คลิกเพื่อยกเลิกสถานะจำหน่ายออก" : "คลิกเพื่อทำเครื่องหมายเป็นนักเรียนจำหน่ายออก (พ้นสภาพ)"}
                                      >
                                        <UserX className="w-3 h-3" />
                                        <span>{isDropped ? 'จำหน่ายออก' : 'ปกติ'}</span>
                                      </button>
                                    </div>
                                  </td>
                                  <td className="p-2 text-center">
                                    <EditableNumberCell 
                                      initialValue={student.behavior}
                                      data-row={sIdx}
                                      data-col={3}
                                      disabled={isDropped}
                                      onDisabledClick={handleDisabledAlert}
                                      onCommit={(val) => updateStudent(student.id, 'behavior', val)}
                                      max={10}
                                      className="w-14 bg-slate-50 border border-slate-200 hover:border-slate-350 focus:bg-white focus:ring-4 focus:ring-indigo-100 focus:border-indigo-500 rounded-lg py-1 text-center font-bold text-slate-700 outline-none transition-all duration-150"
                                    />
                                  </td>
                                  <td className="p-2 text-center">
                                    <EditableNumberCell 
                                      initialValue={student.attendance}
                                      data-row={sIdx}
                                      data-col={4}
                                      disabled={isDropped}
                                      onDisabledClick={handleDisabledAlert}
                                      onCommit={(val) => updateStudent(student.id, 'attendance', val)}
                                      max={10}
                                      className="w-14 bg-slate-50 border border-slate-200 hover:border-slate-350 focus:bg-white focus:ring-4 focus:ring-indigo-100 focus:border-indigo-500 rounded-lg py-1 text-center font-bold text-slate-700 outline-none transition-all duration-150"
                                    />
                                  </td>
                                  <td className="p-2 text-center">
                                    <button 
                                      onClick={() => {
                                        if (isDropped) {
                                          handleDisabledAlert();
                                        } else {
                                          toggleExpand(student.id);
                                        }
                                      }}
                                      className={`flex items-center justify-center gap-1.5 mx-auto border px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all active:scale-95 ${
                                        isDropped
                                          ? 'bg-rose-100/50 text-rose-600 border-rose-200 cursor-not-allowed'
                                          : 'bg-indigo-50/70 hover:bg-indigo-100 text-indigo-700 border-indigo-100'
                                      }`}
                                    >
                                      <span className="font-mono">{isDropped ? '-' : (() => {
                                        return (student.assignment1?.part1 || 0) + (student.assignment1?.part2 || 0) + (student.assignment1?.part3 || 0) +
                                               (student.assignment2?.part1 || 0) + (student.assignment2?.part2 || 0) + (student.assignment2?.part3 || 0) +
                                               (student.assignment3?.part1 || 0) + (student.assignment3?.part2 || 0) + (student.assignment3?.part3 || 0);
                                      })()}</span>
                                      {!isDropped && (isExp ? <ChevronDown className="w-3.5 h-3.5 text-indigo-500" /> : <ChevronRight className="w-3.5 h-3.5 text-indigo-500" />)}
                                    </button>
                                  </td>
                                  <td className="p-2 text-center">
                                    <EditableNumberCell 
                                      initialValue={student.midterm}
                                      data-row={sIdx}
                                      data-col={5}
                                      disabled={isDropped}
                                      onDisabledClick={handleDisabledAlert}
                                      onCommit={(val) => updateStudent(student.id, 'midterm', val)}
                                      max={15}
                                      className="w-14 bg-slate-50 border border-slate-200 hover:border-slate-350 focus:bg-white focus:ring-4 focus:ring-indigo-100 focus:border-indigo-500 rounded-lg py-1 text-center font-bold text-slate-700 outline-none transition-all duration-150"
                                    />
                                  </td>
                                  <td className="p-2 text-center">
                                    <EditableNumberCell 
                                      initialValue={student.final}
                                      data-row={sIdx}
                                      data-col={6}
                                      disabled={isDropped}
                                      onDisabledClick={handleDisabledAlert}
                                      onCommit={(val) => updateStudent(student.id, 'final', val)}
                                      max={20}
                                      className="w-14 bg-slate-50 border border-slate-200 hover:border-slate-350 focus:bg-white focus:ring-4 focus:ring-indigo-100 focus:border-indigo-500 rounded-lg py-1 text-center font-bold text-slate-700 outline-none transition-all duration-150"
                                    />
                                  </td>
                                  <td className="p-2 text-center font-black text-base font-mono">
                                    {isDropped ? (
                                      <span className="text-rose-600 text-xs font-bold font-sans">-</span>
                                    ) : (
                                      <span className="text-indigo-650">{total}</span>
                                    )}
                                  </td>
                                  <td className="p-2 text-center">
                                    {isDropped ? (
                                      <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-extrabold bg-rose-100 text-rose-700 border border-rose-300">
                                        จำหน่ายออก
                                      </span>
                                    ) : (
                                      <span className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-black shadow-xs ${
                                        Number(grade) >= 3 ? 'bg-emerald-50 text-emerald-700 border border-emerald-200/50' : 
                                        Number(grade) >= 1 ? 'bg-amber-50 text-amber-700 border border-amber-200/50' : 
                                        'bg-rose-50 text-rose-700 border border-rose-250'
                                      }`}>
                                        <span className={`w-1.5 h-1.5 rounded-full ${
                                          Number(grade) >= 3 ? 'bg-emerald-500' : 
                                          Number(grade) >= 1 ? 'bg-amber-550' : 
                                          'bg-rose-500'
                                        }`} />
                                        เกรด {grade}
                                      </span>
                                    )}
                                  </td>
                                  <td className="p-2 text-center">
                                    <button 
                                      onClick={() => removeStudent(student.id)}
                                      className="p-2 text-slate-300 hover:text-rose-600 hover:bg-rose-50 rounded-xl transition-all opacity-0 group-hover:opacity-100"
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
                                                      <EditableNumberCell 
                                                        initialValue={score[part as keyof SubScores] || 0}
                                                        onCommit={(val) => updateStudent(student.id, `${key}.${part}`, val)}
                                                        max={5}
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
                                              const submission = (appData.submissions || []).find(s => s.assignmentId === assignment.id && (s.studentId || '').trim().toLowerCase() === (student.studentId || '').trim().toLowerCase());
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
                        student = (appData.courses || {})[key].find(s => (s.studentId || '').trim().toLowerCase() === (sub.studentId || '').trim().toLowerCase());
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
                                {sub.fileName === 'ส่งงานด้วยลิงก์' ? 'เปิดดูงานจากลิงก์' : 'เปิดดูงานใน Drive'}
                              </a>
                              <span className="text-xs text-slate-400">ส่งเมื่อ: {new Date(sub.submittedAt).toLocaleString('th-TH')}</span>
                            </div>
                          </div>

                          <div className="flex items-center gap-3">
                            <div className="flex items-center gap-2">
                              <input 
                                type="number" 
                                placeholder="คะแนน"
                                min={0}
                                max={assignment?.maxScore || 10}
                                value={submissionScores[sub.id] || ''}
                                onChange={(e) => {
                                  setSubmissionScores(prev => ({
                                    ...prev,
                                    [sub.id]: e.target.value
                                  }));
                                }}
                                onFocus={(e) => e.target.select()}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter' && submissionScores[sub.id]) {
                                    updateSubmissionScore(sub.id, Number(submissionScores[sub.id]));
                                  }
                                  handleGridKeyDown(e as any);
                                }}
                                className="w-20 bg-white border border-slate-250 focus:border-indigo-500 rounded-xl px-3 py-2 text-center outline-none focus:ring-4 focus:ring-indigo-100 font-mono font-bold transition-all"
                              />
                              <span className="text-sm font-bold text-slate-400">/ {assignment?.maxScore}</span>
                            </div>
                            <button 
                              onClick={() => {
                                const typedVal = submissionScores[sub.id];
                                if (typedVal !== undefined && typedVal !== '') {
                                  updateSubmissionScore(sub.id, Number(typedVal));
                                } else {
                                  showAlert('กรอกคะแนนก่อน', 'กรุณาระบุคะแนนในช่องป้อนคะแนนเพื่อบันทึก', 'warning');
                                }
                              }}
                              className="bg-emerald-600 hover:bg-emerald-700 text-white px-5 py-2.5 rounded-xl font-bold transition-all active:scale-95 shadow-md shadow-emerald-100/50 cursor-pointer text-sm"
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
                        student = (appData.courses || {})[key].find(s => (s.studentId || '').trim().toLowerCase() === (sub.studentId || '').trim().toLowerCase());
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
                            <a 
                              href={sub.fileUrl} 
                              target="_blank" 
                              rel="noreferrer" 
                              className="text-slate-400 hover:text-indigo-600" 
                              title={sub.fileName === 'ส่งงานด้วยลิงก์' ? 'เปิดดูงานจากลิงก์' : 'เปิดดูงานใน Drive'}
                            >
                              <ExternalLink className="w-4 h-4" />
                            </a>
                            <button 
                              onClick={() => updateSubmissionScore(sub.id, 0)} // Reset to pending for re-grading
                              className="text-slate-400 hover:text-indigo-600"
                              title="ส่งกลับเพื่อตรวจใหม่"
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
            {teacherTab === 'materials' && (
              <div className="max-w-4xl mx-auto space-y-8">
                {/* Add Material card */}
                <motion.div 
                  initial={{ opacity: 0, y: 15 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="bg-white p-8 rounded-3xl border border-slate-200 shadow-sm space-y-6"
                >
                  <div className="flex items-center gap-3 border-b border-slate-100 pb-4">
                    <div className="p-3 bg-indigo-50 text-indigo-600 rounded-2xl">
                      <Link className="w-6 h-6" />
                    </div>
                    <div>
                      <h2 className="text-2xl font-bold text-slate-800">เพิ่มคลังสื่อการสอน</h2>
                      <p className="text-slate-500 text-sm">อัปโหลดหรือเพิ่มลิงก์เอกสารประกอบการเรียน หนังสือเรียน หรือวิดีโอประกอบการสอนสำหรับนักเรียน</p>
                    </div>
                  </div>

                  <form onSubmit={addMaterial} className="space-y-6">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      <div className="space-y-2">
                        <label className="text-sm font-bold text-slate-600">หัวข้อสื่อการสอน</label>
                        <input 
                          type="text" 
                          placeholder="เช่น หนังสือเรียน รายวิชาภาษาไทย บทที่ 1"
                          value={newMaterialTitle}
                          onChange={(e) => setNewMaterialTitle(e.target.value)}
                          className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 outline-none focus:ring-2 focus:ring-indigo-500 text-base font-medium transition-all"
                        />
                      </div>

                      <div className="space-y-2">
                        <label className="text-sm font-bold text-slate-600">ประเภทของสื่อการเรียนรู้</label>
                        <div className="grid grid-cols-5 gap-2">
                          {[
                            { type: 'pdf', label: 'PDF' },
                            { type: 'doc', label: 'Doc/Word' },
                            { type: 'link', label: 'ลิงก์เว็บ' },
                            { type: 'video', label: 'วิดีโอ' },
                            { type: 'image', label: 'รูปภาพ' },
                          ].map(item => (
                            <button
                              key={item.type}
                              type="button"
                              onClick={() => setNewMaterialType(item.type as any)}
                              className={`py-2.5 rounded-lg border text-xs font-bold transition-all text-center flex flex-col items-center justify-center gap-1 ${
                                newMaterialType === item.type 
                                  ? 'bg-indigo-600 text-white border-indigo-600 shadow-md scale-105' 
                                  : 'bg-white hover:bg-slate-50 text-slate-600 border-slate-200/80'
                              }`}
                            >
                              {item.label}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>

                    <div className="space-y-4">
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                        <label className="text-sm font-bold text-slate-600 block">ลิงก์ดาวน์โหลดหรือลิงก์เข้าชมสื่อการสอน</label>
                        <label className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-xs font-bold cursor-pointer transition-all ${
                          isUploadingMaterial 
                            ? 'bg-slate-100 border-slate-200 text-slate-405' 
                            : 'bg-indigo-50 border-indigo-100 text-indigo-700 hover:bg-indigo-100/70'
                        }`}>
                          {isUploadingMaterial ? (
                            <>
                              <div className="w-3 h-3 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin" />
                              กำลังอัปโหลด...
                            </>
                          ) : (
                            <>
                              <Upload className="w-3.5 h-3.5" />
                              อัปโหลดไฟล์จากคอมพิวเตอร์
                            </>
                          )}
                          <input 
                            type="file" 
                            className="hidden" 
                            disabled={isUploadingMaterial}
                            onChange={handleMaterialFileUpload} 
                          />
                        </label>
                      </div>
                      <input 
                        type="text" 
                        placeholder="เช่น https://drive.google.com/... หรือคัดลอกลิงก์มาวางที่นี่"
                        value={newMaterialUrl}
                        onChange={(e) => setNewMaterialUrl(e.target.value)}
                        className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 outline-none focus:ring-2 focus:ring-indigo-500 text-base font-medium transition-all font-mono"
                      />
                    </div>

                    <div className="space-y-2">
                      <label className="text-sm font-bold text-slate-600">คำอธิบาย/รายละเอียดเพิ่มเติม (ถ้ามี)</label>
                      <textarea 
                        rows={3}
                        placeholder="เช่น ให้เด็กๆ อ่านหน้าที่ 10-15 หรือคำชี้แจงในการทำความเข้าใจสื่อชิ้นนี้..."
                        value={newMaterialDesc}
                        onChange={(e) => setNewMaterialDesc(e.target.value)}
                        className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 outline-none focus:ring-2 focus:ring-indigo-500 text-sm font-medium transition-all resize-none"
                      />
                    </div>

                    <div className="flex justify-end pt-2">
                      <button 
                        type="submit"
                        className="bg-indigo-600 hover:bg-indigo-700 text-white px-8 py-3.5 rounded-xl font-bold transition-all active:scale-95 shadow-lg shadow-indigo-150 inline-flex items-center gap-2"
                      >
                        <Plus className="w-5 h-5" />
                        บันทึกสื่อการสอนใหม่
                      </button>
                    </div>
                  </form>
                </motion.div>

                {/* List of current Course Materials */}
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <h3 className="text-xl font-bold text-slate-800">คลังสื่อการสอนที่อัปโหลดไว้</h3>
                    <span className="text-xs font-bold text-slate-400 bg-slate-100 px-3 py-1.5 rounded-xl border border-slate-200">
                      ทั้งหมด {(appData.materials || []).filter(m => m.courseKey === currentCourseKey).length} ชิ้น
                    </span>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {(appData.materials || [])
                      .filter(m => m.courseKey === currentCourseKey)
                      .map(material => {
                        let iconColor = 'bg-slate-50 text-slate-500 border border-slate-100';
                        let label = 'ลิงก์ทั่วไป';
                        if (material.type === 'pdf') { iconColor = 'bg-rose-50 text-rose-600 border border-rose-100'; label = 'เอกสาร PDF'; }
                        else if (material.type === 'doc') { iconColor = 'bg-blue-50 text-blue-600 border border-blue-100'; label = 'Word/PowerPoint'; }
                        else if (material.type === 'video') { iconColor = 'bg-amber-50 text-amber-600 border border-amber-100'; label = 'วิดีโอการสอน'; }
                        else if (material.type === 'image') { iconColor = 'bg-purple-50 text-purple-600 border border-purple-100'; label = 'สื่อรูปภาพ'; }

                        return (
                          <motion.div 
                            initial={{ opacity: 0, scale: 0.98 }}
                            animate={{ opacity: 1, scale: 1 }}
                            key={material.id} 
                            className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm hover:shadow-md transition-shadow flex flex-col justify-between gap-4 group relative overflow-hidden"
                          >
                            <div className="space-y-3">
                              <div className="flex items-start justify-between">
                                <div className="flex gap-3">
                                  <div className={`p-3 rounded-xl flex items-center justify-center ${iconColor}`}>
                                    <Link className="w-5 h-5" />
                                  </div>
                                  <div>
                                    <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">{label}</span>
                                    <h4 className="font-bold text-slate-800 line-clamp-1 group-hover:text-indigo-600 transition-colors">{material.title}</h4>
                                  </div>
                                </div>
                              </div>

                              {material.description && (
                                <p className="text-slate-500 text-xs leading-relaxed line-clamp-2 bg-slate-50 p-2.5 rounded-lg border border-slate-100">{material.description}</p>
                              )}
                            </div>

                            <div className="flex items-center justify-between border-t border-slate-50 pt-3">
                              <span className="text-[10px] font-bold text-slate-400">
                                เพิ่มเมื่อ {new Date(material.createdAt).toLocaleDateString('th-TH')}
                              </span>
                              <div className="flex items-center gap-2">
                                <a 
                                  href={material.url} 
                                  target="_blank" 
                                  rel="noreferrer" 
                                  className="flex items-center gap-1 text-xs font-bold text-indigo-600 hover:text-indigo-800 bg-indigo-50/50 hover:bg-indigo-50 px-3 py-1.5 rounded-lg border border-indigo-100 transition-all cursor-pointer"
                                >
                                  <ExternalLink className="w-3.5 h-3.5" />
                                  เปิดดู/ดาวน์โหลด
                                </a>
                                <button 
                                  onClick={() => deleteMaterial(material.id)}
                                  className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-all"
                                  title="ลบสื่อการสอน"
                                >
                                  <Trash2 className="w-4 h-4" />
                                </button>
                              </div>
                            </div>
                          </motion.div>
                        );
                      })}

                    {(appData.materials || []).filter(m => m.courseKey === currentCourseKey).length === 0 && (
                      <div className="md:col-span-2 bg-white border border-slate-200/60 p-12 rounded-3xl text-center shadow-sm space-y-4">
                        <div className="w-16 h-16 bg-slate-50 rounded-full flex items-center justify-center text-slate-400 mx-auto">
                          <Link className="w-8 h-8" />
                        </div>
                        <div className="space-y-1">
                          <p className="font-bold text-slate-800">ยังไม่มีสื่อการสอนในวิชานี้</p>
                          <p className="text-slate-500 text-xs">คุณยังไม่ได้อัปโหลดหรือระบุลิงก์สื่อเรียนรู้ใดๆ กรอกข้อมูลฟอร์มด้านบนเพื่อเริ่มบันทึก</p>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
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
                                <div className="flex items-center gap-1.5 flex-wrap">
                                  <p className="font-bold text-slate-700 leading-tight">{student.name}</p>
                                  {student.isNewTransferred && (
                                    <span className="bg-rose-50 text-rose-605 border border-rose-100 text-[9px] font-extrabold px-1.5 py-0.5 rounded-full">ย้ายเข้า</span>
                                  )}
                                </div>
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

            {teacherTab === 'admin' && (
              /* Database Admin Console View */
              <div className="max-w-5xl mx-auto space-y-8">
                {/* Diagnostics and counts */}
                <div className="grid grid-cols-1 sm:grid-cols-4 gap-6">
                  <div className="backdrop-blur-md bg-white/70 border border-white/60 p-6 rounded-[2rem] shadow-md shadow-slate-100/40 text-left">
                    <p className="text-[10px] font-black uppercase tracking-wider text-slate-400">สถานะการเชื่อมต่อ</p>
                    <p className="text-xl font-black text-emerald-600 mt-2 flex items-center gap-1.5">
                      <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse inline-block" />
                      เชื่อมต่อสำเร็จ
                    </p>
                  </div>
                  <div className="backdrop-blur-md bg-white/70 border border-white/60 p-6 rounded-[2rem] shadow-md shadow-slate-100/40 text-left">
                    <p className="text-[10px] font-black uppercase tracking-wider text-slate-400">นักเรียนรวม</p>
                    <p className="text-3xl font-black text-slate-800 font-mono mt-1">{allStudentsCount} คน</p>
                  </div>
                  <div className="backdrop-blur-md bg-white/70 border border-white/60 p-6 rounded-[2rem] shadow-md shadow-slate-100/40 text-left">
                    <p className="text-[10px] font-black uppercase tracking-wider text-slate-400 font-bold">การเช็คชื่อสะสม</p>
                    <p className="text-3xl font-black text-slate-800 font-mono mt-1">{allAttendanceCount} รายการ</p>
                  </div>
                  <div className="backdrop-blur-md bg-white/70 border border-white/60 p-6 rounded-[2rem] shadow-md shadow-slate-100/40 text-left">
                    <p className="text-[10px] font-black uppercase tracking-wider text-slate-400">การส่งงานออนไลน์</p>
                    <p className="text-3xl font-black text-slate-800 font-mono mt-1">{allSubmissionsCount} รายการ</p>
                  </div>
                </div>

                {/* Database Actions */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                  {/* Backup and Restore panel */}
                  <motion.div 
                    initial={{ opacity: 0, y: 15 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="backdrop-blur-md bg-white/70 border border-white/60 p-8 rounded-[2.5rem] shadow-xl shadow-slate-100/50 space-y-6 text-left"
                  >
                    <div className="flex items-center gap-3 border-b border-slate-100 pb-4">
                      <div className="p-3 bg-indigo-50 text-indigo-650 rounded-2xl">
                        <Cloud className="w-6 h-6" />
                      </div>
                      <div>
                        <h3 className="text-xl font-black text-slate-800">สำรองและกู้คืนฐานข้อมูล</h3>
                        <p className="text-slate-400 text-xs mt-0.5">ส่งออกและนำเข้าข้อมูล JSON ทั้งระบบ</p>
                      </div>
                    </div>

                    <div className="space-y-4">
                      <div>
                        <button
                          onClick={exportDatabaseJson}
                          disabled={isAdminProcessing}
                          className="w-full flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white py-4 rounded-2xl font-bold transition-all active:scale-[0.98] cursor-pointer shadow-md shadow-indigo-100 text-sm"
                        >
                          <Download className="w-5 h-5" />
                          ส่งออกข้อมูลฐานข้อมูลทั้งหมด (Export JSON)
                        </button>
                        <p className="text-[10px] text-slate-400 text-center mt-2">
                          * ข้อมูลจะถูกแปลงเป็นโครงสร้าง JSON และดาวน์โหลดลงคอมพิวเตอร์ของคุณ
                        </p>
                      </div>

                      <div className="border-t border-slate-100 pt-6">
                        <label className={`w-full flex items-center justify-center gap-2 border-2 border-dashed rounded-2xl py-6 text-center cursor-pointer transition-all ${
                          isBackupRestoring 
                            ? 'bg-slate-50 border-slate-200 text-slate-400' 
                            : 'bg-slate-50/50 hover:bg-slate-50 border-slate-200 hover:border-indigo-400 text-slate-650'
                        }`}>
                          {isBackupRestoring ? (
                            <>
                              <Loader2 className="w-5 h-5 animate-spin text-indigo-600" />
                              <span className="font-bold text-sm">กำลังนำเข้าและกู้คืนข้อมูล...</span>
                            </>
                          ) : (
                            <>
                              <Upload className="w-5 h-5 text-slate-400" />
                              <div className="flex flex-col text-left">
                                <span className="font-bold text-sm text-slate-700">นำเข้าไฟล์เพื่อกู้คืนระบบ (Import JSON)</span>
                                <span className="text-[10px] text-slate-400 mt-0.5">คลิกเพื่อเลือกไฟล์สำรองข้อมูลนามสกุล .json</span>
                              </div>
                            </>
                          )}
                          <input 
                            type="file" 
                            accept=".json"
                            disabled={isBackupRestoring}
                            onChange={(e) => {
                              const file = e.target.files?.[0];
                              if (file) importDatabaseJson(file);
                              e.target.value = '';
                            }} 
                            className="hidden" 
                          />
                        </label>
                      </div>
                    </div>
                  </motion.div>

                  {/* Student migration / Copying */}
                  <motion.div 
                    initial={{ opacity: 0, y: 15 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="backdrop-blur-md bg-white/70 border border-white/60 p-8 rounded-[2.5rem] shadow-xl shadow-slate-100/50 space-y-6 text-left"
                  >
                    <div className="flex items-center gap-3 border-b border-slate-100 pb-4">
                      <div className="p-3 bg-emerald-50/80 text-emerald-600 rounded-2xl">
                        <Users className="w-6 h-6" />
                      </div>
                      <div>
                        <h3 className="text-xl font-black text-slate-800">ย้าย/คัดลอกรายชื่อนักเรียน</h3>
                        <p className="text-slate-400 text-xs mt-0.5">จัดการโอนย้ายนักเรียนข้ามวิชาเรียนหรือห้องเรียน</p>
                      </div>
                    </div>

                    <div className="space-y-4">
                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <label className="text-xs font-black text-slate-500 uppercase tracking-wider">ห้องเรียนต้นทาง</label>
                          <select 
                            value={migrationSrcSubject}
                            onChange={(e) => setMigrationSrcSubject(e.target.value)}
                            className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-indigo-500 font-medium"
                          >
                            <option value="">เลือกวิชาต้นทาง...</option>
                            {appData.subjects.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                          </select>
                          <select 
                            value={migrationSrcClass}
                            onChange={(e) => setMigrationSrcClass(e.target.value)}
                            className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-indigo-500 font-medium mt-1.5"
                          >
                            <option value="">เลือกห้องต้นทาง...</option>
                            {appData.classRooms.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                          </select>
                        </div>

                        <div className="space-y-2">
                          <label className="text-xs font-black text-slate-500 uppercase tracking-wider">ห้องเรียนปลายทาง</label>
                          <select 
                            value={migrationDstSubject}
                            onChange={(e) => setMigrationDstSubject(e.target.value)}
                            className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-indigo-500 font-medium"
                          >
                            <option value="">เลือกวิชาปลายทาง...</option>
                            {appData.subjects.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                          </select>
                          <select 
                            value={migrationDstClass}
                            onChange={(e) => setMigrationDstClass(e.target.value)}
                            className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-indigo-500 font-medium mt-1.5"
                          >
                            <option value="">เลือกห้องปลายทาง...</option>
                            {appData.classRooms.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                          </select>
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-3 pt-2">
                        <button
                          onClick={() => handleMigrateStudents('move')}
                          disabled={isAdminProcessing}
                          className="flex items-center justify-center gap-1.5 bg-indigo-50 hover:bg-indigo-100 disabled:opacity-50 text-indigo-650 py-3.5 rounded-2xl font-bold text-xs transition-all active:scale-[0.98] border border-indigo-100/50 cursor-pointer"
                        >
                          <ChevronRight className="w-4 h-4" />
                          ย้ายเด็ก (Move)
                        </button>
                        <button
                          onClick={() => handleMigrateStudents('copy')}
                          disabled={isAdminProcessing}
                          className="flex items-center justify-center gap-1.5 bg-emerald-50 hover:bg-emerald-100 disabled:opacity-50 text-emerald-650 py-3.5 rounded-2xl font-bold text-xs transition-all active:scale-[0.98] border border-emerald-100/50 cursor-pointer"
                        >
                          <Users className="w-4 h-4" />
                          คัดลอกเด็ก (Copy)
                        </button>
                      </div>
                    </div>
                  </motion.div>
                </div>

                {/* Database Cleansing */}
                <motion.div 
                  initial={{ opacity: 0, y: 15 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="backdrop-blur-md bg-white/70 border border-white/60 p-8 rounded-[2.5rem] shadow-xl shadow-slate-100/50 space-y-6 text-left"
                >
                  <div className="flex items-center gap-3 border-b border-slate-100 pb-4">
                    <div className="p-3 bg-rose-50 text-rose-600 rounded-2xl">
                      <Trash2 className="w-6 h-6" />
                    </div>
                    <div>
                      <h3 className="text-xl font-black text-slate-800">ล้างประวัติ/ลบข้อมูลรายห้อง</h3>
                      <p className="text-slate-400 text-xs mt-0.5">เคลียร์ข้อมูลในวิชาที่กำลังเลือกอยู่ เพื่อเตรียมระบบขึ้นเทอมใหม่</p>
                    </div>
                  </div>

                  <div className="flex flex-col sm:flex-row items-center justify-between gap-4 p-4 bg-rose-50/40 border border-rose-100/40 rounded-2xl">
                    <div className="text-left">
                      <span className="text-[10px] font-black uppercase tracking-wider text-rose-550 block">ห้องเรียนที่เลือกสำหรับการลบ</span>
                      <span className="font-extrabold text-slate-800 text-sm">
                        {appData.subjects.find(s => s.id === selectedSubjectId)?.name || 'ยังไม่ได้เลือกวิชา'} - ห้อง {appData.classRooms.find(c => c.id === selectedClassId)?.name || 'ยังไม่ได้เลือกห้อง'}
                      </span>
                    </div>
                    
                    <div className="flex flex-wrap gap-3">
                      <button
                        onClick={() => handlePurgeData('attendance')}
                        disabled={isAdminProcessing}
                        className="flex items-center gap-1 bg-white hover:bg-rose-50 border border-slate-200 hover:border-rose-200 text-slate-700 hover:text-rose-600 px-4 py-2.5 rounded-xl font-bold text-xs transition-all cursor-pointer"
                      >
                        <CheckCircle2 className="w-3.5 h-3.5 text-slate-400 hover:text-rose-500" />
                        ล้างการเช็คชื่อ
                      </button>
                      <button
                        onClick={() => handlePurgeData('submissions')}
                        disabled={isAdminProcessing}
                        className="flex items-center gap-1 bg-white hover:bg-rose-50 border border-slate-200 hover:border-rose-200 text-slate-700 hover:text-rose-600 px-4 py-2.5 rounded-xl font-bold text-xs transition-all cursor-pointer"
                      >
                        <FileText className="w-3.5 h-3.5 text-slate-400 hover:text-rose-500" />
                        ล้างการส่งงาน
                      </button>
                      <button
                        onClick={() => handlePurgeData('students')}
                        disabled={isAdminProcessing}
                        className="flex items-center gap-1 bg-white hover:bg-rose-50 border border-slate-200 hover:border-rose-200 text-slate-700 hover:text-rose-600 px-4 py-2.5 rounded-xl font-bold text-xs transition-all cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5 text-slate-400 hover:text-rose-500" />
                        ลบรายชื่อนักเรียนทั้งหมด
                      </button>
                    </div>
                  </div>
                </motion.div>
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

                      <div className="space-y-1 text-left">
                        <p className="text-[10px] font-black text-indigo-400 uppercase tracking-[0.3em] mb-1">Authenticated Student</p>
                        <h3 className="text-4xl font-black text-slate-800 leading-tight tracking-tight">{foundStudent.name}</h3>
                        
                        {/* Course Selector Tabs - Dynamic switcher for multi-subject students */}
                        {matchingStudentRecords.length > 1 ? (
                          <div className="space-y-2 mt-3 text-left">
                            <span className="text-[10px] font-extrabold text-slate-400 uppercase tracking-wider block">สลับวิชาเพื่อแสดงผลคะแนนและสื่อการเรียนสอน:</span>
                            <div className="flex flex-wrap gap-2">
                              {matchingStudentRecords.map(record => {
                                const match = matchCourseKey(record.courseKey, appData.subjects, appData.classRooms);
                                const subjectName = match?.subject.name || 'วิชาเรียน';
                                const className = match?.classroom.name || 'ห้องเรียน';
                                const isActive = record.courseKey === foundStudent.courseKey;
                                return (
                                  <button
                                    key={record.id}
                                    type="button"
                                    onClick={() => setFoundStudent(record)}
                                    className={`px-3 py-2 rounded-xl text-xs font-black transition-all cursor-pointer border flex items-center gap-1.5 ${
                                      isActive
                                        ? 'bg-indigo-600 text-white border-indigo-600 shadow-md shadow-indigo-100 scale-105'
                                        : 'bg-white hover:bg-slate-50 text-slate-650 border-slate-205'
                                    }`}
                                  >
                                    <span className={`w-1.5 h-1.5 rounded-full ${isActive ? 'bg-white animate-pulse' : 'bg-slate-300'}`} />
                                    {subjectName} ({className})
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        ) : (
                          (() => {
                            const match = matchCourseKey(foundStudent.courseKey, appData.subjects, appData.classRooms);
                            const subjectName = match?.subject.name || '';
                            const className = match?.classroom.name || '';
                            return (
                              <div className="mt-2 text-left">
                                <span className="text-[10px] font-black text-indigo-600 bg-indigo-50 border border-indigo-100 px-3 py-1.5 rounded-xl inline-block">
                                  วิชาเรียน: {subjectName} ({className})
                                </span>
                              </div>
                            );
                          })()
                        )}

                        <div className="flex flex-wrap items-center gap-4 mt-3">
                          <div className="flex items-center gap-3 bg-slate-100/80 px-4 py-2 rounded-2xl border border-slate-200/50">
                            <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">ID</span>
                            <span className="text-sm font-black text-slate-700 leading-none">{foundStudent.studentId}</span>
                          </div>
                          <div className="flex items-center gap-3 bg-slate-100/80 px-4 py-2 rounded-2xl border border-slate-200/50">
                            <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">NO</span>
                            <span className="text-sm font-black text-slate-700 leading-none">{foundStudent.no}</span>
                          </div>
                          {foundStudent.isNewTransferred && (
                            <div className="flex items-center gap-2 bg-rose-50 px-4 py-2 rounded-2xl border border-rose-200/50">
                              <span className="text-[10px] font-black text-rose-550 uppercase tracking-widest">STATUS</span>
                              <span className="text-sm font-black text-rose-600 leading-none">นักเรียนย้ายเข้าใหม่</span>
                            </div>
                          )}
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
                    {/* Exam Scores Card (คะแนนสอบกลางภาค & ปลายภาค) */}
                    <div className="md:col-span-12 bg-white p-8 md:p-10 rounded-[3rem] border border-slate-200 shadow-xl space-y-6">
                      <div className="flex flex-wrap items-center justify-between gap-4">
                        <h3 className="text-2xl font-black text-slate-800 flex items-center gap-3">
                          <div className="p-2.5 bg-indigo-50 text-indigo-600 rounded-2xl">
                            <GraduationCap className="w-6 h-6" />
                          </div>
                          คะแนนสอบประเมินผล
                        </h3>
                        <span className="text-xs font-extrabold text-slate-500 bg-slate-50 px-4 py-2 rounded-xl border border-slate-200">
                          รวมคะแนนสอบ {(foundStudent.midterm || 0) + (foundStudent.final || 0)} / 35 คะแนน
                        </span>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        {/* Midterm Exam Card */}
                        <div className={`p-6 md:p-8 rounded-[2.5rem] border-2 transition-all relative overflow-hidden ${
                          (foundStudent.midterm || 0) < 7 
                            ? 'bg-rose-50/70 border-rose-300 shadow-lg shadow-rose-100/60' 
                            : 'bg-slate-50/70 border-slate-200 hover:border-indigo-200'
                        }`}>
                          <div className="flex items-center justify-between mb-4">
                            <div className="flex items-center gap-2.5">
                              <div className={`p-2.5 rounded-2xl ${ (foundStudent.midterm || 0) < 7 ? 'bg-rose-600 text-white' : 'bg-indigo-600 text-white' }`}>
                                <Award className="w-5 h-5" />
                              </div>
                              <div>
                                <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Midterm Exam</p>
                                <h4 className="text-lg font-black text-slate-800">คะแนนสอบกลางภาค</h4>
                              </div>
                            </div>
                            <div className="text-right">
                              <span className={`text-4xl font-black ${ (foundStudent.midterm || 0) < 7 ? 'text-rose-600' : 'text-indigo-600' }`}>
                                {foundStudent.midterm || 0}
                              </span>
                              <span className="text-xs font-bold text-slate-400 ml-1">/ 15</span>
                            </div>
                          </div>

                          {/* Warning logic for Midterm < 7 */}
                          {(foundStudent.midterm || 0) < 7 ? (
                            <div className="mt-4 p-4 bg-rose-500 text-white rounded-2xl shadow-md space-y-1.5">
                              <div className="flex items-center gap-2 font-black text-xs">
                                <AlertTriangle className="w-4 h-4 text-amber-300 shrink-0" />
                                <span>คำเตือน: คะแนนสอบกลางภาคต่ำกว่าเกณฑ์!</span>
                              </div>
                              <p className="text-xs font-medium leading-relaxed opacity-95">
                                คุณได้คะแนนสอบกลางภาค {foundStudent.midterm || 0} คะแนน (ต่ำกว่าเกณฑ์ขั้นต่ำ 7 คะแนน) กรุณาติดต่อครูผู้สอนเพื่อขอคำแนะนำและดำเนินการสอบซ่อมเสริม
                              </p>
                            </div>
                          ) : (
                            <div className="mt-4 p-3.5 bg-emerald-50 border border-emerald-200/80 rounded-2xl flex items-center gap-2 text-emerald-700 text-xs font-bold">
                              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                              <span>ผ่านเกณฑ์การประเมินสอบกลางภาค (ผ่านเกณฑ์ขั้นต่ำ 7 คะแนน)</span>
                            </div>
                          )}
                        </div>

                        {/* Final Exam Card */}
                        <div className="p-6 md:p-8 rounded-[2.5rem] border-2 border-slate-200 bg-slate-50/70 hover:border-indigo-200 transition-all">
                          <div className="flex items-center justify-between mb-4">
                            <div className="flex items-center gap-2.5">
                              <div className="p-2.5 rounded-2xl bg-teal-600 text-white">
                                <GraduationCap className="w-5 h-5" />
                              </div>
                              <div>
                                <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Final Exam</p>
                                <h4 className="text-lg font-black text-slate-800">คะแนนสอบปลายภาค</h4>
                              </div>
                            </div>
                            <div className="text-right">
                              <span className="text-4xl font-black text-teal-600">
                                {foundStudent.final || 0}
                              </span>
                              <span className="text-xs font-bold text-slate-400 ml-1">/ 20</span>
                            </div>
                          </div>

                          <div className="mt-4 p-3.5 bg-white border border-slate-200/80 rounded-2xl flex items-center justify-between text-xs text-slate-600 font-bold">
                            <span>คะแนนเต็มการสอบปลายภาค: 20 คะแนน</span>
                            <span className="text-teal-600 font-black">{Math.round(((foundStudent.final || 0) / 20) * 100)}%</span>
                          </div>
                        </div>
                      </div>
                    </div>

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
                         const studentRecords = (appData.attendance || []).filter(a => (a.studentId || '').trim().toLowerCase() === (foundStudent.studentId || '').trim().toLowerCase());
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
                        {(appData.assignments || [])
                          .filter(assignment => studentCourseMatch(assignment.courseKey, foundStudent.courseKey))
                          .map(assignment => {
                            const submission = appData.submissions.find(s => s.assignmentId === assignment.id && (s.studentId || '').trim().toLowerCase() === (foundStudent.studentId || '').trim().toLowerCase());
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
                                    (() => {
                                      const mode = studentSubmissionMode[assignment.id] || 'file';
                                      return (
                                        <div className="space-y-3">
                                          {/* Mode Selector */}
                                          <div className="flex bg-slate-100 p-1 rounded-xl">
                                            <button
                                              type="button"
                                              onClick={() => setStudentSubmissionMode(prev => ({ ...prev, [assignment.id]: 'file' }))}
                                              className={`flex-1 py-1.5 rounded-lg text-center text-[10px] font-extrabold transition-all cursor-pointer ${
                                                mode === 'file'
                                                  ? 'bg-white text-slate-800 shadow-sm'
                                                  : 'text-slate-500 hover:text-slate-800'
                                              }`}
                                            >
                                              แนบไฟล์ (File)
                                            </button>
                                            <button
                                              type="button"
                                              onClick={() => setStudentSubmissionMode(prev => ({ ...prev, [assignment.id]: 'link' }))}
                                              className={`flex-1 py-1.5 rounded-lg text-center text-[10px] font-extrabold transition-all cursor-pointer ${
                                                mode === 'link'
                                                  ? 'bg-white text-slate-800 shadow-sm'
                                                  : 'text-slate-500 hover:text-slate-800'
                                              }`}
                                            >
                                              ส่งเป็นลิงก์ (Link)
                                            </button>
                                          </div>

                                          {mode === 'file' ? (
                                            <label className={`block w-full text-center py-4 rounded-2xl font-black text-[10px] uppercase tracking-widest transition-all cursor-pointer ${
                                              uploading ? 'bg-slate-200 text-slate-400' : 'bg-indigo-600 text-white hover:bg-indigo-700 shadow-lg shadow-indigo-100'
                                            }`}>
                                              {uploading ? 'Uploading...' : 'เลือกไฟล์และส่ง'}
                                              <input 
                                                type="file" 
                                                className="hidden" 
                                                disabled={uploading}
                                                onChange={(e) => handleStudentFileUpload(e, assignment.id, foundStudent)} 
                                              />
                                            </label>
                                          ) : (
                                            <div className="space-y-2">
                                              <input
                                                type="url"
                                                placeholder="วางลิงก์ที่นี่ (https://...)"
                                                value={studentLinkInput[assignment.id] || ''}
                                                onChange={(e) => setStudentLinkInput(prev => ({ ...prev, [assignment.id]: e.target.value }))}
                                                onKeyDown={(e) => {
                                                  if (e.key === 'Enter') {
                                                    handleStudentLinkSubmit(assignment.id, foundStudent);
                                                  }
                                                }}
                                                className="w-full bg-white border border-slate-250 focus:border-indigo-500 rounded-xl px-3 py-2 text-xs outline-none focus:ring-4 focus:ring-indigo-105 font-medium placeholder-slate-400 transition-all"
                                              />
                                              <button
                                                type="button"
                                                disabled={uploading}
                                                onClick={() => handleStudentLinkSubmit(assignment.id, foundStudent)}
                                                className={`w-full py-3 rounded-xl font-bold text-[10px] tracking-widest uppercase transition-all text-white bg-indigo-600 hover:bg-indigo-700 shadow-lg shadow-indigo-100 flex items-center justify-center gap-1.5 cursor-pointer`}
                                              >
                                                {uploading ? 'กำลังส่งข้อมูล...' : 'ส่งลิงก์งาน'}
                                              </button>
                                            </div>
                                          )}
                                        </div>
                                      );
                                    })()
                                  )}
                                </div>
                              </div>
                            );
                          })}

                        {(appData.assignments || []).filter(assignment => studentCourseMatch(assignment.courseKey, foundStudent.courseKey)).length === 0 && (
                          <div className="md:col-span-3 text-center py-12">
                            <div className="w-16 h-16 bg-slate-50 rounded-[2rem] flex items-center justify-center mx-auto mb-4 border border-dashed border-slate-200 text-slate-300">
                              <Clock className="w-8 h-8" />
                            </div>
                            <p className="text-sm font-bold text-slate-400">ยังไม่มีงานออนไลน์</p>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Learning Materials Card */}
                    <div className="md:col-span-12 bg-white p-10 rounded-[3rem] border border-slate-200 shadow-xl flex flex-col">
                      <h3 className="text-2xl font-black text-slate-800 flex items-center gap-3 mb-8">
                        <div className="p-2.5 bg-indigo-50 text-indigo-600 rounded-2xl">
                          <BookOpen className="w-6 h-6" />
                        </div>
                        สื่อการเรียนการสอนสำหรับน้องๆ
                      </h3>

                      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                        {(appData.materials || [])
                          .filter(m => studentCourseMatch(m.courseKey, foundStudent.courseKey))
                          .map(material => {
                            let iconColor = 'bg-slate-50 text-slate-500 border border-slate-100';
                            let label = 'ลิงก์ประกอบการเรียน';
                            if (material.type === 'pdf') { iconColor = 'bg-rose-50 text-rose-600 border border-rose-100'; label = 'เอกสาร PDF'; }
                            else if (material.type === 'doc') { iconColor = 'bg-blue-50 text-blue-600 border border-blue-100'; label = 'Word / PowerPoint'; }
                            else if (material.type === 'video') { iconColor = 'bg-amber-50 text-amber-600 border border-amber-100'; label = 'วิดีโอประกอบการเรียน'; }
                            else if (material.type === 'image') { iconColor = 'bg-purple-50 text-purple-600 border border-purple-100'; label = 'สื่อรูปภาพ'; }

                            return (
                              <div key={material.id} className="p-6 rounded-[2.5rem] border border-slate-150 bg-slate-50/50 flex flex-col justify-between hover:border-indigo-200 hover:bg-white transition-all group">
                                <div className="space-y-4">
                                  <div className="flex gap-3">
                                    <div className={`p-3 rounded-xl flex items-center justify-center h-fit ${iconColor}`}>
                                      <Link className="w-4 h-4" />
                                    </div>
                                    <div>
                                      <span className="text-[9px] font-black uppercase tracking-widest text-slate-400">{label}</span>
                                      <h4 className="font-extrabold text-slate-800 line-clamp-1 group-hover:text-indigo-600 transition-colors">{material.title}</h4>
                                    </div>
                                  </div>

                                  {material.description && (
                                    <p className="text-slate-500 text-xs leading-relaxed line-clamp-3 bg-white p-3 rounded-2xl border border-slate-100">{material.description}</p>
                                  )}
                                </div>

                                <div className="mt-4 pt-3 border-t border-slate-100/60 flex items-center justify-between">
                                  <span className="text-[9px] font-bold text-slate-400">
                                    {new Date(material.createdAt).toLocaleDateString('th-TH')}
                                  </span>
                                  <a 
                                    href={material.url} 
                                    target="_blank" 
                                    rel="noreferrer" 
                                    className="flex items-center gap-1.5 text-xs font-black text-white bg-indigo-600 hover:bg-indigo-700 px-4 py-2.5 rounded-xl shadow-lg shadow-indigo-100 cursor-pointer transition-all active:scale-95"
                                  >
                                    <Download className="w-3.5 h-3.5" />
                                    อ่าน/ดาวน์โหลด
                                  </a>
                                </div>
                              </div>
                            );
                          })}

                        {(appData.materials || []).filter(m => studentCourseMatch(m.courseKey, foundStudent.courseKey)).length === 0 && (
                          <div className="md:col-span-3 text-center py-12">
                            <div className="w-16 h-16 bg-slate-50 rounded-[2rem] flex items-center justify-center mx-auto mb-4 border border-dashed border-slate-200 text-slate-300">
                              <BookOpen className="w-8 h-8" />
                            </div>
                            <p className="text-sm font-bold text-slate-400">ยังไม่มีเอกสารหรือสื่อการเรียนในวิชานี้</p>
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

          {!foundStudent && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="bg-white p-10 rounded-[3rem] border border-slate-200/90 shadow-xl space-y-6"
            >
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-100 pb-4">
                <div className="flex items-center gap-3">
                  <div className="p-3 bg-indigo-50 text-indigo-600 rounded-2xl">
                    <BookOpen className="w-6 h-6" />
                  </div>
                  <div className="text-left">
                    <h3 className="text-xl font-bold text-slate-800">เอกสารการสอน & สื่อสำหรับนักเรียน</h3>
                    <p className="text-slate-500 text-xs">คุณสามารถเลือกดู ค้นหา หรือดาวน์โหลดสื่อการเรียนรู้สาธารณะได้ที่นี่</p>
                  </div>
                </div>
              </div>

              {/* Filters */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-2xl px-4 py-3 group">
                  <BookOpen className="w-4 h-4 text-slate-400 group-focus-within:text-indigo-600" />
                  <select 
                    value={studentFilterSubjectId}
                    onChange={(e) => setStudentFilterSubjectId(e.target.value)}
                    className="bg-transparent border-none outline-none text-sm font-semibold text-slate-700 w-full cursor-pointer"
                  >
                    <option value="">-- รายวิชาทั้งหมด --</option>
                    {appData.subjects.map(s => (
                      <option key={s.id} value={s.id}>{s.name}</option>
                    ))}
                  </select>
                </div>

                <div className="flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-2xl px-4 py-3 group">
                  <Users className="w-4 h-4 text-slate-400 group-focus-within:text-indigo-600" />
                  <select 
                    value={studentFilterClassId}
                    onChange={(e) => setStudentFilterClassId(e.target.value)}
                    className="bg-transparent border-none outline-none text-sm font-semibold text-slate-700 w-full cursor-pointer"
                  >
                    <option value="">-- ชั้นเรียนทั้งหมด --</option>
                    {appData.classRooms.map(c => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Media Elements */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {(appData.materials || [])
                  .filter(m => {
                    const { subjectId: subId, classroomId: classId } = parseCourseKey(m.courseKey);
                    if (studentFilterSubjectId && subId !== studentFilterSubjectId) return false;
                    if (studentFilterClassId && classId !== studentFilterClassId) return false;
                    return true;
                  })
                  .map(material => {
                    const { subjectId: subId, classroomId: classId } = parseCourseKey(material.courseKey);
                    const associatedSubject = appData.subjects.find(s => s.id === subId)?.name || '';
                    const associatedClass = appData.classRooms.find(c => c.id === classId)?.name || '';
                    
                    let iconColor = 'bg-slate-50 text-slate-500 border border-slate-100';
                    let label = 'ลิงก์ประกอบการเรียน';
                    if (material.type === 'pdf') { iconColor = 'bg-rose-50 text-rose-600 border border-rose-100'; label = 'เอกสาร PDF'; }
                    else if (material.type === 'doc') { iconColor = 'bg-blue-50 text-blue-600 border border-blue-100'; label = 'Word / PowerPoint'; }
                    else if (material.type === 'video') { iconColor = 'bg-amber-50 text-amber-600 border border-amber-100'; label = 'วิดีโอประกอบการเรียน'; }
                    else if (material.type === 'image') { iconColor = 'bg-purple-50 text-purple-600 border border-purple-100'; label = 'รูปภาพ/สไลด์'; }

                    return (
                      <div key={material.id} className="p-5 rounded-3xl border border-slate-150 bg-slate-50/50 flex flex-col justify-between hover:border-indigo-200 hover:bg-white transition-all group">
                        <div className="space-y-3 mb-4">
                          <div className="flex gap-3">
                            <div className={`p-2.5 rounded-xl flex items-center justify-center h-fit ${iconColor}`}>
                              <Link className="w-4 h-4" />
                            </div>
                            <div className="text-left">
                              <span className="text-[10px] font-bold text-slate-400 block leading-none mb-1">
                                {associatedSubject} {associatedClass ? `(${associatedClass})` : ''}
                              </span>
                              <h4 className="font-extrabold text-slate-800 text-sm line-clamp-1 group-hover:text-indigo-600 transition-colors">{material.title}</h4>
                            </div>
                          </div>

                          {material.description && (
                            <p className="text-slate-500 text-xs text-left leading-relaxed line-clamp-2 bg-white p-3 border border-slate-100/60 rounded-2xl">{material.description}</p>
                          )}
                        </div>

                        <div className="pt-3 border-t border-slate-100/60 flex items-center justify-between">
                          <span className="text-[9px] font-bold text-indigo-400 bg-indigo-50/70 px-2.5 py-1 rounded-md">
                            {label}
                          </span>
                          <a 
                            href={material.url} 
                            target="_blank" 
                            rel="noreferrer" 
                            className="flex items-center gap-1.5 text-xs font-black text-white bg-indigo-600 hover:bg-indigo-700 px-3.5 py-2.5 rounded-xl shadow-md transition-all active:scale-95 cursor-pointer"
                          >
                            <Download className="w-3.5 h-3.5" />
                            เข้าชมสื่อ
                          </a>
                        </div>
                      </div>
                    );
                  })}

                {(appData.materials || []).filter(m => {
                  const { subjectId: subId, classroomId: classId } = parseCourseKey(m.courseKey);
                  if (studentFilterSubjectId && subId !== studentFilterSubjectId) return false;
                  if (studentFilterClassId && classId !== studentFilterClassId) return false;
                  return true;
                }).length === 0 && (
                  <div className="sm:col-span-2 text-center py-10 bg-slate-50/50 rounded-2xl border border-dashed border-slate-200">
                    <p className="text-slate-400 font-bold text-sm">ยังไม่มีสื่อการสอนในประเภทจัดกรอง</p>
                  </div>
                )}
              </div>
            </motion.div>
          )}
          </div>
        )}

        {/* Footer Info */}
        <footer className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
          <div className="flex flex-col md:flex-row justify-between gap-6">
            <div className="space-y-3">
              <button 
                onClick={() => setIsGradingCriteriaModalOpen(true)}
                className="font-bold text-slate-800 flex items-center gap-2 hover:text-indigo-600 transition-colors group cursor-pointer"
              >
                <div className="w-8 h-8 rounded-lg bg-indigo-50 flex items-center justify-center text-indigo-600 group-hover:bg-indigo-100 transition-colors">
                  <Info className="w-5 h-5" />
                </div>
                เกณฑ์การตัดเกรด
                <ChevronRight className="w-4 h-4 text-slate-300 group-hover:text-indigo-400 group-hover:translate-x-0.5 transition-all" />
              </button>
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
              className="relative w-full max-w-lg bg-white rounded-3xl shadow-2xl border border-slate-200 overflow-hidden z-10"
            >
              <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
                <div className="text-left">
                  <h3 className="text-xl font-bold text-slate-800 flex items-center gap-2">
                    <Settings className="w-5 h-5 text-indigo-600 animate-spin-hover" />
                    ศูนย์ตั้งค่าวิชา & ห้องเรียนทั้งหมด
                  </h3>
                  <p className="text-xs text-slate-500 font-medium">จัดการทุกรายวิชา ห้องเรียน แผนก และระดับชั้นในหน้าต่างเดียว</p>
                </div>
                <button onClick={() => setIsManageModalOpen(false)} className="p-2 hover:bg-slate-100 rounded-xl transition-colors">
                  <X className="w-5 h-5 text-slate-400" />
                </button>
              </div>

              {/* Tab Switcher */}
              <div className="flex border-b border-slate-100 bg-slate-50/30 p-2 gap-2">
                <button
                  type="button"
                  onClick={() => setManageCenterTab('subject')}
                  className={`flex-1 py-3 text-sm font-bold rounded-xl transition-all duration-300 flex items-center justify-center gap-2 cursor-pointer ${
                    manageCenterTab === 'subject'
                      ? 'bg-indigo-600 text-white shadow-md shadow-indigo-100'
                      : 'text-slate-600 hover:bg-slate-100 hover:text-slate-800'
                  }`}
                >
                  <BookOpen className="w-4 h-4" />
                  รายวิชาเรียน ({appData.subjects.length})
                </button>
                <button
                  type="button"
                  onClick={() => setManageCenterTab('class')}
                  className={`flex-1 py-3 text-sm font-bold rounded-xl transition-all duration-300 flex items-center justify-center gap-2 cursor-pointer ${
                    manageCenterTab === 'class'
                      ? 'bg-indigo-600 text-white shadow-md shadow-indigo-100'
                      : 'text-slate-600 hover:bg-slate-100 hover:text-slate-800'
                  }`}
                >
                  <Users className="w-4 h-4" />
                  ห้องเรียน / แผนก ({appData.classRooms.length})
                </button>
              </div>
              
              <div className="p-6 space-y-5 text-left">
                {manageCenterTab === 'subject' ? (
                  <div className="space-y-4">
                    <div className="space-y-3">
                      <div className="space-y-1">
                        <label className="text-xs font-bold text-slate-400 uppercase tracking-wider block font-sans">เพิ่มรายวิชาที่สอน</label>
                        <div className="flex gap-2">
                          <input 
                            type="text" 
                            placeholder="เช่น วิชาการเขียนโปรแกรมเชิงวัตถุ B..."
                            value={newSubjectNameInput}
                            onChange={(e) => setNewSubjectNameInput(e.target.value)}
                            onKeyDown={(e) => { if (e.key === 'Enter') { addSubject(); } }}
                            className="flex-1 bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 outline-none focus:ring-2 focus:ring-indigo-500 font-semibold text-slate-700 placeholder-slate-400 text-sm"
                          />
                          <button 
                            type="button"
                            onClick={() => addSubject()}
                            className="bg-indigo-600 hover:bg-indigo-700 text-white px-5 py-2.5 rounded-xl font-bold transition-all active:scale-95 text-sm cursor-pointer"
                          >
                            เพิ่มวิชา
                          </button>
                        </div>
                      </div>

                      {/* Classroom selection for new subject */}
                      <div className="bg-indigo-50/40 p-3 rounded-2xl border border-indigo-100/50 space-y-2">
                        <div className="flex justify-between items-center">
                          <span className="text-xs font-extrabold text-indigo-700 block">เปิดสอนในห้องเรียนใดบ้าง?:</span>
                          <button
                            type="button"
                            onClick={() => {
                              const allRoomIds = appData.classRooms.map(r => r.id);
                              if (selectedClassroomsForNewSubject.length === allRoomIds.length) {
                                setSelectedClassroomsForNewSubject([]);
                              } else {
                                setSelectedClassroomsForNewSubject(allRoomIds);
                              }
                            }}
                            className="text-[10px] font-bold text-indigo-600 hover:underline cursor-pointer"
                          >
                            {selectedClassroomsForNewSubject.length === appData.classRooms.length ? 'ยกเลิกทั้งหมด' : 'เลือกทุกห้อง'}
                          </button>
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          {appData.classRooms.map(room => {
                            const isSelected = selectedClassroomsForNewSubject.includes(room.id);
                            return (
                              <button
                                key={room.id}
                                type="button"
                                onClick={() => {
                                  if (isSelected) {
                                    setSelectedClassroomsForNewSubject(prev => prev.filter(id => id !== room.id));
                                  } else {
                                    setSelectedClassroomsForNewSubject(prev => [...prev, room.id]);
                                  }
                                }}
                                className={`px-2.5 py-1 text-xs font-bold rounded-lg border transition-all cursor-pointer ${
                                  isSelected
                                    ? 'bg-indigo-600 border-indigo-600 text-white shadow-xs'
                                    : 'bg-white border-slate-200 text-slate-500 hover:bg-slate-50'
                                }`}
                              >
                                {room.name}
                              </button>
                            );
                          })}
                          {appData.classRooms.length === 0 && (
                            <span className="text-xs text-slate-400 font-medium italic">กรุณาเพิ่มห้องเรียนในแท็บ 'ห้องเรียน/แผนก' ก่อน</span>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="space-y-2">
                      <label className="text-xs font-bold text-slate-400 uppercase tracking-wider block">รายวิชาเรียนทั้งหมด ({appData.subjects.length} วิชา)</label>
                      <div className="space-y-3 max-h-64 overflow-y-auto pr-2 divide-y divide-slate-100 bg-slate-50/50 p-3.5 rounded-2xl border border-slate-150">
                        {appData.subjects.map(item => (
                          <div key={item.id} className="pt-3 first:pt-0 flex flex-col gap-2">
                            <div className="flex items-center justify-between">
                              <span className="font-bold text-slate-800 text-sm block">{item.name}</span>
                              <button 
                                type="button"
                                onClick={() => removeSubject(item.id)}
                                className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-all cursor-pointer"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </div>

                            {/* Class selection box */}
                            <div className="bg-white p-2.5 rounded-xl border border-slate-200/80 space-y-1.5 text-left">
                              <span className="text-[10px] font-black text-slate-400 block uppercase tracking-widest">ห้องเรียนที่สอนวิชานี้ (คลิกเปิด/ปิด เพื่อกำหนดแยกกัน):</span>
                              <div className="flex flex-wrap gap-1.5">
                                {appData.classRooms.map(room => {
                                  // Default to true (or includes) depending on if classroomIds is initialized
                                  const hasIdsField = Array.isArray(item.classroomIds);
                                  const isSelected = hasIdsField ? item.classroomIds!.includes(room.id) : true;
                                  return (
                                    <button
                                      key={room.id}
                                      type="button"
                                      onClick={() => toggleSubjectClassroom(item.id, room.id)}
                                      className={`px-2.5 py-1 text-[11px] font-bold rounded-lg border transition-all cursor-pointer ${
                                        isSelected
                                          ? 'bg-emerald-50 border-emerald-250 text-emerald-700 font-extrabold'
                                          : 'bg-slate-50/50 border-slate-150 text-slate-400 hover:bg-slate-50 hover:text-slate-600'
                                      }`}
                                    >
                                      {room.name}
                                    </button>
                                  );
                                })}
                                {appData.classRooms.length === 0 && (
                                  <span className="text-[11px] text-slate-400 font-semibold italic">ไม่มีห้องเรียนในระบบ</span>
                                )}
                              </div>
                            </div>
                          </div>
                        ))}
                        {appData.subjects.length === 0 && (
                          <p className="text-center text-slate-400 py-6 text-xs font-medium">ยังไม่มีรายวิชาในระบบ</p>
                        )}
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div className="space-y-1">
                      <label className="text-xs font-bold text-slate-400 uppercase tracking-wider block">เพิ่มห้องเรียน / แผนก / ระดับชั้น</label>
                      <div className="flex gap-2">
                        <input 
                          type="text" 
                          placeholder="เช่น DB-PM5/1, ปวส.2 คอมพิวเตอร์..."
                          value={newClassNameInput}
                          onChange={(e) => setNewClassNameInput(e.target.value)}
                          onKeyDown={(e) => { if (e.key === 'Enter') { addClass(); } }}
                          className="flex-1 bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 outline-none focus:ring-2 focus:ring-indigo-500 font-semibold text-slate-700 placeholder-slate-400 text-sm"
                        />
                        <button 
                          onClick={() => addClass()}
                          className="bg-indigo-600 hover:bg-indigo-700 text-white px-5 py-2.5 rounded-xl font-bold transition-all active:scale-95 text-sm cursor-pointer"
                        >
                          เพิ่มห้อง
                        </button>
                      </div>
                    </div>

                    <div className="space-y-1">
                      <label className="text-xs font-bold text-slate-400 uppercase tracking-wider block">ห้องเรียน / แผนกทั้งหมด ({appData.classRooms.length} ห้อง)</label>
                      <div className="space-y-2 max-h-60 overflow-y-auto pr-2 divide-y divide-slate-100 bg-slate-50/50 p-3 rounded-2xl border border-slate-150">
                        {appData.classRooms.map(item => (
                          <div key={item.id} className="flex items-center justify-between py-2 first:pt-0 last:pb-0">
                            <span className="font-semibold text-slate-705 text-sm">{item.name}</span>
                            <button 
                              onClick={() => removeClass(item.id)}
                              className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-all cursor-pointer"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        ))}
                        {appData.classRooms.length === 0 && (
                          <p className="text-center text-slate-400 py-6 text-xs font-medium">ยังไม่มีห้องเรียนในระบบ</p>
                        )}
                      </div>
                    </div>
                  </div>
                )}

                <div className="bg-amber-50 border border-amber-100 rounded-2xl p-4 flex gap-2.5 text-amber-800 text-xs font-medium leading-relaxed">
                  <span className="text-sm">💡</span>
                  <p>
                    ระบบจะนำรายวิชาที่คุณป้อนทุกวิชา มาจับคู่กับห้องเรียนทุกห้องโดยอัตโนมัติ เพื่อสร้างห้องย่อยให้คุณเข้าเลือกทำงาน จัดการคะแนน หรือประเมินผลได้สะดวกทันที
                  </p>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Teacher Notes Modal */}
      <AnimatePresence>
        {isNotesModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsNotesModalOpen(false)}
              className="absolute inset-0 bg-slate-900/60 backdrop-blur-md"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="relative bg-slate-50 rounded-[40px] w-full max-w-6xl h-[80vh] shadow-2xl flex flex-col overflow-hidden border border-white"
            >
              {/* Modal Header */}
              <div className="p-8 pb-4 flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 bg-indigo-600 rounded-2xl flex items-center justify-center text-white shadow-lg shadow-indigo-200">
                    <StickyNote className="w-6 h-6" />
                  </div>
                  <div>
                    <h3 className="text-2xl font-bold text-slate-800">โน๊ตส่วนตัวของคุณครู</h3>
                    <p className="text-slate-400 font-medium">บันทึกข้อความหรือสิ่งที่ต้องทำส่วนตัว</p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <button 
                    onClick={addNote}
                    className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white px-6 py-3 rounded-2xl font-bold transition-all active:scale-95 shadow-md"
                  >
                    <Plus className="w-5 h-5" />
                    เขียนโน๊ตใหม่
                  </button>
                  <button 
                    onClick={() => setIsNotesModalOpen(false)}
                    className="p-3 hover:bg-slate-200 rounded-2xl transition-colors text-slate-400 lg:ml-4"
                  >
                    <X className="w-6 h-6" />
                  </button>
                </div>
              </div>

              {/* Modal Content */}
              <div className="flex-1 overflow-y-auto p-8 pt-4 custom-scrollbar">
                {teacherNotes.length > 0 ? (
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    <AnimatePresence mode="popLayout">
                      {teacherNotes.map((note) => (
                        <motion.div
                          key={note.id}
                          initial={{ opacity: 0, y: 20 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, scale: 0.9 }}
                          layout
                          className="bg-white p-6 rounded-[32px] border border-slate-200 shadow-sm relative group overflow-hidden transition-all hover:shadow-md h-fit"
                        >
                          <div className={`absolute top-0 left-0 w-full h-1.5 ${
                            note.color === 'emerald' ? 'bg-emerald-500' :
                            note.color === 'amber' ? 'bg-amber-500' :
                            note.color === 'rose' ? 'bg-rose-500' :
                            note.color === 'sky'  ? 'bg-sky-500' :
                            note.color === 'violet' ? 'bg-violet-500' :
                            'bg-indigo-500'
                          }`} />
                          
                          <input
                            type="text"
                            value={note.title}
                            onChange={(e) => updateNote(note.id, 'title', e.target.value)}
                            placeholder="หัวข้อ..."
                            className="w-full bg-transparent border-none focus:ring-0 text-xl font-bold text-slate-800 p-0 placeholder:text-slate-300 mb-2"
                          />
                          <textarea
                            value={note.content}
                            onChange={(e) => updateNote(note.id, 'content', e.target.value)}
                            placeholder="พิมพ์ข้อความที่นี่..."
                            className="w-full bg-transparent border-none focus:ring-0 text-slate-600 p-0 min-h-[160px] resize-none placeholder:text-slate-300 leading-relaxed text-sm"
                          />
                          
                          <div className="flex items-center justify-between pt-4 mt-2 border-t border-slate-50">
                            <span className="text-[10px] font-medium text-slate-400 font-mono italic">
                              อัปเดตล่าสุด {new Date(note.updatedAt).toLocaleTimeString('th-TH')} {new Date(note.updatedAt).toLocaleDateString('th-TH')}
                            </span>
                            <button
                              onClick={() => deleteNote(note.id)}
                              className="text-slate-200 hover:text-rose-500 transition-colors p-2 rounded-xl hover:bg-rose-50"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </motion.div>
                      ))}
                    </AnimatePresence>
                  </div>
                ) : (
                  <div className="h-full flex flex-col items-center justify-center text-center space-y-4 py-20">
                    <div className="w-24 h-24 bg-white rounded-[32px] shadow-sm flex items-center justify-center text-slate-200 border border-slate-100">
                      <StickyNote className="w-10 h-10" />
                    </div>
                    <div className="space-y-1">
                      <h4 className="text-xl font-bold text-slate-400">ยังไม่มีบันทึก</h4>
                      <p className="text-slate-400 text-sm font-medium">คุณสามารถเพิ่มโน๊ตส่วนตัวเพื่อจดบันทึกสิ่งต่างๆ ได้ที่นี่</p>
                    </div>
                  </div>
                )}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Add New/Transferred Student Modal */}
      <AnimatePresence>
        {isAddStudentModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsAddStudentModalOpen(false)}
              className="absolute inset-0 bg-slate-900/60 backdrop-blur-md"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="relative bg-white rounded-[32px] w-full max-w-2xl shadow-2xl flex flex-col overflow-hidden border border-slate-200 z-10"
            >
              {/* Modal Header */}
              <div className="p-6 pb-4 border-b border-slate-100 flex justify-between items-center bg-slate-50/50 text-left">
                <div className="flex items-center gap-3.5 text-left">
                  <div className="w-10 h-10 bg-indigo-50 text-indigo-600 rounded-2xl flex items-center justify-center shadow-sm">
                    <UserPlus className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="text-xl font-bold text-slate-800">ระบบเพิ่มรายชื่อนักเรียน</h3>
                    <p className="text-xs text-slate-500 font-medium">เพิ่มข้อมูลนักเรียนใหม่ นักเรียนทั่วไป หรือนักเรียนย้ายเข้า</p>
                  </div>
                </div>
                <button 
                  onClick={() => setIsAddStudentModalOpen(false)} 
                  className="p-2 hover:bg-slate-100 rounded-xl transition-colors text-slate-400 hover:text-slate-600 cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Tab Switcher for Importing */}
              <div className="flex border-b border-slate-100 bg-slate-50/50 p-2 gap-2">
                <button
                  type="button"
                  onClick={() => setAddStudentTab('individual')}
                  className={`flex-1 py-2.5 text-xs font-bold rounded-xl transition-all duration-300 flex items-center justify-center gap-2 cursor-pointer ${
                    addStudentTab === 'individual'
                      ? 'bg-white text-slate-800 shadow-sm ring-1 ring-slate-100/50 font-extrabold'
                      : 'text-slate-500 hover:bg-white/40 hover:text-slate-800'
                  }`}
                >
                  <UserPlus className="w-4 h-4 text-indigo-500" />
                  เพิ่มทีละคน
                </button>
                <button
                  type="button"
                  onClick={() => setAddStudentTab('excel')}
                  className={`flex-1 py-2.5 text-xs font-bold rounded-xl transition-all duration-300 flex items-center justify-center gap-2 cursor-pointer ${
                    addStudentTab === 'excel'
                      ? 'bg-white text-slate-800 shadow-sm ring-1 ring-slate-100/50 font-extrabold'
                      : 'text-slate-500 hover:bg-white/40 hover:text-slate-800'
                  }`}
                >
                  <FileText className="w-4 h-4 text-emerald-500" />
                  คัดลอกจาก Excel / พิมพ์ลิสต์
                </button>
                <button
                  type="button"
                  onClick={() => setAddStudentTab('file')}
                  className={`flex-1 py-2.5 text-xs font-bold rounded-xl transition-all duration-300 flex items-center justify-center gap-2 cursor-pointer ${
                    addStudentTab === 'file'
                      ? 'bg-white text-slate-800 shadow-sm ring-1 ring-slate-100/50 font-extrabold'
                      : 'text-slate-500 hover:bg-white/40 hover:text-slate-800'
                  }`}
                >
                  <Upload className="w-4 h-4 text-amber-500" />
                  อัปโหลดไฟล์ CSV
                </button>
              </div>

              {/* Global Mark Dropped Out Switch */}
              <div className="p-4 px-6 bg-rose-50 border-b border-rose-100 flex items-center justify-between gap-4 text-left">
                <div className="flex items-start gap-2.5 text-left">
                  <UserX className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                  <div>
                    <p className="text-xs font-bold text-rose-800">ต้องการทำเครื่องหมายเป็น "นักเรียนจำหน่ายออก / พ้นสภาพ" ใช่ไหม?</p>
                    <p className="text-[10px] text-rose-600/90 font-medium">ระบบจะแสดงแถบสีแดง ปิดการกรอกคะแนน และข้ามช่องอัตโนมัติเมื่อกดลูกศรคีย์บอร์ด</p>
                  </div>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input 
                    type="checkbox" 
                    checked={singleStudentInput.isDroppedOut} 
                    onChange={(e) => setSingleStudentInput(prev => ({ ...prev, isDroppedOut: e.target.checked }))}
                    className="sr-only peer" 
                  />
                  <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-rose-600" />
                </label>
              </div>

              {/* Modal Content container */}
              <div className="p-6 overflow-y-auto max-h-[55vh] custom-scrollbar text-left font-sans">
                
                {/* 1. INDIVIDUAL FORM */}
                {addStudentTab === 'individual' && (
                  <div className="space-y-4">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-xs font-bold text-slate-600 mb-1.5">เลขที่</label>
                        <input 
                          type="text" 
                          placeholder="เช่น 1, 2, 3..."
                          value={singleStudentInput.no}
                          onChange={(e) => setSingleStudentInput(prev => ({ ...prev, no: e.target.value }))}
                          className="w-full bg-slate-50 border border-slate-200 focus:bg-white focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100 rounded-2xl px-4 py-3 outline-none transition-all duration-200 font-medium text-slate-800 text-sm"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-bold text-slate-600 mb-1.5">รหัสนักเรียน (ประจำตัว)</label>
                        <input 
                          type="text" 
                          placeholder="เช่น 66309010001"
                          value={singleStudentInput.studentId}
                          onChange={(e) => setSingleStudentInput(prev => ({ ...prev, studentId: e.target.value }))}
                          className="w-full bg-slate-50 border border-slate-200 focus:bg-white focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100 rounded-2xl px-4 py-3 outline-none transition-all duration-200 font-medium text-slate-800 text-sm font-mono"
                        />
                      </div>
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-slate-600 mb-1.5">ชื่อ - นามสกุล นักเรียน</label>
                      <input 
                        type="text" 
                        placeholder="คำนำหน้าตามด้วยชื่อและนามสกุล (เช่น นายสมชาย ใจดี)"
                        value={singleStudentInput.name}
                        onChange={(e) => setSingleStudentInput(prev => ({ ...prev, name: e.target.value }))}
                        className="w-full bg-slate-50 border border-slate-200 focus:bg-white focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100 rounded-2xl px-4 py-3 outline-none transition-all duration-200 font-bold text-slate-800 text-sm"
                      />
                    </div>

                    <div className="pt-4 border-t border-slate-100 flex flex-col sm:flex-row items-center justify-end gap-3">
                      <button
                        type="button"
                        onClick={() => handleSaveIndividualStudent(true)}
                        className="w-full sm:w-auto px-5 py-3 hover:bg-slate-50 text-indigo-600 border border-indigo-200 hover:border-indigo-300 rounded-2xl font-bold text-xs transition-all active:scale-95 cursor-pointer flex items-center justify-center gap-1.5"
                      >
                        <UserPlus className="w-4 h-4" />
                        บันทึกและเพิ่มคนถัดไป
                      </button>
                      <button
                        type="button"
                        onClick={() => handleSaveIndividualStudent(false)}
                        className="w-full sm:w-auto px-6 py-3 bg-indigo-600 hover:bg-indigo-700 text-white rounded-2xl font-bold text-xs transition-all active:scale-95 cursor-pointer shadow-lg shadow-indigo-100 flex items-center justify-center gap-1.5"
                      >
                        <Check className="w-4 h-4" />
                        บันทึกข้อมูลและปิดหน้าต่าง
                      </button>
                    </div>
                  </div>
                )}

                {/* 2. EXCEL PASTE FORM */}
                {addStudentTab === 'excel' && (
                  <div className="space-y-4">
                    <div className="p-4 bg-slate-50 border border-slate-200/60 rounded-2xl">
                      <h4 className="text-xs font-bold text-slate-800 flex items-center gap-2 mb-1.5">
                        <Info className="w-4 h-4 text-indigo-500 shrink-0" />
                        รูปแบบข้อมูลที่รองรับ
                      </h4>
                      <p className="text-[11px] text-slate-500 leading-relaxed font-medium">
                        คุณสามารถคัดลอก (Copy) คอลัมน์จาก <span className="font-bold text-indigo-600">Microsoft Excel / Google Sheets</span> แล้ววางลงในช่องพิมพ์ด้านล่างได้ทันที ระบบจะทำการแปลงข้อมูลให้อัตโนมัติ
                      </p>
                      <div className="mt-3 bg-white p-3 rounded-xl border border-slate-100 font-mono text-[10px] text-slate-500 space-y-1">
                        <p className="text-slate-400 border-b border-slate-50 pb-1 mb-1 font-bold">ตัวอย่างรูปแบบ (รองรับหลากหลายวิธี):</p>
                        <p className="bg-slate-50/80 px-2 py-0.5 rounded text-indigo-600 font-medium">วิธีที่ 1 (แนะนำ): รหัส [เว้นวรรค/Tab] ชื่อ-นามสกุล</p>
                        <p className="px-3 italic">66309010001    นายสมชาย ใจดี</p>
                        <p className="px-3 italic">66309010002    นางสาวสมศรี ดีเลิศ</p>
                        <p className="bg-slate-50/80 px-2 py-0.5 rounded text-indigo-600 font-medium mt-2">วิธีที่ 2: เฉพาะชื่ออย่างเดียว</p>
                        <p className="px-3 italic">นายสมศักดิ์ มาดี</p>
                        <p className="px-3 italic">นางสมร เจริญพร</p>
                      </div>
                    </div>

                    <div>
                      <label className="block text-xs font-bold text-slate-600 mb-1.5 flex justify-between items-center">
                        <span>พื้นที่วางข้อมูลรายชื่อ</span>
                        <span className="text-[10px] font-medium text-slate-400">1 บรรทัดต่อ 1 คน</span>
                      </label>
                      <textarea
                        rows={6}
                        placeholder="วางข้อมูลที่นี่..."
                        value={excelPasteInput}
                        onChange={(e) => setExcelPasteInput(e.target.value)}
                        className="w-full bg-slate-50 border border-slate-200 focus:bg-white focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100 rounded-2xl px-4 py-3 outline-none transition-all duration-205 font-mono text-xs text-slate-800 placeholder:text-slate-350 leading-relaxed"
                      />
                    </div>

                    <div className="pt-4 border-t border-slate-100 flex items-center justify-end gap-3">
                      <button
                        type="button"
                        onClick={() => setExcelPasteInput('')}
                        className="px-4 py-2.5 rounded-xl text-xs font-bold text-slate-500 hover:bg-slate-100 transition-colors"
                      >
                        ล้างข้อมูล
                      </button>
                      <button
                        type="button"
                        onClick={handleImportPastedText}
                        className="px-6 py-3 bg-indigo-600 hover:bg-indigo-700 text-white rounded-2xl font-bold text-xs transition-all active:scale-95 cursor-pointer shadow-lg shadow-indigo-100 flex items-center gap-1.5"
                      >
                        <Check className="w-4 h-4" />
                        นำเข้าจำนวน {excelPasteInput.split('\n').filter(l => l.trim()).length} คน เข้าระบบ
                      </button>
                    </div>
                  </div>
                )}

                {/* 3. CSV FILE UPLOAD */}
                {addStudentTab === 'file' && (
                  <div className="space-y-4">
                    <div className="p-8 border-2 border-dashed border-slate-200 hover:border-indigo-300 rounded-[24px] bg-slate-50 hover:bg-indigo-50/20 transition-all text-center flex flex-col items-center justify-center relative cursor-pointer group">
                      <input 
                        type="file" 
                        accept=".csv" 
                        onChange={async (e) => {
                          const file = e.target.files?.[0];
                          if (!file) return;
                          
                          const reader = new FileReader();
                          reader.onload = async (event) => {
                            const text = event.target?.result as string;
                            const lines = text.split('\n');
                            let count = 0;
                            const batchPromises = [];
                            
                            for (let i = 1; i < lines.length; i++) {
                              const line = lines[i].trim();
                              if (!line) continue;
                              const parts = line.split(',').map(p => p.trim());
                              if (parts.length < 2) continue;
                              
                              let no = '';
                              let studentId = '';
                              let name = '';
                              
                              if (parts.length >= 3) {
                                no = parts[0];
                                studentId = parts[1];
                                name = parts[2];
                              } else {
                                no = (students.length + count + 1).toString();
                                studentId = parts[0];
                                name = parts[1];
                              }
                              
                              const id = crypto.randomUUID();
                              const newStudent: Student = {
                                id,
                                no,
                                studentId,
                                name,
                                courseKey: currentCourseKey,
                                behavior: 0,
                                attendance: 0,
                                assignment1: { part1: 0, part2: 0, part3: 0 },
                                assignment2: { part1: 0, part2: 0, part3: 0 },
                                assignment3: { part1: 0, part2: 0, part3: 0 },
                                midterm: 0,
                                final: 0,
                                isDroppedOut: singleStudentInput.isDroppedOut
                              };
                              batchPromises.push(setDoc(doc(db, 'students', id), newStudent));
                              count++;
                            }
                            
                            try {
                              await Promise.all(batchPromises);
                              showAlert('สำเร็จ!', `นำเข้าข้อมูลนักเรียน ${count} คน เรียบร้อยแล้ว`, 'success');
                              setIsAddStudentModalOpen(false);
                            } catch (err) {
                              console.error(err);
                              showAlert('ผิดพลาด', 'มีข้อผิดพลาดในการบันทึกข้อมูลเข้าระบบ', 'error');
                            }
                          };
                          reader.readAsText(file);
                        }} 
                        className="absolute inset-0 opacity-0 cursor-pointer z-10" 
                      />
                      <div className="w-16 h-16 bg-white rounded-2xl flex items-center justify-center text-slate-400 group-hover:text-indigo-600 shadow-sm border border-slate-100 group-hover:scale-110 transition-all duration-300">
                        <Upload className="w-8 h-8" />
                      </div>
                      <div className="mt-4 space-y-1">
                        <p className="text-sm font-bold text-slate-700">คลิกที่นี่ หรือ ลากไฟล์เพื่ออัปโหลด</p>
                        <p className="text-xs text-slate-400 font-medium">รองรับเฉพาะไฟล์ข้อมูลสกุล .CSV</p>
                      </div>
                    </div>

                    <div className="p-4 bg-slate-50 border border-slate-200/60 rounded-2xl">
                      <h4 className="text-xs font-bold text-slate-800 flex items-center gap-2 mb-1.5">
                        <Info className="w-4 h-4 text-amber-500 shrink-0" />
                        คำแนะนำไฟล์ CSV
                      </h4>
                      <p className="text-[11px] text-slate-500 leading-relaxed font-medium">
                        โครงสร้างของไฟล์ควรเรียงลำดับคอลัมน์ดังนี้: <span className="font-bold text-indigo-600">เลขที่, รหัสประจำตัวประจำชั้น, ชื่อ-นามสกุล</span> (ไม่มีแถวหัวตาราง หรือมีแถวหัวตารางเป็นภาษาอังกฤษ)
                      </p>
                    </div>
                  </div>
                )}

              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Grading Criteria Modal */}
      <AnimatePresence>
        {isGradingCriteriaModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsGradingCriteriaModalOpen(false)}
              className="absolute inset-0 bg-slate-900/60 backdrop-blur-md"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="relative bg-white rounded-[40px] w-full max-w-lg shadow-2xl overflow-hidden border border-white"
            >
              {/* Modal Header */}
              <div className="p-8 pb-4 flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 bg-indigo-600 rounded-2xl flex items-center justify-center text-white shadow-lg shadow-indigo-200">
                    <Info className="w-6 h-6" />
                  </div>
                  <div>
                    <h3 className="text-2xl font-bold text-slate-800">เกณฑ์การตัดเกรด</h3>
                    <p className="text-slate-400 font-medium">เกณฑ์มาตรฐานที่ใช้ในการประเมินผล</p>
                  </div>
                </div>
                <button 
                  onClick={() => setIsGradingCriteriaModalOpen(false)}
                  className="p-3 hover:bg-slate-100 rounded-2xl transition-colors text-slate-400"
                >
                  <X className="w-6 h-6" />
                </button>
              </div>

              {/* Modal Content */}
              <div className="p-8 space-y-6">
                <div className="grid grid-cols-2 gap-4">
                  {GRADING_SCALE.map((s, i) => (
                    <motion.div 
                      key={i}
                      initial={{ opacity: 0, x: -10 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: i * 0.05 }}
                      className="flex items-center justify-between p-5 rounded-3xl bg-slate-50 border border-slate-100 group hover:bg-indigo-50 hover:border-indigo-100 transition-all"
                    >
                      <div className="flex flex-col">
                        <span className="text-[10px] uppercase font-bold text-slate-400 group-hover:text-indigo-400 transition-colors">คะแนนอย่างน้อย</span>
                        <span className="text-xl font-black text-slate-700 group-hover:text-indigo-700 transition-colors">≥ {s.min}</span>
                      </div>
                      <div className="flex flex-col items-end">
                        <span className="text-[10px] uppercase font-bold text-slate-400 group-hover:text-indigo-400 transition-colors">สรุปผลการเรียน</span>
                        <span className="text-xl font-black text-indigo-600 group-hover:text-indigo-600 transition-colors">เกรด {s.grade}</span>
                      </div>
                    </motion.div>
                  ))}
                </div>
                
                <div className="bg-indigo-50 p-6 rounded-3xl border border-indigo-100/50">
                  <div className="flex gap-4">
                    <div className="w-10 h-10 bg-white rounded-xl flex items-center justify-center text-indigo-600 shadow-sm shrink-0">
                      <BookOpen className="w-5 h-5" />
                    </div>
                    <p className="text-sm text-indigo-800 leading-relaxed">
                      คะแนนทั้งหมดจะถูกรวบรวมและประเมินผลตามเกณฑ์ที่กำหนดไว้อัตโนมัติ โดยอ้างอิงจากคะแนนเก็บและการสอบตามสัดส่วนของรายวิชา
                    </p>
                  </div>
                </div>
              </div>
              
              {/* Modal Footer */}
              <div className="p-8 pt-0">
                <button 
                  onClick={() => setIsGradingCriteriaModalOpen(false)}
                  className="w-full bg-slate-800 hover:bg-slate-900 text-white font-bold py-4 rounded-2xl transition-all active:scale-[0.98] shadow-lg shadow-slate-200"
                >
                  รับทราบ
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
      {/* Confirmation Modal */}
      <AnimatePresence>
        {confirmModal.isOpen && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setConfirmModal(prev => ({ ...prev, isOpen: false }))}
              className="absolute inset-0 bg-slate-900/60 backdrop-blur-md"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="relative bg-white rounded-[40px] w-full max-w-md shadow-2xl overflow-hidden border border-white"
            >
              <div className="p-8 pb-4 flex items-center gap-4">
                <div className={`w-12 h-12 rounded-2xl flex items-center justify-center text-white shadow-lg ${
                  confirmModal.type === 'danger' ? 'bg-rose-500 shadow-rose-200' : 
                  confirmModal.type === 'warning' ? 'bg-amber-500 shadow-amber-200' : 
                  confirmModal.type === 'success' ? 'bg-emerald-500 shadow-emerald-200' :
                  'bg-indigo-600 shadow-indigo-200'
                }`}>
                  {confirmModal.type === 'success' ? <CheckCircle2 className="w-6 h-6" /> : <AlertCircle className="w-6 h-6" />}
                </div>
                <div>
                  <h3 className="text-2xl font-bold text-slate-800">{confirmModal.title}</h3>
                </div>
              </div>

              <div className="p-8 pt-4">
                <p className="text-slate-500 font-medium leading-relaxed whitespace-pre-line">
                  {confirmModal.message}
                </p>
              </div>

              <div className="p-8 pt-0 flex gap-3">
                {!confirmModal.isAlert && (
                  <button 
                    onClick={() => setConfirmModal(prev => ({ ...prev, isOpen: false }))}
                    className="flex-1 px-6 py-4 rounded-2xl font-bold text-slate-400 hover:bg-slate-50 transition-colors"
                  >
                    {confirmModal.cancelLabel || 'ยกเลิก'}
                  </button>
                )}
                <button 
                  onClick={() => {
                    confirmModal.onConfirm();
                    setConfirmModal(prev => ({ ...prev, isOpen: false }));
                  }}
                  className={`flex-1 px-6 py-4 rounded-2xl font-bold text-white transition-all active:scale-[0.98] shadow-lg ${
                    confirmModal.type === 'danger' ? 'bg-rose-500 hover:bg-rose-600 shadow-rose-100' :
                    confirmModal.type === 'warning' ? 'bg-amber-500 hover:bg-amber-600 shadow-amber-100' :
                    confirmModal.type === 'success' ? 'bg-emerald-500 hover:bg-emerald-600 shadow-emerald-100' :
                    'bg-indigo-600 hover:bg-indigo-700 shadow-indigo-100'
                  }`}
                >
                  {confirmModal.confirmLabel || (confirmModal.isAlert ? 'ตกลง' : 'ยืนยัน')}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Hidden PDF Template */}
      <div id="grade-report-pdf" style={{ display: 'none', position: 'absolute', left: '-9999px', width: '210mm', padding: '20mm', backgroundColor: 'white', color: '#1e293b', fontFamily: 'sans-serif' }}>
        <div style={{ textAlign: 'center', marginBottom: '30px' }}>
          <h1 style={{ fontSize: '24px', fontWeight: 'bold', margin: '0 0 10px 0', color: '#4f46e5' }}>รายงานสรุปผลการเรียน</h1>
          <p style={{ margin: '5px 0', fontSize: '14px' }}>
            วิชา: {appData.subjects.find(s => s.id === selectedSubjectId)?.name || '-'} | 
            ห้อง: {appData.classRooms.find(c => c.id === selectedClassId)?.name || '-'}
          </p>
          <p style={{ margin: '5px 0', fontSize: '12px', color: '#64748b' }}>วันที่ออกรายงาน: {new Date().toLocaleDateString('th-TH', { year: 'numeric', month: 'long', day: 'numeric' })}</p>
        </div>

        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '11px' }}>
          <thead>
            <tr style={{ backgroundColor: '#f8fafc' }}>
              <th style={{ border: '1px solid #e2e8f0', padding: '8px' }}>เลขที่</th>
              <th style={{ border: '1px solid #e2e8f0', padding: '8px' }}>รหัส</th>
              <th style={{ border: '1px solid #e2e8f0', padding: '8px', textAlign: 'left' }}>ชื่อ-นามสกุล</th>
              <th style={{ border: '1px solid #e2e8f0', padding: '8px' }}>จิตพิสัย</th>
              <th style={{ border: '1px solid #e2e8f0', padding: '8px' }}>มาเรียน</th>
              <th style={{ border: '1px solid #e2e8f0', padding: '8px' }}>งาน1</th>
              <th style={{ border: '1px solid #e2e8f0', padding: '8px' }}>งาน2</th>
              <th style={{ border: '1px solid #e2e8f0', padding: '8px' }}>งาน3</th>
              <th style={{ border: '1px solid #e2e8f0', padding: '8px' }}>กลางภาค</th>
              <th style={{ border: '1px solid #e2e8f0', padding: '8px' }}>ปลายภาค</th>
              <th style={{ border: '1px solid #e2e8f0', padding: '8px', backgroundColor: '#e0e7ff', fontWeight: 'bold' }}>รวม</th>
              <th style={{ border: '1px solid #e2e8f0', padding: '8px', backgroundColor: '#e0e7ff', fontWeight: 'bold' }}>เกรด</th>
            </tr>
          </thead>
          <tbody>
            {students.map((s) => {
              const a1 = (s.assignment1?.part1 || 0) + (s.assignment1?.part2 || 0) + (s.assignment1?.part3 || 0);
              const a2 = (s.assignment2?.part1 || 0) + (s.assignment2?.part2 || 0) + (s.assignment2?.part3 || 0);
              const a3 = (s.assignment3?.part1 || 0) + (s.assignment3?.part2 || 0) + (s.assignment3?.part3 || 0);
              const total = calculateTotal(s);
              return (
                <tr key={s.id}>
                  <td style={{ border: '1px solid #e2e8f0', padding: '6px', textAlign: 'center' }}>{s.no}</td>
                  <td style={{ border: '1px solid #e2e8f0', padding: '6px', textAlign: 'center' }}>{s.studentId}</td>
                  <td style={{ border: '1px solid #e2e8f0', padding: '6px' }}>{s.name}</td>
                  <td style={{ border: '1px solid #e2e8f0', padding: '6px', textAlign: 'center' }}>{s.behavior}</td>
                  <td style={{ border: '1px solid #e2e8f0', padding: '6px', textAlign: 'center' }}>{s.attendance}</td>
                  <td style={{ border: '1px solid #e2e8f0', padding: '6px', textAlign: 'center' }}>{a1}</td>
                  <td style={{ border: '1px solid #e2e8f0', padding: '6px', textAlign: 'center' }}>{a2}</td>
                  <td style={{ border: '1px solid #e2e8f0', padding: '6px', textAlign: 'center' }}>{a3}</td>
                  <td style={{ border: '1px solid #e2e8f0', padding: '6px', textAlign: 'center' }}>{s.midterm}</td>
                  <td style={{ border: '1px solid #e2e8f0', padding: '6px', textAlign: 'center' }}>{s.final}</td>
                  <td style={{ border: '1px solid #e2e8f0', padding: '6px', textAlign: 'center', fontWeight: 'bold' }}>{total}</td>
                  <td style={{ border: '1px solid #e2e8f0', padding: '6px', textAlign: 'center', fontWeight: 'bold', color: '#4f46e5' }}>{getGrade(total)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>

        <div style={{ marginTop: '40px', textAlign: 'right', fontSize: '12px' }}>
          <p>ลงชื่อ.................................................................</p>
          <p style={{ marginRight: '15px' }}>( {user?.displayName || 'อาจารย์ผู้สอน'} )</p>
          <p style={{ marginRight: '40px' }}>อาจารย์ผู้สอน</p>
        </div>
      </div>

      {/* Google Sheets Studio Customizer Modal */}
      <GoogleSheetsStudioModal
        isOpen={isSheetsStudioOpen}
        onClose={() => setIsSheetsStudioOpen(false)}
        students={students}
        currentSubject={appData.subjects.find(s => s.id === selectedSubjectId)}
        currentClass={appData.classRooms.find(c => c.id === selectedClassId)}
        teacherName={user?.displayName || 'ครูผู้สอน'}
        isGoogleAuth={isGoogleAuth}
        spreadsheetUrl={spreadsheetUrl}
        onSyncSheets={handleSyncToSheets}
        showAlert={showAlert}
      />
    </div>
  );
}
