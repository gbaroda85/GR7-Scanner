import React, { useState, useEffect, useRef, useCallback } from 'react';
import { X, Zap, ZapOff, Image as ImageIcon, Check, Camera, Settings, Info } from 'lucide-react';
import { detectDocumentCorners } from '../lib/image';
import { Haptics, ImpactStyle } from '@capacitor/haptics';
import { Capacitor } from '@capacitor/core';
import { Camera as CapCamera } from '@capacitor/camera';
import { Device } from '@capacitor/device';

interface Point {
  x: number;
  y: number;
}

interface CameraViewProps {
  onPickGallery?: () => void;
  onFallback: () => void;
  onCapture: (files: File[]) => void;
  onClose: () => void;
  initialMode?: 'single' | 'batch';
}

const playShutterSound = () => {
  try {
    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    const bufferSize = ctx.sampleRate * 0.12; // 0.12 seconds
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    
    // Generate white noise for shutter snap
    for (let i = 0; i < bufferSize; i++) {
      data[i] = Math.random() * 2 - 1;
    }

    const noise = ctx.createBufferSource();
    noise.buffer = buffer;

    // Filter to sound like a camera mechanical clicking
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 1000;
    filter.Q.value = 1.8;

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.45, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.1);

    noise.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);

    noise.start();
    noise.stop(ctx.currentTime + 0.12);
  } catch (e) {
    console.warn("Shutter sound failed", e);
  }
};

export default function CameraView({ onCapture, onClose, onFallback, onPickGallery, initialMode = 'single' }: CameraViewProps) {
  // Clear Scanner modes: Single, Batch, ID Card, Passport
  const [mode, setMode] = useState<'single' | 'batch' | 'idcard' | 'passport'>(
    initialMode === 'batch' ? 'batch' : 'single'
  );
  
  const [flashEnabled, setFlashEnabled] = useState(false);
  const [flashSupported, setFlashSupported] = useState(false);
  const [autoCapture, setAutoCapture] = useState(true);
  const [zoom, setZoom] = useState<number>(1);
  const [capturedImages, setCapturedImages] = useState<File[]>([]);
  const [showSettings, setShowSettings] = useState(false);
  const [isAutoCapturePaused, setIsAutoCapturePaused] = useState(false);
  const [isProcessingPhoto, setIsProcessingPhoto] = useState(false);
  
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const trackRef = useRef<MediaStreamTrack | null>(null);
  const animationFrameRef = useRef<number>();
  
  const stableCountRef = useRef(0);
  const isCapturingRef = useRef(false);

  // Corner stabilization references
  const lastDrawnCornersRef = useRef<Point[] | null>(null);
  const nonDetectedFramesRef = useRef(0);
  const frameCountRef = useRef(0);
  const lastDetectedCornersRef = useRef<Point[] | null>(null);

  const [cameraError, setCameraError] = useState<string | null>(null);
  const [deviceInfo, setDeviceInfo] = useState<{ model: string; os: string; platform: string } | null>(null);

  // Fetch device information on mount
  useEffect(() => {
    const fetchDeviceInfo = async () => {
      try {
        const info = await Device.getInfo();
        setDeviceInfo({
          model: info.model || 'Unknown Device',
          os: info.operatingSystem || 'Unknown OS',
          platform: info.platform || 'web'
        });
      } catch (e) {
        console.warn("Failed to get device info", e);
      }
    };
    fetchDeviceInfo();
  }, []);

  // Initialize camera function
  const startCamera = useCallback(async () => {
    try {
      setCameraError(null);

      // 1. Check and request permissions natively if on a Native platform
      if (Capacitor.isNativePlatform()) {
        try {
          const status = await CapCamera.checkPermissions();
          console.log("Native camera permission status:", status);
          if (status.camera !== 'granted') {
            const reqStatus = await CapCamera.requestPermissions({ permissions: ['camera'] });
            console.log("Native camera permission request result:", reqStatus);
            if (reqStatus.camera !== 'granted') {
              throw new Error('PermissionDenied');
            }
          }
        } catch (capErr: any) {
          if (capErr.message === 'PermissionDenied') {
            throw capErr;
          }
          console.warn("Capacitor permission check/request failed, trying legacy Android bridging", capErr);
          if (typeof window !== 'undefined' && (window as any).Android && (window as any).Android.requestCameraPermission) {
            (window as any).Android.requestCameraPermission();
            await new Promise(r => setTimeout(r, 600));
          }
        }
      }

      // 2. Clean up any existing stream before initiating a new one
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(t => t.stop());
      }

      // 3. Request video stream
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: 'environment',
          width: { ideal: 4096 },
          height: { ideal: 3072 }
        },
        audio: false
      });
      
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
      
      const track = stream.getVideoTracks()[0];
      trackRef.current = track;
      
      const capabilities = track.getCapabilities ? track.getCapabilities() : {};
      if ((capabilities as any).torch) {
        setFlashSupported(true);
      }
    } catch (err: any) {
      console.error("Camera access failed", err);
      let msg = "Camera permission denied. Please allow camera access in your app settings.";
      if (err.message === 'PermissionDenied') {
        msg = "Camera permission was denied. To scan documents, you must grant Camera access.";
      } else if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
        msg = "No camera hardware found on this device.";
      } else if (err.name === 'NotReadableError' || err.name === 'TrackStartError') {
        msg = "Camera is already in use by another application.";
      }
      setCameraError(msg);
    }
  }, []);

  // Initialize camera on mount
  useEffect(() => {
    startCamera();
    
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(t => t.stop());
      }
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [startCamera]);

  // Handle visibility changes or window focus (e.g. returning from App Settings)
  useEffect(() => {
    const handleFocusOrVisible = () => {
      if (document.visibilityState === 'visible' && cameraError) {
        console.log("App resumed/focused and camera was in error state. Retrying camera...");
        startCamera();
      }
    };
    window.addEventListener('focus', handleFocusOrVisible);
    document.addEventListener('visibilitychange', handleFocusOrVisible);
    return () => {
      window.removeEventListener('focus', handleFocusOrVisible);
      document.removeEventListener('visibilitychange', handleFocusOrVisible);
    };
  }, [cameraError, startCamera]);

  // Flash management
  useEffect(() => {
    if (trackRef.current && flashSupported) {
      try {
        trackRef.current.applyConstraints({
          advanced: [{ torch: flashEnabled } as any]
        });
      } catch (e) {
        console.warn("Failed to toggle flash", e);
      }
    }
  }, [flashEnabled, flashSupported]);

  // Hardware zoom support (web-standard)
  useEffect(() => {
    if (trackRef.current) {
      try {
        const capabilities = trackRef.current.getCapabilities ? trackRef.current.getCapabilities() : {};
        if ((capabilities as any).zoom) {
          trackRef.current.applyConstraints({
            advanced: [{ zoom: zoom } as any]
          });
        }
      } catch (e) {
        console.warn("Hardware zoom unsupported, using CSS scaling fallback:", e);
      }
    }
  }, [zoom]);

  // Frame processing with advanced exponential moving average stabilization & temporal hysteresis
  const processFrame = useCallback(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    
    if (!video || !canvas || video.readyState !== video.HAVE_ENOUGH_DATA) {
      animationFrameRef.current = requestAnimationFrame(processFrame);
      return;
    }
    
    // Throttle corner detection to run every 3 frames (~100ms) to maximize performance and save battery
    frameCountRef.current += 1;
    let detectedCorners = lastDetectedCornersRef.current;
    const shouldDetect = frameCountRef.current % 3 === 0;

    const scale = Math.min(800 / video.videoWidth, 800 / video.videoHeight, 1);

    if (shouldDetect) {
      // Create canvas for corner detection
      const detCanvas = document.createElement('canvas');
      const w = Math.round(video.videoWidth * scale);
      const h = Math.round(video.videoHeight * scale);
      
      detCanvas.width = w;
      detCanvas.height = h;
      const detCtx = detCanvas.getContext('2d');
      if (detCtx) {
        detCtx.drawImage(video, 0, 0, w, h);
        try {
          const detected = detectDocumentCorners(detCanvas);
          if (detected && detected.length === 4) {
            detectedCorners = detected;
            lastDetectedCornersRef.current = detected;
          } else {
            detectedCorners = null;
            lastDetectedCornersRef.current = null;
          }
        } catch (e) {
          detectedCorners = null;
          lastDetectedCornersRef.current = null;
        }
      }
    }
    
    const ctx = canvas.getContext('2d');
    if (ctx) {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      
      // Only show corners overlay in standard single & batch doc modes
      if ((mode === 'single' || mode === 'batch') && detectedCorners && detectedCorners.length === 4) {
        nonDetectedFramesRef.current = 0; // Reset dropout counter

        const mappedCorners = detectedCorners.map(p => ({
          x: p.x / scale,
          y: p.y / scale
        }));
        
        // Stabilize corners using Exponential Moving Average (EMA)
        let smoothedCorners: Point[] = [];
        if (lastDrawnCornersRef.current && lastDrawnCornersRef.current.length === 4) {
          for (let i = 0; i < 4; i++) {
            const prev = lastDrawnCornersRef.current[i];
            const curr = mappedCorners[i];
            const dist = Math.hypot(curr.x - prev.x, curr.y - prev.y);
            
            let alpha = 0.15; // default smooth factor
            if (dist > 65) {
              alpha = 0.65; // document moved fast, jump/adapt quickly
            } else if (dist < 4) {
              alpha = 0.02; // extremely close to previous, lock frame to prevent micro-shaking
            }
            
            smoothedCorners.push({
              x: prev.x * (1 - alpha) + curr.x * alpha,
              y: prev.y * (1 - alpha) + curr.y * alpha
            });
          }
        } else {
          smoothedCorners = mappedCorners;
        }
        
        lastDrawnCornersRef.current = smoothedCorners;
        
        // Render the ultra-smooth, premium translucent outline
        ctx.strokeStyle = 'rgba(59, 130, 246, 0.95)';
        ctx.fillStyle = 'rgba(59, 130, 246, 0.15)';
        ctx.lineWidth = 6;
        ctx.lineJoin = 'round';
        ctx.beginPath();
        ctx.moveTo(smoothedCorners[0].x, smoothedCorners[0].y);
        ctx.lineTo(smoothedCorners[1].x, smoothedCorners[1].y);
        ctx.lineTo(smoothedCorners[2].x, smoothedCorners[2].y);
        ctx.lineTo(smoothedCorners[3].x, smoothedCorners[3].y);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        
        // Accent anchor dots on corners
        ctx.fillStyle = '#ffffff';
        ctx.strokeStyle = '#2563eb';
        ctx.lineWidth = 4;
        smoothedCorners.forEach(pt => {
          ctx.beginPath();
          ctx.arc(pt.x, pt.y, 11, 0, 2 * Math.PI);
          ctx.fill();
          ctx.stroke();
        });
        
        // Auto capture trigger logic based on stabilized frames
        if (autoCapture && !isCapturingRef.current && !isAutoCapturePaused) {
          stableCountRef.current += 1;
          if (stableCountRef.current > 24) { // ~0.8s of stable, clean tracking
            performCapture(smoothedCorners);
            stableCountRef.current = 0;
          }
        }
      } else {
        stableCountRef.current = 0;
        nonDetectedFramesRef.current += 1;
        
        // Temporal Hysteresis (flicker prevention):
        // If we fail to detect document corners for less than 10 consecutive frames (~0.33s),
        // keep rendering the last known stable positions with slightly reduced opacity.
        if (nonDetectedFramesRef.current < 10 && lastDrawnCornersRef.current && lastDrawnCornersRef.current.length === 4) {
          const smoothedCorners = lastDrawnCornersRef.current;
          ctx.strokeStyle = 'rgba(59, 130, 246, 0.5)';
          ctx.fillStyle = 'rgba(59, 130, 246, 0.08)';
          ctx.lineWidth = 5;
          ctx.lineJoin = 'round';
          ctx.beginPath();
          ctx.moveTo(smoothedCorners[0].x, smoothedCorners[0].y);
          ctx.lineTo(smoothedCorners[1].x, smoothedCorners[1].y);
          ctx.lineTo(smoothedCorners[2].x, smoothedCorners[2].y);
          ctx.lineTo(smoothedCorners[3].x, smoothedCorners[3].y);
          ctx.closePath();
          ctx.fill();
          ctx.stroke();
        } else {
          lastDrawnCornersRef.current = null;
        }
      }
    }
    
    animationFrameRef.current = requestAnimationFrame(processFrame);
  }, [autoCapture, mode, isAutoCapturePaused]);

  useEffect(() => {
    const video = videoRef.current;
    if (video) {
      const handlePlay = () => {
        animationFrameRef.current = requestAnimationFrame(processFrame);
      };
      video.addEventListener('play', handlePlay);
      return () => video.removeEventListener('play', handlePlay);
    }
  }, [processFrame]);

  useEffect(() => {
    setIsAutoCapturePaused(false);
  }, [mode]);

  // Execute shutter capture
  const performCapture = async (corners?: Point[]) => {
    if (isCapturingRef.current) return;
    isCapturingRef.current = true;
    setIsProcessingPhoto(true);
    
    playShutterSound();

    try {
      await Haptics.impact({ style: ImpactStyle.Light });
    } catch (e) {}
    
    const video = videoRef.current;
    if (!video) {
      isCapturingRef.current = false;
      return;
    }
    
    // Smooth flash visual indicator
    const flashDiv = document.createElement('div');
    flashDiv.className = 'absolute inset-0 bg-white z-50 opacity-100 transition-opacity duration-300 pointer-events-none';
    document.body.appendChild(flashDiv);
    
    setTimeout(() => {
      flashDiv.style.opacity = '0';
      setTimeout(() => flashDiv.remove(), 300);
    }, 50);
    
    const handleCapturedBlob = (blob: Blob) => {
      const file = new File([blob], `capture_${Date.now()}.jpg`, { type: 'image/jpeg' });
      
      if (corners && video) {
        const relativeCorners = corners.map(pt => ({
          x: pt.x / video.videoWidth,
          y: pt.y / video.videoHeight
        }));
        (file as any).relativeCorners = relativeCorners;
      }

      if (mode === 'single' || mode === 'idcard' || mode === 'passport') {
        // Send immediately for cropping / warping
        onCapture([file]);
      } else {
        // Batch mode: add to stack
        setCapturedImages(prev => [...prev, file]);
        setIsAutoCapturePaused(true);
        setIsProcessingPhoto(false);
        setTimeout(() => {
          isCapturingRef.current = false;
        }, 850);
      }
    };

    // Use high-performance canvas drawing instead of ImageCapture to prevent camera sensor freezing/hanging
    const maxDim = 2560; // Max 2560px on longest edge to prevent 12MP toBlob hanging on mobile
    let targetWidth = video.videoWidth;
    let targetHeight = video.videoHeight;
    
    if (Math.max(targetWidth, targetHeight) > maxDim) {
      const scale = maxDim / Math.max(targetWidth, targetHeight);
      targetWidth = Math.round(targetWidth * scale);
      targetHeight = Math.round(targetHeight * scale);
    }
    
    const canvas = document.createElement('canvas');
    canvas.width = targetWidth;
    canvas.height = targetHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      isCapturingRef.current = false;
      setIsProcessingPhoto(false);
      return;
    }
    
    // Capture from the raw video stream considering zoom settings
    if (zoom > 1) {
      const sw = video.videoWidth / zoom;
      const sh = video.videoHeight / zoom;
      const sx = (video.videoWidth - sw) / 2;
      const sy = (video.videoHeight - sh) / 2;
      ctx.drawImage(video, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
    } else {
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    }
    
    canvas.toBlob((blob) => {
      if (blob) {
        handleCapturedBlob(blob);
      } else {
        isCapturingRef.current = false;
        setIsProcessingPhoto(false);
      }
    }, 'image/jpeg', 0.92);
  };

  const handleFinishBatch = () => {
    if (capturedImages.length > 0) {
      onCapture(capturedImages);
    } else {
      onClose();
    }
  };

  return (
    <div className="fixed inset-0 bg-black z-[200] flex flex-col font-sans select-none overflow-hidden">
      {/* Error Overlay */}
      {cameraError && (
        <div className="absolute inset-0 bg-black/95 flex flex-col items-center justify-center p-8 text-center z-50">
          <div className="bg-red-500/10 p-4 rounded-full mb-4">
            <X className="w-12 h-12 text-red-500" />
          </div>
          <h3 className="text-white text-xl font-bold mb-2">Camera Access Failed</h3>
          <p className="text-gray-300 text-xs mb-6 leading-relaxed space-y-2">
            <span>{cameraError}</span>
            <br /><br />
            {deviceInfo && (
              <span className="block p-2 rounded-lg bg-slate-900/60 font-mono text-[10px] text-gray-400 border border-slate-800/50">
                Device: {deviceInfo.model} ({deviceInfo.os} - {deviceInfo.platform})
              </span>
            )}
            <br />
            <span className="block p-3 rounded-xl bg-slate-800/80 text-left text-[11px] border border-slate-700/50">
              <strong>💡 Settings Guide:</strong> Go to Phone Settings &gt; Apps &gt; select this Scanner App &gt; Permissions &gt; set <strong>Camera</strong> to <strong>"Allow Only While Using the App"</strong>.
            </span>
            <br />
            <span className="block font-medium text-emerald-400">
              या फिर आप सीधे अपने फोन का सिस्टम कैमरा भी इस्तेमाल कर सकते हैं (कोई परमिशन की ज़रूरत नहीं)!
            </span>
          </p>
          <div className="flex flex-col w-full gap-3 max-w-xs">
            <button 
              onClick={onFallback}
              className="w-full bg-indigo-600 text-white py-3.5 rounded-xl font-bold active:scale-95 transition-all flex items-center justify-center gap-2 shadow-lg shadow-indigo-600/35 hover:bg-indigo-700"
            >
              <Camera className="w-5 h-5 animate-pulse" /> Use System Camera (Bypass)
            </button>
            <button 
              onClick={async () => {
                await startCamera();
              }}
              className="w-full bg-emerald-600 text-white py-3 rounded-xl font-bold active:scale-95 transition-transform"
            >
              Request Permission / Retry
            </button>
            <button 
              onClick={onPickGallery}
              className="w-full bg-blue-600 text-white py-3 rounded-xl font-bold active:scale-95 transition-transform"
            >
              Upload from Gallery
            </button>
            <button 
              onClick={onClose}
              className="w-full bg-white/10 text-white py-3 rounded-xl font-bold active:scale-95 transition-transform"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Top Bar Header */}
      <div className="absolute top-0 inset-x-0 flex items-center justify-between px-5 z-20 bg-gradient-to-b from-black/95 via-black/60 to-transparent safe-pt pb-4">
        <button 
          onClick={onClose} 
          className="touch-target p-2 text-white/90 hover:text-white transition-transform active:scale-90"
        >
          <X className="w-6 h-6" />
        </button>
        
        <div className="flex items-center space-x-5">
          {/* Clear Scanner styled Auto-Capture button */}
          <button 
            onClick={() => setAutoCapture(!autoCapture)} 
            className="touch-target p-2 flex items-center justify-center transition-transform active:scale-90"
            title="Auto Capture Toggle"
          >
            <div className="relative">
              <Camera className={`w-6 h-6 ${autoCapture ? 'text-blue-400' : 'text-white/60'}`} />
              <div className={`absolute inset-0 flex items-center justify-center text-[8px] font-black leading-none translate-y-0.5 ${autoCapture ? 'text-blue-400' : 'text-white/60'}`}>
                A
              </div>
            </div>
          </button>
          
          {/* Flash Switcher */}
          {flashSupported ? (
            <button 
              onClick={() => setFlashEnabled(!flashEnabled)} 
              className="touch-target p-2 text-white/90 hover:text-white transition-transform active:scale-90"
            >
              {flashEnabled ? (
                <Zap className="w-6 h-6 text-yellow-400 fill-yellow-400" />
              ) : (
                <ZapOff className="w-6 h-6 text-white/60" />
              )}
            </button>
          ) : (
            <div className="w-10 h-10" />
          )}

          {/* Camera Settings Panel Info */}
          <button 
            onClick={() => setShowSettings(!showSettings)} 
            className="touch-target p-2 text-white/90 hover:text-white transition-transform active:scale-90"
          >
            <Settings className="w-6 h-6 text-white/80" />
          </button>
        </div>
      </div>
      
      {/* Camera Viewport Area */}
      <div className="flex-1 relative overflow-hidden flex items-center justify-center bg-black">
        <video 
          ref={videoRef}
          autoPlay 
          playsInline 
          muted 
          style={{ transform: `scale(${zoom})`, transformOrigin: 'center' }}
          className="absolute inset-0 w-full h-full object-cover transition-transform duration-200 ease-out"
        />
        <canvas 
          ref={canvasRef}
          style={{ transform: `scale(${zoom})`, transformOrigin: 'center' }}
          className="absolute inset-0 w-full h-full object-cover pointer-events-none transition-transform duration-200 ease-out z-10"
        />

        {isAutoCapturePaused && mode === 'batch' && (
          <div className="absolute inset-0 bg-black/70 backdrop-blur-[1px] flex flex-col items-center justify-center z-30 p-6">
            <div className="bg-blue-500/20 border border-blue-400/30 p-4 rounded-full mb-3 animate-pulse">
              <Check className="w-10 h-10 text-blue-400 stroke-[3]" />
            </div>
            <h3 className="text-white text-lg font-black tracking-tight mb-1">Page Scanned!</h3>
            <p className="text-gray-300 text-xs text-center max-w-xs mb-6 leading-relaxed">
              Auto-capture is paused so you can turn the page. Click the button below to scan the next page.
            </p>
            <button
              onClick={() => {
                setIsAutoCapturePaused(false);
                stableCountRef.current = 0;
                lastDrawnCornersRef.current = null;
              }}
              className="touch-target bg-blue-600 hover:bg-blue-500 active:scale-95 text-white font-bold text-xs px-6 py-3 rounded-full shadow-lg shadow-blue-900/30 transition-all cursor-pointer flex items-center space-x-2"
            >
              <span>Scan Next Page (Auto)</span>
            </button>
          </div>
        )}

        {/* Clear Scanner styled ID Card Guide Overlay */}
        {mode === 'idcard' && (
          <div className="absolute inset-0 pointer-events-none flex flex-col items-center justify-center z-20">
            <div className="relative w-[320px] h-[200px] rounded-2xl border-[3px] border-dashed border-blue-400/95 flex items-center justify-center shadow-[0_0_0_9999px_rgba(0,0,0,0.65)] animate-pulse">
              <div className="text-center px-4">
                <p className="text-xs font-black text-blue-300 uppercase tracking-widest bg-black/75 px-3 py-1 rounded-md border border-blue-400/30">
                  ALIGN ID CARD HERE
                </p>
                <p className="text-[10px] text-white/70 mt-1.5 font-medium">Front side fits inside the outline</p>
              </div>
            </div>
          </div>
        )}

        {/* Clear Scanner styled Passport Guide Overlay */}
        {mode === 'passport' && (
          <div className="absolute inset-0 pointer-events-none flex flex-col items-center justify-center z-20">
            <div className="relative w-[330px] h-[460px] rounded-3xl border-[3px] border-dashed border-emerald-400/95 flex flex-col items-center justify-between py-6 shadow-[0_0_0_9999px_rgba(0,0,0,0.65)]">
              <div className="text-center px-4 pt-10">
                <p className="text-xs font-black text-emerald-300 uppercase tracking-widest bg-black/75 px-3 py-1 rounded-md border border-emerald-400/30">
                  ALIGN PASSPORT PAGE
                </p>
                <p className="text-[10px] text-white/70 mt-2 font-medium">Position photo page on lower area</p>
              </div>
              <div className="w-full border-t border-dashed border-emerald-400/40 my-auto" />
              <div className="pb-10">
                <p className="text-[9px] text-emerald-300/80 bg-black/50 px-2.5 py-1 rounded font-mono">GRID SCALE: 1.42 ISO</p>
              </div>
            </div>
          </div>
        )}

        {/* Settings Info Banner */}
        {showSettings && (
          <div className="absolute top-20 left-1/2 -translate-x-1/2 w-[90%] max-w-sm bg-slate-900/95 border border-white/10 p-4 rounded-2xl text-white backdrop-blur-md shadow-2xl z-40 animate-in fade-in duration-200">
            <div className="flex justify-between items-start mb-2">
              <h4 className="font-bold text-sm text-blue-400 flex items-center gap-1.5">
                <Info className="w-4 h-4" /> Camera Assistance
              </h4>
              <button onClick={() => setShowSettings(false)} className="text-white/40 hover:text-white">
                <X className="w-4 h-4" />
              </button>
            </div>
            <p className="text-xs text-white/70 leading-relaxed">
              Our advanced paper corner detection dynamically tracks page boundaries.
              For best results, place documents on a high-contrast dark background under good lighting.
            </p>
            <div className="mt-3 flex gap-2">
              <span className="text-[10px] bg-blue-500/10 text-blue-400 border border-blue-500/20 px-2 py-0.5 rounded-full font-bold">Auto Warp On</span>
              <span className="text-[10px] bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 px-2 py-0.5 rounded-full font-bold">Lens Un-distortion</span>
            </div>
          </div>
        )}

        {/* Optimizing Overlay */}
        {isProcessingPhoto && (
          <div className="absolute inset-0 bg-black/90 backdrop-blur-sm z-50 flex flex-col items-center justify-center pointer-events-none animate-in fade-in duration-200">
             <div className="w-12 h-12 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mb-4 shadow-lg shadow-blue-500/20"></div>
             <p className="text-white font-bold text-sm tracking-wide">Optimizing...</p>
          </div>
        )}
      </div>
      
      {/* Sleek Bottom Control Bar - Non-overlapping Flow-based Layout */}
      <div className="bg-neutral-950 safe-pb z-30 flex flex-col select-none">
        
        {/* Real-time Zoom Slider perfectly integrated as a single clean thin line */}
        <div className="flex items-center justify-center py-2.5 px-8 bg-neutral-950">
          <div className="w-full max-w-xs flex items-center">
            <span className="text-[10px] text-white/40 mr-2.5 font-mono select-none">1x</span>
            <input 
              type="range" 
              min="1" 
              max="4" 
              step="0.1" 
              value={zoom} 
              onChange={(e) => setZoom(parseFloat(e.target.value))}
              className="flex-1 h-0.5 bg-white/20 rounded-lg appearance-none cursor-pointer accent-blue-500 focus:outline-none"
            />
            <span className="text-[10px] text-white/40 ml-2.5 font-mono select-none">4x</span>
            <span className="text-[10px] font-semibold text-blue-400 font-mono ml-3.5 w-8 text-right select-none">{zoom.toFixed(1)}x</span>
          </div>
        </div>

        {/* Mode Selector Tabs inside Capsule Background */}
        <div className="flex justify-center items-center py-3.5 space-x-1.5 border-b border-white/5 bg-neutral-950 px-4">
          <button 
            onClick={() => setMode('single')}
            className={`text-xs font-black tracking-wider transition-all px-4 py-2 rounded-full ${mode === 'single' ? 'bg-white/10 text-blue-400' : 'text-white/40 hover:text-white/60'}`}
          >
            Single
          </button>
          <button 
            onClick={() => setMode('batch')}
            className={`text-xs font-black tracking-wider transition-all px-4 py-2 rounded-full ${mode === 'batch' ? 'bg-white/10 text-blue-400' : 'text-white/40 hover:text-white/60'}`}
          >
            Batch
          </button>
          <button 
            onClick={() => setMode('idcard')}
            className={`text-xs font-black tracking-wider transition-all px-4 py-2 rounded-full ${mode === 'idcard' ? 'bg-white/10 text-blue-400' : 'text-white/40 hover:text-white/60'}`}
          >
            ID Card
          </button>
          <button 
            onClick={() => setMode('passport')}
            className={`text-xs font-black tracking-wider transition-all px-4 py-2 rounded-full ${mode === 'passport' ? 'bg-white/10 text-blue-400' : 'text-white/40 hover:text-white/60'}`}
          >
            Passport
          </button>
        </div>
        
        {/* Shutter Controls */}
        <div className="flex items-center justify-between px-8 py-5 h-28 bg-neutral-950">
          
          {/* Left Action: Gallery Import OR Batch Thumbnail Stack */}
          <div className="w-16 flex items-center justify-start">
            {mode === 'batch' && capturedImages.length > 0 ? (
              <div className="relative group active:scale-95 transition-transform cursor-pointer" onClick={handleFinishBatch}>
                <div className="absolute -top-1.5 -right-1.5 bg-blue-500 text-white text-[9px] font-black w-5 h-5 rounded-full flex items-center justify-center border border-neutral-950 shadow-md animate-bounce z-10">
                  {capturedImages.length}
                </div>
                <img 
                  src={URL.createObjectURL(capturedImages[capturedImages.length - 1])} 
                  className="w-12 h-12 rounded-xl object-cover border-2 border-white/20 shadow-lg brightness-95 hover:brightness-100"
                />
              </div>
            ) : (
              <button 
                onClick={() => { onPickGallery?.(); onClose(); }} 
                className="w-12 h-12 rounded-full bg-white/10 flex items-center justify-center hover:bg-white/15 active:scale-90 transition-transform border border-white/5"
                title="Open Gallery"
              >
                <ImageIcon className="w-5 h-5 text-white/90" />
              </button>
            )}
          </div>
          
          {/* Middle Action: Shutter Button */}
          <button 
            onClick={() => {
              if (isAutoCapturePaused) {
                setIsAutoCapturePaused(false);
                stableCountRef.current = 0;
                lastDrawnCornersRef.current = null;
              } else {
                performCapture(lastDrawnCornersRef.current || undefined);
              }
            }}
            className="w-20 h-20 rounded-full border-4 border-white/40 flex items-center justify-center p-1 active:scale-90 transition-transform hover:border-white/60 bg-transparent"
          >
            <div className="w-full h-full bg-white rounded-full hover:bg-white/90 transition-colors shadow-inner"></div>
          </button>
          
          {/* Right Action: Batch Done Checkmark */}
          <div className="w-16 flex justify-end">
            {mode === 'batch' && capturedImages.length > 0 ? (
              <button 
                onClick={handleFinishBatch}
                className="w-12 h-12 rounded-full bg-blue-600 text-white flex items-center justify-center hover:bg-blue-500 active:scale-90 transition-transform border border-blue-500/30 shadow-lg"
                title="Finish Batch"
              >
                <Check className="w-6 h-6 stroke-[3]" />
              </button>
            ) : (
              <div className="w-12 h-12"></div>
            )}
          </div>
          
        </div>
      </div>
    </div>
  );
}
