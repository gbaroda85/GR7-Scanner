import React, { useRef, useState, useEffect, TouchEvent } from 'react';
import { ZoomIn, ZoomOut, X, RefreshCw } from 'lucide-react';

interface ZoomableImageProps {
  src: string;
  onClose: () => void;
  addPdfBorder?: boolean;
}

export default function ZoomableImage({ src, onClose, addPdfBorder }: ZoomableImageProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  
  // Touch tracking state
  const touchState = useRef({
    initialDistance: 0,
    initialScale: 1,
    initialPan: { x: 0, y: 0 },
    lastCenter: { x: 0, y: 0 },
    lastTouchTime: 0
  });

  const getDistance = (p1: React.Touch, p2: React.Touch) => {
    return Math.hypot(p1.clientX - p2.clientX, p1.clientY - p2.clientY);
  };

  const getCenter = (p1: React.Touch, p2: React.Touch) => {
    return {
      x: (p1.clientX + p2.clientX) / 2,
      y: (p1.clientY + p2.clientY) / 2
    };
  };

  const handleTouchStart = (e: TouchEvent<HTMLDivElement>) => {
    if (e.touches.length === 2) {
      const dist = getDistance(e.touches[0], e.touches[1]);
      touchState.current.initialDistance = dist;
      touchState.current.initialScale = scale;
      touchState.current.lastCenter = getCenter(e.touches[0], e.touches[1]);
      setIsDragging(false);
    } else if (e.touches.length === 1) {
      const now = Date.now();
      const timeSinceLastTouch = now - touchState.current.lastTouchTime;
      if (timeSinceLastTouch < 300) {
         // Double tap
         handleDoubleTap(e.touches[0]);
      } else {
         touchState.current.lastCenter = { x: e.touches[0].clientX, y: e.touches[0].clientY };
         if (scale > 1) {
           setIsDragging(true);
           touchState.current.initialPan = { ...position };
         }
      }
      touchState.current.lastTouchTime = now;
    }
  };

  const handleDoubleTap = (touch: React.Touch) => {
    if (scale > 1) {
       setScale(1);
       setPosition({ x: 0, y: 0 });
    } else {
       setScale(2.5);
       // We could try to zoom into the specific point, but a simple center zoom is usually fine for a fallback
    }
  };

  const handleTouchMove = (e: TouchEvent<HTMLDivElement>) => {
    // Prevent default to stop scrolling behind the modal
    if (scale > 1 && e.cancelable) {
       // React synthetic events don't easily allow preventDefault for passive listeners, 
       // but we applied overscroll-behavior: none to the body which helps.
    }
    
    if (e.touches.length === 2) {
      const dist = getDistance(e.touches[0], e.touches[1]);
      const center = getCenter(e.touches[0], e.touches[1]);
      
      const distRatio = dist / touchState.current.initialDistance;
      let newScale = touchState.current.initialScale * distRatio;
      newScale = Math.min(Math.max(1, newScale), 5); // Limit scale 1x to 5x
      
      // Calculate pan to keep center point stable
      const deltaX = center.x - touchState.current.lastCenter.x;
      const deltaY = center.y - touchState.current.lastCenter.y;
      
      setScale(newScale);
      
      if (newScale > 1) {
         setPosition(prev => ({
           x: prev.x + deltaX,
           y: prev.y + deltaY
         }));
      } else {
         setPosition({ x: 0, y: 0 });
      }
      
      touchState.current.lastCenter = center;
    } else if (e.touches.length === 1 && isDragging && scale > 1) {
       const deltaX = e.touches[0].clientX - touchState.current.lastCenter.x;
       const deltaY = e.touches[0].clientY - touchState.current.lastCenter.y;
       
       setPosition(prev => ({
         x: prev.x + deltaX,
         y: prev.y + deltaY
       }));
       
       touchState.current.lastCenter = { x: e.touches[0].clientX, y: e.touches[0].clientY };
    }
  };

  const handleTouchEnd = () => {
    setIsDragging(false);
    
    // Snap back if out of bounds (simple version)
    if (scale <= 1) {
      setScale(1);
      setPosition({ x: 0, y: 0 });
    } else {
       // Optional: Add bounds checking to prevent dragging image completely off screen
       const maxPan = (scale - 1) * 200; // rough heuristic
       setPosition(prev => ({
          x: Math.max(-maxPan, Math.min(maxPan, prev.x)),
          y: Math.max(-maxPan, Math.min(maxPan, prev.y))
       }));
    }
  };

  return (
    <div className="fixed inset-0 bg-black/95 z-[100] flex flex-col animate-in fade-in duration-200 app-height">
      <div className="absolute top-0 left-0 right-0 p-4 safe-pt flex justify-between items-center z-[110] bg-gradient-to-b from-black/80 to-transparent">
        <div className="flex items-center space-x-2">
          <button 
            onClick={() => { setScale(1); setPosition({x:0, y:0}); }}
            className="touch-target p-2 text-white/70 hover:text-white bg-black/40 hover:bg-black/60 rounded-full transition-colors"
            title="Reset Zoom"
          >
            <RefreshCw className="w-5 h-5" />
          </button>
          <span className="text-white/80 text-xs font-mono w-12 text-center select-none">
            {Math.round(scale * 100)}%
          </span>
        </div>
        <button 
          onClick={onClose} 
          className="touch-target p-2 text-white/70 hover:text-white bg-black/40 hover:bg-black/60 rounded-full transition-colors"
          title="Close"
        >
          <X className="w-6 h-6" />
        </button>
      </div>
                
      <div 
        ref={containerRef}
        className="flex-1 w-full h-full overflow-hidden flex items-center justify-center touch-none safe-pb"
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onTouchCancel={handleTouchEnd}
      >
        <img 
          src={src} 
          alt="Fullscreen preview" 
          className={`max-w-full max-h-full object-contain will-change-transform ${addPdfBorder ? "border-[4px] border-black ring-2 ring-white/15" : ""}`}
          style={{ 
            transform: `translate3d(${position.x}px, ${position.y}px, 0) scale(${scale})`,
            transition: isDragging ? 'none' : 'transform 0.2s cubic-bezier(0.2, 0, 0, 1)'
          }}
          draggable={false}
        />
      </div>
    </div>
  );
}
