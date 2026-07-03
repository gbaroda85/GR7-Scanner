import React, { useRef, useState, useEffect, useCallback } from 'react';
import { Point } from '../types';
import { detectDocumentCorners } from '../lib/image';

interface CropViewProps {
  imageSrc: string;
  initialCorners?: Point[];
  onCrop: (corners: Point[]) => void;
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

  useEffect(() => {
    let hasDetectedSuccessfully = false;
    const img = new Image();
    img.src = imageSrc;
    img.onload = () => {
      setImageSize(prev => ({ ...prev, naturalWidth: img.width, naturalHeight: img.height }));
      
      if (initialCorners) {
        setCorners(initialCorners);
      } else {
        try {
          const detected = detectDocumentCorners(img);
          if (detected) {
            setCorners(detected);
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
        setCorners([
          { x: marginX, y: marginY },
          { x: img.width - marginX, y: marginY },
          { x: img.width - marginX, y: img.height - marginY },
          { x: marginX, y: img.height - marginY }
        ]);
      }
    };
    img.onerror = () => {
      console.warn("Failed to load image in CropView, using fallback dimensions");
      const fallbackW = 800;
      const fallbackH = 1000;
      setImageSize(prev => ({ ...prev, naturalWidth: fallbackW, naturalHeight: fallbackH }));
      setCorners([
        { x: 50, y: 50 },
        { x: fallbackW - 50, y: 50 },
        { x: fallbackW - 50, y: fallbackH - 50 },
        { x: 50, y: fallbackH - 50 }
      ]);
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
  }, []);

  const handlePointerDown = (idx: number) => (e: React.PointerEvent) => {
    if (isProcessing) return;
    e.preventDefault();
    setDraggingIdx(idx);
  };

  const handlePointerMove = useCallback((e: PointerEvent) => {
    if (draggingIdx === null || !imageRef.current) return;
    
    const rect = imageRef.current.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    
    const scaleX = imageSize.naturalWidth / rect.width;
    const scaleY = imageSize.naturalHeight / rect.height;

    if (isNaN(scaleX) || isNaN(scaleY) || !isFinite(scaleX) || !isFinite(scaleY)) return;

    let x = (e.clientX - rect.left) * scaleX;
    let y = (e.clientY - rect.top) * scaleY;

    // Clamp to image bounds
    x = Math.max(0, Math.min(x, imageSize.naturalWidth));
    y = Math.max(0, Math.min(y, imageSize.naturalHeight));

    setCorners(prev => {
      const next = [...prev];
      next[draggingIdx] = { x, y };
      return next;
    });
  }, [draggingIdx, imageSize]);

  const handlePointerUp = useCallback(() => {
    setDraggingIdx(null);
  }, []);

  useEffect(() => {
    if (draggingIdx !== null) {
      window.addEventListener('pointermove', handlePointerMove);
      window.addEventListener('pointerup', handlePointerUp);
    }
    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
    };
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
        className="absolute w-8 h-8 bg-blue-500 rounded-full border-2 border-white shadow-lg cursor-move transform -translate-x-1/2 -translate-y-1/2 touch-none"
        style={{
          left: `${c.x * scaleX}px`,
          top: `${c.y * scaleY}px`,
          zIndex: 10
        }}
      />
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
    <div className="flex flex-col h-[100dvh] bg-gray-900 text-white overflow-hidden relative">
      <div className="flex items-center justify-between p-4 bg-black z-20">
        <button 
          onClick={onCancel} 
          disabled={isProcessing} 
          className="px-4 py-2 text-gray-300 disabled:opacity-50"
        >
          Cancel
        </button>
        <h2 className="text-lg font-medium">Adjust Crop</h2>
        <button 
          onClick={() => onCrop(corners)} 
          disabled={isProcessing} 
          className="px-4 py-2 text-blue-400 font-medium disabled:opacity-50"
        >
          Next
        </button>
      </div>
      
      <div className="flex-1 relative flex items-center justify-center p-8 pb-16" ref={containerRef}>
        <div className="relative inline-block">
          <img
            ref={imageRef}
            src={imageSrc}
            alt="Crop area"
            className="block max-w-full max-h-[70vh] select-none shadow-md"
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
      
      <div className="p-6 bg-black text-center text-sm text-gray-400">
        Drag the corners to fit the document
      </div>
    </div>
  );
}
