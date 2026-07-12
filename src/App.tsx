import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Camera, Image as ImageIcon, Plus, FileText, ChevronRight, ChevronDown, Download, Upload, Trash2, ArrowLeft, Share2, CheckSquare, Square, X, ArrowDownUp, LayoutGrid, List as ListIcon, FolderInput, FolderPlus, Combine, Pencil, Check, Search, ArrowUp, ArrowDown, GripVertical, Home, StickyNote, User, Settings, Sun, Moon, Crop, MoreVertical, Lock, Unlock, FileArchive, FolderOpen, Mail, Undo, ZoomIn, ZoomOut, Info, Layers, Sparkles, Eye } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { App as CapApp } from '@capacitor/app';
import { Haptics, ImpactStyle, NotificationType } from '@capacitor/haptics';

export const triggerHapticLight = async (type?: 'scan' | 'export' | 'delete') => {
  if (type && localStorage.getItem(`docscanner_haptic_${type}`) === 'false') return;
  try {
    await Haptics.impact({ style: ImpactStyle.Light });
  } catch (e) {}
};

export const triggerHapticMedium = async (type?: 'scan' | 'export' | 'delete') => {
  if (type && localStorage.getItem(`docscanner_haptic_${type}`) === 'false') return;
  try {
    await Haptics.impact({ style: ImpactStyle.Medium });
  } catch (e) {}
};

export const triggerHapticSuccess = async (type?: 'scan' | 'export' | 'delete') => {
  if (type && localStorage.getItem(`docscanner_haptic_${type}`) === 'false') return;
  try {
    await Haptics.notification({ type: NotificationType.Success });
  } catch (e) {}
};
import { getDocuments, saveDocument, deleteDocument, getFolders, saveFolder, deleteFolder } from './lib/store';
import { Document, DocumentPage, Point, FilterType, Folder, QueueItem, WatermarkOptions } from './types';
import CropView from './components/CropView';
import FilterView from './components/FilterView';
import { warpPerspective, downscaleImage, detectDocumentCorners, applyFilter, loadImage, addWatermarkToImage } from './lib/image';
import { generatePDF } from './lib/pdf';
import JSZip from 'jszip';

import ZoomableImage from './components/ZoomableImage';
import CameraView from "./components/CameraView";


const isAndroidWebView = () => {
  const ua = navigator.userAgent.toLowerCase();
  return ua.includes("wv") || (ua.includes("android") && ua.includes("median")) || Capacitor.isNativePlatform();
};

const blobToBase64 = (blob: Blob): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const base64String = reader.result as string;
      // Remove the prefix (e.g., "data:application/pdf;base64,")
      resolve(base64String.split(',')[1]);
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
};

type AppState = 'home' | 'view_doc' | 'crop' | 'filter';
type SortOrder = 'newest' | 'oldest' | 'alpha';
type LayoutMode = 'grid' | 'list';

function PromptModal({ 
  promptState, 
  setPromptState, 
  theme 
}: { 
  promptState: { title: string; placeholder: string; defaultValue?: string; resolve: (val: string | null) => void };
  setPromptState: (val: any) => void;
  theme: string;
}) {
  const [val, setVal] = useState(promptState.defaultValue || '');
  return (
    <div className="fixed inset-0 bg-black/60 z-[120] flex items-center justify-center p-4 backdrop-blur-xs">
      <div className={`w-full max-w-sm rounded-2xl p-6 shadow-2xl ${theme === 'dark' ? 'bg-slate-900 text-white border border-slate-800' : 'bg-white text-gray-900'}`}>
        <h3 className="font-bold text-lg mb-3">{promptState.title}</h3>
        <input
          type="text"
          value={val}
          onChange={(e) => setVal(e.target.value)}
          placeholder={promptState.placeholder}
          className={`w-full border rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 font-medium mb-6 ${theme === 'dark' ? 'bg-slate-800 border-slate-700 text-white placeholder-slate-500' : 'bg-white border-gray-200'}`}
          autoFocus
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              promptState.resolve(val);
              setPromptState(null);
            } else if (e.key === 'Escape') {
              promptState.resolve(null);
              setPromptState(null);
            }
          }}
        />
        <div className="flex justify-end space-x-3">
          <button
            onClick={() => {
              promptState.resolve(null);
              setPromptState(null);
            }}
            className={`px-4 py-2 rounded-xl text-sm font-medium transition-colors ${theme === 'dark' ? 'text-slate-300 hover:bg-slate-800' : 'text-gray-600 hover:bg-gray-100'}`}
          >
            Cancel
          </button>
          <button
            onClick={() => {
              promptState.resolve(val);
              setPromptState(null);
            }}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-sm font-medium transition-colors"
          >
            Submit
          </button>
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const [appState, setAppState] = useState<AppState>('home');
  const [documents, setDocuments] = useState<Document[]>([]);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [currentDoc, setCurrentDoc] = useState<Document | null>(null);
  const [sortOrder, setSortOrder] = useState<SortOrder>('newest');
  const [layout, setLayout] = useState<LayoutMode>('grid');
  
  // New scan state
  const [capturedImage, setCapturedImage] = useState<string | null>(null);
  const [croppedImage, setCroppedImage] = useState<string | null>(null);
  const [currentCorners, setCurrentCorners] = useState<Point[] | undefined>();
  const [processingQueue, setProcessingQueue] = useState<QueueItem[]>([]);
  // Haptic settings state
  const [hapticScan, setHapticScan] = useState(localStorage.getItem('docscanner_haptic_scan') !== 'false');
  const [hapticExport, setHapticExport] = useState(localStorage.getItem('docscanner_haptic_export') !== 'false');
  const [hapticDelete, setHapticDelete] = useState(localStorage.getItem('docscanner_haptic_delete') !== 'false');

  useEffect(() => { localStorage.setItem('docscanner_haptic_scan', hapticScan.toString()); }, [hapticScan]);
  useEffect(() => { localStorage.setItem('docscanner_haptic_export', hapticExport.toString()); }, [hapticExport]);
  useEffect(() => { localStorage.setItem('docscanner_haptic_delete', hapticDelete.toString()); }, [hapticDelete]);
  
  // Tab navigation states
  const [fullScreenImage, setFullScreenImage] = useState<string | null>(null);
  const [fullScreenScale, setFullScreenScale] = useState<number>(1);
  const [currentTab, setCurrentTab] = useState<'home' | 'notes' | 'profile' | 'settings'>('home');
  const [showScanMenu, setShowScanMenu] = useState(false);
  const [totalBatchFiles, setTotalBatchFiles] = useState(0);
  const [processedBatchFiles, setProcessedBatchFiles] = useState(0);

  // Active folder filter state
  const [activeFolderFilter, setActiveFolderFilter] = useState<string | 'all'>('all');

  // Watermark options state
  const [watermarkEnabled, setWatermarkEnabled] = useState(false);
  const [watermarkText, setWatermarkText] = useState('');
  const [watermarkSize, setWatermarkSize] = useState<number>(30);
  const [watermarkColor, setWatermarkColor] = useState<string>('#CCCCCC');
  const [watermarkOpacity, setWatermarkOpacity] = useState<number>(0.3);
  const [watermarkStyle, setWatermarkStyle] = useState<'single' | 'grid'>('single');
  const [watermarkPosition, setWatermarkPosition] = useState<'center' | 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'>('center');
  const [watermarkRotation, setWatermarkRotation] = useState<number>(0);
  const [watermarkMargin, setWatermarkMargin] = useState<number>(20);
  const [showCustomCamera, setShowCustomCamera] = useState(false);
  const [cameraMode, setCameraMode] = useState<"single"|"batch">("single");


  // Notes state
  const [noteSearchQuery, setNoteSearchQuery] = useState('');
  const [notes, setNotes] = useState<{ id: string; title: string; content: string; createdAt: number; colorIndex: number }[]>(() => {
    try {
      const stored = localStorage.getItem('docscanner_quick_notes');
      return stored ? JSON.parse(stored) : [

        { id: '1', title: 'Receipt Scan To-Do', content: 'Remember to group receipt scans by month. Put restaurant receipts in the "Expenses" folder.', createdAt: Date.now() - 3600000 * 2, colorIndex: 0 },
        { id: '2', title: 'Meeting Notes Checklist', content: 'After scanning meeting notes, tap on "Filter" and choose the "Magic" filter. It makes the black pen text pop perfectly on white paper!', createdAt: Date.now() - 3600000 * 12, colorIndex: 1 }
      ];
    } catch {
      return [];
    }
  });

  useEffect(() => {
    localStorage.setItem('docscanner_quick_notes', JSON.stringify(notes));
  }, [notes]);

  const [showAddNoteModal, setShowAddNoteModal] = useState(false);
  const [newNoteTitle, setNewNoteTitle] = useState('');
  const [newNoteContent, setNewNoteContent] = useState('');
  const [newNoteColor, setNewNoteColor] = useState(0);
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);

  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    try {
      const stored = localStorage.getItem('docscanner_theme');
      return (stored as 'light' | 'dark') || 'light';
    } catch {
      return 'light';
    }
  });

  useEffect(() => {
    localStorage.setItem('docscanner_theme', theme);
  }, [theme]);

  // Profile details state with local persistence
  const [profileName, setProfileName] = useState<string>(() => {
    try {
      return localStorage.getItem('docscanner_profile_name') || 'Image PDF Scanner';
    } catch {
      return 'Image PDF Scanner';
    }
  });

  const [profileEmail, setProfileEmail] = useState<string>(() => {
    try {
      return localStorage.getItem('docscanner_profile_email') || 'gr7.gbaroda85@gmail.com';
    } catch {
      return 'gr7.gbaroda85@gmail.com';
    }
  });

  const [profileTier, setProfileTier] = useState<string>(() => {
    try {
      return localStorage.getItem('docscanner_profile_tier') || 'PRO ACTIVE';
    } catch {
      return 'PRO ACTIVE';
    }
  });

  const [profileAvatarColor, setProfileAvatarColor] = useState<string>(() => {
    try {
      return localStorage.getItem('docscanner_profile_avatar_color') || 'from-blue-500 to-indigo-600';
    } catch {
      return 'from-blue-500 to-indigo-600';
    }
  });

  useEffect(() => {
    localStorage.setItem('docscanner_profile_name', profileName);
  }, [profileName]);

  useEffect(() => {
    localStorage.setItem('docscanner_profile_email', profileEmail);
  }, [profileEmail]);

  useEffect(() => {
    localStorage.setItem('docscanner_profile_tier', profileTier);
  }, [profileTier]);

  useEffect(() => {
    localStorage.setItem('docscanner_profile_avatar_color', profileAvatarColor);
  }, [profileAvatarColor]);

  const [isEditingProfile, setIsEditingProfile] = useState(false);
  const [editName, setEditName] = useState('');
  const [editEmail, setEditEmail] = useState('');
  const [editTier, setEditTier] = useState('');
  const [editAvatarColor, setEditAvatarColor] = useState('');

  const NOTE_COLORS = theme === 'dark' ? [
    { bg: 'bg-purple-950/20 hover:bg-purple-950/35 border-purple-900/40', text: 'text-purple-200', tag: 'bg-purple-900/30 text-purple-300', activeRing: 'ring-purple-500' },
    { bg: 'bg-blue-950/20 hover:bg-blue-950/35 border-blue-900/40', text: 'text-blue-200', tag: 'bg-blue-900/30 text-blue-300', activeRing: 'ring-blue-500' },
    { bg: 'bg-emerald-950/20 hover:bg-emerald-950/35 border-emerald-900/40', text: 'text-emerald-200', tag: 'bg-emerald-900/30 text-emerald-300', activeRing: 'ring-emerald-500' },
    { bg: 'bg-amber-950/20 hover:bg-amber-950/35 border-amber-900/40', text: 'text-amber-200', tag: 'bg-amber-900/30 text-amber-300', activeRing: 'ring-amber-500' },
    { bg: 'bg-rose-950/20 hover:bg-rose-950/35 border-rose-900/40', text: 'text-rose-200', tag: 'bg-rose-900/30 text-rose-300', activeRing: 'ring-rose-500' },
  ] : [
    { bg: 'bg-purple-50 hover:bg-purple-100/80 border-purple-100', text: 'text-purple-800', tag: 'bg-purple-200/50 text-purple-700', activeRing: 'ring-purple-400' },
    { bg: 'bg-blue-50 hover:bg-blue-100/80 border-blue-100', text: 'text-blue-800', tag: 'bg-blue-200/50 text-blue-700', activeRing: 'ring-blue-400' },
    { bg: 'bg-emerald-50 hover:bg-emerald-100/80 border-emerald-100', text: 'text-emerald-800', tag: 'bg-emerald-200/50 text-emerald-700', activeRing: 'ring-emerald-400' },
    { bg: 'bg-amber-50 hover:bg-amber-100/80 border-amber-100', text: 'text-amber-800', tag: 'bg-amber-200/50 text-amber-700', activeRing: 'ring-amber-400' },
    { bg: 'bg-rose-50 hover:bg-rose-100/80 border-rose-100', text: 'text-rose-800', tag: 'bg-rose-200/50 text-rose-700', activeRing: 'ring-rose-400' },
  ];
  
  // Selection state
  const [isMultiSelect, setIsMultiSelect] = useState(false);
  const [selectedDocs, setSelectedDocs] = useState<Set<string>>(new Set());
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const fileInputGalleryRef = useRef<HTMLInputElement>(null);
  const fileInputCameraRef = useRef<HTMLInputElement>(null);
  const fileInputGalleryRef2 = useRef<HTMLInputElement>(null);
  const fileInputCameraRef2 = useRef<HTMLInputElement>(null);
  const restoreInputRef = useRef<HTMLInputElement>(null);

  const [isProcessingBatch, setIsProcessingBatch] = useState(false);
  const [isProcessingStep, setIsProcessingStep] = useState(false);
  const [addPdfBorder, setAddPdfBorder] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [tempTitle, setTempTitle] = useState('');
  const [editingPageId, setEditingPageId] = useState<string | null>(null);
  const [draggedPageIndex, setDraggedPageIndex] = useState<number | null>(null);
  const [dragEnabled, setDragEnabled] = useState(false);
  
  // Menu and Modals State
  const [activeMenuDocId, setActiveMenuDocId] = useState<string | null>(null);
  const [showPinModalFor, setShowPinModalFor] = useState<string | null>(null);
  const [showLockSetupFor, setShowLockSetupFor] = useState<string | null>(null);
  const [showFolderSelectFor, setShowFolderSelectFor] = useState<string | null>(null);
  const [showMultiFolderSelect, setShowMultiFolderSelect] = useState<boolean>(false);
  const [showApkHelp, setShowApkHelp] = useState<boolean>(false);
  const [showExportModalFor, setShowExportModalFor] = useState<string | null>(null);
  const [exportPassword, setExportPassword] = useState('');
  const [exportQuality, setExportQuality] = useState<number>(1);
  const [exportFormat, setExportFormat] = useState<'pdf' | 'images' | 'zip'>('pdf');
  const [tempPin, setTempPin] = useState('');
  const [activeActionDocId, setActiveActionDocId] = useState<string | null>(null);
  const [pdfExportProgress, setPdfExportProgress] = useState<{current: number, total: number} | null>(null);
  
  // Animated Splash Screen state
  const [showSplash, setShowSplash] = useState(true);

  useEffect(() => {
    const timer = setTimeout(() => {
      setShowSplash(false);
    }, 2800);
    return () => clearTimeout(timer);
  }, []);
  
  // Custom non-blocking Confirm & Prompt States
  const [confirmState, setConfirmState] = useState<{
    message: string;
    resolve: (val: boolean) => void;
  } | null>(null);

  const [promptState, setPromptState] = useState<{
    title: string;
    placeholder: string;
    defaultValue?: string;
    resolve: (val: string | null) => void;
  } | null>(null);

  const [alertState, setAlertState] = useState<{
    message: string;
    resolve: () => void;
  } | null>(null);

  // Back button handling on Android/Native
  const backStateRef = useRef({
    confirmState,
    promptState,
    alertState,
    showCustomCamera,
    showExportModalFor,
    activeMenuDocId,
    showFolderSelectFor,
    showMultiFolderSelect,
    showPinModalFor,
    showLockSetupFor,
    showAddNoteModal,
    editingNoteId,
    fullScreenImage,
    isMultiSelect,
    appState,
    currentTab,
    currentDoc,
    isEditingProfile,
  });

  useEffect(() => {
    backStateRef.current = {
      confirmState,
      promptState,
      alertState,
      showCustomCamera,
      showExportModalFor,
      activeMenuDocId,
      showFolderSelectFor,
      showMultiFolderSelect,
      showPinModalFor,
      showLockSetupFor,
      showAddNoteModal,
      editingNoteId,
      fullScreenImage,
      isMultiSelect,
      appState,
      currentTab,
      currentDoc,
      isEditingProfile,
    };
  });

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;

    const handleBackButton = async () => {
      const s = backStateRef.current;

      // 1. Custom Alerts, Prompts, Confirms
      if (s.alertState) {
        s.alertState.resolve();
        setAlertState(null);
        return;
      }
      if (s.confirmState) {
        s.confirmState.resolve(false);
        setConfirmState(null);
        return;
      }
      if (s.promptState) {
        s.promptState.resolve(null);
        setPromptState(null);
        return;
      }

      // 2. Full screen image
      if (s.fullScreenImage) {
        setFullScreenImage(null);
        return;
      }

      // 3. Modals and overlays
      if (s.showExportModalFor) {
        setShowExportModalFor(null);
        return;
      }
      if (s.showFolderSelectFor) {
        setShowFolderSelectFor(null);
        return;
      }
      if (s.showMultiFolderSelect) {
        setShowMultiFolderSelect(false);
        return;
      }
      if (s.showPinModalFor) {
        setShowPinModalFor(null);
        return;
      }
      if (s.showLockSetupFor) {
        setShowLockSetupFor(null);
        return;
      }
      if (s.activeMenuDocId) {
        setActiveMenuDocId(null);
        return;
      }
      if (s.showAddNoteModal) {
        setShowAddNoteModal(false);
        return;
      }
      if (s.editingNoteId) {
        setEditingNoteId(null);
        return;
      }
      if (s.isEditingProfile) {
        setIsEditingProfile(false);
        return;
      }

      // 4. Custom Camera UI
      if (s.showCustomCamera) {
        setShowCustomCamera(false);
        return;
      }

      // 5. Multi-selection
      if (s.isMultiSelect) {
        setIsMultiSelect(false);
        setSelectedDocs(new Set());
        return;
      }

      // 6. Sub-screens / Sub-states
      if (s.appState === 'crop' || s.appState === 'filter') {
        setAppState('view_doc');
        return;
      }
      if (s.appState === 'view_doc') {
        setCurrentDoc(null);
        setAppState('home');
        return;
      }

      // 7. Navigation Tabs
      if (s.currentTab !== 'home') {
        setCurrentTab('home');
        return;
      }

      // 8. If nothing is open and we are on home view, exit the app
      if (s.confirmState) return;
      
      setConfirmState({
        message: "Are you sure you want to exit?",
        resolve: (confirmed: boolean) => {
          if (confirmed) {
            CapApp.exitApp();
          }
        }
      });
    };

    const backListener = CapApp.addListener('backButton', handleBackButton);

    return () => {
      backListener.then(l => l.remove());
    };
  }, []);

  const showCustomConfirm = (message: string): Promise<boolean> => {
    return new Promise((resolve) => {
      setConfirmState({ message, resolve });
    });
  };

  const showCustomPrompt = (title: string, placeholder: string = "Enter text...", defaultValue: string = ""): Promise<string | null> => {
    return new Promise((resolve) => {
      setPromptState({ title, placeholder, defaultValue, resolve });
    });
  };

  const showCustomAlert = (message: string): Promise<void> => {
    return new Promise((resolve) => {
      setAlertState({ message, resolve });
    });
  };

  const renderCustomDialogs = () => {
    return (
      <>
        {confirmState && (
          <div className="fixed inset-0 bg-black/60 z-[120] flex items-center justify-center p-4 backdrop-blur-xs">
            <div className={`w-full max-w-sm rounded-2xl p-6 shadow-2xl ${theme === 'dark' ? 'bg-slate-900 text-white border border-slate-800' : 'bg-white text-gray-900'}`}>
              <h3 className="font-bold text-lg mb-2">Confirm</h3>
              <p className={`text-sm mb-6 ${theme === 'dark' ? 'text-slate-300' : 'text-gray-600'}`}>{confirmState.message}</p>
              <div className="flex justify-end space-x-3">
                <button
                  onClick={() => {
                    confirmState.resolve(false);
                    setConfirmState(null);
                  }}
                  className={`px-4 py-2 rounded-xl text-sm font-medium transition-colors ${theme === 'dark' ? 'text-slate-300 hover:bg-slate-800' : 'text-gray-600 hover:bg-gray-100'}`}
                >
                  Cancel
                </button>
                <button
                  onClick={() => {
                    confirmState.resolve(true);
                    setConfirmState(null);
                  }}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-sm font-medium transition-colors"
                >
                  Confirm
                </button>
              </div>
            </div>
          </div>
        )}

        {promptState && (
          <PromptModal promptState={promptState} setPromptState={setPromptState} theme={theme} />
        )}

        {alertState && (
          <div className="fixed inset-0 bg-black/60 z-[120] flex items-center justify-center p-4 backdrop-blur-xs">
            <div className={`w-full max-w-sm rounded-2xl p-6 shadow-2xl ${theme === 'dark' ? 'bg-slate-900 text-white border border-slate-800' : 'bg-white text-gray-900'}`}>
              <h3 className="font-bold text-lg mb-2">Notice</h3>
              <p className={`text-sm mb-6 ${theme === 'dark' ? 'text-slate-300' : 'text-gray-600'}`}>{alertState.message}</p>
              <div className="flex justify-end">
                <button
                  onClick={() => {
                    alertState.resolve();
                    setAlertState(null);
                  }}
                  className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-sm font-medium transition-colors shadow-md"
                >
                  OK
                </button>
              </div>
            </div>
          </div>
        )}

        <AnimatePresence>
          {activeMenuDocId && (() => {
            const doc = documents.find(d => d.id === activeMenuDocId);
            if (!doc) return null;
            return (
              <div className="fixed inset-0 z-[110] flex items-end sm:items-center sm:justify-center p-0 sm:p-4">
                {/* Backdrop */}
                <motion.div 
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  onClick={() => setActiveMenuDocId(null)}
                  className="absolute inset-0 bg-black/60 backdrop-blur-xs"
                />
                
                {/* Menu Sheet */}
                <motion.div 
                  initial={{ y: "100%", opacity: 0.9 }}
                  animate={{ y: 0, opacity: 1 }}
                  exit={{ y: "100%", opacity: 0.9 }}
                  transition={{ type: "spring", damping: 28, stiffness: 380 }}
                  className={`relative w-full sm:max-w-sm rounded-t-3xl sm:rounded-2xl shadow-2xl border z-50 overflow-hidden ${theme === 'dark' ? 'bg-slate-900 border-slate-800 text-slate-100' : 'bg-white border-gray-100 text-gray-800'}`}
                >
                  <div className="p-4 border-b dark:border-slate-800 flex justify-between items-center sm:hidden">
                    <span className="font-semibold text-sm truncate max-w-[200px]">{doc.title}</span>
                    <button onClick={() => setActiveMenuDocId(null)} className="text-gray-400 hover:text-gray-600">
                      <X className="w-5 h-5" />
                    </button>
                  </div>
                  <div className="py-2.5 sm:py-3 space-y-0.5">
                    {/* Header on desktop */}
                    <div className="hidden sm:block px-5 py-2 border-b border-gray-100 dark:border-slate-800 mb-2">
                      <p className="font-semibold text-xs text-gray-400 dark:text-slate-500 uppercase tracking-wider">Document Options</p>
                      <p className="font-medium text-sm text-gray-900 dark:text-slate-200 truncate mt-0.5">{doc.title}</p>
                    </div>

                    <button 
                      onClick={(e) => { 
                        e.stopPropagation(); 
                        setActiveActionDocId(doc.id); 
                        setTempTitle(doc.title); 
                        setActiveMenuDocId(null);
                      }} 
                      className={`w-full text-left px-5 py-3 text-sm font-medium flex items-center transition-colors ${theme === 'dark' ? 'hover:bg-slate-800 text-slate-200' : 'hover:bg-gray-50 text-gray-700'}`}
                    >
                      <Pencil className="w-4 h-4 mr-3 text-gray-400" /> Rename
                    </button>

                    {doc.isLocked ? (
                      <button 
                        onClick={(e) => { 
                          e.stopPropagation(); 
                          handleRemoveLock(doc); 
                          setActiveMenuDocId(null);
                        }} 
                        className={`w-full text-left px-5 py-3 text-sm font-medium flex items-center transition-colors ${theme === 'dark' ? 'hover:bg-slate-800 text-slate-200' : 'hover:bg-gray-50 text-gray-700'}`}
                      >
                        <Unlock className="w-4 h-4 mr-3 text-gray-400" /> Remove PIN
                      </button>
                    ) : (
                      <button 
                        onClick={(e) => { 
                          e.stopPropagation(); 
                          setShowLockSetupFor(doc.id); 
                          setActiveMenuDocId(null);
                        }} 
                        className={`w-full text-left px-5 py-3 text-sm font-medium flex items-center transition-colors ${theme === 'dark' ? 'hover:bg-slate-800 text-slate-200' : 'hover:bg-gray-50 text-gray-700'}`}
                      >
                        <Lock className="w-4 h-4 mr-3 text-gray-400" /> Lock with PIN
                      </button>
                    )}

                    <button 
                      onClick={(e) => { 
                        e.stopPropagation(); 
                        setShowExportModalFor(doc.id); 
                        setActiveMenuDocId(null); 
                      }} 
                      className={`w-full text-left px-5 py-3 text-sm font-medium flex items-center transition-colors ${theme === 'dark' ? 'hover:bg-slate-800 text-slate-200' : 'hover:bg-gray-50 text-gray-700'}`}
                    >
                      <Share2 className="w-4 h-4 mr-3 text-gray-400" /> Export & Share
                    </button>

                    {doc.isTrash ? (
                      <button 
                        onClick={(e) => { 
                          e.stopPropagation(); 
                          handleRestoreDoc(doc.id); 
                          setActiveMenuDocId(null);
                        }} 
                        className={`w-full text-left px-5 py-3 text-sm font-medium flex items-center transition-colors ${theme === 'dark' ? 'hover:bg-slate-800 text-blue-400' : 'hover:bg-blue-50 text-blue-600'}`}
                      >
                        <Undo className="w-4 h-4 mr-3" /> Restore from Trash
                      </button>
                    ) : (
                      <button 
                        onClick={(e) => { 
                          e.stopPropagation(); 
                          setShowFolderSelectFor(doc.id); 
                          setActiveMenuDocId(null);
                        }} 
                        className={`w-full text-left px-5 py-3 text-sm font-medium flex items-center transition-colors ${theme === 'dark' ? 'hover:bg-slate-800 text-slate-200' : 'hover:bg-gray-50 text-gray-700'}`}
                      >
                        <FolderOpen className="w-4 h-4 mr-3 text-gray-400" /> Move to Folder
                      </button>
                    )}

                    <div className={`my-1 border-t ${theme === 'dark' ? 'border-slate-800' : 'border-gray-100'}`} />

                    <button 
                      onClick={(e) => { 
                        e.stopPropagation(); 
                        handleDeleteDoc(doc.id);
                        setActiveMenuDocId(null); 
                      }} 
                      className={`w-full text-left px-5 py-3 text-sm font-medium flex items-center text-red-600 transition-colors ${theme === 'dark' ? 'hover:bg-red-950/30' : 'hover:bg-red-50'}`}
                    >
                      <Trash2 className="w-4 h-4 mr-3 text-red-500" /> {doc.isTrash ? 'Delete Permanently' : 'Move to Trash'}
                    </button>
                  </div>
                </motion.div>
              </div>
            );
          })()}
        </AnimatePresence>
      </>
    );
  };
  
  // Close menu on outside click
  useEffect(() => {
    const handleClickOutside = () => setActiveMenuDocId(null);
    document.addEventListener('click', handleClickOutside);
    return () => document.removeEventListener('click', handleClickOutside);
  }, []);

  const filteredDocs = useMemo(() => {
    const isTrashMode = activeFolderFilter === 'trash';
    const baseDocs = documents.filter(d => {
      if (isTrashMode) return !!d.isTrash;
      if (d.isTrash) return false;
      
      if (activeFolderFilter === 'all') return true;
      if (activeFolderFilter === 'root' || activeFolderFilter === 'uncategorized') return !d.folderId;
      return d.folderId === activeFolderFilter;
    });
    
    if (!searchQuery.trim()) return baseDocs;
    const q = searchQuery.toLowerCase().trim();
    return baseDocs.filter(d => d.title.toLowerCase().includes(q));
  }, [documents, searchQuery, activeFolderFilter]);

  useEffect(() => {
    getDocuments().then(setDocuments);
    getFolders().then(setFolders);
  }, []);

  const handleCapture = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []) as File[];
    handleFilesSelected(files);
    e.target.value = "";
  };
  const handleFilesSelected = async (files: File[]) => {
    if (files.length === 0) return;
    
    setTotalBatchFiles(files.length);
    setProcessedBatchFiles(0);
    setIsProcessingBatch(true);
    
    // Helper to process a single file: read, downscale, load, and detect corners
    const processFile = async (file: File): Promise<QueueItem | null> => {
      let objectUrl: string | null = null;
      try {
        objectUrl = URL.createObjectURL(file);

        if (!objectUrl) {
          setProcessedBatchFiles(prev => Math.min(prev + 1, files.length));
          return null;
        }

        // Downscale to 2400 max dimension
        let finalUrl = '';
        try {
           finalUrl = await downscaleImage(objectUrl, 2400);
        } catch (e) {
           // Fallback to Data URL if downscale fails so we don't return a revoked Object URL
           finalUrl = await new Promise<string>((resolve) => {
             const reader = new FileReader();
             reader.onload = (e) => resolve((e.target?.result as string) || '');
             reader.readAsDataURL(file);
           });
        }

        // Load image to run corner detection
        const img = await loadImage(finalUrl);
        let corners: Point[] | null = null;
        
        // Check if the file has relative corners pre-attached from real-time CameraView detection
        if ((file as any).relativeCorners && Array.isArray((file as any).relativeCorners) && (file as any).relativeCorners.length === 4) {
          corners = (file as any).relativeCorners.map((pt: Point) => ({
            x: pt.x * img.width,
            y: pt.y * img.height
          }));
        } else {
          corners = detectDocumentCorners(img);
        }
        
        // If detection fails, provide default corners (10% margin) so the page is still processed
        if (!corners) {
          const marginW = img.width * 0.1;
          const marginH = img.height * 0.1;
          corners = [
            { x: marginW, y: marginH },
            { x: img.width - marginW, y: marginH },
            { x: img.width - marginW, y: img.height - marginH },
            { x: marginW, y: img.height - marginH }
          ];
        }

        if (objectUrl) URL.revokeObjectURL(objectUrl);

        setProcessedBatchFiles(prev => Math.min(prev + 1, files.length));
        return {
          url: finalUrl,
          corners: corners
        };
      } catch (err) {
        console.error("Error processing file in queue:", err);
        if (objectUrl) URL.revokeObjectURL(objectUrl);
        setProcessedBatchFiles(prev => Math.min(prev + 1, files.length));
        return null;
      }
    };

    // Process files sequentially to prevent main-thread congestion and memory spikes
    const runInQueue = async (files: File[], limit: number): Promise<QueueItem[]> => {
      const results = new Array<QueueItem | null>(files.length).fill(null);
      let index = 0;

      const worker = async () => {
        while (index < files.length) {
          const currentIndex = index++;
          const file = files[currentIndex];
          const res = await processFile(file);
          results[currentIndex] = res;
          // Small breathing room for GC
          await new Promise(r => setTimeout(r, 100));
        }
      };

      const workers = Array(Math.min(limit, files.length)).fill(null).map(worker);
      await Promise.all(workers);
      return results.filter((item): item is QueueItem => item !== null);
    };

    try {
      const results = await runInQueue(files, 1);
      if (results.length > 0) {
        setCapturedImage(results[0].url);
        setCurrentCorners(results[0].corners || undefined);
        setProcessingQueue(results.slice(1));
        setAppState('crop');
      } else {
        alert("Could not process the image. Please try again or use a different photo.");
      }
    } catch (err) {
      console.error("Error processing captured batch:", err);
      alert("Error processing the image.");
    } finally {
      setIsProcessingBatch(false);
    }
  };

  const handleCropNext = async (corners: Point[]) => {
    try {
      if (!capturedImage) return;
      setIsProcessingStep(true);
      setCurrentCorners(corners);
      const warped = await warpPerspective(capturedImage, corners);
      setCroppedImage(warped);
      setAppState('filter');
    } catch (err: any) {
      console.error(err);
      setErrorMessage("Error in crop: " + (err.message || err));
    } finally {
      setIsProcessingStep(false);
    }
  };

  const handleFilterSave = async (filtered: string, filter: FilterType) => {
    if (!capturedImage || !croppedImage || !currentCorners) return;
    
    setIsProcessingStep(true);
    setErrorMessage(null);
    
    try {
      const newPage: DocumentPage = {
        id: editingPageId || Date.now().toString(),
        originalImage: capturedImage,
        croppedImage: croppedImage,
        filteredImage: filtered,
        filter: filter,
        corners: currentCorners
      };
      
      let docToUpdate = currentDoc;
      let isNewDoc = false;
      if (!docToUpdate) {
        isNewDoc = true;
        docToUpdate = {
          id: Date.now().toString(),
          title: `Scan ${new Date().toLocaleDateString()}`,
          createdAt: Date.now(),
          pages: [],
          folderId: (activeFolderFilter !== 'all' && activeFolderFilter !== 'trash' && activeFolderFilter !== 'root' && activeFolderFilter !== 'uncategorized') ? activeFolderFilter : undefined
        };
      }
      
      const updatedDoc = {
        ...docToUpdate,
        pages: editingPageId 
          ? docToUpdate.pages.map(p => p.id === editingPageId ? newPage : p)
          : [...docToUpdate.pages, newPage]
      };
      
      // Save to database
      await saveDocument(updatedDoc);
      triggerHapticSuccess();
      
      // Refresh documents from store to ensure consistency
      const freshDocs = await getDocuments();
      setDocuments(freshDocs);
      
      const oldUrl = capturedImage;
      setEditingPageId(null);
      setCurrentDoc(updatedDoc);
      
      if (processingQueue.length > 0) {
         const nextItem = processingQueue[0];
         
         // Set loading state or clear current images to prevent flickering old data
         setCapturedImage(null);
         setCroppedImage(null);
         setAppState('batch_progress'); // Show a small transition or just clear
         
         setTimeout(() => {
           setCapturedImage(nextItem.url);
           setProcessingQueue(processingQueue.slice(1));
           setCurrentCorners(nextItem.corners || undefined);
           setAppState('crop');
         }, 400);
      } else {
         setCapturedImage(null);
         setCroppedImage(null);
         setCurrentCorners(undefined);
         setAppState('view_doc');
      }

      // Delay revocation to ensure UI has switched away from the old image
      if (oldUrl && oldUrl.startsWith('blob:')) {
         setTimeout(() => {
           try { URL.revokeObjectURL(oldUrl); } catch(e) {}
         }, 2000);
      }
    } catch (err: any) {
      console.error("Save error:", err);
      setErrorMessage("Could not save the document. Storage might be full or inaccessible.");
      // Don't change appState, let the user try again
    } finally {
      setIsProcessingStep(false);
    }
  };

  const downloadFile = async (blob: Blob, filename: string) => {
    if (Capacitor.isNativePlatform()) {
      try {
        const base64Data = await blobToBase64(blob);
        const savedFile = await Filesystem.writeFile({
          path: filename,
          data: base64Data,
          directory: Directory.Documents,
        });
        
        showCustomAlert(`File saved to Documents: ${filename}`);
        
        // Optionally offer to share it immediately since Android users expect that
        await Share.share({
          title: filename,
          url: savedFile.uri,
        });
      } catch (err) {
        console.error("Native save failed", err);
        showCustomAlert("Failed to save file natively.");
      }
      return;
    }

    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    
    // Crucial for some mobile browsers/webviews to handle blobs correctly
    const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
    if (isMobile) {
      a.target = '_blank';
    }
    
    document.body.appendChild(a);
    a.click();
    
    setTimeout(() => {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 2000);
  };

  const handleSaveAsPDF = async (doc: Document) => {
    try {
      const blob = await generatePDF(doc, { 
        drawBorder: addPdfBorder,
        onProgress: (current, total) => setPdfExportProgress({ current, total })
      });
      await downloadFile(blob, `${doc.title}.pdf`);
    } catch (e) {
      console.error("Failed to generate PDF", e);
      setErrorMessage("Could not generate PDF. Please try again.");
    } finally {
      setPdfExportProgress(null);
    }
  };

  const handleSharePDF = async (doc: Document) => {
    try {
      const blob = await generatePDF(doc, { 
        drawBorder: addPdfBorder,
        onProgress: (current, total) => setPdfExportProgress({ current, total })
      });
      
      if (Capacitor.isNativePlatform()) {
        const base64Data = await blobToBase64(blob);
        const filename = `${doc.title.replace(/[^a-z0-9]/gi, '_')}.pdf`;
        const savedFile = await Filesystem.writeFile({
          path: filename,
          data: base64Data,
          directory: Directory.Cache, // Use Cache for temporary sharing
        });
        
        await Share.share({
          title: doc.title,
          url: savedFile.uri,
        });
        return;
      }

      const file = new File([blob], `${doc.title}.pdf`, { type: 'application/pdf' });
      if (!isAndroidWebView() && navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({
          files: [file],
          title: doc.title,
        });
      } else {
        // Fallback to download if sharing is not supported
        handleSaveAsPDF(doc);
      }
    } catch (e: any) {
      if (e.name !== 'AbortError') {
        console.error("Failed to share PDF", e);
      }
    } finally {
      setPdfExportProgress(null);
    }
  };

  const handleRestoreDoc = async (id: string) => {
    const doc = documents.find(d => d.id === id);
    if (!doc) return;

    try {
      if (doc.originalDocId) {
        const originalDoc = documents.find(d => d.id === doc.originalDocId);
        if (originalDoc) {
          // Merge back into original document
          const updatedPages = [...originalDoc.pages];
          const pageIndex = typeof doc.originalPageIndex === 'number' ? doc.originalPageIndex : updatedPages.length;
          
          // Clamp index to array bounds in case pages were deleted
          const safeIndex = Math.min(Math.max(0, pageIndex), updatedPages.length);
          updatedPages.splice(safeIndex, 0, doc.pages[0]);
          
          const updatedOriginalDoc = { ...originalDoc, pages: updatedPages };
          
          await saveDocument(updatedOriginalDoc);
          await deleteDocument(id); // Remove the temporary trashed doc
          
          const freshDocs = await getDocuments();
          setDocuments(freshDocs);
          setCurrentDoc(updatedOriginalDoc);
          return;
        }
      }

      const updatedDoc = { ...doc, isTrash: false, originalDocId: undefined, originalPageIndex: undefined };
      await saveDocument(updatedDoc);
      
      const freshDocs = await getDocuments();
      setDocuments(freshDocs);
      setCurrentDoc(updatedDoc);
    } catch (err) {
      console.error("Restore error:", err);
      setErrorMessage("Failed to restore document.");
    }
  };

  const handleDeleteDoc = async (id: string) => {
    const doc = documents.find(d => d.id === id);
    if (!doc) return;

    try {
      if (doc.isTrash) {
        const confirmDelete = await showCustomConfirm(`Are you sure you want to permanently delete "${doc.title}"? This action cannot be undone.`);
        if (!confirmDelete) return;
        triggerHapticMedium();
        await deleteDocument(id);
        setDocuments(prev => prev.filter(d => d.id !== id));
      } else {
        const confirmTrash = await showCustomConfirm(`Move "${doc.title}" to Trash?`);
        if (!confirmTrash) return;
        triggerHapticMedium();
        const updatedDoc = { ...doc, isTrash: true };
        await saveDocument(updatedDoc);
        setDocuments(prev => prev.map(d => d.id === id ? updatedDoc : d));
      }
      
      setAppState('home');
      setCurrentDoc(null);
    } catch (err) {
      console.error("Delete/Trash error:", err);
      setErrorMessage("Operation failed. Storage might be full.");
    }
  };

  const handleDeletePage = async (doc: Document, pageIndex: number) => {
    if (doc.pages.length === 1) {
      const confirmDelete = await showCustomConfirm("This document only has one page. Deleting this page will move the entire document to the Trash. Do you want to proceed?");
      if (confirmDelete) {
        await handleDeleteDoc(doc.id);
      }
      return;
    }

    const confirmDeletePage = await showCustomConfirm(`Are you sure you want to move Page ${pageIndex + 1} to the Trash?`);
    if (confirmDeletePage) {
      triggerHapticMedium();
      const pageToDelete = doc.pages[pageIndex];
      const updatedPages = [...doc.pages];
      updatedPages.splice(pageIndex, 1);
      const updatedDoc = { ...doc, pages: updatedPages };
      
      const trashedDoc: Document = {
        id: crypto.randomUUID(),
        title: `${doc.title} - Page ${pageIndex + 1}`,
        createdAt: Date.now(),
        pages: [pageToDelete],
        isTrash: true,
        originalDocId: doc.id,
        originalPageIndex: pageIndex
      };

      try {
        await saveDocument(trashedDoc);
        await saveDocument(updatedDoc);
        setDocuments(prev => [trashedDoc, ...prev.map(d => d.id === updatedDoc.id ? updatedDoc : d)]);
        if (currentDoc?.id === updatedDoc.id) {
          setCurrentDoc(updatedDoc);
        }
      } catch (err) {
        console.error("Delete page error:", err);
        setErrorMessage("Failed to delete page. Storage issue.");
      }
    }
  };

  const handleRenameSave = async () => {
    if (!currentDoc || !tempTitle.trim()) return;
    
    setIsProcessingStep(true);
    try {
      const updatedDoc = {
        ...currentDoc,
        title: tempTitle.trim()
      };
      
      await saveDocument(updatedDoc);
      setCurrentDoc(updatedDoc);
      setDocuments(prev => prev.map(d => d.id === updatedDoc.id ? updatedDoc : d));
      setIsEditingTitle(false);
    } catch (err: any) {
      console.error("Rename error:", err);
      setErrorMessage("Failed to rename document. Storage might be full.");
    } finally {
      setIsProcessingStep(false);
    }
  };

  const handleReorderPages = async (fromIdx: number, toIdx: number) => {
    if (!currentDoc) return;
    const pages = [...currentDoc.pages];
    const [movedPage] = pages.splice(fromIdx, 1);
    pages.splice(toIdx, 0, movedPage);
    
    const updatedDoc = {
      ...currentDoc,
      pages
    };
    
    try {
      await saveDocument(updatedDoc);
      setDocuments(prev => prev.map(d => d.id === updatedDoc.id ? updatedDoc : d));
      setCurrentDoc(updatedDoc);
    } catch (err) {
      console.error("Reorder error:", err);
      setErrorMessage("Failed to reorder pages. Storage issue.");
    }
  };

  const handleMovePage = (idx: number, direction: 'up' | 'down') => {
    const targetIdx = direction === 'up' ? idx - 1 : idx + 1;
    if (targetIdx < 0 || targetIdx >= (currentDoc?.pages.length || 0)) return;
    handleReorderPages(idx, targetIdx);
  };

  const toggleSelection = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const next = new Set(selectedDocs);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedDocs(next);
  };

  const handleDownloadZip = async (doc: Document, watermarkConfig?: WatermarkOptions) => {
    try {
      const zip = new JSZip();
      for (let i = 0; i < doc.pages.length; i++) {
        const page = doc.pages[i];
        let src = page.filteredImage;
        if (watermarkConfig) {
          src = await addWatermarkToImage(src, watermarkConfig);
        }
        const res = await fetch(src);
        const blob = await res.blob();
        zip.file(`${doc.title}_Page_${i + 1}.jpg`, blob);
      }
      const zipBlob = await zip.generateAsync({ type: 'blob' });
      downloadFile(zipBlob, `${doc.title}.zip`);
    } catch (e) {
      console.error("Error creating ZIP", e);
    }
    setActiveMenuDocId(null);
  };

  const handleDownloadImages = async (doc: Document, watermarkConfig?: WatermarkOptions) => {
    try {
      for (let i = 0; i < doc.pages.length; i++) {
        const page = doc.pages[i];
        let src = page.filteredImage;
        if (watermarkConfig) {
          src = await addWatermarkToImage(src, watermarkConfig);
        }
        const res = await fetch(src);
        const blob = await res.blob();
        downloadFile(blob, `${doc.title}_Page_${i + 1}.jpg`);
        await new Promise(r => setTimeout(r, 200));
      }
    } catch (e) {
      console.error("Error downloading images", e);
    }
    setActiveMenuDocId(null);
  };

  const shareFiles = async (files: File[], title: string, text?: string) => {
    if (Capacitor.isNativePlatform()) {
      try {
        const uris: string[] = [];
        for (const file of files) {
          const base64Data = await blobToBase64(file);
          const savedFile = await Filesystem.writeFile({
            path: file.name,
            data: base64Data,
            directory: Directory.Cache,
          });
          uris.push(savedFile.uri);
        }
        await Share.share({
          title,
          text,
          files: uris,
        });
        return true;
      } catch (err) {
        console.error("Native share failed", err);
        return false;
      }
    }

    if (navigator.share && navigator.canShare && navigator.canShare({ files })) {
      try {
        await navigator.share({
          files,
          title,
          text,
        });
        return true;
      } catch (err) {
        console.warn("Navigator share failed", err);
      }
    }
    return false;
  };

  const executeExport = async (action: 'save' | 'share' | 'email') => {
    const doc = documents.find(d => d.id === showExportModalFor);
    if (!doc) return;

    const watermarkConfig: WatermarkOptions | undefined = watermarkEnabled && watermarkText.trim() ? {
      text: watermarkText,
      size: watermarkSize,
      color: watermarkColor,
      opacity: watermarkOpacity,
      style: watermarkStyle,
      position: watermarkPosition,
      rotation: watermarkRotation,
      margin: watermarkMargin,
    } : undefined;

    if (exportFormat === 'pdf') {
      try {
        const blob = await generatePDF(doc, { 
          drawBorder: addPdfBorder, 
          quality: exportQuality, 
          password: exportPassword || undefined,
          watermark: watermarkConfig,
          onProgress: (current, total) => setPdfExportProgress({ current, total })
        });
        
        const filename = `${doc.title.replace(/[^a-z0-9]/gi, '_')}.pdf`;
        const file = new File([blob], filename, { type: 'application/pdf' });
        
        if (action === 'save') {
          await downloadFile(blob, filename);
        } else if (action === 'email' || action === 'share') {
          const success = await shareFiles([file], doc.title, action === 'email' ? `Please find attached the scanned PDF document "${doc.title}".` : undefined);
          
          if (success) {
            setAppState('home');
            setShowExportModalFor(null);
          } else {
            // Fallback for sharing
            if (action === 'email') {
              const subject = encodeURIComponent(`Scanned Document: ${doc.title}`);
              const body = encodeURIComponent(`I have scanned a document for you: "${doc.title}".\n\nNote: The PDF has been downloaded to my device because standard email links don't support attachments directly. I am attaching it manually now.\n\nSent from Mobile PDF Scanner & Creator.`);
              window.location.href = `mailto:?subject=${subject}&body=${body}`;
              await downloadFile(blob, filename);
              showCustomAlert("Email opened. PDF saved to Downloads—please attach it manually.");
            } else {
              await downloadFile(blob, filename);
              await showCustomAlert("Sharing failed. PDF saved to device—please share it manually.");
            }
          }
        }
      } catch (e) {
        console.error("Export failed", e);
      } finally {
        setPdfExportProgress(null);
      }
    } else if (exportFormat === 'images') {
      if (action === 'save') {
        await handleDownloadImages(doc, watermarkConfig);
      } else if (action === 'email' || action === 'share') {
        try {
          const files = await Promise.all(doc.pages.map(async (page, i) => {
            let src = page.filteredImage;
            if (watermarkConfig) {
              src = await addWatermarkToImage(src, watermarkConfig);
            }
            const res = await fetch(src);
            const blob = await res.blob();
            return new File([blob], `${doc.title.replace(/[^a-z0-9]/gi, '_')}_Page_${i + 1}.jpg`, { type: 'image/jpeg' });
          }));

          const success = await shareFiles(files, doc.title, action === 'email' ? `Please find attached the images from scanned document "${doc.title}".` : undefined);
          
          if (!success) {
            if (action === 'email') {
              const subject = encodeURIComponent(`Scanned Images: ${doc.title}`);
              const body = encodeURIComponent(`Please find attached the images from scanned document "${doc.title}".\n\nSent from Mobile PDF Scanner & Creator.`);
              window.location.href = `mailto:?subject=${subject}&body=${body}`;
              await handleDownloadImages(doc, watermarkConfig);
            } else {
              await handleDownloadImages(doc, watermarkConfig);
              await showCustomAlert("Images saved to device. Please select them when sharing.");
            }
          }
        } catch (e) {
          console.error("Failed to share images", e);
        }
      }
    } else if (exportFormat === 'zip') {
      if (action === 'save') {
        await handleDownloadZip(doc, watermarkConfig);
      } else if (action === 'email' || action === 'share') {
        try {
          const zip = new JSZip();
          for (let i = 0; i < doc.pages.length; i++) {
            const page = doc.pages[i];
            let src = page.filteredImage;
            if (watermarkConfig) {
              src = await addWatermarkToImage(src, watermarkConfig);
            }
            const res = await fetch(src);
            const blob = await res.blob();
            zip.file(`${doc.title.replace(/[^a-z0-9]/gi, '_')}_Page_${i + 1}.jpg`, blob);
          }
          const zipBlob = await zip.generateAsync({ type: 'blob' });
          const filename = `${doc.title.replace(/[^a-z0-9]/gi, '_')}.zip`;
          const file = new File([zipBlob], filename, { type: 'application/zip' });
          
          const success = await shareFiles([file], doc.title, action === 'email' ? `Please find attached the ZIP archive containing scanned images of "${doc.title}".` : undefined);
          
          if (!success) {
            if (action === 'email') {
              const subject = encodeURIComponent(`ZIP Archive: ${doc.title}`);
              const body = encodeURIComponent(`Please find attached the ZIP archive containing scanned images of "${doc.title}".\n\nSent from Mobile PDF Scanner & Creator.`);
              window.location.href = `mailto:?subject=${subject}&body=${body}`;
              await handleDownloadZip(doc, watermarkConfig);
            } else {
              await handleDownloadZip(doc, watermarkConfig);
              await showCustomAlert("ZIP file saved to device. Please select it when sharing.");
            }
          }
        } catch(e) {
          console.error("ZIP share failed", e);
        }
      }
    }
    setShowExportModalFor(null);
  };

  
  const handleRenameDoc = async (doc: Document, newTitle: string) => {
    const updated = { ...doc, title: newTitle };
    await saveDocument(updated);
    const freshDocs = await getDocuments();
    setDocuments(freshDocs);
    setActiveMenuDocId(null);
  };
  
  const handleSetupLock = async (doc: Document, pin: string) => {
    if (pin.length < 4) return;
    const updated = { ...doc, isLocked: true, pin };
    await saveDocument(updated);
    const freshDocs = await getDocuments();
    setDocuments(freshDocs);
    setShowLockSetupFor(null);
    setTempPin('');
    setActiveMenuDocId(null);
  };
  
  const handleRemoveLock = async (doc: Document) => {
    const updated = { ...doc, isLocked: false, pin: undefined };
    await saveDocument(updated);
    const freshDocs = await getDocuments();
    setDocuments(freshDocs);
    setActiveMenuDocId(null);
  };
  
  const suggestFolderForDoc = (doc: Document): string => {
    const textToAnalyze = `${doc.title} ${doc.pages.map(p => p.id).join(' ')}`.toLowerCase();
    
    if (textToAnalyze.includes('receipt') || textToAnalyze.includes('bill') || textToAnalyze.includes('tax') || textToAnalyze.includes('expense')) {
      return 'Receipts';
    }
    if (textToAnalyze.includes('invoice') || textToAnalyze.includes('payment') || textToAnalyze.includes('salary') || textToAnalyze.includes('pay')) {
      return 'Invoices';
    }
    if (textToAnalyze.includes('contract') || textToAnalyze.includes('agreement') || textToAnalyze.includes('legal') || textToAnalyze.includes('lease') || textToAnalyze.includes('terms')) {
      return 'Contracts';
    }
    if (textToAnalyze.includes('note') || textToAnalyze.includes('lecture') || textToAnalyze.includes('class') || textToAnalyze.includes('study')) {
      return 'Notes';
    }
    if (textToAnalyze.includes('book') || textToAnalyze.includes('novel') || textToAnalyze.includes('manual') || textToAnalyze.includes('guide')) {
      return 'Books';
    }
    if (textToAnalyze.includes('id') || textToAnalyze.includes('card') || textToAnalyze.includes('passport') || textToAnalyze.includes('license')) {
      return 'Personal IDs';
    }
    return 'Documents';
  };

  const handleMoveSingleDocToFolder = async (doc: Document, folderId?: string) => {
    const updated = { ...doc, folderId };
    await saveDocument(updated);
    const freshDocs = await getDocuments();
    setDocuments(freshDocs);
    setShowFolderSelectFor(null);
    setActiveMenuDocId(null);
  };

  const handleRestoreSelected = async () => {
    const docsToProcess = Array.from(selectedDocs).map(id => documents.find(d => d.id === id)).filter(Boolean) as Document[];
    if (docsToProcess.length === 0) return;

    for (const doc of docsToProcess) {
      if (doc.originalDocId) {
        // We must fetch fresh documents inside the loop in case multiple pages belong to the same original document
        const currentDocs = await getDocuments();
        const originalDoc = currentDocs.find(d => d.id === doc.originalDocId);
        if (originalDoc) {
          const updatedPages = [...originalDoc.pages];
          const pageIndex = typeof doc.originalPageIndex === 'number' ? doc.originalPageIndex : updatedPages.length;
          const safeIndex = Math.min(Math.max(0, pageIndex), updatedPages.length);
          updatedPages.splice(safeIndex, 0, doc.pages[0]);
          
          await saveDocument({ ...originalDoc, pages: updatedPages });
          await deleteDocument(doc.id);
          continue;
        }
      }
      
      await saveDocument({ ...doc, isTrash: false, originalDocId: undefined, originalPageIndex: undefined });
    }
    
    const freshDocs = await getDocuments();
    setDocuments(freshDocs);
    setSelectedDocs(new Set());
    setIsMultiSelect(false);
  };

  const handleDeleteSelected = async () => {
    const docsToProcess = Array.from(selectedDocs).map(id => documents.find(d => d.id === id)).filter(Boolean) as Document[];
    if (docsToProcess.length === 0) return;

    const areInTrash = docsToProcess.every(d => d.isTrash);
    if (areInTrash) {
      const confirmDelete = await showCustomConfirm(`Are you sure you want to permanently delete these ${docsToProcess.length} documents? This action cannot be undone.`);
      if (!confirmDelete) return;
      await Promise.all(docsToProcess.map(d => deleteDocument(d.id)));
    } else {
      const confirmTrash = await showCustomConfirm(`Move ${docsToProcess.length} selected documents to Trash?`);
      if (!confirmTrash) return;
      await Promise.all(docsToProcess.map(d => saveDocument({ ...d, isTrash: true })));
    }

    const freshDocs = await getDocuments();
    setDocuments(freshDocs);
    setSelectedDocs(new Set());
    setIsMultiSelect(false);
  };

  const handleShareSelected = async () => {
    try {
       const docsToShare = documents.filter(d => selectedDocs.has(d.id));
       if (docsToShare.length === 0) return;
       
       const totalPages = docsToShare.reduce((sum, doc) => sum + doc.pages.length, 0);
       let pagesDone = 0;
       
       const files = [];
       for (const doc of docsToShare) {
         const blob = await generatePDF(doc, { 
           drawBorder: addPdfBorder,
           onProgress: (current) => setPdfExportProgress({ current: pagesDone + current, total: totalPages })
         });
         pagesDone += doc.pages.length;
         files.push(new File([blob], `${doc.title}.pdf`, { type: 'application/pdf' }));
       }
       
       try {
          if (!isAndroidWebView() && navigator.share && navigator.canShare && navigator.canShare({ files })) {
             await navigator.share({
                files,
                title: "Shared Documents",
             });
          } else {
             throw new Error("unsupported");
          }
       } catch (shareErr) {
          pagesDone = 0;
          for (const doc of docsToShare) {
             const blob = await generatePDF(doc, { 
               drawBorder: addPdfBorder,
               onProgress: (current) => setPdfExportProgress({ current: pagesDone + current, total: totalPages })
             });
             pagesDone += doc.pages.length;
             downloadFile(blob, `${doc.title}.pdf`);
          }
          await showCustomAlert("PDFs saved to Downloads. Please select them when sharing.");
       }
    } catch (e: any) {
       if (e.name !== 'AbortError') {
         console.error(e);
         await showCustomAlert("Failed to share: " + e.message);
       }
    } finally {
       setPdfExportProgress(null);
    }
  };

  const handleMergeSelected = async () => {
    const docsToMerge = documents.filter(d => selectedDocs.has(d.id));
    if (docsToMerge.length < 2) return;
    
    docsToMerge.sort((a, b) => a.createdAt - b.createdAt);
    
    const allPages = docsToMerge.flatMap(d => d.pages);
    
    const newDoc: Document = {
      id: Date.now().toString(),
      title: `Merged Document ${new Date().toLocaleDateString()}`,
      createdAt: Date.now(),
      pages: allPages.map((p, i) => ({...p, id: Date.now().toString() + '-' + i}))
    };
    
    await saveDocument(newDoc);
    await Promise.all(docsToMerge.map(d => deleteDocument(d.id)));
    const freshDocs = await getDocuments();
    setDocuments(freshDocs);
    setSelectedDocs(new Set());
    setIsMultiSelect(false);
  };

  const handleShareImages = async (doc: Document) => {
    try {
      const files = await Promise.all(doc.pages.map(async (page, index) => {
        const res = await fetch(page.filteredImage);
        const blob = await res.blob();
        return new File([blob], `${doc.title}_Page_${index + 1}.jpg`, { type: 'image/jpeg' });
      }));

      try {
        if (!isAndroidWebView() && navigator.share && navigator.canShare && navigator.canShare({ files })) {
          await navigator.share({
            files,
            title: doc.title,
          });
        } else {
          throw new Error("unsupported");
        }
      } catch (shareErr) {
        await handleDownloadImages(doc);
        await showCustomAlert("Images saved to Downloads. Please select them when sharing.");
      }
    } catch (e: any) {
      if (e.name !== 'AbortError') {
        console.error("Failed to share images", e);
        await showCustomAlert("Failed to share: " + e.message);
      }
    }
  };

  const handleMoveToFolder = () => {
    setShowMultiFolderSelect(true);
  };

  const handleMoveSelectedToFolder = async (folderId?: string) => {
    const savePromises = documents
       .filter(d => selectedDocs.has(d.id))
       .map(async d => {
          d.folderId = folderId;
          d.isTrash = false; // Recover if in trash
          d.originalDocId = undefined;
          d.originalPageIndex = undefined;
          await saveDocument(d);
       });
       
    await Promise.all(savePromises);
    const freshDocs = await getDocuments();
    setDocuments(freshDocs);
    setSelectedDocs(new Set());
    setIsMultiSelect(false);
    setShowMultiFolderSelect(false);
  };

  const renderPdfProgressModal = () => {
    if (!pdfExportProgress) return null;
    const progress = Math.round((pdfExportProgress.current / Math.max(1, pdfExportProgress.total)) * 100);
    return (
      <div className="fixed inset-0 bg-black/50 z-[9999] flex items-center justify-center p-4 backdrop-blur-sm">
        <div className={`w-full max-w-sm rounded-2xl p-6 flex flex-col items-center justify-center ${theme === 'dark' ? 'bg-slate-900 text-white border-slate-800' : 'bg-white text-gray-900 border-gray-100'} shadow-2xl border`}>
          <div className="w-16 h-16 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mb-6"></div>
          <h3 className="font-bold text-lg mb-2">Generating PDF...</h3>
          <p className={`text-sm mb-4 ${theme === 'dark' ? 'text-slate-400' : 'text-gray-500'}`}>
            Processing page {pdfExportProgress.current} of {pdfExportProgress.total}
          </p>
          <div className={`w-full h-2 rounded-full overflow-hidden ${theme === 'dark' ? 'bg-slate-800' : 'bg-gray-100'}`}>
            <div 
              className="h-full bg-blue-600 rounded-full transition-all duration-300 ease-out"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      </div>
    );
  };

  const renderExportModal = () => {
    if (!showExportModalFor) return null;
    const doc = documents.find(d => d.id === showExportModalFor);
    if (!doc) return null;

    const formats = [
      { id: 'pdf', label: 'PDF Document', icon: FileText, desc: 'Best for multi-page scanning & sharing' },
      { id: 'images', label: 'Images (JPG)', icon: ImageIcon, desc: 'Best for photo gallery & individual pages' },
      { id: 'zip', label: 'ZIP Archive', icon: FileArchive, desc: 'Package all pages in a single file' }
    ] as const;

    return (
      <div className="fixed inset-0 bg-black/60 backdrop-blur-md z-50 flex items-center justify-center p-4 overflow-y-auto animate-fade-in">
        <div 
          className={`w-full max-w-lg rounded-3xl p-6 md:p-8 max-h-[90vh] overflow-y-auto ${
            theme === 'dark' ? 'bg-slate-900 text-white border border-slate-800' : 'bg-white text-gray-900 border border-gray-100'
          } shadow-2xl relative flex flex-col space-y-6`}
        >
          {/* Close button top right */}
          <button 
            onClick={() => { setShowExportModalFor(null); setExportPassword(''); setExportQuality(1); }}
            className={`absolute top-5 right-5 p-2 rounded-full transition-colors ${
              theme === 'dark' ? 'text-slate-400 hover:text-white hover:bg-slate-800' : 'text-gray-400 hover:text-gray-700 hover:bg-gray-100'
            }`}
            title="Close"
          >
            <X className="w-5 h-5" />
          </button>

          {/* Header */}
          <div className="space-y-1">
            <div className="flex items-center space-x-2.5">
              <div className="p-2 rounded-xl bg-blue-500/10 text-blue-500">
                <Share2 className="w-6 h-6" />
              </div>
              <h3 className="font-extrabold text-2xl tracking-tight">Export & Share</h3>
            </div>
            <p className={`text-xs ${theme === 'dark' ? 'text-slate-400' : 'text-gray-500'}`}>
              Configure options to download, email, or share "{doc.title}"
            </p>
          </div>

          {/* Body content */}
          <div className="space-y-5 flex-1">
            {/* Format Selection Cards */}
            <div className="space-y-2.5">
              <label className="block text-xs font-bold uppercase tracking-wider text-slate-400">
                Choose Format
              </label>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {formats.map((fmt) => {
                  const IconComp = fmt.icon;
                  const isSelected = exportFormat === fmt.id;
                  return (
                    <button
                      key={fmt.id}
                      onClick={() => setExportFormat(fmt.id)}
                      type="button"
                      className={`flex sm:flex-col items-start p-3.5 rounded-2xl border text-left transition-all relative ${
                        isSelected 
                          ? (theme === 'dark' ? 'border-blue-500 bg-blue-500/10 ring-2 ring-blue-500/20' : 'border-blue-500 bg-blue-50/50 ring-2 ring-blue-500/10')
                          : (theme === 'dark' ? 'border-slate-800 bg-slate-950/40 hover:bg-slate-800/50 text-slate-300' : 'border-gray-250 bg-gray-50/50 hover:bg-gray-100/50 text-gray-700')
                      }`}
                    >
                      <div className={`p-2 rounded-xl mr-3 sm:mr-0 sm:mb-2.5 ${isSelected ? 'bg-blue-500 text-white' : (theme === 'dark' ? 'bg-slate-800 text-slate-400' : 'bg-gray-250 text-gray-500')}`}>
                        <IconComp className="w-4 h-4" />
                      </div>
                      <div>
                        <p className="text-sm font-bold">{fmt.label}</p>
                        <p className={`text-[10px] leading-tight mt-0.5 ${theme === 'dark' ? 'text-slate-400' : 'text-gray-400'}`}>
                          {fmt.desc}
                        </p>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Config options based on format */}
            <div className="space-y-4">
              {exportFormat === 'pdf' && (
                <div className={`p-4 rounded-2xl border space-y-4 ${theme === 'dark' ? 'bg-slate-950/40 border-slate-800' : 'bg-gray-50/50 border-gray-150'}`}>
                  {/* PDF quality & options */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-bold uppercase tracking-wider text-slate-400 mb-1.5">Size / Quality</label>
                      <select 
                        value={exportQuality} 
                        onChange={(e) => setExportQuality(Number(e.target.value))}
                        className={`w-full p-2.5 rounded-xl border text-sm font-semibold focus:ring-2 focus:ring-blue-500 outline-none ${theme === 'dark' ? 'bg-slate-900 border-slate-800 text-white' : 'bg-white border-gray-200'}`}
                      >
                        <option value={1}>Original Quality (~Max Size)</option>
                        <option value={0.75}>High Quality (75%)</option>
                        <option value={0.5}>Medium Quality (50%)</option>
                        <option value={0.3}>Low Quality (Smallest)</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-xs font-bold uppercase tracking-wider text-slate-400 mb-1.5">Password Protection <span className="text-[10px] text-gray-500 font-normal capitalize">(Optional)</span></label>
                      <div className="relative">
                        <span className="absolute left-3 top-3 text-slate-400">
                          <Lock className="w-4 h-4" />
                        </span>
                        <input 
                          type="password" 
                          placeholder="No password set" 
                          value={exportPassword}
                          onChange={(e) => setExportPassword(e.target.value)}
                          className={`w-full pl-9 pr-4 py-2.5 rounded-xl border text-sm font-semibold focus:ring-2 focus:ring-blue-500 outline-none ${theme === 'dark' ? 'bg-slate-900 border-slate-800 placeholder-slate-600 text-white' : 'bg-white border-gray-200'}`}
                        />
                      </div>
                    </div>
                  </div>

                  {/* Draw border toggle */}
                  <div className="flex items-center justify-between pt-1">
                    <div>
                      <p className="text-sm font-bold">Draw borders on PDF pages</p>
                      <p className={`text-[10px] ${theme === 'dark' ? 'text-slate-400' : 'text-gray-400'}`}>Adds a clean physical boundary to each page</p>
                    </div>
                    <label className="relative inline-flex items-center cursor-pointer select-none">
                      <input 
                        type="checkbox" 
                        checked={addPdfBorder} 
                        onChange={(e) => setAddPdfBorder(e.target.checked)} 
                        className="sr-only peer"
                      />
                      <div className={`w-9 h-5 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:border after:rounded-full after:h-4 after:w-4 after:transition-all ${theme === 'dark' ? 'bg-slate-800 border-slate-700 after:bg-slate-300 after:border-slate-500 peer-checked:bg-blue-500' : 'bg-gray-200 after:bg-white after:border-gray-300 peer-checked:bg-blue-600'}`}></div>
                    </label>
                  </div>
                </div>
              )}

              {/* Watermark Section */}
              <div className={`p-4 rounded-2xl border space-y-4 ${theme === 'dark' ? 'bg-slate-950/40 border-slate-800' : 'bg-gray-50/50 border-gray-150'}`}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-2">
                    <span className="text-base">🛡️</span>
                    <div>
                      <p className="text-sm font-bold">Secure with Watermark</p>
                      <p className={`text-[10px] ${theme === 'dark' ? 'text-slate-400' : 'text-gray-400'}`}>Embed text overlays to protect your documents</p>
                    </div>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer select-none">
                    <input 
                      type="checkbox" 
                      checked={watermarkEnabled} 
                      onChange={(e) => setWatermarkEnabled(e.target.checked)} 
                      className="sr-only peer"
                    />
                    <div className={`w-9 h-5 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:border after:rounded-full after:h-4 after:w-4 after:transition-all ${theme === 'dark' ? 'bg-slate-800 border-slate-700 after:bg-slate-300 after:border-slate-500 peer-checked:bg-blue-500' : 'bg-gray-200 after:bg-white after:border-gray-300 peer-checked:bg-blue-600'}`}></div>
                  </label>
                </div>

                {watermarkEnabled && (
                  <div className="space-y-4 pt-2 border-t border-dashed border-gray-200 dark:border-slate-800">
                    {/* Live Preview & text input */}
                    <div className="grid grid-cols-1 md:grid-cols-12 gap-4">
                      {/* Live Preview left/top column */}
                      <div className="md:col-span-5 flex flex-col justify-center items-center">
                        <span className="block font-bold mb-1.5 text-[10px] uppercase tracking-wider text-slate-400 text-center w-full">Live Preview</span>
                        <div className={`relative h-44 w-32 rounded-xl shadow-lg overflow-hidden flex items-center justify-center border transition-colors ${theme === 'dark' ? 'bg-slate-900 border-slate-700' : 'bg-white border-gray-200'}`}>
                          {/* Inner page decoration */}
                          <div className={`absolute inset-0 flex flex-col justify-between p-2.5 pointer-events-none opacity-5`}>
                            <div className="h-1 bg-current w-1/2 rounded" />
                            <div className="space-y-1.5 py-4 w-full">
                              <div className="h-1 bg-current w-full rounded" />
                              <div className="h-1 bg-current w-5/6 rounded" />
                              <div className="h-1 bg-current w-4/5 rounded" />
                            </div>
                            <div className="h-1 bg-current w-1/3 rounded self-end" />
                          </div>
                          
                          {watermarkStyle === 'grid' ? (
                            <div className="absolute inset-0 grid grid-cols-3 grid-rows-3 gap-1 p-2 pointer-events-none">
                              {[...Array(9)].map((_, i) => (
                                <div key={i} className="flex items-center justify-center">
                                  <span 
                                    style={{ 
                                      color: watermarkColor, 
                                      opacity: watermarkOpacity,
                                      fontSize: `${watermarkSize * 0.15}px`,
                                      transform: `rotate(${watermarkRotation}deg)`,
                                    }}
                                    className="font-bold select-none break-all text-center leading-none"
                                  >
                                    {watermarkText || 'SAMPLE'}
                                  </span>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <div 
                              className={`absolute inset-0 flex pointer-events-none ${
                                watermarkPosition === 'center' ? 'items-center justify-center' :
                                watermarkPosition === 'top-left' ? 'items-start justify-start' :
                                watermarkPosition === 'top-right' ? 'items-start justify-end' :
                                watermarkPosition === 'bottom-left' ? 'items-end justify-start' :
                                'items-end justify-end' // bottom-right
                              }`}
                              style={{ padding: `${watermarkMargin * 0.1}px` }}
                            >
                              <span 
                                style={{ 
                                  color: watermarkColor, 
                                  opacity: watermarkOpacity,
                                  fontSize: `${watermarkSize * 0.3}px`,
                                  transform: `rotate(${watermarkRotation}deg)`,
                                  textAlign: watermarkPosition.includes('left') ? 'left' : (watermarkPosition.includes('right') ? 'right' : 'center')
                                }}
                                className="font-bold select-none break-all leading-tight text-center"
                              >
                                {watermarkText || 'SAMPLE'}
                              </span>
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Config panel right/bottom column */}
                      <div className="md:col-span-7 space-y-3.5">
                        <div>
                          <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">Watermark Text</label>
                          <input 
                            type="text" 
                            placeholder="e.g. CONFIDENTIAL, PRIVATE" 
                            value={watermarkText}
                            onChange={(e) => setWatermarkText(e.target.value)}
                            className={`w-full px-3.5 py-2 rounded-xl border text-xs font-semibold focus:ring-2 focus:ring-blue-500 outline-none ${theme === 'dark' ? 'bg-slate-900 border-slate-800 placeholder-slate-600 text-white' : 'bg-white border-gray-200'}`}
                          />
                        </div>

                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">Style</label>
                            <select 
                              value={watermarkStyle}
                              onChange={(e) => setWatermarkStyle(e.target.value as any)}
                              className={`w-full p-2 rounded-xl border text-xs font-semibold outline-none ${theme === 'dark' ? 'bg-slate-900 border-slate-800 text-white' : 'bg-white border-gray-200'}`}
                            >
                              <option value="single">Single Text</option>
                              <option value="grid">Grid Repeat</option>
                            </select>
                          </div>

                          <div>
                            <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">Position</label>
                            <select 
                              disabled={watermarkStyle === 'grid'}
                              value={watermarkPosition}
                              onChange={(e) => setWatermarkPosition(e.target.value as any)}
                              className={`w-full p-2 rounded-xl border text-xs font-semibold outline-none ${theme === 'dark' ? 'bg-slate-900 border-slate-800 text-white disabled:opacity-40' : 'bg-white border-gray-200 disabled:opacity-40'}`}
                            >
                              <option value="center">Center</option>
                              <option value="top-left">Top Left</option>
                              <option value="top-right">Top Right</option>
                              <option value="bottom-left">Bottom Left</option>
                              <option value="bottom-right">Bottom Right</option>
                            </select>
                          </div>
                        </div>

                        {/* Color selection */}
                        <div>
                          <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">Color Palette</label>
                          <div className="flex items-center space-x-2">
                            <input 
                              type="color" 
                              value={watermarkColor}
                              onChange={(e) => setWatermarkColor(e.target.value)}
                              className="w-7 h-7 rounded-lg cursor-pointer border border-gray-200 dark:border-slate-800 p-0 overflow-hidden"
                            />
                            <div className="flex flex-wrap gap-1.5">
                              {['#CCCCCC', '#FF3B30', '#007AFF', '#34C759', '#FF9500'].map(c => (
                                <button 
                                  key={c}
                                  type="button"
                                  onClick={() => setWatermarkColor(c)}
                                  className={`w-5 h-5 rounded-full border shadow-sm transition-transform hover:scale-110 ${watermarkColor === c ? 'ring-2 ring-blue-500 border-white' : 'border-gray-300 dark:border-slate-700'}`}
                                  style={{ backgroundColor: c }}
                                />
                              ))}
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Sliders in full-width below preview & config */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-3 pt-2">
                      <div>
                        <div className="flex justify-between text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">
                          <span>Size</span>
                          <span>{watermarkSize}px</span>
                        </div>
                        <input 
                          type="range" 
                          min={12} 
                          max={80} 
                          value={watermarkSize}
                          onChange={(e) => setWatermarkSize(Number(e.target.value))}
                          className="w-full accent-blue-600 cursor-pointer h-1.5 bg-gray-200 dark:bg-slate-800 rounded-lg appearance-none"
                        />
                      </div>

                      <div>
                        <div className="flex justify-between text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">
                          <span>Opacity</span>
                          <span>{Math.round(watermarkOpacity * 100)}%</span>
                        </div>
                        <input 
                          type="range" 
                          min={0.05} 
                          max={0.9} 
                          step={0.05}
                          value={watermarkOpacity}
                          onChange={(e) => setWatermarkOpacity(Number(e.target.value))}
                          className="w-full accent-blue-600 cursor-pointer h-1.5 bg-gray-200 dark:bg-slate-800 rounded-lg appearance-none"
                        />
                      </div>

                      <div>
                        <div className="flex justify-between text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">
                          <span>Rotation</span>
                          <span>{watermarkRotation}°</span>
                        </div>
                        <input 
                          type="range" 
                          min={0} 
                          max={360} 
                          value={watermarkRotation}
                          onChange={(e) => setWatermarkRotation(Number(e.target.value))}
                          className="w-full accent-blue-600 cursor-pointer h-1.5 bg-gray-200 dark:bg-slate-800 rounded-lg appearance-none"
                        />
                      </div>

                      <div>
                        <div className="flex justify-between text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">
                          <span>Margin</span>
                          <span>{watermarkMargin}px</span>
                        </div>
                        <input 
                          type="range" 
                          min={0} 
                          max={100} 
                          value={watermarkMargin}
                          onChange={(e) => setWatermarkMargin(Number(e.target.value))}
                          className="w-full accent-blue-600 cursor-pointer h-1.5 bg-gray-200 dark:bg-slate-800 rounded-lg appearance-none"
                        />
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Action buttons footer */}
          <div className="pt-2 border-t border-gray-150/40 dark:border-slate-800/40 space-y-3">
            {/* Primary Sharing Action */}
            <button 
              onClick={() => executeExport('share')} 
              className="w-full py-3 px-4 bg-blue-600 text-white rounded-2xl text-sm font-bold hover:bg-blue-700 hover:shadow-lg flex items-center justify-center gap-2 active:scale-98 transition-all"
            >
              <Share2 className="w-4.5 h-4.5" /> Share Document Now
            </button>

            {/* Save & Email secondary row */}
            <div className="grid grid-cols-2 gap-3">
              <button 
                onClick={() => executeExport('save')} 
                className={`py-3 px-4 rounded-2xl text-xs font-bold border flex items-center justify-center gap-2 active:scale-98 transition-all ${
                  theme === 'dark' ? 'border-slate-800 bg-slate-950/40 text-slate-300 hover:bg-slate-800' : 'border-gray-200 bg-gray-50/50 hover:bg-gray-100 text-gray-700'
                }`}
              >
                <Download className="w-4 h-4" /> 
                {exportFormat === 'images' ? 'Save to Gallery' : 'Save to Storage'}
              </button>
              
              <button 
                onClick={() => executeExport('email')} 
                className={`py-3 px-4 rounded-2xl text-xs font-bold border flex items-center justify-center gap-2 active:scale-98 transition-all ${
                  theme === 'dark' ? 'border-slate-800 bg-slate-950/40 text-slate-300 hover:bg-slate-800' : 'border-gray-200 bg-gray-50/50 hover:bg-gray-100 text-gray-700'
                }`}
              >
                <Mail className="w-4 h-4" /> Send via Email
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  };

  const renderBatchProgressOverlay = () => {
    if (!isProcessingBatch) return null;
    
    const progressPct = totalBatchFiles > 0 ? Math.round((processedBatchFiles / totalBatchFiles) * 100) : 0;
    const radius = 36;
    const circumference = 2 * Math.PI * radius;
    const strokeDashoffset = circumference - (progressPct / 100) * circumference;

    return (
      <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-md z-[100] flex flex-col items-center justify-center p-4">
        <div className="bg-white rounded-3xl p-8 shadow-2xl flex flex-col items-center justify-center max-w-sm w-full border border-gray-100/50 animate-in zoom-in-95 duration-200">
          <div className="relative flex items-center justify-center w-24 h-24 mb-6">
            <svg className="w-24 h-24 transform -rotate-90">
              {/* Background circle */}
              <circle
                cx="48"
                cy="48"
                r={radius}
                className="stroke-gray-100 fill-transparent"
                strokeWidth="6"
              />
              {/* Foreground circle */}
              <circle
                cx="48"
                cy="48"
                r={radius}
                className="stroke-blue-600 fill-transparent transition-all duration-300 ease-out"
                strokeWidth="6"
                strokeDasharray={circumference}
                strokeDashoffset={strokeDashoffset}
                strokeLinecap="round"
              />
            </svg>
            <span className="absolute text-xl font-bold text-gray-800 font-mono">
              {progressPct}%
            </span>
          </div>

          <h3 className="text-lg font-bold text-gray-900 text-center mb-1">
            Analyzing Images
          </h3>
          <p className="text-sm font-medium text-blue-600 mb-4 animate-pulse">
            Processing page {Math.min(processedBatchFiles + 1, totalBatchFiles)} of {totalBatchFiles}
          </p>

          {/* Mini horizontal progress bar */}
          <div className="w-full bg-gray-100 h-2 rounded-full overflow-hidden mb-4">
            <div 
              className="bg-blue-600 h-full rounded-full transition-all duration-300 ease-out"
              style={{ width: `${progressPct}%` }}
            />
          </div>

          <p className="text-xs text-gray-400 text-center">
            Detecting document edges and cropping coordinates...
          </p>
        </div>
      </div>
    );
  };

  if (showCustomCamera) {
    return (
      <CameraView
        initialMode={cameraMode}
        onCapture={(files) => {
          setShowCustomCamera(false);
          handleFilesSelected(files);
        }}
        onClose={() => setShowCustomCamera(false)}
        onPickGallery={() => {
          if (cameraMode === "single") {
            fileInputGalleryRef.current?.click();
          } else {
            fileInputGalleryRef2.current?.click();
          }
        }}
        onFallback={() => {
          setShowCustomCamera(false);
          if (cameraMode === "single") {
            fileInputCameraRef.current?.click();
          } else {
            fileInputCameraRef2.current?.click();
          }
        }}
      />
    );
  }

  if (appState === 'crop' && capturedImage) {
    return (
      <CropView
        key={capturedImage}
        imageSrc={capturedImage}
        initialCorners={currentCorners}
        onCrop={handleCropNext}
        onCancel={() => {
          setCapturedImage(null);
          setProcessingQueue([]);
          setCurrentCorners(undefined);
          setEditingPageId(null);
          setAppState(currentDoc ? 'view_doc' : 'home');
        }}
        isProcessing={isProcessingStep}
      />
    );
  }

  const renderFullScreenImageOverlay = () => {
    if (!fullScreenImage) return null;
    return (
      <ZoomableImage 
        src={fullScreenImage} 
        onClose={() => setFullScreenImage(null)} 
        addPdfBorder={addPdfBorder} 
      />
    );
  };

  if (appState === 'filter' && croppedImage) {
    return (
      <FilterView
        imageSrc={croppedImage}
        onSave={handleFilterSave}
        onBack={() => setAppState('crop')}
        isSaving={isProcessingStep}
      />
    );
  }

  if (appState === 'view_doc' && currentDoc) {
    return (
      <div className={`flex flex-col h-[100dvh] font-sans transition-colors duration-300 ${theme === 'dark' ? 'bg-slate-950 text-white' : 'bg-[var(--color-warm-bg)] text-[var(--color-warm-text)]'}`}>
         <div className={`flex items-center justify-between px-4 pb-3 safe-pt border-b sticky top-0 z-10 shadow-sm transition-colors duration-300 ${theme === 'dark' ? 'bg-slate-900 border-slate-800' : 'bg-[var(--color-warm-card)] border-[var(--color-warm-border)]'}`}>
            <button onClick={() => { setCurrentDoc(null); setAppState('home'); setIsEditingTitle(false); }} className={`touch-target p-2 -ml-2 flex-shrink-0 ${theme === 'dark' ? 'text-slate-400 hover:text-white' : 'text-[var(--color-warm-text-muted)] hover:text-[var(--color-warm-text)]'}`}>
               <ArrowLeft className="w-6 h-6" />
            </button>
            
            {isEditingTitle ? (
              <div className="flex-1 flex items-center space-x-2 px-3">
                <input
                  type="text"
                  value={tempTitle || ''}
                  onChange={(e) => setTempTitle(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleRenameSave();
                    else if (e.key === 'Escape') setIsEditingTitle(false);
                  }}
                  className={`flex-1 border rounded-lg px-2.5 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 font-medium ${theme === 'dark' ? 'bg-slate-800 border-slate-700 text-white' : 'bg-white border-[var(--color-warm-accent)]'}`}
                  autoFocus
                />
                <button onClick={handleRenameSave} className={`touch-target p-1.5 rounded-lg flex-shrink-0 ${theme === 'dark' ? 'text-green-400 hover:bg-slate-800' : 'text-green-600 hover:bg-green-50'}`} title="Save Title">
                  <Check className="w-5 h-5" />
                </button>
                <button onClick={() => setIsEditingTitle(false)} className={`touch-target p-1.5 rounded-lg flex-shrink-0 ${theme === 'dark' ? 'text-slate-400 hover:bg-slate-800' : 'text-gray-400 hover:bg-gray-100'}`} title="Cancel">
                  <X className="w-5 h-5" />
                </button>
              </div>
            ) : (
              <div className="flex-1 flex items-center min-w-0 px-3 group">
                <h1 className={`text-lg font-semibold truncate ${theme === 'dark' ? 'text-slate-200' : 'text-[var(--color-warm-text)]'}`}>{currentDoc.title}</h1>
                <button 
                  onClick={() => { setTempTitle(currentDoc.title); setIsEditingTitle(true); }} 
                  className={`touch-target p-1.5 ml-1 rounded-lg transition-colors flex-shrink-0 ${theme === 'dark' ? 'text-slate-400 hover:text-blue-400 hover:bg-slate-800' : 'text-[var(--color-warm-text-muted)] hover:text-[var(--color-warm-accent)] hover:bg-[var(--color-warm-border)]'}`}
                  title="Rename document"
                >
                  <Pencil className="w-4 h-4" />
                </button>
              </div>
            )}
            
            <div className="flex items-center space-x-1 sm:space-x-2 flex-shrink-0">
              {currentDoc.isTrash && (
                <button 
                  onClick={() => handleRestoreDoc(currentDoc.id)} 
                  className={`p-2 rounded-full ${theme === 'dark' ? 'text-blue-400 hover:bg-slate-800' : 'text-blue-600 hover:bg-blue-50'}`} 
                  title="Restore"
                >
                   <Undo className="w-5 h-5" />
                </button>
              )}
              <button onClick={() => setShowExportModalFor(currentDoc.id)} className={`p-2 rounded-full ${theme === 'dark' ? 'text-green-400 hover:bg-slate-800' : 'text-green-600 hover:bg-green-50'}`} title="Export & Share">
                 <Share2 className="w-5 h-5" />
              </button>
              <button onClick={() => handleDeleteDoc(currentDoc.id)} className={`p-2 rounded-full ${theme === 'dark' ? 'text-red-400 hover:bg-slate-800' : 'text-red-600 hover:bg-red-50'}`} title="Delete">
                 <Trash2 className="w-5 h-5" />
              </button>
            </div>
         </div>
         
         {errorMessage && (
           <div className={`border-b px-4 py-2 flex items-center justify-between text-sm ${theme === 'dark' ? 'bg-red-900/30 border-red-900 text-red-300' : 'bg-red-50 border-red-200 text-red-800'}`}>
             <span>{errorMessage}</span>
             <button onClick={() => setErrorMessage(null)} className={`font-semibold text-xs ${theme === 'dark' ? 'text-red-400 hover:text-red-200' : 'text-red-500 hover:text-red-700'}`}>Dismiss</button>
           </div>
         )}
         
         <div className={`px-4 py-3 border-b flex items-center justify-between shadow-inner ${theme === 'dark' ? 'bg-slate-900 border-slate-800' : 'bg-[var(--color-warm-card)]/50 border-[var(--color-warm-border)]'}`}>
           <span className={`text-sm font-medium ${theme === 'dark' ? 'text-slate-300' : 'text-[var(--color-warm-text)]'}`}>Add outline border to PDF</span>
           <label className="relative inline-flex items-center cursor-pointer select-none">
             <input 
               type="checkbox" 
               checked={addPdfBorder} 
               onChange={(e) => setAddPdfBorder(e.target.checked)} 
               className="sr-only peer"
             />
             <div className={`w-11 h-6 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:border after:rounded-full after:h-5 after:w-5 after:transition-all ${theme === 'dark' ? 'bg-slate-700 border-slate-600 after:bg-slate-300 after:border-slate-500 peer-checked:bg-blue-500' : 'bg-gray-200 after:bg-white after:border-gray-300 peer-checked:bg-blue-600'}`}></div>
           </label>
         </div>

         <div className="flex-1 overflow-y-auto p-4 space-y-6">
           {currentDoc.pages.map((page, idx) => (
             <div 
               key={page.id} 
               draggable={true}
               onDragStart={(e) => {
                 const target = e.target as HTMLElement;
                 if (!target.closest('.drag-handle')) {
                   e.preventDefault();
                   return;
                 }
                 setDraggedPageIndex(idx);
                 e.dataTransfer.effectAllowed = "move";
                 e.dataTransfer.setData('text/plain', idx.toString());
               }}
               onDragEnd={() => {
                 setDraggedPageIndex(null);
               }}
               onDragOver={(e) => {
                 e.preventDefault();
               }}
               onDrop={(e) => {
                 e.preventDefault();
                 const sourceIdxStr = e.dataTransfer.getData('text/plain');
                 if (sourceIdxStr === '') return;
                 const sourceIdx = parseInt(sourceIdxStr, 10);
                 const targetIdx = idx;
                 if (sourceIdx !== targetIdx) {
                   handleReorderPages(sourceIdx, targetIdx);
                 }
               }}
               className={`rounded-lg shadow-sm border overflow-hidden transition-all duration-200 ${
                 theme === 'dark' ? 'bg-slate-900' : 'bg-[var(--color-warm-card)]'
               } ${
                 draggedPageIndex === idx 
                   ? (theme === 'dark' ? 'opacity-40 border-dashed border-indigo-400 bg-indigo-900/10' : 'opacity-40 border-dashed border-[var(--color-warm-accent)] bg-[var(--color-warm-accent)]/10') 
                   : (theme === 'dark' ? 'border-slate-800 hover:border-slate-700' : 'border-[var(--color-warm-border)] hover:border-gray-300')
               }`}
             >
                <div className={`p-2 border-b text-sm font-medium flex justify-between items-center select-none ${theme === 'dark' ? 'bg-slate-800/50 border-slate-700/50 text-slate-400' : 'bg-[var(--color-warm-bg)] border-[var(--color-warm-border)] text-[var(--color-warm-text-muted)]'}`}>
                  <div className="flex items-center space-x-2">
                    <div 
                      className={`drag-handle cursor-grab active:cursor-grabbing p-1 ${theme === 'dark' ? 'text-slate-500 hover:text-slate-300' : 'text-[var(--color-warm-text-muted)] hover:text-[var(--color-warm-text)]'}`} 
                      title="Drag to reorder"
                    >
                      <GripVertical className="w-4 h-4 pointer-events-none drag-handle" />
                    </div>
                    <span>Page {idx + 1}</span>
                  </div>
                  <div className="flex items-center space-x-1">
                    <button
                      onClick={() => {
                        setCapturedImage(page.originalImage);
                        setCroppedImage(null);
                        setCurrentCorners(page.corners || undefined);
                        setEditingPageId(page.id);
                        setAppState('crop');
                      }}
                      className={`p-1 rounded disabled:opacity-30 disabled:hover:bg-transparent ${theme === 'dark' ? 'text-slate-500 hover:text-indigo-400 hover:bg-slate-700 disabled:hover:text-slate-500' : 'text-[var(--color-warm-text-muted)] hover:text-[var(--color-warm-accent)] hover:bg-[var(--color-warm-border)] disabled:hover:text-[var(--color-warm-text-muted)]'}`}
                      title="Re-crop Page"
                    >
                      <Crop className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => handleMovePage(idx, 'up')}
                      disabled={idx === 0}
                      className={`p-1 rounded disabled:opacity-30 disabled:hover:bg-transparent ${theme === 'dark' ? 'text-slate-500 hover:text-indigo-400 hover:bg-slate-700 disabled:hover:text-slate-500' : 'text-[var(--color-warm-text-muted)] hover:text-[var(--color-warm-accent)] hover:bg-[var(--color-warm-border)] disabled:hover:text-[var(--color-warm-text-muted)]'}`}
                      title="Move Page Up"
                    >
                      <ArrowUp className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => handleMovePage(idx, 'down')}
                      disabled={idx === currentDoc.pages.length - 1}
                      className={`p-1 rounded disabled:opacity-30 disabled:hover:bg-transparent ${theme === 'dark' ? 'text-slate-500 hover:text-indigo-400 hover:bg-slate-700 disabled:hover:text-slate-500' : 'text-[var(--color-warm-text-muted)] hover:text-[var(--color-warm-accent)] hover:bg-[var(--color-warm-border)] disabled:hover:text-[var(--color-warm-text-muted)]'}`}
                      title="Move Page Down"
                    >
                      <ArrowDown className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => handleDeletePage(currentDoc, idx)}
                      className={`p-1 rounded transition-colors ${theme === 'dark' ? 'text-red-500 hover:text-red-400 hover:bg-red-950/30' : 'text-red-600 hover:text-red-700 hover:bg-red-50'}`}
                      title="Delete Page"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
                <div className={`p-4 flex justify-center ${theme === 'dark' ? 'bg-slate-950/50' : 'bg-[var(--color-warm-bg)]'}`}>
                  <button onClick={() => setFullScreenImage(page.filteredImage)} className="cursor-zoom-in transition-transform hover:scale-[1.02]">
                    <img src={page.filteredImage} alt={`Page ${idx+1}`} draggable={false} loading="lazy" decoding="async" className={`max-h-[60vh] object-contain shadow-md select-none transition-all duration-150 ${addPdfBorder ? 'border-[3px] border-black rounded-none ring-2 ring-black/10' : 'rounded-md'}`} />
                  </button>
                </div>
             </div>
           ))}
         </div>
         
          <div className={`p-4 border-t ${theme === "dark" ? "bg-slate-900 border-slate-800" : "bg-[var(--color-warm-card)] border-[var(--color-warm-border)]"}`}>
            <div className="flex items-center justify-center space-x-3 w-full">
              <button 
                onClick={() => { triggerHapticLight('scan'); setCameraMode("batch"); setShowCustomCamera(true); }}
                className="flex-1 flex items-center justify-center space-x-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-3 rounded-xl shadow-lg transition-all active:scale-95"
              >
                <Camera className="w-5 h-5" />
                <span className="font-bold text-sm">Scan Page</span>
              </button>
              <button 
                onClick={() => fileInputGalleryRef2.current?.click()}
                className={`flex-1 flex items-center justify-center space-x-2 px-4 py-3 rounded-xl shadow-md transition-all active:scale-95 ${theme === "dark" ? "bg-slate-800 text-white hover:bg-slate-700 border border-slate-700" : "bg-white text-gray-700 hover:bg-gray-50 border border-gray-200"}`}
              >
                <ImageIcon className="w-5 h-5" />
                <span className="font-bold text-sm">Upload</span>
              </button>
            </div>
          </div>
         <input 
            type="file" 
            accept="image/*"
            multiple
            className="hidden" 
            ref={fileInputGalleryRef2}
            onChange={handleCapture}
         />
         <input 
            type="file" 
            accept="image/*"
            capture="environment" 
            className="hidden" 
            ref={fileInputCameraRef2}
            onChange={handleCapture}
         />
         {renderExportModal()}
         {renderPdfProgressModal()}
          {renderBatchProgressOverlay()}
          {renderCustomDialogs()}
          {renderFullScreenImageOverlay()}
      </div>
    );
  }



  const renderNotesTab = () => {
    const filteredNotes = noteSearchQuery.trim()
      ? notes.filter(n => n.title.toLowerCase().includes(noteSearchQuery.toLowerCase().trim()) || n.content.toLowerCase().includes(noteSearchQuery.toLowerCase().trim()))
      : notes;

    return (
      <div className="space-y-6">
        {/* Search bar inside notes */}
        <div className="relative">
          <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Search notes..."
            value={noteSearchQuery || ''}
            className={`w-full border pl-9 pr-4 py-1 rounded-full text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 shadow-xs ${theme === 'dark' ? 'bg-slate-900 border-slate-700 text-white placeholder-slate-400' : 'bg-white border-gray-200 text-gray-800'}`}
            onChange={(e) => setNoteSearchQuery(e.target.value)}
          />
        </div>

        {filteredNotes.length === 0 ? (
          <div className="py-12 flex flex-col items-center justify-center text-gray-400 space-y-4">
            <StickyNote className="w-16 h-16 text-gray-300 stroke-[1.5]" />
            <p className="text-base font-medium">No quick notes found</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {filteredNotes.map((note) => {
              const colorSet = NOTE_COLORS[note.colorIndex] || NOTE_COLORS[0];
              return (
                <div 
                  key={note.id} 
                  className={`p-5 rounded-2xl border ${colorSet.bg} transition-all shadow-xs flex flex-col justify-between group hover:shadow-md relative overflow-hidden`}
                >
                  <div className="space-y-2">
                    <div className="flex justify-between items-start">
                      <h3 className={`font-bold text-base truncate pr-16 ${theme === 'dark' ? 'text-white' : 'text-gray-950'}`}>{note.title || 'Untitled Note'}</h3>
                      <div className="absolute top-3 right-3 flex items-center space-x-0.5 sm:opacity-0 group-hover:opacity-100 transition-opacity">
                        <button 
                          onClick={(e) => {
                            e.stopPropagation();
                            setNewNoteTitle(note.title);
                            setNewNoteContent(note.content);
                            setNewNoteColor(note.colorIndex);
                            setEditingNoteId(note.id);
                            setShowAddNoteModal(true);
                          }}
                          className={`${theme === 'dark' ? 'text-slate-400 hover:text-blue-400' : 'text-gray-400 hover:text-blue-600'} p-1 rounded-md`}
                          title="Edit Note"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                         <button 
                          onClick={async (e) => {
                            e.stopPropagation();
                            const confirmDelete = await showCustomConfirm("Delete this note?");
                            if (confirmDelete) {
                              setNotes(prev => prev.filter(n => n.id !== note.id));
                            }
                          }}
                          className="text-gray-400 hover:text-red-600 p-1 rounded-md"
                          title="Delete Note"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                    <p className={`text-sm whitespace-pre-wrap leading-relaxed ${theme === 'dark' ? 'text-slate-300' : 'text-gray-700'}`}>
                      {note.content}
                    </p>
                  </div>
                  <div className="mt-4 pt-3 border-t border-black/5 flex justify-between items-center text-[11px] text-gray-500 font-medium">
                    <span>{new Date(note.createdAt).toLocaleDateString()}</span>
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${colorSet.tag}`}>
                      Scan Helper
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Create / Edit Note Modal */}
        {showAddNoteModal && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-xs z-[110] flex items-center justify-center p-4">
            <div className={`rounded-3xl shadow-2xl p-6 max-w-md w-full border animate-in zoom-in-95 duration-200 space-y-4 ${theme === 'dark' ? 'bg-slate-900 border-slate-800 text-white' : 'bg-white border-gray-100 text-gray-950'}`}>
              <div className={`flex justify-between items-center border-b pb-2 ${theme === 'dark' ? 'border-slate-800' : 'border-gray-100'}`}>
                <h3 className={`text-lg font-bold ${theme === 'dark' ? 'text-white' : 'text-gray-950'}`}>{editingNoteId ? 'Edit Quick Note' : 'Add Quick Note'}</h3>
                <button onClick={() => { setShowAddNoteModal(false); setEditingNoteId(null); }} className="text-gray-400 hover:text-gray-600">
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="space-y-1">
                <label className={`text-xs font-bold uppercase tracking-wider ${theme === 'dark' ? 'text-slate-400' : 'text-gray-500'}`}>Title</label>
                <input
                  type="text"
                  placeholder="e.g. Invoices Folder Guide"
                  value={newNoteTitle || ''}
                  onChange={(e) => setNewNoteTitle(e.target.value)}
                  className={`w-full border rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 ${theme === 'dark' ? 'bg-slate-950 border-slate-800 text-white' : 'bg-gray-50 border-gray-200 text-gray-900'}`}
                />
              </div>

              <div className="space-y-1">
                <label className={`text-xs font-bold uppercase tracking-wider ${theme === 'dark' ? 'text-slate-400' : 'text-gray-500'}`}>Content</label>
                <textarea
                  placeholder="Type your note details here..."
                  value={newNoteContent || ''}
                  onChange={(e) => setNewNoteContent(e.target.value)}
                  rows={4}
                  className={`w-full border rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 ${theme === 'dark' ? 'bg-slate-950 border-slate-800 text-white' : 'bg-gray-50 border-gray-200 text-gray-900'}`}
                />
              </div>

              {/* Color Selector */}
              <div className="space-y-2">
                <label className={`text-xs font-bold uppercase tracking-wider ${theme === 'dark' ? 'text-slate-400' : 'text-gray-500'}`}>Note Theme</label>
                <div className="flex space-x-2">
                  {NOTE_COLORS.map((col, idx) => (
                    <button
                      key={idx}
                      onClick={() => setNewNoteColor(idx)}
                      type="button"
                      className={`w-8 h-8 rounded-full border-2 ${col.bg} transition-all ${newNoteColor === idx ? `ring-2 ring-offset-2 ${col.activeRing}` : 'border-transparent'}`}
                    />
                  ))}
                </div>
              </div>

              <div className="flex space-x-3 pt-2">
                <button
                  onClick={() => { setShowAddNoteModal(false); setEditingNoteId(null); }}
                  type="button"
                  className={`flex-1 py-2.5 border text-sm font-semibold rounded-xl transition-colors ${theme === 'dark' ? 'border-slate-800 text-slate-300 hover:bg-slate-800/50' : 'border-gray-200 text-gray-600 hover:bg-gray-50'}`}
                >
                  Cancel
                </button>
                <button
                  onClick={() => {
                    if (!newNoteContent.trim()) return;
                    if (editingNoteId) {
                      setNotes(prev => prev.map(n => n.id === editingNoteId ? {
                        ...n,
                        title: newNoteTitle.trim() || 'Untitled Note',
                        content: newNoteContent.trim(),
                        colorIndex: newNoteColor
                      } : n));
                      setEditingNoteId(null);
                    } else {
                      const newNote = {
                        id: Date.now().toString(),
                        title: newNoteTitle.trim() || 'Untitled Note',
                        content: newNoteContent.trim(),
                        createdAt: Date.now(),
                        colorIndex: newNoteColor
                      };
                      setNotes(prev => [newNote, ...prev]);
                    }
                    setShowAddNoteModal(false);
                  }}
                  disabled={!newNoteContent.trim()}
                  type="button"
                  className="flex-1 py-2.5 bg-blue-600 text-white font-semibold rounded-xl hover:bg-blue-700 disabled:opacity-50 transition-colors"
                >
                  {editingNoteId ? 'Save Changes' : 'Save Note'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  };

  const renderProfileTab = () => {
    const totalScans = documents.length;
    const totalPages = documents.reduce((sum, d) => sum + d.pages.length, 0);
    const storageEst = (JSON.stringify(documents).length / 1024).toFixed(1);

    const initials = profileName
      .trim()
      .split(/\s+/)
      .map(n => n[0])
      .join('')
      .slice(0, 2)
      .toUpperCase() || 'GR';

    const handleStartEdit = () => {
      setEditName(profileName);
      setEditEmail(profileEmail);
      setEditTier(profileTier);
      setEditAvatarColor(profileAvatarColor);
      setIsEditingProfile(true);
    };

    const handleSaveProfile = () => {
      if (editName.trim()) setProfileName(editName.trim());
      if (editEmail.trim()) setProfileEmail(editEmail.trim());
      setProfileTier(editTier);
      setProfileAvatarColor(editAvatarColor);
      setIsEditingProfile(false);
    };

    const avatarGradients = [
      { name: 'Classic Indigo', class: 'from-blue-500 to-indigo-600' },
      { name: 'Emerald Wave', class: 'from-emerald-500 to-teal-600' },
      { name: 'Sunset Rose', class: 'from-rose-500 to-red-600' },
      { name: 'Golden Amber', class: 'from-amber-500 to-orange-600' },
      { name: 'Royal Velvet', class: 'from-purple-500 to-pink-600' },
      { name: 'Dark Slate', class: 'from-slate-700 to-slate-900' },
    ];

    return (
      <div className="space-y-6">
        {/* User Card */}
        <div className="bg-gradient-to-br from-[#1b2536] to-[#0f172a] rounded-2xl p-6 text-white shadow-lg relative overflow-hidden transition-all duration-300">
          <div className="absolute top-0 right-0 w-32 h-32 bg-blue-500/10 rounded-full blur-2xl -mr-10 -mt-10" />
          
          {!isEditingProfile ? (
            <div className="relative z-10 flex flex-col sm:flex-row items-center sm:items-start text-center sm:text-left space-y-4 sm:space-y-0 sm:space-x-5">
              <div className={`w-16 h-16 rounded-full bg-gradient-to-tr ${profileAvatarColor} flex items-center justify-center font-black text-xl text-white shadow-md border-2 border-white/20 uppercase transition-all duration-300`}>
                {initials}
              </div>

              <div className="flex-1 space-y-1">
                <div className="flex flex-col sm:flex-row sm:items-center sm:space-x-2.5 justify-center sm:justify-start">
                  <h2 className="text-xl font-bold tracking-tight">{profileName}</h2>
                  <span className="inline-block mt-1 sm:mt-0 px-2 py-0.5 bg-amber-400 text-amber-950 text-[10px] font-extrabold tracking-wider rounded-md uppercase self-center sm:self-auto">
                    {profileTier}
                  </span>
                </div>
                <p className="text-sm text-slate-300 font-mono">{profileEmail}</p>
                <p className="text-xs text-slate-400">Premium active tier. Unlimited OCR & PDF Generation.</p>
                
                <div className="pt-3 flex justify-center sm:justify-start">
                  <button
                    onClick={handleStartEdit}
                    className="touch-target inline-flex items-center space-x-1.5 px-3 py-1 bg-white/10 hover:bg-white/20 active:bg-white/30 border border-white/15 text-xs font-semibold rounded-full text-white transition-all shadow-xs cursor-pointer"
                  >
                    <Pencil className="w-3.5 h-3.5 text-blue-400" />
                    <span>Edit Profile</span>
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <div className="relative z-10 space-y-4 text-left">
              <div className="flex items-center justify-between border-b border-slate-800 pb-2.5">
                <h3 className="text-sm font-extrabold uppercase tracking-widest text-slate-400">Edit Profile Details</h3>
                <span className="text-[10px] font-bold text-slate-500 uppercase">Interactive Setup</span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {/* Name */}
                <div className="space-y-1.5">
                  <label className="block text-[10px] font-extrabold tracking-wider uppercase text-slate-400">Scanner Name</label>
                  <input
                    type="text"
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    placeholder="Enter your name"
                    className="w-full bg-slate-900 border border-slate-800 focus:border-blue-500 rounded-xl px-3 py-2 text-sm text-white focus:outline-none transition-all"
                  />
                </div>

                {/* Email */}
                <div className="space-y-1.5">
                  <label className="block text-[10px] font-extrabold tracking-wider uppercase text-slate-400">Email Address</label>
                  <input
                    type="email"
                    value={editEmail}
                    onChange={(e) => setEditEmail(e.target.value)}
                    placeholder="Enter your email"
                    className="w-full bg-slate-900 border border-slate-800 focus:border-blue-500 rounded-xl px-3 py-2 text-sm text-white focus:outline-none transition-all"
                  />
                </div>

                {/* Account Tier */}
                <div className="space-y-1.5">
                  <label className="block text-[10px] font-extrabold tracking-wider uppercase text-slate-400">Account Tier</label>
                  <select
                    value={editTier}
                    onChange={(e) => setEditTier(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-800 focus:border-blue-500 rounded-xl px-3 py-2 text-sm text-white focus:outline-none transition-all"
                  >
                    <option value="PRO ACTIVE">PRO ACTIVE</option>
                    <option value="ENTERPRISE VIP">ENTERPRISE VIP</option>
                    <option value="CREATOR PASS">CREATOR PASS</option>
                    <option value="FREE TIER">FREE TIER</option>
                  </select>
                </div>

                {/* Theme / Color Scheme */}
                <div className="space-y-1.5">
                  <label className="block text-[10px] font-extrabold tracking-wider uppercase text-slate-400">Avatar Accent</label>
                  <div className="flex flex-wrap gap-2 pt-1">
                    {avatarGradients.map((g) => (
                      <button
                        key={g.class}
                        onClick={() => setEditAvatarColor(g.class)}
                        title={g.name}
                        className={`w-6 h-6 rounded-full bg-gradient-to-tr ${g.class} border-2 transition-all cursor-pointer ${editAvatarColor === g.class ? 'border-white scale-120 ring-2 ring-blue-500/50' : 'border-transparent hover:scale-110'}`}
                      />
                    ))}
                  </div>
                </div>
              </div>

              <div className="pt-3 flex items-center justify-end space-x-2.5 border-t border-slate-800 mt-2">
                <button
                  onClick={() => setIsEditingProfile(false)}
                  className="touch-target px-4 py-1.5 text-xs font-semibold rounded-full bg-slate-800 hover:bg-slate-700 text-slate-300 transition-all cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSaveProfile}
                  className="touch-target px-5 py-1.5 text-xs font-semibold rounded-full bg-blue-600 hover:bg-blue-500 text-white transition-all shadow-md shadow-blue-900/20 flex items-center space-x-1 cursor-pointer"
                >
                  <Check className="w-3.5 h-3.5" />
                  <span>Save Changes</span>
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Bento Stats Grid */}
        <div className="grid grid-cols-2 gap-4">
          <div className={`p-4 rounded-2xl border shadow-xs flex flex-col justify-between ${theme === 'dark' ? 'bg-slate-900 border-slate-800 text-white' : 'bg-white border-gray-100 text-gray-900'}`}>
            <span className={`text-xs font-bold uppercase tracking-wider ${theme === 'dark' ? 'text-slate-400' : 'text-gray-400'}`}>Total Scans</span>
            <div className="mt-2 flex items-baseline space-x-1.5">
              <span className={`text-2xl font-black ${theme === 'dark' ? 'text-white' : 'text-gray-900'}`}>{totalScans}</span>
              <span className={`text-xs font-semibold ${theme === 'dark' ? 'text-slate-400' : 'text-gray-500'}`}>Docs</span>
            </div>
          </div>

          <div className={`p-4 rounded-2xl border shadow-xs flex flex-col justify-between ${theme === 'dark' ? 'bg-slate-900 border-slate-800 text-white' : 'bg-white border-gray-100 text-gray-900'}`}>
            <span className={`text-xs font-bold uppercase tracking-wider ${theme === 'dark' ? 'text-slate-400' : 'text-gray-400'}`}>Pages Processed</span>
            <div className="mt-2 flex items-baseline space-x-1.5">
              <span className={`text-2xl font-black ${theme === 'dark' ? 'text-white' : 'text-gray-900'}`}>{totalPages}</span>
              <span className={`text-xs font-semibold ${theme === 'dark' ? 'text-slate-400' : 'text-gray-500'}`}>Pages</span>
            </div>
          </div>

          <div className={`p-4 rounded-2xl border shadow-xs flex flex-col justify-between ${theme === 'dark' ? 'bg-slate-900 border-slate-800 text-white' : 'bg-white border-gray-100 text-gray-900'}`}>
            <span className={`text-xs font-bold uppercase tracking-wider ${theme === 'dark' ? 'text-slate-400' : 'text-gray-400'}`}>Storage Saved</span>
            <div className="mt-2 flex items-baseline space-x-1.5">
              <span className={`text-2xl font-black ${theme === 'dark' ? 'text-white' : 'text-gray-900'}`}>{storageEst}</span>
              <span className={`text-xs font-semibold ${theme === 'dark' ? 'text-slate-400' : 'text-gray-500'}`}>KB</span>
            </div>
          </div>

          <div className={`p-4 rounded-2xl border shadow-xs flex flex-col justify-between ${theme === 'dark' ? 'bg-slate-900 border-slate-800 text-white' : 'bg-white border-gray-100 text-gray-900'}`}>
            <span className={`text-xs font-bold uppercase tracking-wider ${theme === 'dark' ? 'text-slate-400' : 'text-gray-400'}`}>App Quality</span>
            <div className="mt-2 flex items-baseline space-x-1.5">
              <span className="text-2xl font-black text-green-500">Ultra</span>
              <span className={`text-xs font-semibold ${theme === 'dark' ? 'text-slate-400' : 'text-gray-500'}`}>HD</span>
            </div>
          </div>
        </div>

        {/* Core Quick Tips */}
        <div className={`rounded-2xl border p-5 shadow-xs space-y-3 ${theme === 'dark' ? 'bg-slate-900 border-slate-800 text-white' : 'bg-white border-gray-100 text-gray-900'}`}>
          <h3 className={`font-bold text-sm ${theme === 'dark' ? 'text-white' : 'text-gray-900'}`}>Quick Pro Tips</h3>
          <ul className={`space-y-2 text-xs list-disc list-inside ${theme === 'dark' ? 'text-slate-300' : 'text-gray-600'}`}>
            <li>For maximum clarity, place documents on a high-contrast dark surface.</li>
            <li>Use the Multi-Page merge function in selection mode to generate clean multipage PDF booklets.</li>
            <li>Choose "Document" or "Magic" filter style for dark pen prints.</li>
          </ul>
        </div>
      </div>
    );
  };

  const handleBackupData = async () => {
    try {
      const allDocs = await getDocuments();
      const allFolders = await getFolders();
      const notesStr = localStorage.getItem('docscanner_quick_notes');
      const savedNotes = notesStr ? JSON.parse(notesStr) : [];
      
      const backupData = {
        documents: allDocs,
        folders: allFolders,
        notes: savedNotes,
        version: 1,
        timestamp: Date.now()
      };
      
      const blob = new Blob([JSON.stringify(backupData)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `DocScanner_Backup_${new Date().toISOString().split('T')[0]}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      
      showCustomAlert("Backup created successfully! Save this file to a secure location.");
    } catch (e) {
      console.error(e);
      showCustomAlert("Failed to create backup.");
    }
  };

  const handleRestoreData = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      
      if (!data.documents || !data.folders) {
        showCustomAlert("Invalid backup file format.");
        return;
      }
      
      const confirm = await showCustomConfirm("This will merge the backup with your current data. Do you want to proceed?");
      if (!confirm) {
        if (restoreInputRef.current) restoreInputRef.current.value = "";
        return;
      }
      
      // Save documents
      const allDocs = await getDocuments();
      const existingIds = new Set(allDocs.map(d => d.id));
      for (const doc of data.documents) {
        if (!existingIds.has(doc.id)) {
          await saveDocument(doc);
        }
      }
      
      // Save folders
      const allFolders = await getFolders();
      const existingFolderIds = new Set(allFolders.map(f => f.id));
      for (const folder of data.folders) {
        if (!existingFolderIds.has(folder.id)) {
          await saveFolder(folder);
        }
      }
      
      // Save notes
      if (data.notes && Array.isArray(data.notes)) {
        const notesStr = localStorage.getItem('docscanner_quick_notes');
        const existingNotes = notesStr ? JSON.parse(notesStr) : [];
        const existingNoteIds = new Set(existingNotes.map((n: any) => n.id));
        const mergedNotes = [...existingNotes];
        for (const note of data.notes) {
          if (!existingNoteIds.has(note.id)) {
            mergedNotes.push(note);
          }
        }
        localStorage.setItem('docscanner_quick_notes', JSON.stringify(mergedNotes));
        setNotes(mergedNotes);
      }
      
      const freshDocs = await getDocuments();
      const freshFolders = await getFolders();
      setDocuments(freshDocs);
      setFolders(freshFolders);
      
      showCustomAlert("Data restored successfully!");
    } catch (e) {
      console.error(e);
      showCustomAlert("Failed to restore data. The file might be corrupted.");
    } finally {
      if (restoreInputRef.current) restoreInputRef.current.value = "";
    }
  };

  const renderSettingsTab = () => {
    return (
      <div className="space-y-6">
        <div className={`rounded-2xl border p-5 shadow-xs space-y-4 ${theme === 'dark' ? 'bg-slate-900 border-slate-800 text-white' : 'bg-white border-gray-100 text-gray-900'}`}>
          <h3 className={`font-bold text-sm ${theme === 'dark' ? 'text-white' : 'text-gray-900'}`}>Document View Options</h3>
          
          <div className={`flex items-center justify-between py-2 border-b ${theme === 'dark' ? 'border-slate-800' : 'border-gray-50'}`}>
            <div>
              <p className={`text-sm font-semibold ${theme === 'dark' ? 'text-slate-200' : 'text-gray-800'}`}>Default Layout</p>
              <p className={`text-xs ${theme === 'dark' ? 'text-slate-400' : 'text-gray-400'}`}>Choose between Grid or List layout mode</p>
            </div>
            <div className={`flex rounded-lg p-1 ${theme === 'dark' ? 'bg-slate-950' : 'bg-gray-100'}`}>
              <button 
                onClick={() => setLayout('grid')} 
                className={`touch-target p-1.5 rounded-md text-xs font-bold transition-all ${layout === 'grid' ? theme === 'dark' ? 'bg-slate-800 text-blue-400 shadow-sm' : 'bg-white shadow-sm text-blue-600' : 'text-gray-500'}`}
              >
                Grid
              </button>
              <button 
                onClick={() => setLayout('list')} 
                className={`touch-target p-1.5 rounded-md text-xs font-bold transition-all ${layout === 'list' ? theme === 'dark' ? 'bg-slate-800 text-blue-400 shadow-sm' : 'bg-white shadow-sm text-blue-600' : 'text-gray-500'}`}
              >
                List
              </button>
            </div>
          </div>

          <div className={`flex items-center justify-between py-2 border-b ${theme === 'dark' ? 'border-slate-800' : 'border-gray-50'}`}>
            <div>
              <p className={`text-sm font-semibold ${theme === 'dark' ? 'text-slate-200' : 'text-gray-800'}`}>Sort Sequence</p>
              <p className={`text-xs ${theme === 'dark' ? 'text-slate-400' : 'text-gray-400'}`}>Order scans by date or titles</p>
            </div>
            <select 
              value={sortOrder} 
              onChange={e => setSortOrder(e.target.value as SortOrder)}
              className={`border text-xs font-semibold rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-500 ${theme === 'dark' ? 'bg-slate-950 border-slate-800 text-white' : 'bg-gray-50 border-gray-200 text-gray-800'}`}
            >
              <option value="newest" className={theme === 'dark' ? 'bg-slate-900 text-white' : 'bg-white'}>Newest Scans First</option>
              <option value="oldest" className={theme === 'dark' ? 'bg-slate-900 text-white' : 'bg-white'}>Oldest Scans First</option>
              <option value="alpha" className={theme === 'dark' ? 'bg-slate-900 text-white' : 'bg-white'}>Alphabetical (A-Z)</option>
            </select>
          </div>

          <div className="flex items-center justify-between py-2">
            <div>
              <p className={`text-sm font-semibold ${theme === 'dark' ? 'text-slate-200' : 'text-gray-800'}`}>Default PDF Border</p>
              <p className={`text-xs ${theme === 'dark' ? 'text-slate-400' : 'text-gray-400'}`}>Add a classic margin board border to PDF page downloads</p>
            </div>
            <label className="relative inline-flex items-center cursor-pointer select-none">
              <input 
                type="checkbox" 
                checked={addPdfBorder}
                onChange={(e) => setAddPdfBorder(e.target.checked)}
                className="sr-only peer"
              />
              <div className={`w-11 h-6 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:border after:rounded-full after:h-5 after:w-5 after:transition-all ${theme === 'dark' ? 'bg-slate-800 border-slate-700 after:bg-white after:border-slate-600 peer-checked:bg-blue-600' : 'bg-gray-200 after:bg-white after:border-gray-300 peer-checked:bg-blue-600'}`}></div>
            </label>
          </div>
          <div className="pt-4 border-t border-gray-100 dark:border-slate-800">
            <h3 className={`font-bold text-sm mb-3 ${theme === 'dark' ? 'text-white' : 'text-gray-900'}`}>Haptic Feedback</h3>
            
            <div className="space-y-3">
              {[
                { label: 'Scan Capture', checked: hapticScan, set: setHapticScan },
                { label: 'Export', checked: hapticExport, set: setHapticExport },
                { label: 'Deletion', checked: hapticDelete, set: setHapticDelete },
              ].map(item => (
                <div key={item.label} className="flex items-center justify-between">
                  <p className={`text-sm ${theme === 'dark' ? 'text-slate-300' : 'text-gray-700'}`}>{item.label}</p>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input type="checkbox" checked={item.checked} onChange={e => item.set(e.target.checked)} className="sr-only peer" />
                    <div className={`w-11 h-6 rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:h-5 after:w-5 after:rounded-full after:transition-all ${theme === 'dark' ? 'bg-slate-800 peer-checked:bg-blue-600 after:bg-white' : 'bg-gray-200 peer-checked:bg-blue-600 after:bg-white'}`}></div>
                  </label>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className={`rounded-2xl border p-5 shadow-xs space-y-3 text-center ${theme === 'dark' ? 'bg-slate-900 border-slate-800' : 'bg-white border-gray-100'}`}>
          <p className={`text-xs font-semibold ${theme === 'dark' ? 'text-slate-400' : 'text-gray-500'}`}>Data Management</p>
          
          <div className="flex gap-2">
            <button 
              onClick={handleBackupData}
              className={`flex-1 py-2.5 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1 ${theme === 'dark' ? 'bg-slate-800 text-blue-400 hover:bg-slate-700' : 'bg-blue-50 text-blue-600 hover:bg-blue-100'}`}
            >
              <Download className="w-4 h-4" /> Backup Data
            </button>
            <label className={`flex-1 py-2.5 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1 cursor-pointer ${theme === 'dark' ? 'bg-slate-800 text-green-400 hover:bg-slate-700' : 'bg-green-50 text-green-600 hover:bg-green-100'}`}>
              <Upload className="w-4 h-4" /> Restore Data
              <input type="file" accept=".json" className="hidden" ref={restoreInputRef} onChange={handleRestoreData} />
            </label>
          </div>

          <div className="pt-2">
            <button 
              onClick={async () => {
                const confirmClear = await showCustomConfirm("Are you sure you want to clear all scans? This action is irreversible.");
                if (confirmClear) {
                  try {
                    for (const d of documents) {
                      await deleteDocument(d.id);
                    }
                    setDocuments([]);
                    await showCustomAlert("All scans cleared successfully.");
                  } catch (err: any) {
                    await showCustomAlert("Error: " + err.message);
                  }
                }
              }}
              className={`w-full py-2.5 rounded-xl text-xs font-bold transition-all ${theme === 'dark' ? 'bg-red-950/30 text-red-400 hover:bg-red-950/50' : 'bg-red-50 text-red-600 hover:bg-red-100'}`}
            >
              Clear All Scans Cache
            </button>
          </div>
        </div>
      </div>
    );
  };

  // Home View
  return (
    <>
      <AnimatePresence>
        {showSplash && (
          <motion.div
            initial={{ opacity: 1 }}
            exit={{ opacity: 0, scale: 1.05, filter: "blur(12px)" }}
            transition={{ duration: 0.65, ease: [0.16, 1, 0.3, 1] }}
            className="fixed inset-0 bg-slate-950 z-[9999] flex flex-col items-center justify-center text-white overflow-hidden"
          >
            {/* Glowing ambient radial orbs for depth */}
            <motion.div 
              className="absolute w-[450px] h-[450px] rounded-full bg-blue-600/15 blur-[120px]" 
              animate={{ scale: [1, 1.15, 1], opacity: [0.5, 0.8, 0.5] }} 
              transition={{ repeat: Infinity, duration: 4, ease: "easeInOut" }} 
            />
            <motion.div 
              className="absolute w-[300px] h-[300px] rounded-full bg-red-500/10 blur-[100px]" 
              animate={{ scale: [1, 1.25, 1], opacity: [0.3, 0.6, 0.3] }} 
              transition={{ repeat: Infinity, duration: 5, ease: "easeInOut", delay: 1 }} 
            />

            <motion.div 
              initial={{ scale: 0.7, opacity: 0, y: 30 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              transition={{ duration: 0.9, ease: [0.16, 1, 0.3, 1] }}
              className="relative z-10 flex flex-col items-center"
            >
              {/* Majestic GR7 Logo Container */}
              <div className="w-36 h-36 relative mb-6 drop-shadow-[0_20px_50px_rgba(12,90,112,0.3)] select-none">
                {/* Glowing rotating background indicator */}
                <motion.div 
                  animate={{ rotate: 360 }}
                  transition={{ repeat: Infinity, duration: 25, ease: "linear" }}
                  className="absolute -inset-2.5 rounded-[50px] bg-gradient-to-tr from-[#0c5a70]/40 to-[#e54545]/40 opacity-70 blur-xs"
                />
                <svg viewBox="0 0 160 160" className="w-full h-full relative z-10">
                  <rect x="4" y="4" width="152" height="152" rx="44" fill="#ffffff" stroke="#eef2f6" strokeWidth="8" />
                  <text x="24" y="105" fontFamily="'Inter', system-ui, sans-serif" fontWeight="900" fontSize="74" fill="#0c5a70" letterSpacing="-2">GR</text>
                  <text x="105" y="105" fontFamily="'Inter', system-ui, sans-serif" fontWeight="900" fontSize="84" fill="#e54545">7</text>
                </svg>
              </div>

              {/* Text elements */}
              <motion.h1 
                initial={{ opacity: 0, y: 15 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.35, duration: 0.7 }}
                className="text-2xl font-black tracking-wider text-white uppercase text-center"
              >
                GR7 <span className="text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 to-rose-400">Scanner</span>
              </motion.h1>

              <motion.p 
                initial={{ opacity: 0 }}
                animate={{ opacity: 0.6 }}
                transition={{ delay: 0.6, duration: 0.7 }}
                className="text-xs text-slate-400 font-medium tracking-[0.25em] uppercase mt-2 text-center"
              >
                Document & PDF Digitizer
              </motion.p>

              {/* Loading progress bar */}
              <div className="w-32 h-1 bg-slate-800 rounded-full mt-12 overflow-hidden relative">
                <motion.div 
                  initial={{ left: "-100%" }}
                  animate={{ left: "100%" }}
                  transition={{ repeat: Infinity, duration: 1.8, ease: "easeInOut" }}
                  className="absolute top-0 bottom-0 w-2/3 bg-gradient-to-r from-transparent via-cyan-400 to-transparent"
                />
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className={`flex flex-col h-[100dvh] font-sans relative ${theme === 'dark' ? 'bg-slate-950 text-white' : 'bg-[var(--color-warm-bg)] text-[var(--color-warm-text)]'}`}>
      <div className={`px-4 pb-3 sm:px-6 border-b sticky top-0 safe-pt z-30 flex items-center justify-between transition-colors duration-300 backdrop-blur-xl ${theme === 'dark' ? 'bg-slate-900/90 border-slate-800 text-white' : 'bg-[var(--color-warm-card)]/90 border-[var(--color-warm-border)] shadow-sm'}`}>
        {currentTab === 'home' ? (
          isMultiSelect ? (
          <>
            <div className="flex items-center space-x-2 min-w-0">
              <button onClick={() => { setIsMultiSelect(false); setSelectedDocs(new Set()); }} className={`touch-target p-1.5 rounded-lg -ml-1 ${theme === 'dark' ? 'text-slate-400 hover:text-white hover:bg-slate-800' : 'text-[var(--color-warm-text)] hover:text-black hover:bg-[var(--color-warm-border)]'}`}>
                <X className="w-5 h-5" />
              </button>
              <h1 className={`text-base sm:text-lg font-bold truncate ${theme === 'dark' ? 'text-slate-200' : 'text-[var(--color-warm-text)]'}`}>{selectedDocs.size} Selected</h1>
            </div>
            
            <div className="flex items-center space-x-2 flex-shrink-0">
              <label className="flex items-center space-x-1.5 cursor-pointer mr-1 sm:mr-2" title="Toggle PDF Border">
                <span className={`text-[10px] sm:text-xs font-semibold ${theme === 'dark' ? 'text-slate-400' : 'text-[var(--color-warm-text-muted)]'}`}>Border</span>
                <div className="relative inline-flex items-center">
                  <input 
                    type="checkbox" 
                    checked={addPdfBorder} 
                    onChange={(e) => setAddPdfBorder(e.target.checked)} 
                    className="sr-only peer"
                  />
                  <div className={`w-8 h-4 sm:w-9 sm:h-5 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:border after:rounded-full after:h-3 after:w-3 sm:after:h-4 sm:after:w-4 after:transition-all ${theme === 'dark' ? 'bg-slate-700 border-slate-600 after:bg-slate-300 after:border-slate-500 peer-checked:bg-blue-500' : 'bg-gray-200 after:bg-white after:border-gray-300 peer-checked:bg-blue-600'}`}></div>
                </div>
              </label>
              
              <button 
                onClick={handleRestoreSelected} 
                disabled={selectedDocs.size === 0}
                className={`p-2 rounded-full transition-all disabled:opacity-40 ${theme === 'dark' ? 'text-blue-400 hover:bg-slate-800' : 'text-blue-600 hover:bg-blue-100'}`}
                title="Restore Selected"
              >
                 <Undo className="w-5 h-5" />
              </button>
              
              <button 
                onClick={handleMoveToFolder} 
                disabled={selectedDocs.size === 0}
                className={`p-2 rounded-full transition-all disabled:opacity-40 ${theme === 'dark' ? 'text-indigo-400 hover:bg-slate-800' : 'text-indigo-600 hover:bg-indigo-100'}`}
                title="Move to Folder"
              >
                 <FolderInput className="w-5 h-5" />
              </button>
              {selectedDocs.size > 1 && (
                <button 
                  onClick={handleMergeSelected} 
                  className={`p-2 rounded-full transition-all ${theme === 'dark' ? 'text-blue-400 hover:bg-slate-800' : 'text-blue-600 hover:bg-blue-100'}`}
                  title="Merge into single document"
                >
                   <Combine className="w-5 h-5" />
                </button>
              )}
              <button 
                onClick={handleShareSelected} 
                disabled={selectedDocs.size === 0}
                className={`p-2 rounded-full transition-all disabled:opacity-40 ${theme === 'dark' ? 'text-emerald-400 hover:bg-slate-800' : 'text-emerald-600 hover:bg-emerald-100'}`}
                title="Share Selected"
              >
                 <Share2 className="w-5 h-5" />
              </button>
              <button 
                onClick={handleDeleteSelected} 
                disabled={selectedDocs.size === 0}
                className={`p-2 rounded-full transition-all disabled:opacity-40 ${theme === 'dark' ? 'text-rose-400 hover:bg-slate-800' : 'text-rose-600 hover:bg-rose-100'}`}
                title="Delete Selected"
              >
                 <Trash2 className="w-5 h-5" />
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="flex items-center space-x-2.5 flex-1 select-none">
              <div className="w-10 h-10 flex-shrink-0 flex items-center justify-center">
                <svg viewBox="0 0 160 160" className="w-10 h-10">
                  <rect x="4" y="4" width="152" height="152" rx="44" fill="#ffffff" stroke="#eef2f6" strokeWidth="8" />
                  <text x="24" y="105" fontFamily="'Inter', system-ui, sans-serif" fontWeight="900" fontSize="74" fill="#0c5a70" letterSpacing="-2">GR</text>
                  <text x="105" y="105" fontFamily="'Inter', system-ui, sans-serif" fontWeight="900" fontSize="84" fill="#e54545">7</text>
                </svg>
              </div>
              <h1 className={`text-xl sm:text-2xl font-black tracking-tight ${theme === 'dark' ? 'text-white' : 'text-[#0c5a70]'}`}>Scanner</h1>
            </div>
            <div className="flex items-center space-x-2 flex-shrink-0">
              {documents.length > 0 && (
                <div className={`flex rounded-lg p-0.5 border ${theme === 'dark' ? 'bg-slate-900 border-slate-800' : 'bg-white border-gray-200 shadow-xs'}`}>
                   <button 
                     onClick={() => setLayout('grid')} 
                     className={`w-7 h-7 flex items-center justify-center rounded transition-all ${layout === 'grid' ? (theme === 'dark' ? 'bg-slate-800 text-blue-400' : 'bg-gray-100 text-blue-600') : 'text-gray-400 hover:text-gray-600'}`}
                     title="Grid View"
                   >
                      <LayoutGrid className="w-3.5 h-3.5" />
                   </button>
                   <button 
                     onClick={() => setLayout('list')} 
                     className={`w-7 h-7 flex items-center justify-center rounded transition-all ${layout === 'list' ? (theme === 'dark' ? 'bg-slate-800 text-blue-400' : 'bg-gray-100 text-blue-600') : 'text-gray-400 hover:text-gray-600'}`}
                     title="List View"
                   >
                      <ListIcon className="w-3.5 h-3.5" />
                   </button>
                </div>
              )}
              <button 
                onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}
                className={`w-8 h-8 flex items-center justify-center rounded-lg border transition-all active:scale-95 ${theme === 'dark' ? 'bg-slate-900 border-slate-800 text-yellow-400 hover:bg-slate-800' : 'bg-white border-gray-200 text-gray-750 hover:bg-gray-50 shadow-xs'}`}
                title={theme === 'light' ? 'Switch to Dark Mode' : 'Switch to Light Mode'}
              >
                {theme === 'light' ? <Moon className="w-4 h-4" /> : <Sun className="w-4 h-4" />}
              </button>
            </div>
          </>
        )
        ) : currentTab === 'notes' ? (
          <>
            <div className="flex items-center space-x-2">
              <h1 className={`text-xl sm:text-2xl font-black tracking-tight ${theme === 'dark' ? 'text-white' : 'text-transparent bg-clip-text bg-gradient-to-r from-blue-700 to-indigo-600'}`}>Quick Notes</h1>
              <button 
                onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}
                className={`touch-target p-1.5 rounded-full transition-all active:scale-95 flex-shrink-0 ${theme === 'dark' ? 'text-yellow-400 hover:bg-slate-800' : 'text-slate-500 hover:bg-blue-100/50'}`}
                title="Toggle Theme"
              >
                {theme === 'light' ? <Moon className="w-4.5 h-4.5" /> : <Sun className="w-4.5 h-4.5" />}
              </button>
            </div>
            <button 
              onClick={() => {
                setNewNoteTitle('');
                setNewNoteContent('');
                setNewNoteColor(0);
                setEditingNoteId(null);
                setShowAddNoteModal(true);
              }}
              type="button"
              className="flex items-center space-x-1 text-xs font-semibold bg-blue-600 hover:bg-blue-700 text-white px-3 py-1.5 rounded-lg transition-colors shadow-sm"
            >
              <Plus className="w-4 h-4" />
              <span>Add Note</span>
            </button>
          </>
        ) : currentTab === 'profile' ? (
          <>
            <div className="flex items-center space-x-2">
              <h1 className={`text-xl sm:text-2xl font-black tracking-tight ${theme === 'dark' ? 'text-white' : 'text-transparent bg-clip-text bg-gradient-to-r from-blue-700 to-indigo-600'}`}>My Profile</h1>
              <button 
                onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}
                className={`touch-target p-1.5 rounded-full transition-all active:scale-95 flex-shrink-0 ${theme === 'dark' ? 'text-yellow-400 hover:bg-slate-800' : 'text-slate-500 hover:bg-blue-100/50'}`}
                title="Toggle Theme"
              >
                {theme === 'light' ? <Moon className="w-4.5 h-4.5" /> : <Sun className="w-4.5 h-4.5" />}
              </button>
            </div>
            <div className="text-[10px] bg-amber-100 text-amber-800 px-2.5 py-1 rounded-full font-bold uppercase tracking-wider animate-pulse">
              ★ PRO
            </div>
          </>
        ) : (
          <>
            <div className="flex items-center space-x-2">
              <h1 className={`text-xl sm:text-2xl font-black tracking-tight ${theme === 'dark' ? 'text-white' : 'text-transparent bg-clip-text bg-gradient-to-r from-blue-700 to-indigo-600'}`}>Settings</h1>
              <button 
                onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}
                className={`touch-target p-1.5 rounded-full transition-all active:scale-95 flex-shrink-0 ${theme === 'dark' ? 'text-yellow-400 hover:bg-slate-800' : 'text-slate-500 hover:bg-blue-100/50'}`}
                title="Toggle Theme"
              >
                {theme === 'light' ? <Moon className="w-4.5 h-4.5" /> : <Sun className="w-4.5 h-4.5" />}
              </button>
            </div>
            <span className="text-xs text-gray-400 font-mono">v1.2.0</span>
          </>
        )}
      </div>
      
      {errorMessage && (
        <div className="bg-red-50 border-b border-red-200 px-4 py-2 flex items-center justify-between text-sm text-red-800">
          <span>{errorMessage}</span>
          <button onClick={() => setErrorMessage(null)} className="text-red-500 hover:text-red-700 font-semibold text-xs">Dismiss</button>
        </div>
      )}
      
      <div className={`flex-1 overflow-y-auto p-4 pb-28 transition-colors duration-300 ${theme === 'dark' ? 'bg-slate-950 text-white' : 'bg-[var(--color-warm-bg)] text-[var(--color-warm-text)]'}`}>
        <AnimatePresence mode="wait">
          <motion.div
            key={currentTab}
            initial={{ opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -15 }}
            transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
            className="space-y-6"
          >
            {currentTab === 'home' ? (
          documents.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-gray-400 space-y-4 py-20">
             <FileText className="w-16 h-16 text-gray-300 stroke-[1.5]" />
             <p className={`text-lg font-bold ${theme === 'dark' ? 'text-slate-300' : 'text-[var(--color-warm-text)]'}`}>No documents yet</p>
             <p className="text-sm text-gray-400 text-center">Tap the scan camera button below to start digitizing</p>
          </div>
        ) : (
          <>
             {/* Search input bar */}
             <div className="w-full max-w-xl mx-auto flex items-center space-x-2 py-2 px-0.5 transition-colors duration-300">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                  <input
                    type="text"
                    placeholder="Search documents by title..."
                    value={searchQuery || ''}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className={`w-full pl-9 pr-8 py-1 border rounded-full text-sm transition-all focus:outline-none focus:ring-1 focus:ring-blue-500 placeholder-gray-400 ${theme === 'dark' ? 'bg-slate-900 border-slate-800 text-white focus:border-slate-700' : 'bg-white border-gray-200 text-gray-850 focus:border-gray-300 shadow-xs'}`}
                  />
                  {searchQuery && (
                    <button
                      onClick={() => setSearchQuery('')}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 p-0.5 text-gray-400 hover:text-gray-600 rounded-full"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  )}
                </div>
                {documents.length > 0 && (
                  <div className="flex items-center space-x-1.5 flex-shrink-0">
                    <div className={`relative flex items-center h-8 rounded-full border transition-colors cursor-pointer px-4 ${theme === 'dark' ? 'bg-slate-900 border-slate-800 text-slate-300 hover:bg-slate-800 hover:border-slate-750' : 'bg-white border-gray-200 text-gray-700 hover:bg-gray-50 shadow-xs'}`}>
                      <ArrowDownUp className="w-3 h-3 opacity-60 mr-1 pointer-events-none" />
                      <select 
                        value={sortOrder} 
                        onChange={e => setSortOrder(e.target.value as SortOrder)}
                        className="bg-transparent text-[11px] font-medium appearance-none outline-none cursor-pointer pr-3.5 py-0"
                      >
                        <option value="newest" className={theme === 'dark' ? 'bg-slate-900 text-white' : 'bg-white'}>Newest</option>
                        <option value="oldest" className={theme === 'dark' ? 'bg-slate-900 text-white' : 'bg-white'}>Oldest</option>
                        <option value="alpha" className={theme === 'dark' ? 'bg-slate-900 text-white' : 'bg-white'}>A-Z</option>
                      </select>
                      <ChevronDown className="w-3 h-3 opacity-55 absolute right-1.5 pointer-events-none" />
                    </div>
                    <button 
                      onClick={() => setIsMultiSelect(true)} 
                      className={`flex items-center h-8 px-2 rounded-lg text-[11px] font-medium border transition-all active:scale-95 ${theme === 'dark' ? 'text-blue-400 bg-slate-900 border-slate-800 hover:bg-slate-800' : 'text-blue-600 bg-blue-50 border-blue-100/70 hover:bg-blue-100 shadow-xs'}`}
                      title="Select multiple"
                    >
                      <CheckSquare className="w-3 h-3" />
                      <span className="ml-1 hidden sm:inline-block">Select</span>
                    </button>
                  </div>
                )}
             </div>

              {/* Folders & Filters Section */}
              <div className="w-full max-w-xl mx-auto space-y-2 mt-2">
                <div className="flex items-center justify-between">
                  <h2 className="text-xs font-bold tracking-wider uppercase opacity-65 flex items-center">
                    <FolderOpen className="w-3.5 h-3.5 mr-1" /> Folders
                  </h2>
                  <button 
                    onClick={async () => {
                      const name = await showCustomPrompt("Create New Folder", "Enter new folder name...");
                      if (!name || !name.trim()) return;
                      const newFolder = { id: Date.now().toString(), name: name.trim(), createdAt: Date.now() };
                      await saveFolder(newFolder);
                      const freshFolders = await getFolders();
                      setFolders(freshFolders);
                    }}
                    className={`text-xs font-bold flex items-center px-2 py-1 rounded-lg ${theme === 'dark' ? 'text-blue-400 hover:bg-slate-800' : 'text-blue-600 hover:bg-blue-50'}`}
                  >
                    <FolderPlus className="w-3.5 h-3.5 mr-1" /> Create Folder
                  </button>
                </div>

                <div className="flex items-center space-x-1.5 overflow-x-auto pb-1.5 hide-scrollbar">
                  <button
                    onClick={() => setActiveFolderFilter('all')}
                    className={`shrink-0 px-3 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap transition-all border ${activeFolderFilter === 'all' ? 'bg-blue-600 border-blue-600 text-white shadow-sm' : (theme === 'dark' ? 'bg-slate-900 border-slate-800 text-slate-300 hover:bg-slate-800' : 'bg-white text-gray-650 hover:bg-gray-100 border-gray-200')}`}
                  >
                    All ({documents.filter(d => !d.isTrash).length})
                  </button>
                  <button
                    onClick={() => setActiveFolderFilter('root')}
                    className={`shrink-0 px-3 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap transition-all border ${activeFolderFilter === 'root' ? 'bg-blue-600 border-blue-600 text-white shadow-sm' : (theme === 'dark' ? 'bg-slate-900 border-slate-800 text-slate-300 hover:bg-slate-800' : 'bg-white text-gray-650 hover:bg-gray-100 border-gray-200')}`}
                  >
                    Uncategorized ({documents.filter(d => !d.isTrash && !d.folderId).length})
                  </button>
                  <button
                    onClick={() => setActiveFolderFilter('trash')}
                    className={`shrink-0 px-3 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap transition-all border flex items-center ${activeFolderFilter === 'trash' ? 'bg-red-600 border-red-600 text-white shadow-sm' : (theme === 'dark' ? 'bg-slate-900 border-slate-800 text-red-400 hover:bg-slate-80 border-slate-800' : 'bg-red-50 border-red-200 text-red-750 hover:bg-red-100/70')}`}
                  >
                    <Trash2 className="w-3.5 h-3.5 mr-1" />
                    Trash ({documents.filter(d => d.isTrash).length})
                  </button>
                  {folders.map(folder => {
                    const count = documents.filter(d => !d.isTrash && d.folderId === folder.id).length;
                    const isActive = activeFolderFilter === folder.id;
                    return (
                      <div 
                        key={folder.id} 
                        className={`flex items-center shrink-0 rounded-xl border transition-all text-xs font-semibold whitespace-nowrap overflow-hidden select-none ${
                          isActive 
                            ? 'bg-blue-600 border-blue-600 text-white shadow-xs' 
                            : (theme === 'dark' 
                                ? 'bg-slate-900 border-slate-800 text-slate-300 hover:bg-slate-850 hover:border-slate-700' 
                                : 'bg-white border-gray-200 text-gray-700 hover:bg-gray-50 hover:border-gray-300 shadow-xs')
                        }`}
                      >
                        <button
                          onClick={() => setActiveFolderFilter(folder.id)}
                          className="px-3 py-1.5 flex items-center h-full focus:outline-none"
                        >
                          <FolderOpen className={`w-3.5 h-3.5 mr-1.5 ${isActive ? 'text-white' : 'text-gray-400'}`} />
                          <span>{folder.name}</span>
                          <span className={`ml-1.5 text-[10px] font-bold px-1.5 py-0.25 rounded-full ${isActive ? 'bg-white/20 text-white' : (theme === 'dark' ? 'bg-slate-800 text-slate-400' : 'bg-gray-100 text-gray-500')}`}>
                            {count}
                          </span>
                        </button>
                        <button
                          onClick={async (e) => {
                            e.stopPropagation();
                            const confirmDelete = await showCustomConfirm(`Are you sure you want to delete folder "${folder.name}"? Documents in this folder will become Uncategorized.`);
                            if (confirmDelete) {
                              await deleteFolder(folder.id);
                              const freshFolders = await getFolders();
                              setFolders(freshFolders);
                              if (activeFolderFilter === folder.id) {
                                setActiveFolderFilter('all');
                              }
                            }
                          }}
                          className={`px-2 py-1.5 h-full border-l flex items-center justify-center transition-colors focus:outline-none ${
                            isActive 
                              ? 'border-blue-500/35 hover:bg-blue-700 text-blue-200 hover:text-white' 
                              : (theme === 'dark' 
                                  ? 'border-slate-850 hover:bg-slate-800 hover:text-red-400 text-slate-500' 
                                  : 'border-gray-150 hover:bg-red-50 hover:text-red-600 text-gray-400')
                          }`}
                          title="Delete folder"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>

             {filteredDocs.length === 0 ? (
               <div className="py-12 flex flex-col items-center justify-center text-gray-400 space-y-3">
                  <Search className="w-12 h-12 text-gray-300 animate-pulse" />
                  <p className="text-lg font-medium text-gray-600">No matching scans found</p>
                  <p className="text-sm">Try checking your spelling or search terms</p>
               </div>
             ) : activeFolderFilter !== 'all' && filteredDocs.filter(d => {
                   if (activeFolderFilter === 'trash') return d.isTrash;
                   return (activeFolderFilter === 'root' && !d.folderId) || d.folderId === activeFolderFilter;
                 }).length === 0 ? (
                <div className="py-12 flex flex-col items-center justify-center text-gray-400 space-y-3">
                   <FolderOpen className="w-12 h-12 text-gray-300 stroke-[1.5]" />
                   <p className="text-lg font-medium text-gray-600">This folder is empty</p>
                   <p className="text-xs text-gray-400">Scan a document or move one here to get started</p>
                </div>
             ) : (
                (() => {
                  const foldersToRender = activeFolderFilter === 'all'
                    ? ['root', ...folders.map(f => f.id)]
                    : [activeFolderFilter];
                  
                  return foldersToRender.map(folderId => {
                    const folderName = folderId === 'root' ? 'All Scans' : (folderId === 'trash' ? 'Trash' : folders.find(f => f.id === folderId)?.name);
                    let folderDocs = filteredDocs.filter(d => {
                      if (folderId === 'trash') return d.isTrash;
                      return (folderId === 'root' && !d.folderId) || d.folderId === folderId;
                    });
                 
                    if (folderDocs.length === 0) return null;
               
               folderDocs = folderDocs.sort((a, b) => {
                 if (sortOrder === 'newest') return b.createdAt - a.createdAt;
                 if (sortOrder === 'oldest') return a.createdAt - b.createdAt;
                 if (sortOrder === 'alpha') return a.title.localeCompare(b.title);
                 return 0;
               });

               return (
                 <motion.div layout key={folderId} className="space-y-3">
                   {folderId !== 'root' && (
                     <h2 className={`text-lg font-semibold flex items-center ${theme === 'dark' ? 'text-slate-200' : 'text-[var(--color-warm-text)]'}`}>
                        <FolderInput className="w-5 h-5 mr-2 text-[var(--color-warm-accent)]" />
                        {folderName}
                     </h2>
                   )}
                   {folderId === 'root' && folders.length > 0 && (
                     <h2 className={`text-lg font-semibold ${theme === 'dark' ? 'text-slate-200' : 'text-[var(--color-warm-text)]'}`}>Uncategorized</h2>
                   )}
                   <motion.div layout className={layout === 'grid' ? "grid gap-3 grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5" : "flex flex-col gap-3"}>
                     <AnimatePresence mode="popLayout">
                     {folderDocs.map(doc => {
                       const isSelected = selectedDocs.has(doc.id);
                       return (
                         <motion.div 
                           layout
                           initial={{ opacity: 0, scale: 0.95 }}
                           animate={{ opacity: 1, scale: 1 }}
                           exit={{ opacity: 0, scale: 0.95 }}
                           transition={{ duration: 0.2 }}
                           key={doc.id} 
                           onClick={() => {
                              if (isMultiSelect) {
                                const next = new Set(selectedDocs);
                                if (next.has(doc.id)) next.delete(doc.id);
                                else next.add(doc.id);
                                setSelectedDocs(next);
                              } else {
                                if (doc.isLocked) {
                                  setShowPinModalFor(doc.id);
                                } else {
                                  setCurrentDoc(doc); 
                                  setAppState('view_doc');
                                }
                              }
                           }}
                           onContextMenu={(e) => {
                              e.preventDefault();
                              if (!isMultiSelect) {
                                setIsMultiSelect(true);
                                setSelectedDocs(new Set([doc.id]));
                              }
                           }}
                           className={`rounded-xl shadow-sm border cursor-pointer hover:shadow-md transition-shadow active:scale-[0.98] ${isSelected ? theme === 'dark' ? 'border-[var(--color-warm-accent)] bg-blue-900/40' : 'border-[var(--color-warm-accent)] bg-[var(--color-warm-border)]' : theme === 'dark' ? 'border-slate-800 bg-slate-900' : 'border-[var(--color-warm-border)] bg-[var(--color-warm-card)]'} ${layout === 'grid' ? 'p-2.5 flex flex-col space-y-2' : 'p-3 sm:p-4 flex flex-row items-center space-x-4'}`}
                         >
                            {isMultiSelect && layout === 'list' && (
                              <div className="flex-shrink-0" onClick={(e) => toggleSelection(doc.id, e)}>
                                {isSelected ? <CheckSquare className="w-6 h-6 text-[var(--color-warm-accent)]" /> : <Square className={`w-6 h-6 ${theme === 'dark' ? 'text-slate-600' : 'text-gray-400'}`} />}
                              </div>
                            )}
                            
                            <div className={`rounded overflow-hidden flex-shrink-0 relative ${theme === 'dark' ? 'bg-slate-800 border border-slate-700' : 'bg-white border border-[var(--color-warm-border)]'} ${layout === 'grid' ? 'w-full aspect-[3/4]' : 'w-16 h-20'}`}>
                              {doc.pages[0] && (
                                <img src={doc.pages[0].filteredImage} alt="" className="w-full h-full object-cover" loading="lazy" decoding="async" />
                              )}
                              {isMultiSelect && layout === 'grid' && (
                                <div className="absolute top-1 left-1" onClick={(e) => toggleSelection(doc.id, e)}>
                                   {isSelected ? <CheckSquare className="w-5 h-5 text-[var(--color-warm-accent)] bg-white rounded-sm" /> : <Square className="w-5 h-5 text-gray-400 bg-white/50 rounded-sm" />}
                                </div>
                              )}
                            </div>
                            
                            <div className="flex justify-between items-start w-full">
                              <div className="flex-1 min-w-0">
                                <h3 className={`truncate flex items-center ${layout === 'grid' ? 'font-semibold text-sm' : 'font-semibold'} ${theme === 'dark' ? 'text-slate-200' : 'text-[var(--color-warm-text)]'}`}>
                                  {doc.isLocked && <Lock className="w-3 h-3 mr-1 opacity-70" />}
                                  {doc.title}
                                </h3>
                                <p className={`mt-0.5 ${layout === 'grid' ? 'text-xs' : 'text-sm'} ${theme === 'dark' ? 'text-slate-400' : 'text-[var(--color-warm-text-muted)]'}`}>{new Date(doc.createdAt).toLocaleDateString()}</p>
                                <p className={`mt-0.5 ${layout === 'grid' ? 'text-[10px]' : 'text-xs'} ${theme === 'dark' ? 'text-slate-500' : 'text-[var(--color-warm-text-muted)]'}`}>{doc.pages.length} page{doc.pages.length !== 1 ? 's' : ''}</p>
                              </div>
                              
                              {!isMultiSelect && (
                                <div className="relative flex-shrink-0 ml-1" onClick={(e) => e.stopPropagation()}>
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setActiveMenuDocId(activeMenuDocId === doc.id ? null : doc.id);
                                    }}
                                    className={`touch-target p-1.5 rounded-full transition-colors ${theme === 'dark' ? 'text-slate-400 hover:bg-slate-800' : 'text-gray-500 hover:bg-gray-100'}`}
                                  >
                                    <MoreVertical className="w-5 h-5" />
                                  </button>
                                </div>
                              )}
                            </div>
                         </motion.div>
                       );
                     })}
                     </AnimatePresence>
                   </motion.div>
                 </motion.div>
              );
            });
          })())}
          </>
        )
        ) : currentTab === 'notes' ? (
          renderNotesTab()
        ) : currentTab === 'profile' ? (
          renderProfileTab()
        ) : (
          renderSettingsTab()
        )}
          </motion.div>
        </AnimatePresence>
      </div>

      {renderCustomDialogs()}

      {/* APK Help Modal */}
      {showApkHelp && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setShowApkHelp(false)} />
          <div className={`relative w-full max-w-sm rounded-3xl shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200 ${theme === 'dark' ? 'bg-slate-900 text-white border border-slate-800' : 'bg-white text-gray-800'}`}>
            <div className="p-6">
              <div className="flex items-center space-x-3 mb-4">
                <div className="p-2 bg-blue-100 rounded-xl">
                  <Info className="w-6 h-6 text-blue-600" />
                </div>
                <h2 className="text-xl font-bold">APK Support Help</h2>
              </div>
              
              <div className="space-y-4 text-sm leading-relaxed">
                <div className="p-3 rounded-xl bg-orange-50 border border-orange-100 text-orange-800">
                  <p className="font-bold mb-1">Camera not opening?</p>
                  <p>In your APK settings (Median/GoNative), ensure **Camera Permission** is enabled. Also, check Android app settings for this app.</p>
                </div>
                
                <div className="p-3 rounded-xl bg-blue-50 border border-blue-100 text-blue-800">
                  <p className="font-bold mb-1">Cannot upload multiple images?</p>
                  <p>Some Android WebViews limit gallery selection to one image. Try selecting images one by one or enable "Advanced File Uploads" in your APK dashboard.</p>
                </div>

                <p className={`text-xs ${theme === 'dark' ? 'text-slate-400' : 'text-gray-500'}`}>
                  This app works perfectly in Chrome/Safari browsers. APK behavior depends on your wrapper configuration.
                </p>
              </div>

              <button 
                onClick={() => setShowApkHelp(false)}
                className="w-full mt-6 py-3 bg-blue-600 text-white font-bold rounded-2xl active:scale-95 transition-transform"
              >
                Got it
              </button>
            </div>
          </div>
        </div>
      )}

      {renderFullScreenImageOverlay()}

      {/* Modals */}
      {activeActionDocId && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className={`w-full max-w-sm rounded-2xl p-6 ${theme === 'dark' ? 'bg-slate-900 text-white' : 'bg-white text-gray-900'}`}>
            <h3 className="font-bold text-lg mb-4">Rename Document</h3>
            <input
              type="text"
              value={tempTitle}
              onChange={(e) => setTempTitle(e.target.value)}
              className={`w-full border rounded-xl px-4 py-3 mb-6 focus:outline-none focus:ring-2 focus:ring-blue-500 font-medium ${theme === 'dark' ? 'bg-slate-800 border-slate-700 text-white' : 'bg-gray-50 border-gray-200'}`}
              placeholder="Enter new title..."
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                   const doc = documents.find(d => d.id === activeActionDocId);
                   if (doc) handleRenameDoc(doc, tempTitle || doc.title);
                   setActiveActionDocId(null);
                }
              }}
            />
            <div className="flex justify-end space-x-3">
              <button onClick={() => setActiveActionDocId(null)} className={`px-4 py-2 rounded-xl text-sm font-medium ${theme === 'dark' ? 'text-slate-300 hover:bg-slate-800' : 'text-gray-600 hover:bg-gray-100'}`}>Cancel</button>
              <button onClick={() => {
                const doc = documents.find(d => d.id === activeActionDocId);
                if (doc) handleRenameDoc(doc, tempTitle || doc.title);
                setActiveActionDocId(null);
              }} className="px-4 py-2 bg-blue-600 text-white rounded-xl text-sm font-medium hover:bg-blue-700">Save</button>
            </div>
          </div>
        </div>
      )}

      {showLockSetupFor && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className={`w-full max-w-sm rounded-2xl p-6 ${theme === 'dark' ? 'bg-slate-900 text-white' : 'bg-white text-gray-900'}`}>
            <h3 className="font-bold text-lg mb-2">Set PIN Lock</h3>
            <p className={`text-sm mb-4 ${theme === 'dark' ? 'text-slate-400' : 'text-gray-500'}`}>Enter a 4+ digit PIN to lock this document.</p>
            <input
              type="password"
              inputMode="numeric"
              value={tempPin}
              onChange={(e) => setTempPin(e.target.value)}
              className={`w-full border px-3 py-2 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 mb-6 tracking-widest ${theme === 'dark' ? 'bg-slate-800 border-slate-700 text-white' : 'bg-white border-gray-200'}`}
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter' && tempPin.length >= 4) {
                  const doc = documents.find(d => d.id === showLockSetupFor);
                  if (doc) handleSetupLock(doc, tempPin);
                } else if (e.key === 'Escape') setShowLockSetupFor(null);
              }}
            />
            <div className="flex justify-end space-x-3">
              <button onClick={() => { setShowLockSetupFor(null); setTempPin(''); }} className={`px-4 py-2 rounded-xl text-sm font-medium ${theme === 'dark' ? 'text-slate-300 hover:bg-slate-800' : 'text-gray-600 hover:bg-gray-100'}`}>Cancel</button>
              <button onClick={() => {
                const doc = documents.find(d => d.id === showLockSetupFor);
                if (doc) handleSetupLock(doc, tempPin);
              }} disabled={tempPin.length < 4} className="px-4 py-2 bg-blue-600 text-white rounded-xl text-sm font-medium hover:bg-blue-700 disabled:opacity-50">Set PIN</button>
            </div>
          </div>
        </div>
      )}

      {showPinModalFor && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4 backdrop-blur-sm">
          <div className={`w-full max-w-sm rounded-2xl p-6 ${theme === 'dark' ? 'bg-slate-900 text-white' : 'bg-white text-gray-900'}`}>
            <h3 className="font-bold text-lg mb-2">Unlock Document</h3>
            <p className={`text-sm mb-4 ${theme === 'dark' ? 'text-slate-400' : 'text-gray-500'}`}>Please enter your PIN.</p>
            <input
              type="password"
              inputMode="numeric"
              value={tempPin}
              onChange={(e) => setTempPin(e.target.value)}
              className={`w-full border px-3 py-2 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 mb-4 tracking-widest ${theme === 'dark' ? 'bg-slate-800 border-slate-700 text-white' : 'bg-white border-gray-200'}`}
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  const doc = documents.find(d => d.id === showPinModalFor);
                  if (doc && doc.pin === tempPin) {
                    setShowPinModalFor(null);
                    setTempPin('');
                    setCurrentDoc(doc);
                    setAppState('view_doc');
                  } else {
                    alert("Incorrect PIN");
                  }
                } else if (e.key === 'Escape') {
                  setShowPinModalFor(null);
                  setTempPin('');
                }
              }}
            />
            <div className="flex justify-end space-x-3">
              <button onClick={() => { setShowPinModalFor(null); setTempPin(''); }} className={`px-4 py-2 rounded-xl text-sm font-medium ${theme === 'dark' ? 'text-slate-300 hover:bg-slate-800' : 'text-gray-600 hover:bg-gray-100'}`}>Cancel</button>
              <button onClick={() => {
                const doc = documents.find(d => d.id === showPinModalFor);
                if (doc && doc.pin === tempPin) {
                  setShowPinModalFor(null);
                  setTempPin('');
                  setCurrentDoc(doc);
                  setAppState('view_doc');
                } else {
                  alert("Incorrect PIN");
                }
              }} className="px-4 py-2 bg-blue-600 text-white rounded-xl text-sm font-medium hover:bg-blue-700">Unlock</button>
            </div>
          </div>
        </div>
      )}

      {showFolderSelectFor && (() => {
        const docToSelect = documents.find(d => d.id === showFolderSelectFor);
        const suggestion = docToSelect ? suggestFolderForDoc(docToSelect) : '';
        return (
          <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
            <div className={`w-full max-w-sm rounded-2xl p-6 ${theme === 'dark' ? 'bg-slate-900 text-white' : 'bg-white text-gray-900'}`}>
              <h3 className="font-bold text-lg mb-4">Move to Folder</h3>
              
              {suggestion && (
                <div className={`mb-4 p-3.5 rounded-xl border flex items-center justify-between text-xs transition-colors ${theme === 'dark' ? 'bg-blue-950/40 border-blue-800/80 text-blue-300' : 'bg-blue-50 border-blue-100 text-blue-700'}`}>
                  <div className="flex-1 pr-2">
                    <p className="font-bold flex items-center"><span className="mr-1">💡</span> Smart Auto-Sort</p>
                    <p className="opacity-90 mt-0.5">Categorize as: <strong className="underline">{suggestion}</strong></p>
                  </div>
                  <button 
                    onClick={async () => {
                      let targetFolder = folders.find(f => f.name.toLowerCase() === suggestion.toLowerCase());
                      if (!targetFolder) {
                        targetFolder = { id: Date.now().toString(), name: suggestion, createdAt: Date.now() };
                        await saveFolder(targetFolder);
                        const freshFolders = await getFolders();
                        setFolders(freshFolders);
                      }
                      if (docToSelect) {
                        await handleMoveSingleDocToFolder(docToSelect, targetFolder.id);
                      }
                    }}
                    className="px-2.5 py-1.5 bg-blue-600 text-white font-semibold rounded-lg hover:bg-blue-700 transition-colors shrink-0"
                  >
                    Apply
                  </button>
                </div>
              )}

              <div className={`space-y-2 max-h-60 overflow-y-auto mb-6 pr-2 ${theme === 'dark' ? 'text-slate-200' : 'text-gray-800'}`}>
                <button
                  onClick={() => {
                    if (docToSelect) handleMoveSingleDocToFolder(docToSelect, undefined);
                  }}
                  className={`w-full text-left px-4 py-3 rounded-xl flex items-center ${theme === 'dark' ? 'hover:bg-slate-800 bg-slate-800/50' : 'hover:bg-gray-100 bg-gray-50'}`}
                >
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center mr-3 ${theme === 'dark' ? 'bg-slate-700 text-slate-400' : 'bg-white text-gray-400 shadow-sm'}`}>
                    <FileText className="w-4 h-4" />
                  </div>
                  Uncategorized
                </button>
                {folders.map(folder => (
                  <button
                    key={folder.id}
                    onClick={() => {
                      if (docToSelect) handleMoveSingleDocToFolder(docToSelect, folder.id);
                    }}
                    className={`w-full text-left px-4 py-3 rounded-xl flex items-center ${theme === 'dark' ? 'hover:bg-slate-800 bg-slate-800/50' : 'hover:bg-gray-100 bg-gray-50'}`}
                  >
                    <div className="w-8 h-8 rounded-full flex items-center justify-center mr-3 bg-blue-100 text-blue-600 shadow-sm">
                      <FolderOpen className="w-4 h-4" />
                    </div>
                    {folder.name}
                  </button>
                ))}
              </div>
              <div className="flex justify-between mt-4">
                <button 
                  onClick={async () => {
                     const folderName = await showCustomPrompt("Create New Folder", "Enter new folder name...");
                     if (!folderName || !folderName.trim()) return;
                     const newFolder = { id: Date.now().toString(), name: folderName.trim(), createdAt: Date.now() };
                     await saveFolder(newFolder);
                     const freshFolders = await getFolders();
                     setFolders(freshFolders);
                  }} 
                  className={`px-4 py-2 rounded-xl text-sm font-medium ${theme === 'dark' ? 'text-blue-400 hover:bg-slate-800' : 'text-blue-600 hover:bg-blue-50'}`}
                >
                  + New Folder
                </button>
                <button onClick={() => setShowFolderSelectFor(null)} className={`px-4 py-2 rounded-xl text-sm font-medium ${theme === 'dark' ? 'text-slate-300 hover:bg-slate-800' : 'text-gray-600 hover:bg-gray-100'}`}>Cancel</button>
              </div>
            </div>
          </div>
        );
      })()}

      {showMultiFolderSelect && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className={`w-full max-w-sm rounded-2xl p-6 ${theme === 'dark' ? 'bg-slate-900 text-white' : 'bg-white text-gray-900'}`}>
            <h3 className="font-bold text-lg mb-4">Move {selectedDocs.size} Files to Folder</h3>

            <div className={`space-y-2 max-h-60 overflow-y-auto mb-6 pr-2 ${theme === 'dark' ? 'text-slate-200' : 'text-gray-800'}`}>
              <button
                onClick={() => handleMoveSelectedToFolder(undefined)}
                className={`w-full text-left px-4 py-3 rounded-xl flex items-center ${theme === 'dark' ? 'hover:bg-slate-800 bg-slate-800/50' : 'hover:bg-gray-100 bg-gray-50'}`}
              >
                <div className={`w-8 h-8 rounded-full flex items-center justify-center mr-3 ${theme === 'dark' ? 'bg-slate-700 text-slate-400' : 'bg-white text-gray-400 shadow-sm'}`}>
                  <FileText className="w-4 h-4" />
                </div>
                Uncategorized
              </button>
              {folders.map(folder => (
                <button
                  key={folder.id}
                  onClick={() => handleMoveSelectedToFolder(folder.id)}
                  className={`w-full text-left px-4 py-3 rounded-xl flex items-center ${theme === 'dark' ? 'hover:bg-slate-800 bg-slate-800/50' : 'hover:bg-gray-100 bg-gray-50'}`}
                >
                  <div className="w-8 h-8 rounded-full flex items-center justify-center mr-3 bg-blue-100 text-blue-600 shadow-sm">
                    <FolderOpen className="w-4 h-4" />
                  </div>
                  {folder.name}
                </button>
              ))}
            </div>

            <div className="flex justify-between mt-4">
              <button 
                onClick={async () => {
                   const folderName = await showCustomPrompt("Create New Folder", "Enter new folder name...");
                   if (!folderName || !folderName.trim()) return;
                   const newFolder = { id: Date.now().toString(), name: folderName.trim(), createdAt: Date.now() };
                   await saveFolder(newFolder);
                   const freshFolders = await getFolders();
                   setFolders(freshFolders);
                }} 
                className={`px-4 py-2 rounded-xl text-sm font-medium ${theme === 'dark' ? 'text-blue-400 hover:bg-slate-800' : 'text-blue-600 hover:bg-blue-50'}`}
              >
                + New Folder
              </button>
              <button onClick={() => setShowMultiFolderSelect(false)} className={`px-4 py-2 rounded-xl text-sm font-medium ${theme === 'dark' ? 'text-slate-300 hover:bg-slate-800' : 'text-gray-600 hover:bg-gray-100'}`}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {renderExportModal()}
      {renderPdfProgressModal()}

      {/* Hidden File Inputs */}
      <input 
         type="file" 
         accept="image/*"
         multiple
         className="hidden" 
         ref={fileInputGalleryRef}
         onChange={handleCapture}
      />
      <input 
         type="file" 
         accept="image/*"
         capture="environment" 
         className="hidden" 
         ref={fileInputCameraRef}
         onChange={handleCapture}
      />

      {/* Batch Processing Overlay */}
      {renderBatchProgressOverlay()}

      {/* Bottom Tab Bar Navigation Footer */}
      <div className={`fixed bottom-0 left-0 right-0 backdrop-blur-md border-t pt-2.5 pb-[max(0.625rem,env(safe-area-inset-bottom))] px-6 safe-pl safe-pr flex items-center justify-between z-40 shadow-xl max-w-lg mx-auto sm:rounded-t-2xl transition-colors duration-300 ${theme === 'dark' ? 'bg-slate-900/95 border-slate-800' : 'bg-[var(--color-warm-card)]/95 border-[var(--color-warm-border)]'}`}>
        {/* Home Tab */}
        <button 
          onClick={() => setCurrentTab('home')}
          type="button"
          className={`flex flex-col items-center justify-center flex-1 py-1 transition-all ${currentTab === 'home' ? (theme === 'dark' ? 'text-indigo-400 scale-105' : 'text-[var(--color-warm-text)] scale-105') : (theme === 'dark' ? 'text-slate-500 hover:text-slate-300' : 'text-[var(--color-warm-text-muted)] hover:text-[var(--color-warm-text)]')}`}
        >
          <Home className="w-5 h-5 stroke-[2.5]" />
          <span className="text-[10px] font-extrabold mt-1 tracking-wide">Home</span>
        </button>

        {/* Notes Tab */}
        <button 
          onClick={() => setCurrentTab('notes')}
          type="button"
          className={`flex flex-col items-center justify-center flex-1 py-1 transition-all ${currentTab === 'notes' ? (theme === 'dark' ? 'text-indigo-400 scale-105' : 'text-[var(--color-warm-text)] scale-105') : (theme === 'dark' ? 'text-slate-500 hover:text-slate-300' : 'text-[var(--color-warm-text-muted)] hover:text-[var(--color-warm-text)]')}`}
        >
          <StickyNote className="w-5 h-5 stroke-[2.5]" />
          <span className="text-[10px] font-extrabold mt-1 tracking-wide">Notes</span>
        </button>

        {/* Scan Core Center Button */}
        <div className="relative -mt-6 flex flex-col items-center justify-center flex-1">
          <button 
            onClick={() => { triggerHapticLight('scan'); setShowScanMenu(!showScanMenu); }}
            type="button"
            className={`w-14 h-14 rounded-full shadow-lg flex items-center justify-center hover:shadow-xl active:scale-95 transition-all border-4 ${theme === 'dark' ? 'bg-indigo-600 text-white border-slate-900' : 'bg-[var(--color-warm-accent)] text-white border-[var(--color-warm-card)]'}`}
          >
            <Camera className="w-6 h-6" />
          </button>
          <span className={`text-[10px] font-extrabold mt-1 tracking-wide ${theme === 'dark' ? 'text-slate-500' : 'text-[var(--color-warm-text-muted)]'}`}>Scan</span>

          {/* Core Scan Popover Menu */}
          {showScanMenu && (
            <>
              {/* Overlay Backdrop to close menu */}
              <div className="fixed inset-0 z-30" onClick={() => setShowScanMenu(false)} />
              
              <div className={`absolute bottom-18 rounded-2xl shadow-2xl p-2.5 w-44 flex flex-col space-y-1 z-40 animate-in slide-in-from-bottom-5 duration-200 border ${theme === 'dark' ? 'bg-slate-800 border-slate-700' : 'bg-[var(--color-warm-card)] border-[var(--color-warm-border)]'}`}>
                <button 
                  onClick={() => {
                    triggerHapticLight('scan');
                    setCameraMode("single"); setShowCustomCamera(true);
                    setShowScanMenu(false);
                  }}
                  type="button"
                  className={`flex items-center space-x-3 w-full px-3 py-2 text-sm rounded-xl transition-colors font-semibold ${theme === 'dark' ? 'text-slate-200 hover:bg-slate-700' : 'text-[var(--color-warm-text)] hover:bg-[var(--color-warm-border)]'}`}
                >
                  <Camera className={`w-4 h-4 ${theme === 'dark' ? 'text-indigo-400' : 'text-[var(--color-warm-accent)]'}`} />
                  <span>Scan Camera</span>
                </button>
                <button 
                  onClick={() => {
                    fileInputGalleryRef.current?.click();
                    setShowScanMenu(false);
                  }}
                  type="button"
                  className={`flex items-center space-x-3 w-full px-3 py-2 text-sm rounded-xl transition-colors font-semibold ${theme === 'dark' ? 'text-slate-200 hover:bg-slate-700' : 'text-[var(--color-warm-text)] hover:bg-[var(--color-warm-border)]'}`}
                >
                  <ImageIcon className={`w-4 h-4 ${theme === 'dark' ? 'text-indigo-400' : 'text-[var(--color-warm-accent)]'}`} />
                  <span>Scan Gallery</span>
                </button>
                <div className="border-t border-gray-100 my-1" />
                <button 
                  onClick={async () => {
                    const name = await showCustomPrompt("Create New Folder", "Enter folder name...");
                    if (name && name.trim()) {
                      const newFolder = {
                        id: Date.now().toString(),
                        name: name.trim(),
                        createdAt: Date.now()
                      };
                      await saveFolder(newFolder);
                      const freshFolders = await getFolders();
                      setFolders(freshFolders);
                    }
                    setShowScanMenu(false);
                  }}
                  type="button"
                  className="hidden flex items-center space-x-3 w-full px-3 py-2 text-sm text-gray-700 hover:bg-blue-50 rounded-xl transition-colors font-semibold"
                >
                  <FolderPlus className="w-4 h-4 text-indigo-600" />
                  <span>Create Folder</span>
                </button>
              </div>
            </>
          )}
        </div>

        {/* Profile Tab */}
        <button 
          onClick={() => setCurrentTab('profile')}
          type="button"
          className={`flex flex-col items-center justify-center flex-1 py-1 transition-all ${currentTab === 'profile' ? (theme === 'dark' ? 'text-indigo-400 scale-105' : 'text-[var(--color-warm-text)] scale-105') : (theme === 'dark' ? 'text-slate-500 hover:text-slate-300' : 'text-[var(--color-warm-text-muted)] hover:text-[var(--color-warm-text)]')}`}
        >
          <User className="w-5 h-5 stroke-[2.5]" />
          <span className="text-[10px] font-extrabold mt-1 tracking-wide">Profile</span>
        </button>

        {/* Settings Tab */}
        <button 
          onClick={() => setCurrentTab('settings')}
          type="button"
          className={`flex flex-col items-center justify-center flex-1 py-1 transition-all ${currentTab === 'settings' ? (theme === 'dark' ? 'text-indigo-400 scale-105' : 'text-[var(--color-warm-text)] scale-105') : (theme === 'dark' ? 'text-slate-500 hover:text-slate-300' : 'text-[var(--color-warm-text-muted)] hover:text-[var(--color-warm-text)]')}`}
        >
          <Settings className="w-5 h-5 stroke-[2.5]" />
          <span className="text-[10px] font-extrabold mt-1 tracking-wide">Settings</span>
        </button>
      </div>
    </div>
    </>
  );
}
