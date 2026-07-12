import React, { useState, useEffect, useRef } from 'react';
import { FilterType } from '../types';
import { applyFilter, downscaleImage } from '../lib/image';
import { Check, ChevronLeft, RotateCw, SlidersHorizontal } from 'lucide-react';

interface FilterViewProps {
  imageSrc: string; 
  initialFilter?: FilterType;
  onSave: (filteredImage: string, filterType: FilterType) => void;
  onBack: () => void;
  isSaving?: boolean;
}

export default function FilterView({ imageSrc, initialFilter = 'magic', onSave, onBack, isSaving }: FilterViewProps) {
  const [filter, setFilter] = useState<FilterType>(initialFilter);
  const [previewImage, setPreviewImage] = useState<string>(imageSrc);
  const [isProcessing, setIsProcessing] = useState(false);
  const [filterPreviews, setFilterPreviews] = useState<Record<string, string>>({});
  
  const [rotation, setRotation] = useState<number>(0);
  const [brightness, setBrightness] = useState<number>(100);
  const [contrast, setContrast] = useState<number>(100);
  const [showAdjustments, setShowAdjustments] = useState<boolean>(false);

  // डिबाउंस के लिए रिफ
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  const filterOptions: { id: FilterType; label: string }[] = [
    { id: 'original', label: 'Original' },
    { id: 'magic', label: 'Magic' },
    { id: 'document', label: 'Document' },
    { id: 'photo', label: 'Photo' },
    { id: 'bw', label: 'B & W' }
  ];

  useEffect(() => {
    let active = true;
    
    if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
    }

    const processFilter = async () => {
      setIsProcessing(true);
      try {
        const result = await applyFilter(imageSrc, filter, { rotation, brightness, contrast });
        if (active) {
          setPreviewImage(result);
        }
      } catch (err) {
        console.error("Filter error", err);
      } finally {
        if (active) {
          setIsProcessing(false);
        }
      }
    };
    
    timeoutRef.current = setTimeout(() => {
        processFilter();
    }, 150);

    return () => { 
      active = false; 
      if (timeoutRef.current) clearTimeout(timeoutRef.current); 
    };
  }, [imageSrc, filter, rotation, brightness, contrast]);

  // Generate Filter Previews
  useEffect(() => {
    let active = true;
    
    const generatePreviews = async () => {
      try {
        const smallImg = await downscaleImage(imageSrc, 150);
        for (const opt of filterOptions) {
          if (!active) break;
          // Calculate preview using the small downscaled image
          const preview = await applyFilter(smallImg, opt.id, { rotation, brightness, contrast });
          if (active) {
            setFilterPreviews(prev => ({ ...prev, [opt.id]: preview }));
          }
        }
      } catch (e) {
        console.error("Preview generation failed", e);
      }
    };
    
    generatePreviews();
    
    return () => { active = false; };
  }, [imageSrc, rotation, brightness, contrast]);

  const handleSave = () => {
    if (isProcessing || isSaving) return;
    onSave(previewImage, filter);
  };

  const handleRotate = () => {
    setRotation(prev => (prev + 90) % 360);
  };

  return (
    <div className="fixed top-0 left-0 w-full h-[100dvh] z-[200] flex flex-col bg-gray-900 text-white overflow-hidden">
      <div className="safe-pt bg-black z-20 flex-shrink-0">
        <div className="relative flex items-center justify-between px-4 h-14">
          <button onClick={onBack} className="p-2 -ml-2 text-gray-300 active:scale-95 transition-transform touch-target">
            <ChevronLeft className="w-6 h-6" />
          </button>
          <h2 className="text-sm font-medium text-gray-400 absolute left-1/2 -translate-x-1/2 top-1/2 -translate-y-1/2 pointer-events-none">
            Fine Tuning
          </h2>
          <button onClick={handleSave} className="p-2 -mr-2 text-blue-400 font-bold active:scale-95 transition-transform touch-target" disabled={isProcessing || isSaving}>
            {isSaving ? (
               <div className="w-6 h-6 border-2 border-blue-400 border-t-transparent rounded-full animate-spin"></div>
            ) : (
               <Check className="w-7 h-7 stroke-[2.5]" />
            )}
          </button>
        </div>
      </div>
      
      {/* Canvas Preview Area */}
      <div className="flex-1 relative overflow-hidden flex items-center justify-center p-4">
        {isProcessing && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-gray-900 bg-opacity-50">
             <div className="w-10 h-10 border-4 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
          </div>
        )}
        <img
          src={previewImage}
          alt="Filtered preview"
          className="max-w-full max-h-full object-contain"
        />
      </div>
      
      {/* Brightness & Contrast Adjustments Panel */}
      {showAdjustments && (
        <div className="bg-gray-800 p-6 space-y-6 rounded-t-2xl shadow-lg border-t border-gray-700">
           <div>
              <div className="flex justify-between text-sm text-gray-300 mb-2">
                 <span>Brightness</span>
                 <span>{brightness}%</span>
              </div>
              <input 
                type="range" 
                min="50" max="150" 
                value={brightness} 
                onChange={e => setBrightness(Number(e.target.value))}
                className="w-full accent-blue-500"
              />
           </div>
           <div>
              <div className="flex justify-between text-sm text-gray-300 mb-2">
                 <span>Contrast</span>
                 <span>{contrast}%</span>
              </div>
              <input 
                type="range" 
                min="50" max="200" 
                value={contrast} 
                onChange={e => setContrast(Number(e.target.value))}
                className="w-full accent-blue-500"
              />
           </div>
        </div>
      )}

      {/* Footer Controls */}
      <div className="bg-black px-4 pt-4 pb-6 safe-pb">
        <div className="flex items-center justify-between mb-6 px-2">
           <button onClick={() => setShowAdjustments(!showAdjustments)} className={`p-3 rounded-full transition-colors ${showAdjustments ? 'bg-blue-600 text-white' : 'bg-gray-800 text-gray-300 hover:bg-gray-700'}`}>
              <SlidersHorizontal className="w-5 h-5" />
           </button>
           <button onClick={handleRotate} className="p-3 rounded-full bg-gray-800 text-gray-300 hover:bg-gray-700 transition-colors">
              <RotateCw className="w-5 h-5" />
           </button>
        </div>

        {/* Filter List */}
        <div className="flex overflow-x-auto hide-scrollbar space-x-6 px-2 pb-2">
           {filterOptions.map(opt => (
             <button
               key={opt.id}
               onClick={() => setFilter(opt.id)}
               className={`flex flex-col items-center justify-center flex-shrink-0 space-y-2 transition-all ${
                 filter === opt.id ? 'text-blue-400 scale-105' : 'text-gray-400 hover:text-gray-200'
               }`}
             >
               <div className={`w-14 h-20 sm:w-16 sm:h-24 bg-gray-800 rounded-md overflow-hidden border-2 ${filter === opt.id ? 'border-blue-400' : 'border-transparent'}`}>
                 {filterPreviews[opt.id] ? (
                   <img src={filterPreviews[opt.id]} alt={opt.label} className="w-full h-full object-cover" />
                 ) : (
                   <div className="w-full h-full flex items-center justify-center">
                     <div className="w-4 h-4 border-2 border-gray-500 border-t-transparent rounded-full animate-spin"></div>
                   </div>
                 )}
               </div>
               <span className="text-xs sm:text-sm font-medium whitespace-nowrap">{opt.label}</span>
             </button>
           ))}
        </div>
      </div>
    </div>
  );
}
