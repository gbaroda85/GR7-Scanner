import { convertFilesToImageFiles } from "./lib/fileImport";
import React, { useState, useEffect, useRef, useMemo } from 'react';
import { FileDown, Camera, Image as ImageIcon, Plus, FileText, ChevronRight, Download, Trash2, ArrowLeft, Share2, CheckSquare, Square, X, ArrowDownUp, LayoutGrid, List as ListIcon, FolderInput, FolderPlus, Combine, Pencil, Check, Search, ArrowUp, ArrowDown, GripVertical, Home, StickyNote, User, Settings, Sun, Moon, Crop, MoreVertical, Lock, Unlock, FileArchive, FolderOpen, Mail, Undo, ZoomIn, ZoomOut } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { getDocuments, saveDocument, deleteDocument, getFolders, saveFolder, deleteFolder } from './lib/store';
import { Document, DocumentPage, Point, FilterType, Folder, QueueItem, WatermarkOptions } from './types';
import CropView from './components/CropView';
import FilterView from './components/FilterView';
import { warpPerspective, downscaleImage, detectDocumentCorners, applyFilter, loadImage, addWatermarkToImage } from './lib/image';
import { generatePDF } from './lib/pdf';
import JSZip from 'jszip';

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


  const [autoCleanupDays, setAutoCleanupDays] = useState<number>(() => {
    try {
      const stored = localStorage.getItem('docscanner_cleanup');
      return stored ? parseInt(stored, 10) : 30;
    } catch {
      return 30;
    }
  });

  useEffect(() => {
    localStorage.setItem('docscanner_cleanup', autoCleanupDays.toString());
  }, [autoCleanupDays]);
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
  const [showExportModalFor, setShowExportModalFor] = useState<string | null>(null);
  const [exportPassword, setExportPassword] = useState('');
  const [exportQuality, setExportQuality] = useState<number>(1);
  const [exportFormat, setExportFormat] = useState<'pdf' | 'images' | 'zip'>('pdf');
  const [tempPin, setTempPin] = useState('');
  const [activeActionDocId, setActiveActionDocId] = useState<string | null>(null);
  
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

  
  
  useEffect(() => {
    // Handle files shared via share_target (mobile)
    const handleMessage = (event: MessageEvent) => {
      if (event.data && event.data.type === 'SHARED_FILES') {
        const files = event.data.files as File[];
        if (files && files.length > 0) {
          processIncomingFiles(files);
        }
      }
    };
    
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.addEventListener('message', handleMessage);
      
      // Tell SW we are ready to receive any pending shared files
      if (navigator.serviceWorker.controller) {
        navigator.serviceWorker.controller.postMessage({ type: 'APP_READY' });
      }
    }

    // Handle files opened via file_handlers (desktop)
    if ('launchQueue' in window) {
      (window as any).launchQueue.setConsumer(async (launchParams: any) => {
        if (launchParams.files && launchParams.files.length > 0) {
          const files: File[] = [];
          for (const handle of launchParams.files) {
            const file = await handle.getFile();
            files.push(file);
          }
          if (files.length > 0) {
            processIncomingFiles(files);
          }
        }
      });
    }

    return () => {
      if ('serviceWorker' in navigator) {
        navigator.serviceWorker.removeEventListener('message', handleMessage);
      }
    };
  }, []);
  
const processIncomingFiles = async (rawFiles: File[]) => {
    if (rawFiles.length === 0) return;
    setIsProcessingBatch(true);
    setTotalBatchFiles(rawFiles.length);
    setProcessedBatchFiles(0);
    
    // Check if we need to convert PDFs to images
    const files = await convertFilesToImageFiles(rawFiles, (msg) => {
      // We can use an existing progress text state, or just console.log
      console.log(msg);
    });

    if (files.length === 0) {
      setIsProcessingBatch(false);
      return;
    }

    setTotalBatchFiles(files.length);
    setProcessedBatchFiles(0);
    
    const processFile = async (file: File): Promise<QueueItem | null> => {
      let objectUrl: string | null = null;
      try {
        objectUrl = URL.createObjectURL(file);
        if (!objectUrl) {
          setProcessedBatchFiles(prev => Math.min(prev + 1, files.length));
          return null;
        }

        let finalUrl = '';
        try {
           finalUrl = await downscaleImage(objectUrl, 2400);
        } catch (e) {
           finalUrl = await new Promise<string>((resolve) => {
             const reader = new FileReader();
             reader.onload = (e) => resolve((e.target?.result as string) || '');
             reader.readAsDataURL(file);
           });
        }

        const img = await loadImage(finalUrl);
        let corners = detectDocumentCorners(img);
        
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
        return { url: finalUrl, corners: corners };
      } catch (err) {
        console.error("Error processing file in queue:", err);
        if (objectUrl) URL.revokeObjectURL(objectUrl);
        setProcessedBatchFiles(prev => Math.min(prev + 1, files.length));
        return null;
      }
    };

    const runInQueue = async (files: File[], limit: number): Promise<QueueItem[]> => {
      const results = new Array<QueueItem | null>(files.length).fill(null);
      let index = 0;
      const worker = async () => {
        while (index < files.length) {
          const currentIndex = index++;
          results[currentIndex] = await processFile(files[currentIndex]);
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
        alert("Could not process the files. Please try again.");
      }
    } catch (err) {
      console.error("Error processing captured batch:", err);
      alert("Error processing the files.");
    } finally {
      setIsProcessingBatch(false);
    }
  };

  const handleCapture = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const inputElement = e.target;
    const files = Array.from(inputElement.files || []) as File[];
    await processIncomingFiles(files);
    inputElement.value = '';
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

  const downloadFile = (blob: Blob, filename: string) => {
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
      const blob = await generatePDF(doc, { drawBorder: addPdfBorder });
      
      // On mobile, navigator.share is much more reliable than <a> download
      const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
      const file = new File([blob], `${doc.title}.pdf`, { type: 'application/pdf' });
      
      if (isMobile && navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
        try {
          await navigator.share({
            files: [file],
            title: doc.title,
          });
          return;
        } catch (shareErr) {
          console.warn("Share failed, falling back to download", shareErr);
        }
      }

      downloadFile(blob, `${doc.title}.pdf`);
    } catch (e) {
      console.error("Failed to generate PDF", e);
      setErrorMessage("Could not generate PDF. Please try again.");
    }
  };

  const handleSharePDF = async (doc: Document) => {
    try {
      const blob = await generatePDF(doc, { drawBorder: addPdfBorder });
      const file = new File([blob], `${doc.title}.pdf`, { type: 'application/pdf' });
      if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
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
    }
  };

  const handleRestoreDoc = async (id: string) => {
    const doc = documents.find(d => d.id === id);
    if (!doc) return;

    try {
      const updatedDoc = { ...doc, isTrash: false };
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
        await deleteDocument(id);
        setDocuments(prev => prev.filter(d => d.id !== id));
      } else {
        const confirmTrash = await showCustomConfirm(`Move "${doc.title}" to Trash?`);
        if (!confirmTrash) return;
        const updatedDoc = { ...doc, isTrash: true, trashedAt: Date.now() };
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
      const confirmDelete = await showCustomConfirm("This document only has one page. Deleting this page will delete the entire document. Do you want to proceed?");
      if (confirmDelete) {
        await handleDeleteDoc(doc.id);
      }
      return;
    }

    const confirmDeletePage = await showCustomConfirm(`Are you sure you want to delete Page ${pageIndex + 1}?`);
    if (confirmDeletePage) {
      const updatedPages = [...doc.pages];
      updatedPages.splice(pageIndex, 1);
      const updatedDoc = { ...doc, pages: updatedPages };
      try {
        await saveDocument(updatedDoc);
        setDocuments(prev => prev.map(d => d.id === updatedDoc.id ? updatedDoc : d));
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
          watermark: watermarkConfig
        });
        
        const file = new File([blob], `${doc.title}.pdf`, { type: 'application/pdf' });
        
        if (action === 'save') {
          downloadFile(blob, `${doc.title}.pdf`);
        } else if (action === 'email') {
          // Check if we can share with files (preferred for attachments)
          if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
            try {
              await navigator.share({
                files: [file],
                title: doc.title,
                text: `Please find attached the scanned PDF document "${doc.title}".`
              });
              setAppState('home');
              setShowExportModalFor(null);
              return;
            } catch (shareErr) {
              console.warn("Share via email failed, falling back:", shareErr);
            }
          }

          // Fallback to mailto + download
          const subject = encodeURIComponent(`Scanned Document: ${doc.title}`);
          const body = encodeURIComponent(`I have scanned a document for you: "${doc.title}".\n\nNote: The PDF has been downloaded to my device because standard email links don't support attachments directly. I am attaching it manually now.\n\nSent from Mobile PDF Scanner & Creator.`);
          window.location.href = `mailto:?subject=${subject}&body=${body}`;

          // Also download for easy attachment
          downloadFile(blob, `${doc.title}.pdf`);
          
          showCustomAlert("Email App Opened: Standard email links cannot attach files automatically. The PDF has been downloaded to your device so you can attach it to the email manually.");
        } else {
          try {
            if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
              await navigator.share({
                files: [file],
                title: doc.title,
              });
            } else {
              throw new Error("unsupported");
            }
          } catch (shareErr) {
            // fallback
            downloadFile(blob, `${doc.title}.pdf`);
            await showCustomAlert("System sharing is not fully supported in this browser. The PDF has been downloaded to your device instead.");
          }
        }
      } catch (e) {
        console.error("Export failed", e);
      }
    } else if (exportFormat === 'images') {
      if (action === 'save') {
        await handleDownloadImages(doc, watermarkConfig);
      } else if (action === 'email') {
        const subject = encodeURIComponent(`Scanned Images: ${doc.title}`);
        const body = encodeURIComponent(`Please find attached the images from scanned document "${doc.title}".\n\nSent from Mobile PDF Scanner & Creator.`);
        window.location.href = `mailto:?subject=${subject}&body=${body}`;
        await handleDownloadImages(doc, watermarkConfig);
      } else {
        try {
          const files = await Promise.all(doc.pages.map(async (page, i) => {
            let src = page.filteredImage;
            if (watermarkConfig) {
              src = await addWatermarkToImage(src, watermarkConfig);
            }
            const res = await fetch(src);
            const blob = await res.blob();
            return new File([blob], `${doc.title}_Page_${i + 1}.jpg`, { type: 'image/jpeg' });
          }));
          try {
            if (navigator.share && navigator.canShare && navigator.canShare({ files })) {
              await navigator.share({ files, title: doc.title });
            } else {
              throw new Error("unsupported");
            }
          } catch (shareErr) {
            await handleDownloadImages(doc, watermarkConfig);
            await showCustomAlert("System sharing is not fully supported in this browser. The images have been downloaded to your device instead.");
          }
        } catch (e) {
          console.error("Failed to share images", e);
        }
      }
    } else if (exportFormat === 'zip') {
      if (action === 'save') {
        await handleDownloadZip(doc, watermarkConfig);
      } else if (action === 'email') {
        const subject = encodeURIComponent(`ZIP Archive: ${doc.title}`);
        const body = encodeURIComponent(`Please find attached the ZIP archive containing scanned images of "${doc.title}".\n\nSent from Mobile PDF Scanner & Creator.`);
        window.location.href = `mailto:?subject=${subject}&body=${body}`;
        await handleDownloadZip(doc, watermarkConfig);
      } else {
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
          const file = new File([zipBlob], `${doc.title}.zip`, { type: 'application/zip' });
          try {
            if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
              await navigator.share({ files: [file], title: doc.title });
            } else {
              throw new Error("unsupported");
            }
          } catch (shareErr) {
            await handleDownloadZip(doc, watermarkConfig);
            await showCustomAlert("System sharing is not fully supported in this browser. The ZIP file has been downloaded to your device instead.");
          }
        } catch(e) {}
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

    await Promise.all(docsToProcess.map(d => saveDocument({ ...d, isTrash: false })));
    
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
      await Promise.all(docsToProcess.map(d => saveDocument({ ...d, isTrash: true, trashedAt: Date.now() })));
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
       const files = await Promise.all(docsToShare.map(async doc => {
         const blob = await generatePDF(doc, { drawBorder: addPdfBorder });
         return new File([blob], `${doc.title}.pdf`, { type: 'application/pdf' });
       }));
       
       try {
          if (navigator.share && navigator.canShare && navigator.canShare({ files })) {
             await navigator.share({
                files,
                title: "Shared Documents",
             });
          } else {
             throw new Error("unsupported");
          }
       } catch (shareErr) {
          for (const doc of docsToShare) {
             const blob = await generatePDF(doc, { drawBorder: addPdfBorder });
             downloadFile(blob, `${doc.title}.pdf`);
          }
          await showCustomAlert("System sharing is not fully supported in this browser. The PDFs have been downloaded to your device instead.");
       }
    } catch (e: any) {
       if (e.name !== 'AbortError') {
         console.error(e);
         await showCustomAlert("Failed to share: " + e.message);
       }
    }
  };

  
  const handleDownloadCombinedPDF = async () => {
    const docsToMerge = documents.filter(d => selectedDocs.has(d.id));
    if (docsToMerge.length === 0) return;
    
    docsToMerge.sort((a, b) => a.createdAt - b.createdAt);
    const allPages = docsToMerge.flatMap(d => d.pages);
    
    if (allPages.length === 0) {
      setErrorMessage("No pages to export.");
      return;
    }
    
    const combinedDoc = {
      id: "combined-temp",
      title: `Combined PDF ${new Date().toLocaleDateString()}`,
      createdAt: Date.now(),
      pages: allPages
    };
    
    try {
      const blob = await generatePDF(combinedDoc, { drawBorder: addPdfBorder });
      downloadFile(blob, `Combined_PDF_${new Date().getTime()}.pdf`);
      setIsMultiSelect(false);
      setSelectedDocs(new Set());
    } catch (e) {
      console.error("Failed to generate combined PDF", e);
      setErrorMessage("Could not generate combined PDF.");
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
        if (navigator.share && navigator.canShare && navigator.canShare({ files })) {
          await navigator.share({
            files,
            title: doc.title,
          });
        } else {
          throw new Error("unsupported");
        }
      } catch (shareErr) {
        await handleDownloadImages(doc);
        await showCustomAlert("System sharing is not fully supported in this browser. The images have been downloaded to your device instead.");
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
          await saveDocument(d);
       });
       
    await Promise.all(savePromises);
    const freshDocs = await getDocuments();
    setDocuments(freshDocs);
    setSelectedDocs(new Set());
    setIsMultiSelect(false);
    setShowMultiFolderSelect(false);
  };

  const renderExportModal = () => {
    if (!showExportModalFor) return null;
    const doc = documents.find(d => d.id === showExportModalFor);
    if (!doc) return null;
    return (
      <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
        <div className={`w-full max-w-md rounded-2xl p-6 max-h-[85vh] overflow-y-auto ${theme === 'dark' ? 'bg-slate-900 text-white' : 'bg-white text-gray-900'} shadow-2xl border ${theme === 'dark' ? 'border-slate-800' : 'border-gray-100'}`}>
          <h3 className="font-bold text-xl mb-4">Export Options</h3>
          <div className="space-y-5">
            
            <div>
              <label className="block text-sm font-medium mb-2">Format</label>
              <div className="flex bg-gray-100 rounded-lg p-1 dark:bg-slate-800">
                <button 
                  onClick={() => setExportFormat('pdf')} 
                  className={`flex-1 text-sm py-2 rounded-md font-medium transition-all ${exportFormat === 'pdf' ? (theme === 'dark' ? 'bg-slate-700 shadow text-white' : 'bg-white shadow text-black') : 'text-gray-500 hover:text-gray-700 dark:text-slate-400'}`}
                >
                  PDF
                </button>
                <button 
                  onClick={() => setExportFormat('images')} 
                  className={`flex-1 text-sm py-2 rounded-md font-medium transition-all ${exportFormat === 'images' ? (theme === 'dark' ? 'bg-slate-700 shadow text-white' : 'bg-white shadow text-black') : 'text-gray-500 hover:text-gray-700 dark:text-slate-400'}`}
                >
                  Images
                </button>
                <button 
                  onClick={() => setExportFormat('zip')} 
                  className={`flex-1 text-sm py-2 rounded-md font-medium transition-all ${exportFormat === 'zip' ? (theme === 'dark' ? 'bg-slate-700 shadow text-white' : 'bg-white shadow text-black') : 'text-gray-500 hover:text-gray-700 dark:text-slate-400'}`}
                >
                  ZIP
                </button>
              </div>
            </div>

            {exportFormat === 'pdf' && (
              <>
                <div>
                  <label className="block text-sm font-medium mb-2">Size / Quality</label>
                  <select 
                    value={exportQuality} 
                    onChange={(e) => setExportQuality(Number(e.target.value))}
                    className={`w-full p-2.5 rounded-xl border text-sm focus:ring-2 focus:ring-blue-500 outline-none ${theme === 'dark' ? 'bg-slate-800 border-slate-700 text-white' : 'bg-gray-50 border-gray-200'}`}
                  >
                    <option value={1}>Original Quality (~Max Size)</option>
                    <option value={0.75}>High Quality (~75% Size)</option>
                    <option value={0.5}>Medium Quality (~50% Size)</option>
                    <option value={0.3}>Low Quality (Smallest Size)</option>
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium mb-2">Password Protection <span className="text-xs text-gray-500 font-normal">(Optional)</span></label>
                  <input 
                    type="password" 
                    placeholder="Leave blank for no password" 
                    value={exportPassword}
                    onChange={(e) => setExportPassword(e.target.value)}
                    className={`w-full px-4 py-2.5 rounded-xl border text-sm focus:ring-2 focus:ring-blue-500 outline-none ${theme === 'dark' ? 'bg-slate-800 border-slate-700 placeholder-slate-500' : 'bg-gray-50 border-gray-200'}`}
                  />
                </div>
              </>
            )}

            {/* Watermark Section */}
            <div className="border-t pt-4 border-gray-100 dark:border-slate-800">
              <div className="flex items-center justify-between mb-3">
                <label className="text-sm font-semibold flex items-center">
                  <span className="mr-1.5 text-base">🛡️</span> Watermark Document
                </label>
                <label className="relative inline-flex items-center cursor-pointer select-none">
                  <input 
                    type="checkbox" 
                    checked={watermarkEnabled} 
                    onChange={(e) => setWatermarkEnabled(e.target.checked)} 
                    className="sr-only peer"
                  />
                  <div className={`w-9 h-5 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:border after:rounded-full after:h-4 after:w-4 after:transition-all ${theme === 'dark' ? 'bg-slate-700 border-slate-600 after:bg-slate-300 after:border-slate-500 peer-checked:bg-blue-500' : 'bg-gray-200 after:bg-white after:border-gray-300 peer-checked:bg-blue-600'}`}></div>
                </label>
              </div>

              {watermarkEnabled && (
                <div className={`space-y-3 p-3.5 rounded-xl border text-xs ${theme === 'dark' ? 'bg-slate-800/40 border-slate-800/80' : 'bg-gray-50 border-gray-100'}`}>
                  {/* Miniature Preview Area */}
                    <div className={`mb-4`}>
                      <label className="block font-semibold mb-2 text-[10px] opacity-70 uppercase tracking-wider">Live Preview</label>
                      <div className={`relative h-40 w-28 mx-auto rounded-sm shadow-md overflow-hidden flex items-center justify-center border transition-colors ${theme === 'dark' ? 'bg-slate-900 border-slate-700' : 'bg-white border-gray-200'}`}>
                        <div className={`absolute inset-0 flex items-center justify-center pointer-events-none opacity-5 font-bold text-[8px] uppercase tracking-widest ${theme === 'dark' ? 'text-white' : 'text-black'}`}>
                          Document Page
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
                              className="font-bold select-none break-all leading-tight"
                            >
                              {watermarkText || 'SAMPLE'}
                            </span>
                          </div>
                        )}
                      </div>
                    </div>

                  <div>
                    <label className="block font-semibold mb-1">Watermark Text</label>
                    <input 
                      type="text" 
                      placeholder="e.g. CONFIDENTIAL, DRAFT" 
                      value={watermarkText}
                      onChange={(e) => setWatermarkText(e.target.value)}
                      className={`w-full px-3 py-2 rounded-lg border text-xs focus:ring-2 focus:ring-blue-500 outline-none ${theme === 'dark' ? 'bg-slate-800 border-slate-700 placeholder-slate-500 text-white' : 'bg-white border-gray-200'}`}
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block font-semibold mb-1">Style</label>
                      <select 
                        value={watermarkStyle}
                        onChange={(e) => setWatermarkStyle(e.target.value as any)}
                        className={`w-full p-2 rounded-lg border text-xs outline-none ${theme === 'dark' ? 'bg-slate-800 border-slate-700 text-white' : 'bg-white border-gray-200'}`}
                      >
                        <option value="single">Single Text</option>
                        <option value="grid">3x3 Grid Repeat</option>
                      </select>
                    </div>

                    <div>
                      <label className="block font-semibold mb-1">Position</label>
                      <select 
                        disabled={watermarkStyle === 'grid'}
                        value={watermarkPosition}
                        onChange={(e) => setWatermarkPosition(e.target.value as any)}
                        className={`w-full p-2 rounded-lg border text-xs outline-none ${theme === 'dark' ? 'bg-slate-800 border-slate-700 text-white disabled:opacity-40' : 'bg-white border-gray-200 disabled:opacity-40'}`}
                      >
                        <option value="center">Center</option>
                        <option value="top-left">Top Left</option>
                        <option value="top-right">Top Right</option>
                        <option value="bottom-left">Bottom Left</option>
                        <option value="bottom-right">Bottom Right</option>
                      </select>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3 pt-1">
                    <div>
                      <label className="block font-semibold mb-1">Size ({watermarkSize}px)</label>
                      <input 
                        type="range" 
                        min={12} 
                        max={80} 
                        value={watermarkSize}
                        onChange={(e) => setWatermarkSize(Number(e.target.value))}
                        className="w-full accent-blue-600"
                      />
                    </div>

                    <div>
                      <label className="block font-semibold mb-1">Opacity ({Math.round(watermarkOpacity * 100)}%)</label>
                      <input 
                        type="range" 
                        min={0.05} 
                        max={0.9} 
                        step={0.05}
                        value={watermarkOpacity}
                        onChange={(e) => setWatermarkOpacity(Number(e.target.value))}
                        className="w-full accent-blue-600"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3 pt-1">
                    <div>
                      <label className="block font-semibold mb-1">Rotation ({watermarkRotation}°)</label>
                      <input 
                        type="range" 
                        min={0} 
                        max={360} 
                        value={watermarkRotation}
                        onChange={(e) => setWatermarkRotation(Number(e.target.value))}
                        className="w-full accent-blue-600"
                      />
                    </div>

                    <div>
                      <label className="block font-semibold mb-1">Margin ({watermarkMargin}px)</label>
                      <input 
                        type="range" 
                        min={0} 
                        max={100} 
                        value={watermarkMargin}
                        onChange={(e) => setWatermarkMargin(Number(e.target.value))}
                        className="w-full accent-blue-600"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block font-semibold mb-1">Color</label>
                    <div className="flex items-center space-x-2 mt-1">
                      <input 
                        type="color" 
                        value={watermarkColor}
                        onChange={(e) => setWatermarkColor(e.target.value)}
                        className="w-7 h-7 rounded cursor-pointer border border-gray-200 dark:border-slate-700 p-0"
                      />
                      <div className="flex flex-wrap gap-1">
                        {['#CCCCCC', '#FF3B30', '#007AFF', '#34C759', '#FF9500'].map(c => (
                          <button 
                            key={c}
                            onClick={() => setWatermarkColor(c)}
                            className="w-4 h-4 rounded-full border border-gray-300 dark:border-slate-600 shadow-sm"
                            style={{ backgroundColor: c }}
                          />
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className={`mt-6 grid grid-cols-2 gap-3`}>
            <button onClick={() => executeExport('save')} className={`px-4 py-3 rounded-xl text-sm font-medium border flex items-center justify-center transition-colors ${theme === 'dark' ? 'border-slate-700 hover:bg-slate-800 text-slate-200' : 'border-gray-200 hover:bg-gray-50 text-gray-700'}`}>
              {exportFormat === 'images' ? 'Save to Gallery' : 'Save to Storage'}
            </button>
            <button onClick={() => executeExport('share')} className="px-4 py-3 bg-blue-600 text-white rounded-xl text-sm font-medium hover:bg-blue-700 flex items-center justify-center transition-colors">
               Share (Other)
            </button>
            <button onClick={() => executeExport('email')} className={`col-span-2 px-4 py-3 border rounded-xl text-sm font-medium flex items-center justify-center transition-colors ${theme === 'dark' ? 'border-slate-700 hover:bg-slate-800 text-slate-200' : 'border-gray-200 hover:bg-gray-50 text-gray-700'}`}>
               <Mail className="w-4 h-4 mr-2" /> Share via Email
            </button>
          </div>
          
          <div className="mt-4 flex justify-center">
            <button onClick={() => { setShowExportModalFor(null); setExportPassword(''); setExportQuality(1); }} className={`px-4 py-2 rounded-xl text-sm font-medium ${theme === 'dark' ? 'text-slate-400 hover:bg-slate-800' : 'text-gray-500 hover:bg-gray-100'}`}>
              Cancel
            </button>
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
      <div className="fixed inset-0 bg-black/95 z-[100] flex flex-col animate-in fade-in duration-200">
         <div className="absolute top-0 left-0 right-0 p-4 flex justify-between items-center z-[110] bg-gradient-to-b from-black/60 to-transparent">
           <div className="flex items-center space-x-2">
             <button 
               onClick={() => setFullScreenScale(prev => Math.max(1, prev - 0.5))}
               className="p-2 text-white/70 hover:text-white bg-black/40 hover:bg-black/60 rounded-full transition-colors"
               title="Zoom Out"
             >
               <ZoomOut className="w-5 h-5" />
             </button>
             <span className="text-white/60 text-xs font-mono w-12 text-center">{Math.round(fullScreenScale * 100)}%</span>
             <button 
               onClick={() => setFullScreenScale(prev => Math.min(4, prev + 0.5))}
               className="p-2 text-white/70 hover:text-white bg-black/40 hover:bg-black/60 rounded-full transition-colors"
               title="Zoom In"
             >
               <ZoomIn className="w-5 h-5" />
             </button>
           </div>
           <button 
             onClick={() => { setFullScreenImage(null); setFullScreenScale(1); }} 
             className="p-2 text-white/70 hover:text-white bg-black/40 hover:bg-black/60 rounded-full transition-colors"
             title="Close"
           >
             <X className="w-6 h-6" />
           </button>
         </div>
         
          <div className="flex-1 overflow-auto p-4 touch-auto">
            <div 
              className="transition-all duration-200 ease-out flex items-center justify-center min-h-full min-w-full"
              style={{ 
                width: fullScreenScale > 1 ? `${fullScreenScale * 100}%` : "100%",
                height: fullScreenScale > 1 ? `${fullScreenScale * 100}%` : "100%",
              }}
            >
              <img 
                src={fullScreenImage} 
                alt="Fullscreen preview" 
                style={{ 
                  maxWidth: fullScreenScale > 1 ? "none" : "95vw",
                  maxHeight: fullScreenScale > 1 ? "none" : "90vh",
                }} 
                className={`object-contain drop-shadow-2xl transition-all duration-200 ${addPdfBorder ? "border-[4px] border-black ring-2 ring-white/15" : ""}`} 
                draggable={false}
              />
            </div>
          </div>
      </div>
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
         <div className={`flex items-center justify-between p-4 border-b sticky top-0 z-10 shadow-sm transition-colors duration-300 ${theme === 'dark' ? 'bg-slate-900 border-slate-800' : 'bg-[var(--color-warm-card)] border-[var(--color-warm-border)]'}`}>
            <button onClick={() => { setCurrentDoc(null); setAppState('home'); setIsEditingTitle(false); }} className={`p-2 -ml-2 flex-shrink-0 ${theme === 'dark' ? 'text-slate-400 hover:text-white' : 'text-[var(--color-warm-text-muted)] hover:text-[var(--color-warm-text)]'}`}>
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
                <button onClick={handleRenameSave} className={`p-1.5 rounded-lg flex-shrink-0 ${theme === 'dark' ? 'text-green-400 hover:bg-slate-800' : 'text-green-600 hover:bg-green-50'}`} title="Save Title">
                  <Check className="w-5 h-5" />
                </button>
                <button onClick={() => setIsEditingTitle(false)} className={`p-1.5 rounded-lg flex-shrink-0 ${theme === 'dark' ? 'text-slate-400 hover:bg-slate-800' : 'text-gray-400 hover:bg-gray-100'}`} title="Cancel">
                  <X className="w-5 h-5" />
                </button>
              </div>
            ) : (
              <div className="flex-1 flex items-center min-w-0 px-3 group">
                <h1 className={`text-lg font-semibold truncate ${theme === 'dark' ? 'text-slate-200' : 'text-[var(--color-warm-text)]'}`}>{currentDoc.title}</h1>
                <button 
                  onClick={() => { setTempTitle(currentDoc.title); setIsEditingTitle(true); }} 
                  className={`p-1.5 ml-1 rounded-lg transition-colors flex-shrink-0 ${theme === 'dark' ? 'text-slate-400 hover:text-blue-400 hover:bg-slate-800' : 'text-[var(--color-warm-text-muted)] hover:text-[var(--color-warm-accent)] hover:bg-[var(--color-warm-border)]'}`}
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
                    <img src={page.filteredImage} alt={`Page ${idx+1}`} draggable={false} className={`max-h-[60vh] object-contain shadow-md select-none transition-all duration-150 ${addPdfBorder ? 'border-[3px] border-black rounded-none ring-2 ring-black/10' : 'rounded-md'}`} />
                  </button>
                </div>
             </div>
           ))}
         </div>
         
          <div className={`p-4 border-t ${theme === "dark" ? "bg-slate-900 border-slate-800" : "bg-[var(--color-warm-card)] border-[var(--color-warm-border)]"}`}>
            <div className="flex items-center justify-center space-x-3 w-full">
              <button 
                onClick={() => fileInputCameraRef2.current?.click()}
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
            accept="image/*,application/pdf"
            multiple
            className="hidden" 
            ref={fileInputGalleryRef2}
            onChange={handleCapture}
         />
         <input 
            type="file" 
            accept="image/*,application/pdf"
            capture="environment" 
            className="hidden" 
            ref={fileInputCameraRef2}
            onChange={handleCapture}
         />
         {renderExportModal()}
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
          <Search className="w-5 h-5 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Search notes..."
            value={noteSearchQuery || ''}
            className={`w-full border pl-10 pr-4 py-2.5 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 shadow-xs ${theme === 'dark' ? 'bg-slate-900 border-slate-700 text-white placeholder-slate-400' : 'bg-white border-gray-200'}`}
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

    return (
      <div className="space-y-6">
        {/* User Card */}
        <div className="bg-gradient-to-br from-[#1b2536] to-[#0f172a] rounded-2xl p-6 text-white shadow-lg relative overflow-hidden flex flex-col sm:flex-row items-center sm:items-start space-y-4 sm:space-y-0 sm:space-x-5">
          <div className="absolute top-0 right-0 w-32 h-32 bg-blue-500/10 rounded-full blur-2xl -mr-10 -mt-10" />
          
          <div className="w-16 h-16 rounded-full bg-gradient-to-tr from-blue-500 to-indigo-600 flex items-center justify-center font-bold text-xl text-white shadow-md border-2 border-white/20">
            GP
          </div>

          <div className="flex-1 text-center sm:text-left space-y-1">
            <div className="flex flex-col sm:flex-row sm:items-center sm:space-x-2.5 justify-center sm:justify-start">
              <h2 className="text-xl font-bold">Image PDF Scanner</h2>
              <span className="inline-block mt-1 sm:mt-0 px-2 py-0.5 bg-amber-400 text-amber-950 text-[10px] font-extrabold tracking-wider rounded-md uppercase">
                PRO ACTIVE
              </span>
            </div>
            <p className="text-sm text-slate-300">gr7imagepdf@gmail.com</p>
            <p className="text-xs text-slate-400">Premium active tier. Unlimited OCR & PDF Generation.</p>
          </div>
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
                className={`p-1.5 rounded-md text-xs font-bold transition-all ${layout === 'grid' ? theme === 'dark' ? 'bg-slate-800 text-blue-400 shadow-sm' : 'bg-white shadow-sm text-blue-600' : 'text-gray-500'}`}
              >
                Grid
              </button>
              <button 
                onClick={() => setLayout('list')} 
                className={`p-1.5 rounded-md text-xs font-bold transition-all ${layout === 'list' ? theme === 'dark' ? 'bg-slate-800 text-blue-400 shadow-sm' : 'bg-white shadow-sm text-blue-600' : 'text-gray-500'}`}
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
        </div>

        <div className={`rounded-2xl border p-5 shadow-xs space-y-4 ${theme === 'dark' ? 'bg-slate-900 border-slate-800 text-white' : 'bg-white border-gray-100 text-gray-900'}`}>
          <h3 className={`font-bold text-sm ${theme === 'dark' ? 'text-white' : 'text-gray-900'}`}>Preferences</h3>
          
          <div className={`flex items-center justify-between py-2`}>
            <div>
              <p className={`text-sm font-semibold ${theme === 'dark' ? 'text-slate-200' : 'text-gray-800'}`}>Trash Auto-Cleanup</p>
              <p className={`text-xs ${theme === 'dark' ? 'text-slate-400' : 'text-gray-400'}`}>Automatically empty trash.</p>
            </div>
            <select 
              value={autoCleanupDays}
              onChange={(e) => setAutoCleanupDays(parseInt(e.target.value, 10))}
              className={`border text-xs font-semibold rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-500 ${theme === 'dark' ? 'bg-slate-950 border-slate-800 text-white' : 'bg-gray-50 border-gray-200 text-gray-800'}`}
            >
              <option value={0} className={theme === 'dark' ? 'bg-slate-900 text-white' : 'bg-white'}>Never</option>
              <option value={7} className={theme === 'dark' ? 'bg-slate-900 text-white' : 'bg-white'}>7 days</option>
              <option value={15} className={theme === 'dark' ? 'bg-slate-900 text-white' : 'bg-white'}>15 days</option>
              <option value={30} className={theme === 'dark' ? 'bg-slate-900 text-white' : 'bg-white'}>30 days</option>
              <option value={90} className={theme === 'dark' ? 'bg-slate-900 text-white' : 'bg-white'}>90 days</option>
            </select>
          </div>
        </div>

        <div className={`rounded-2xl border p-5 shadow-xs space-y-3 text-center ${theme === 'dark' ? 'bg-slate-900 border-slate-800' : 'bg-white border-gray-100'}`}>
          <p className={`text-xs font-semibold ${theme === 'dark' ? 'text-slate-400' : 'text-gray-500'}`}>Local Storage Operations</p>
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
    );
  };

  // Home View
  return (
    <div className={`flex flex-col h-screen font-sans relative ${theme === 'dark' ? 'bg-slate-950 text-white' : 'bg-[var(--color-warm-bg)] text-[var(--color-warm-text)]'}`}>
      <div className={`px-3 py-3 sm:px-6 border-b sticky top-0 z-30 flex items-center justify-between transition-colors duration-300 backdrop-blur-xl ${theme === 'dark' ? 'bg-slate-900/90 border-slate-800 text-white' : 'bg-[var(--color-warm-card)]/90 border-[var(--color-warm-border)] shadow-sm'}`}>
        {currentTab === 'home' ? (
          isMultiSelect ? (
          <>
            <div className="flex items-center space-x-2 min-w-0">
              <button onClick={() => { setIsMultiSelect(false); setSelectedDocs(new Set()); }} className={`p-1.5 rounded-lg -ml-1 ${theme === 'dark' ? 'text-slate-400 hover:text-white hover:bg-slate-800' : 'text-[var(--color-warm-text)] hover:text-black hover:bg-[var(--color-warm-border)]'}`}>
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
                <>
                
                <button 
                  onClick={handleDownloadCombinedPDF} 
                  className={`p-2 rounded-full transition-all ${theme === 'dark' ? 'text-red-400 hover:bg-slate-800' : 'text-red-600 hover:bg-red-100'}`}
                  title="Download as Combined PDF"
                >
                   <FileDown className="w-5 h-5" />
                </button>
                <button 
                  onClick={handleMergeSelected} 
                  className={`p-2 rounded-full transition-all ${theme === 'dark' ? 'text-blue-400 hover:bg-slate-800' : 'text-blue-600 hover:bg-blue-100'}`}
                  title="Merge into single document"
                >
                   <Combine className="w-5 h-5" />
                </button>
                </>
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
                <div className={`flex rounded-lg p-0.5 ${theme === 'dark' ? 'bg-slate-800' : 'bg-[var(--color-warm-card)] shadow-sm backdrop-blur-md border border-[var(--color-warm-border)]'}`}>
                   <button onClick={() => setLayout('grid')} className={`p-1 rounded ${layout === 'grid' ? theme === 'dark' ? 'bg-slate-700 text-blue-400 shadow-xs' : 'bg-[var(--color-warm-bg)] shadow-xs text-[var(--color-warm-accent)]' : 'text-[var(--color-warm-text-muted)] hover:text-[var(--color-warm-text)]'}`}>
                      <LayoutGrid className="w-3.5 h-3.5" />
                   </button>
                   <button onClick={() => setLayout('list')} className={`p-1 rounded ${layout === 'list' ? theme === 'dark' ? 'bg-slate-700 text-blue-400 shadow-xs' : 'bg-[var(--color-warm-bg)] shadow-xs text-[var(--color-warm-accent)]' : 'text-[var(--color-warm-text-muted)] hover:text-[var(--color-warm-text)]'}`}>
                      <ListIcon className="w-3.5 h-3.5" />
                   </button>
                </div>
              )}
              <button 
                onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}
                className={`p-1.5 rounded-full transition-all active:scale-95 ${theme === 'dark' ? 'text-yellow-400 hover:bg-slate-800' : 'text-[var(--color-warm-text-muted)] hover:bg-[var(--color-warm-border)]'}`}
                title={theme === 'light' ? 'Switch to Dark Mode' : 'Switch to Light Mode'}
              >
                {theme === 'light' ? <Moon className="w-4.5 h-4.5" /> : <Sun className="w-4.5 h-4.5" />}
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
                className={`p-1.5 rounded-full transition-all active:scale-95 flex-shrink-0 ${theme === 'dark' ? 'text-yellow-400 hover:bg-slate-800' : 'text-slate-500 hover:bg-blue-100/50'}`}
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
                className={`p-1.5 rounded-full transition-all active:scale-95 flex-shrink-0 ${theme === 'dark' ? 'text-yellow-400 hover:bg-slate-800' : 'text-slate-500 hover:bg-blue-100/50'}`}
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
                className={`p-1.5 rounded-full transition-all active:scale-95 flex-shrink-0 ${theme === 'dark' ? 'text-yellow-400 hover:bg-slate-800' : 'text-slate-500 hover:bg-blue-100/50'}`}
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
      
      <div className={`flex-1 overflow-y-auto p-4 pb-28 space-y-6 transition-colors duration-300 ${theme === 'dark' ? 'bg-slate-950 text-white' : 'bg-[var(--color-warm-bg)] text-[var(--color-warm-text)]'}`}>
        {currentTab === 'home' ? (
          documents.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-gray-400 space-y-4 py-20">
             <FileText className="w-16 h-16 text-gray-300 stroke-[1.5]" />
             <p className={`text-lg font-bold ${theme === 'dark' ? 'text-slate-300' : 'text-[var(--color-warm-text)]'}`}>No documents yet</p>
             <p className="text-sm text-gray-400 text-center">Tap the scan camera button below to start digitizing</p>
          </div>
        ) : (
          <>
             {/* Sticky/Smooth Search input bar */}
             <div className={`w-full max-w-xl mx-auto flex items-center space-x-2 sticky top-0 z-10 py-[2px] backdrop-blur-sm transition-colors duration-300 ${theme === 'dark' ? 'bg-slate-950/95' : 'bg-[var(--color-warm-bg)]/95'}`}>
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-2.5 h-4 w-4 text-gray-400" />
                  <input
                    type="text"
                    placeholder="Search documents by title..."
                    value={searchQuery || ''}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full pl-10 pr-10 py-2 bg-white border border-gray-200 rounded-full text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent shadow-sm transition-all placeholder-gray-400"
                  />
                  {searchQuery && (
                    <button
                      onClick={() => setSearchQuery('')}
                      className="absolute right-3 top-2.5 p-0.5 text-gray-400 hover:text-gray-600 rounded-full"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  )}
                </div>
                {documents.length > 0 && (
                  <div className="flex items-center space-x-1.5 flex-shrink-0">
                    <div className={`relative flex items-center group cursor-pointer px-1.5 py-1.5 rounded-full transition-colors ${theme === 'dark' ? 'text-slate-300 bg-slate-800 hover:bg-slate-700' : 'text-[var(--color-warm-text)] bg-[var(--color-warm-card)] shadow-sm hover:bg-[var(--color-warm-border)] border border-[var(--color-warm-border)]'}`}>
                      <ArrowDownUp className="w-3.5 h-3.5 sm:w-4 sm:h-4 opacity-70 absolute left-2 pointer-events-none" />
                      <select 
                        value={sortOrder} 
                        onChange={e => setSortOrder(e.target.value as SortOrder)}
                        className="bg-transparent text-[10px] sm:text-xs font-semibold appearance-none outline-none cursor-pointer pl-6 pr-3 py-0.5"
                      >
                        <option value="newest" className={theme === 'dark' ? 'bg-slate-900 text-white' : 'bg-white'}>Newest</option>
                        <option value="oldest" className={theme === 'dark' ? 'bg-slate-900 text-white' : 'bg-white'}>Oldest</option>
                        <option value="alpha" className={theme === 'dark' ? 'bg-slate-900 text-white' : 'bg-white'}>A-Z</option>
                      </select>
                    </div>
                    <button 
                      onClick={() => setIsMultiSelect(true)} 
                      className={`flex items-center px-2 py-1.5 sm:px-3 sm:py-2 rounded-full transition-all ${theme === 'dark' ? 'text-blue-400 bg-slate-800 hover:bg-slate-700' : 'text-blue-600 bg-blue-50 border border-blue-100 hover:bg-blue-100 shadow-sm'}`}
                      title="Select multiple"
                    >
                      <CheckSquare className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                      <span className="text-[10px] sm:text-xs font-bold ml-1.5 hidden sm:inline-block">Select</span>
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
                    <Plus className="w-3.5 h-3.5 mr-1" /> Create Folder
                  </button>
                </div>

                <div className="flex items-center space-x-1.5 overflow-x-auto pb-1.5 scrollbar-thin">
                  <button
                    onClick={() => setActiveFolderFilter('all')}
                    className={`px-3 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap transition-all ${activeFolderFilter === 'all' ? 'bg-blue-600 text-white shadow-sm' : (theme === 'dark' ? 'bg-slate-800 text-slate-300 hover:bg-slate-750' : 'bg-white text-gray-600 hover:bg-gray-100 border border-gray-100')}`}
                  >
                    All ({documents.filter(d => !d.isTrash).length})
                  </button>
                  <button
                    onClick={() => setActiveFolderFilter('root')}
                    className={`px-3 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap transition-all ${activeFolderFilter === 'root' ? 'bg-blue-600 text-white shadow-sm' : (theme === 'dark' ? 'bg-slate-800 text-slate-300 hover:bg-slate-750' : 'bg-white text-gray-600 hover:bg-gray-100 border border-gray-100')}`}
                  >
                    Uncategorized ({documents.filter(d => !d.isTrash && !d.folderId).length})
                  </button>
                  <button
                    onClick={() => setActiveFolderFilter('trash')}
                    className={`px-3 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap transition-all flex items-center ${activeFolderFilter === 'trash' ? 'bg-red-600 text-white shadow-sm' : (theme === 'dark' ? 'bg-slate-800 text-red-400 hover:bg-slate-750' : 'bg-red-50 text-red-700 hover:bg-red-100 border border-red-200')}`}
                  >
                    <Trash2 className="w-3.5 h-3.5 mr-1" />
                    Trash ({documents.filter(d => d.isTrash).length})
                  </button>
                  {folders.map(folder => {
                    const count = documents.filter(d => !d.isTrash && d.folderId === folder.id).length;
                    return (
                      <div key={folder.id} className="flex items-center shrink-0">
                        <button
                          onClick={() => setActiveFolderFilter(folder.id)}
                          className={`px-3 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap transition-all flex items-center ${activeFolderFilter === folder.id ? 'bg-blue-600 text-white shadow-sm' : (theme === 'dark' ? 'bg-slate-800 text-slate-300 hover:bg-slate-750' : 'bg-white text-gray-600 hover:bg-gray-100 border border-gray-100')}`}
                        >
                          <FolderOpen className="w-3 h-3 mr-1 opacity-70" />
                          {folder.name} ({count})
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
                          className={`p-1 ml-0.5 rounded-lg hover:text-red-500 transition-colors ${theme === 'dark' ? 'text-slate-500 hover:bg-slate-850' : 'text-gray-400 hover:bg-gray-100'}`}
                          title="Delete folder"
                        >
                          <Trash2 className="w-3 h-3" />
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
                   <motion.div layout className={layout === 'grid' ? "grid gap-3 grid-cols-3 sm:grid-cols-4 lg:grid-cols-5" : "flex flex-col gap-3"}>
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
                                <img src={doc.pages[0].filteredImage} alt="" className="w-full h-full object-cover" />
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
                                    className={`p-1.5 rounded-full transition-colors ${theme === 'dark' ? 'text-slate-400 hover:bg-slate-800' : 'text-gray-500 hover:bg-gray-100'}`}
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
      </div>

      {renderCustomDialogs()}

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

      {/* Hidden File Inputs */}
      <input 
         type="file" 
         accept="image/*,application/pdf"
         multiple
         className="hidden" 
         ref={fileInputGalleryRef}
         onChange={handleCapture}
      />
      <input 
         type="file" 
         accept="image/*,application/pdf"
         capture="environment" 
         className="hidden" 
         ref={fileInputCameraRef}
         onChange={handleCapture}
      />

      {/* Batch Processing Overlay */}
      {renderBatchProgressOverlay()}

      {/* Bottom Tab Bar Navigation Footer */}
      <div className={`fixed bottom-0 left-0 right-0 backdrop-blur-md border-t py-2.5 px-6 flex items-center justify-between z-40 shadow-xl max-w-lg mx-auto sm:rounded-t-2xl transition-colors duration-300 ${theme === 'dark' ? 'bg-slate-900/95 border-slate-800' : 'bg-[var(--color-warm-card)]/95 border-[var(--color-warm-border)]'}`}>
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
            onClick={() => setShowScanMenu(!showScanMenu)}
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
                    fileInputCameraRef.current?.click();
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
  );
}
