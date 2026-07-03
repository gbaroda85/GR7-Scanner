import React, { useState, useEffect, useRef } from 'react';
import { FilterType } from '../types';
import { applyFilter } from '../lib/image';
import { Check, ChevronLeft, RotateCw, SlidersHorizontal } from 'lucide-react';

interface FilterViewProps {
  imageSrc: string; 
  initialFilter?: FilterType;
  onSave: (filteredImage: string, filterType: FilterType) => void;
  onBack: () => void;
}

export default function FilterView({ imageSrc, initialFilter = 'magic', onSave, onBack }: FilterViewProps) {
  const [filter, setFilter] = useState<FilterType>(initialFilter);
  const [previewImage, setPreviewImage] = useState<string>(imageSrc);
  const [isProcessing, setIsProcessing] = useState(false);
  
  const [rotation, setRotation] = useState<number>(0);
  const [brightness, setBrightness] = useState<number>(100);
  const [contrast, setContrast] = useState<number>(100);
  const [showAdjustments, setShowAdjustments] = useState<boolean>(false);

  // Use a ref to debounce
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

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

    return () => { active = false; if (timeoutRef.current) clearTimeout(timeoutRef.current); };
  }, [imageSrc, filter, rotation, brightness, contrast]);

  const handleSave = () => {
    onSave(previewImage, filter);
  };

  const handleRotate = () => {
    setRotation(prev => (prev + 90) % 360);
  };

  const filterOptions: { id: FilterType; label: string }[] = [
    { id: 'original', label: 'Original' },
    { id: 'magic', label: 'Magic' },
    { id: 'document', label: 'Document' },
    { id: 'photo', label: 'Photo' },
    { id: 'bw', label: 'B & W' }
  ];

  return (
    <div className="flex flex-col h-screen bg-gray-900 text-white">
      <div className="flex items-center justify-between p-4 bg-black">
        <button onClick={onBack} className="p-2 -ml-2 text-gray-300">
          <ChevronLeft className="w-6 h-6" />
        </button>
        <h2 className="text-lg font-medium">Fine Tuning</h2>
        <button onClick={handleSave} className="p-2 -mr-2 text-blue-400 font-medium" disabled={isProcessing}>
          <Check className="w-6 h-6" />
        </button>
      </div>
      
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

      <div className="bg-black p-4 pb-8">
        <div className="flex items-center justify-between mb-6 px-2">
           <button onClick={() => setShowAdjustments(!showAdjustments)} className={`p-3 rounded-full transition-colors ${showAdjustments ? 'bg-blue-600 text-white' : 'bg-gray-800 text-gray-300 hover:bg-gray-700'}`}>
              <SlidersHorizontal className="w-5 h-5" />
           </button>
           <button onClick={handleRotate} className="p-3 rounded-full bg-gray-800 text-gray-300 hover:bg-gray-700 transition-colors">
              <RotateCw className="w-5 h-5" />
           </button>
        </div>

        <div className="flex overflow-x-auto hide-scrollbar space-x-8 px-2 pb-2">
           {filterOptions.map(opt => (
             <button
               key={opt.id}
               onClick={() => setFilter(opt.id)}
               className={`flex flex-col items-center justify-center flex-shrink-0 space-y-2 transition-colors ${
                 filter === opt.id ? 'text-blue-400' : 'text-gray-400 hover:text-gray-200'
               }`}
             >
               <span className="text-sm font-medium whitespace-nowrap">{opt.label}</span>
               <div className={`w-1.5 h-1.5 rounded-full ${filter === opt.id ? 'bg-blue-400' : 'bg-transparent'}`}></div>
             </button>
           ))}
        </div>
      </div>
    </div>
  );
}
