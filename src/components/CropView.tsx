import React, { useRef, useState, useEffect, useCallback } from 'react';
import { Point } from '../types';
import { detectDocumentCorners } from '../lib/image';
import { Scan, Maximize, FileText, CreditCard } from 'lucide-react';

interface CropViewProps {
  key?: string;
  imageSrc: string;
  initialCorners?: Point[];
  onCrop: (corners: Point[]) => void | Promise<void>;
  onCancel: () => void;
  isProcessing?: boolean;
}

export default function CropView({ imageSrc, initialCorners, onCrop, onCancel, isProcessing }: CropViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const [corners, setCorners] = useState<Point[]>([
    { x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }
  ]);
  const [imageSize, setImageSize] = useState({ width: 0, height: 0, naturalWidth: 0, naturalHeight: 0 });
  const [draggingIdx, setDraggingIdx] = useState<number | null>(null);

  const detectedCornersRef = useRef<Point[] | null>(null);
  const [activePreset, setActivePreset] = useState<string>('auto');

  const applyPreset = (presetType: string) => {
    const natW = imageSize.naturalWidth || (imageRef.current?.naturalWidth || 0);
    const natH = imageSize.naturalHeight || (imageRef.current?.naturalHeight || 0);
    if (!natW || !natH) return;

    if (presetType === 'auto') {
      if (detectedCornersRef.current) {
        setCorners(detectedCornersRef.current);
      } else {
        const marginX = natW * 0.05;
        const marginY = natH * 0.05;
        setCorners([
          { x: marginX, y: marginY },
          { x: natW - marginX, y: marginY },
          { x: natW - marginX, y: natH - marginY },
          { x: marginX, y: natH - marginY }
        ]);
      }
      return;
    }

    if (presetType === 'full') {
      setCorners([
        { x: 0, y: 0 },
        { x: natW, y: 0 },
        { x: natW, y: natH },
        { x: 0, y: natH }
      ]);
      return;
    }

    const isLandscape = natW >= natH;
    let ratio = 1;
    if (presetType === 'A4') {
      ratio = isLandscape ? 1.4142 : 0.7071;
    } else if (presetType === 'letter') {
      ratio = isLandscape ? (11 / 8.5) : (8.5 / 11);
    } else if (presetType === 'id_card') {
      ratio = isLandscape ? 1.5858 : 0.6306;
    }

    let w = natW * 0.85;
    let h = w / ratio;
    if (h > natH * 0.85) {
      h = natH * 0.85;
      w = h * ratio;
    }

    const x = (natW - w) / 2;
    const y = (natH - h) / 2;

    setCorners([
      { x: x, y: y },
      { x: x + w, y: y },
      { x: x + w, y: y + h },
      { x: x, y: y + h }
    ]);
  };

  useEffect(() => {
    let hasDetectedSuccessfully = false;
    const img = new Image();
    img.src = imageSrc;
    img.onload = () => {
      setImageSize(prev => ({ ...prev, naturalWidth: img.width, naturalHeight: img.height }));
      
      if (initialCorners) {
        setCorners(initialCorners);
        detectedCornersRef.current = initialCorners;
      } else {
        try {
          const detected = detectDocumentCorners(img);
          if (detected) {
            setCorners(detected);
            detectedCornersRef.current = detected;
            hasDetectedSuccessfully = true;
          } else {
            fallbackCorners();
          }
        } catch (err) {
          console.error("Error during document corner detection:", err);
          fallbackCorners();
        }
      }

      function fallbackCorners() {
        // Default to a margin of 5% inside the image
        const marginX = img.width * 0.05;
        const marginY = img.height * 0.05;
        const fallback = [
          { x: marginX, y: marginY },
          { x: img.width - marginX, y: marginY },
          { x: img.width - marginX, y: img.height - marginY },
          { x: marginX, y: img.height - marginY }
        ];
        setCorners(fallback);
        if (!detectedCornersRef.current) {
          detectedCornersRef.current = fallback;
        }
      }
    };
    img.onerror = () => {
      console.warn("Failed to load image in CropView, using fallback dimensions");
      const fallbackW = 800;
      const fallbackH = 1000;
      setImageSize(prev => ({ ...prev, naturalWidth: fallbackW, naturalHeight: fallbackH }));
      const fallback = [
        { x: 50, y: 50 },
        { x: fallbackW - 50, y: 50 },
        { x: fallbackW - 50, y: fallbackH - 50 },
        { x: 50, y: fallbackH - 50 }
      ];
      setCorners(fallback);
      detectedCornersRef.current = fallback;
    };

    // If initialCorners is not provided and we haven't successfully detected with OpenCV yet,
    // we poll for OpenCV.js loading and re-run detection once it is available.
    if (!initialCorners) {
      let intervalId = setInterval(() => {
        const cv = (window as any).cv;
        if (cv && cv.Mat && !hasDetectedSuccessfully) {
          clearInterval(intervalId);
          const retryImg = new Image();
          retryImg.src = imageSrc;
          retryImg.onload = () => {
            try {
              const detected = detectDocumentCorners(retryImg);
              if (detected) {
                setCorners(detected);
                detectedCornersRef.current = detected;
                hasDetectedSuccessfully = true;
              }
            } catch (err) {
              console.warn("Retry corner detection failed:", err);
            }
          };
        }
      }, 150);

      // Timeout safety to stop polling after 5 seconds
      const timeoutId = setTimeout(() => {
        clearInterval(intervalId);
      }, 5000);

      return () => {
        clearInterval(intervalId);
        clearTimeout(timeoutId);
      };
    }
  }, [imageSrc, initialCorners]);

  useEffect(() => {
    const updateSize = () => {
      if (imageRef.current) {
        const rect = imageRef.current.getBoundingClientRect();
        setImageSize(prev => ({
          ...prev,
          width: rect.width,
          height: rect.height
        }));
      }
    };
    
    const observer = new ResizeObserver(updateSize);
    if (imageRef.current) {
      observer.observe(imageRef.current);
    }
    window.addEventListener('resize', updateSize);
    updateSize(); // Initial call
    setTimeout(updateSize, 50);
    setTimeout(updateSize, 200);
    return () => {
       window.removeEventListener('resize', updateSize);
       observer.disconnect();
    };
  }, [imageSrc]);

  const handlePointerDown = (idx: number) => (e: React.PointerEvent<HTMLDivElement>) => {
    if (isProcessing) return;
    
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    
    setDraggingIdx(idx);
    
    // Vibrate on touch if supported
    if (window.navigator.vibrate) {
      window.navigator.vibrate(10);
    }
  };

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (draggingIdx === null || !imageRef.current || isProcessing) return;
    
    const clientX = e.clientX;
    const clientY = e.clientY;
    
    const rect = imageRef.current.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    
    const natW = imageSize.naturalWidth || imageRef.current.naturalWidth;
    const natH = imageSize.naturalHeight || imageRef.current.naturalHeight;
    const scaleX = natW / rect.width;
    const scaleY = natH / rect.height;

    if (isNaN(scaleX) || isNaN(scaleY) || !isFinite(scaleX) || !isFinite(scaleY)) return;

    let x = (clientX - rect.left) * scaleX;
    let y = (clientY - rect.top) * scaleY;

    // Clamp to image bounds
    x = Math.max(0, Math.min(x, natW));
    y = Math.max(0, Math.min(y, natH));

    const isLockedRatio = ['A4', 'letter', 'id_card'].includes(activePreset);
    const isRectangleOnly = activePreset === 'full';

    if (isLockedRatio || isRectangleOnly) {
      // Find diagonal anchor (opposite corner)
      let ax = 0;
      let ay = 0;
      if (draggingIdx === 0) {
        ax = corners[2].x;
        ay = corners[2].y;
      } else if (draggingIdx === 1) {
        ax = corners[3].x;
        ay = corners[3].y;
      } else if (draggingIdx === 2) {
        ax = corners[0].x;
        ay = corners[0].y;
      } else if (draggingIdx === 3) {
        ax = corners[1].x;
        ay = corners[1].y;
      }

      const dx = x - ax;
      const dy = y - ay;
      const signX = dx >= 0 ? 1 : -1;
      const signY = dy >= 0 ? 1 : -1;

      let newX = x;
      let newY = y;

      if (isLockedRatio) {
        let R = 1;
        const isLandscape = natW >= natH;
        if (activePreset === 'A4') {
          R = isLandscape ? 1.4142 : 0.7071;
        } else if (activePreset === 'letter') {
          R = isLandscape ? (11 / 8.5) : (8.5 / 11);
        } else if (activePreset === 'id_card') {
          R = isLandscape ? 1.5858 : 0.6306;
        }

        let W = Math.abs(dx);
        let H = Math.abs(dy);

        // Keep them proportional to aspect ratio R
        if (W / R > H) {
          H = W / R;
        } else {
          W = H * R;
        }

        const maxW = signX >= 0 ? (natW - ax) : ax;
        const maxH = signY >= 0 ? (natH - ay) : ay;
        const limitW = Math.min(maxW, maxH * R);

        if (W > limitW) {
          W = limitW;
          H = W / R;
        }

        newX = ax + (W * signX);
        newY = ay + (H * signY);
      }

      const x_left = Math.min(ax, newX);
      const x_right = Math.max(ax, newX);
      const y_top = Math.min(ay, newY);
      const y_bottom = Math.max(ay, newY);

      setCorners([
        { x: x_left, y: y_top },
        { x: x_right, y: y_top },
        { x: x_right, y: y_bottom },
        { x: x_left, y: y_bottom }
      ]);
    } else {
      // Freeform movement
      if (activePreset === 'auto') {
        setActivePreset('');
      }

      setCorners(prev => {
        const next = [...prev];
        next[draggingIdx] = { x, y };
        return next;
      });
    }
  }, [draggingIdx, imageSize, isProcessing, activePreset, corners, setActivePreset]);

  const handlePointerUp = useCallback(() => {
    setDraggingIdx(null);
  }, []);

  useEffect(() => {
    // We are now handling events on the container div
    // window events are removed
  }, [draggingIdx, handlePointerMove, handlePointerUp]);

  const renderCorners = () => {
    const natW = imageSize.naturalWidth || (imageRef.current?.naturalWidth || 0);
    const natH = imageSize.naturalHeight || (imageRef.current?.naturalHeight || 0);
    if (imageSize.width === 0 || natW === 0) return null;
    
    const scaleX = imageSize.width / natW;
    const scaleY = imageSize.height / natH;

    return corners.map((c, i) => (
      <div
        key={i}
        onPointerDown={handlePointerDown(i)}
        className="absolute w-16 h-16 flex items-center justify-center cursor-move transform -translate-x-1/2 -translate-y-1/2 touch-none select-none z-[100]"
        style={{
          left: `${c.x * scaleX}px`,
          top: `${c.y * scaleY}px`,
          padding: '10px'
        }}
      >
        <div className={`w-8 h-8 rounded-full border-[3px] border-white shadow-[0_0_10px_rgba(0,0,0,0.5)] transition-all duration-75 ${draggingIdx === i ? 'bg-blue-400 scale-125 ring-4 ring-blue-500/40' : 'bg-blue-500 active:scale-110'}`} />
      </div>
    ));
  };

  const renderPolygon = () => {
    const natW = imageSize.naturalWidth || (imageRef.current?.naturalWidth || 0);
    const natH = imageSize.naturalHeight || (imageRef.current?.naturalHeight || 0);
    if (imageSize.width === 0 || natW === 0) return null;
    const scaleX = imageSize.width / natW;
    const scaleY = imageSize.height / natH;
    
    const pointsStr = corners.map(c => `${c.x * scaleX},${c.y * scaleY}`).join(' ');

    return (
      <svg className="absolute inset-0 w-full h-full pointer-events-none overflow-visible" style={{ zIndex: 5 }}>
        <polygon points={pointsStr} fill="rgba(59, 130, 246, 0.2)" stroke="#3b82f6" strokeWidth="4" strokeLinejoin="round" />
      </svg>
    );
  };

  const renderMagnifier = () => {
    if (draggingIdx === null || imageSize.width === 0 || !imageRef.current) return null;
    
    const natW = imageSize.naturalWidth || imageRef.current.naturalWidth;
    const natH = imageSize.naturalHeight || imageRef.current.naturalHeight;
    const scaleX = imageSize.width / natW;
    const scaleY = imageSize.height / natH;
    const c = corners[draggingIdx];

    const pointerX = c.x * scaleX;
    const pointerY = c.y * scaleY;
    
    const zoom = 2;
    const magSize = 120;
    const bgW = imageSize.width * zoom;
    const bgH = imageSize.height * zoom;
    
    const bgPosX = - (pointerX * zoom) + (magSize / 2);
    const bgPosY = - (pointerY * zoom) + (magSize / 2);

    const isLeft = pointerX > imageSize.width / 2;
    const magLeft = isLeft ? 16 : imageSize.width - magSize - 16;
    const magTop = 16;

    return (
      <div 
        className="absolute rounded-full border-4 border-blue-500 shadow-2xl overflow-hidden pointer-events-none bg-black"
        style={{
          width: magSize,
          height: magSize,
          left: magLeft,
          top: magTop,
          zIndex: 50,
        }}
      >
        <div 
           className="absolute inset-0 pointer-events-none"
           style={{
             backgroundImage: `url(${imageSrc})`,
             backgroundSize: `${bgW}px ${bgH}px`,
             backgroundPosition: `${bgPosX}px ${bgPosY}px`,
             backgroundRepeat: 'no-repeat',
           }}
        />
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none drop-shadow-md">
          <div className="w-6 h-0.5 bg-blue-500"></div>
          <div className="w-0.5 h-6 bg-blue-500 absolute"></div>
        </div>
      </div>
    );
  };

  return (
    <div className="fixed top-0 left-0 w-full h-[100dvh] z-[200] flex flex-col bg-gray-900 text-white overflow-hidden">
      <div className="safe-pt bg-black z-20 flex-shrink-0">
        <div className="relative flex items-center justify-between px-4 h-14">
          <button 
            onClick={onCancel} 
            disabled={isProcessing} 
            className="touch-target px-3 py-1 text-gray-300 disabled:opacity-50 text-sm"
          >
            Cancel
          </button>
          
          <h2 className="text-sm font-medium text-gray-400 absolute left-1/2 -translate-x-1/2 top-1/2 -translate-y-1/2 pointer-events-none">
            Adjust Crop
          </h2>
          
          <button 
            onClick={() => onCrop(corners)} 
            disabled={isProcessing} 
            className="px-5 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-full font-bold text-sm shadow-md active:scale-95 transition-all disabled:opacity-50 h-9 flex items-center justify-center"
          >
            Next
          </button>
        </div>
      </div>
      
      <div 
        className={`flex-1 min-h-0 relative flex items-center justify-center p-8 pb-16 touch-none ${draggingIdx !== null ? 'cursor-grabbing' : 'cursor-auto'}`} 
        ref={containerRef}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onPointerLeave={handlePointerUp}
      >
        <div className="relative inline-block select-none touch-none max-w-full max-h-full flex items-center justify-center">
          <img
            ref={imageRef}
            src={imageSrc}
            alt="Crop area"
            className="block max-w-full max-h-[60vh] select-none shadow-md"
            draggable={false}
            onLoad={(e) => {
               if (imageRef.current) {
                 const rect = imageRef.current.getBoundingClientRect();
                 setImageSize(prev => ({
                    ...prev,
                    width: rect.width,
                    height: rect.height,
                    naturalWidth: imageRef.current!.naturalWidth,
                    naturalHeight: imageRef.current!.naturalHeight
                 }));
               }
            }}
          />
          {renderPolygon()}
          {renderCorners()}
          {renderMagnifier()}
        </div>

        {isProcessing && (
          <div className="absolute inset-0 bg-black/75 z-50 flex flex-col items-center justify-center">
            <div className="w-12 h-12 border-4 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
            <p className="mt-4 font-medium text-gray-200">Cropping and aligning page...</p>
          </div>
        )}
      </div>
      
      <div className="bg-black border-t border-gray-800 pb-6 pt-4 safe-pb z-20 flex-shrink-0">
        {/* Preset Ratios Row */}
        <div className="flex items-center justify-start md:justify-center space-x-2.5 mb-4 px-4 overflow-x-auto hide-scrollbar w-full">
          <button
            onClick={() => {
              setActivePreset('auto');
              applyPreset('auto');
            }}
            className={`flex-shrink-0 px-3 py-1.5 rounded-full text-xs font-semibold transition-all flex items-center space-x-1.5 ${
              activePreset === 'auto'
                ? 'bg-blue-600 text-white shadow-md scale-105'
                : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
            }`}
          >
            <Scan className="w-3.5 h-3.5" />
            <span>Auto Detect</span>
          </button>
          <button
            onClick={() => {
              setActivePreset('full');
              applyPreset('full');
            }}
            className={`flex-shrink-0 px-3 py-1.5 rounded-full text-xs font-semibold transition-all flex items-center space-x-1.5 ${
              activePreset === 'full'
                ? 'bg-blue-600 text-white shadow-md scale-105'
                : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
            }`}
          >
            <Maximize className="w-3.5 h-3.5" />
            <span>Full Page</span>
          </button>
          <button
            onClick={() => {
              setActivePreset('A4');
              applyPreset('A4');
            }}
            className={`flex-shrink-0 px-3 py-1.5 rounded-full text-xs font-semibold transition-all flex items-center space-x-1.5 ${
              activePreset === 'A4'
                ? 'bg-blue-600 text-white shadow-md scale-105'
                : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
            }`}
          >
            <FileText className="w-3.5 h-3.5" />
            <span>A4</span>
            <span className="text-[10px] opacity-60 font-normal">(1:1.41)</span>
          </button>
          <button
            onClick={() => {
              setActivePreset('letter');
              applyPreset('letter');
            }}
            className={`flex-shrink-0 px-3 py-1.5 rounded-full text-xs font-semibold transition-all flex items-center space-x-1.5 ${
              activePreset === 'letter'
                ? 'bg-blue-600 text-white shadow-md scale-105'
                : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
            }`}
          >
            <FileText className="w-3.5 h-3.5" />
            <span>Letter</span>
            <span className="text-[10px] opacity-60 font-normal">(1:1.29)</span>
          </button>
          <button
            onClick={() => {
              setActivePreset('id_card');
              applyPreset('id_card');
            }}
            className={`flex-shrink-0 px-3 py-1.5 rounded-full text-xs font-semibold transition-all flex items-center space-x-1.5 ${
              activePreset === 'id_card'
                ? 'bg-blue-600 text-white shadow-md scale-105'
                : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
            }`}
          >
            <CreditCard className="w-3.5 h-3.5" />
            <span>ID Card</span>
            <span className="text-[10px] opacity-60 font-normal">(1:1.59)</span>
          </button>
        </div>

        <div className="text-center text-xs text-gray-400">
          Drag the corners or choose a standard preset for precise cropping
        </div>
      </div>
    </div>
  );
}
