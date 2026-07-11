const fs = require('fs');

let content = fs.readFileSync('src/components/CropView.tsx', 'utf8');

// Replace handlePointerMove with generic pointer/touch handlers
content = content.replace(
  "const handlePointerMove = useCallback((e: PointerEvent) => {",
  `const handleMove = useCallback((clientX: number, clientY: number) => {
    if (draggingIdx === null || !imageRef.current || isProcessing) return;
    
    const rect = imageRef.current.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    
    const scaleX = (imageSize.naturalWidth || imageRef.current.naturalWidth) / rect.width;
    const scaleY = (imageSize.naturalHeight || imageRef.current.naturalHeight) / rect.height;

    if (isNaN(scaleX) || isNaN(scaleY) || !isFinite(scaleX) || !isFinite(scaleY)) return;

    let x = (clientX - rect.left) * scaleX;
    let y = (clientY - rect.top) * scaleY;

    // Clamp to image bounds
    x = Math.max(0, Math.min(x, imageSize.naturalWidth || imageRef.current.naturalWidth));
    y = Math.max(0, Math.min(y, imageSize.naturalHeight || imageRef.current.naturalHeight));

    setCorners(prev => {
      const next = [...prev];
      next[draggingIdx] = { x, y };
      return next;
    });
  }, [draggingIdx, imageSize, isProcessing]);

  const handlePointerMove = useCallback((e: PointerEvent) => {
    handleMove(e.clientX, e.clientY);
  }, [handleMove]);

  const handleTouchMove = useCallback((e: TouchEvent) => {
    if (e.cancelable) e.preventDefault();
    if (e.touches.length > 0) {
      handleMove(e.touches[0].clientX, e.touches[0].clientY);
    }
  }, [handleMove]);`
);

content = content.replace(
  "const handlePointerUp = useCallback(() => {",
  `const handlePointerUp = useCallback(() => {
    setDraggingIdx(null);
  }, []);

  const handleTouchEnd = useCallback(() => {`
);

content = content.replace(
  "window.addEventListener('pointermove', handlePointerMove);",
  "window.addEventListener('pointermove', handlePointerMove);\n      window.addEventListener('touchmove', handleTouchMove, { passive: false });"
);

content = content.replace(
  "window.addEventListener('pointerup', handlePointerUp);",
  "window.addEventListener('pointerup', handlePointerUp);\n      window.addEventListener('touchend', handlePointerUp);\n      window.addEventListener('touchcancel', handlePointerUp);"
);

content = content.replace(
  "window.removeEventListener('pointermove', handlePointerMove);",
  "window.removeEventListener('pointermove', handlePointerMove);\n      window.removeEventListener('touchmove', handleTouchMove);"
);

content = content.replace(
  "window.removeEventListener('pointerup', handlePointerUp);",
  "window.removeEventListener('pointerup', handlePointerUp);\n      window.removeEventListener('touchend', handlePointerUp);\n      window.removeEventListener('touchcancel', handlePointerUp);"
);

fs.writeFileSync('src/components/CropView.tsx', content);
console.log("Patched touch events successfully.");

