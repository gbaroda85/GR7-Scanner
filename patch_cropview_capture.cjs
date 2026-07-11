const fs = require('fs');

let content = fs.readFileSync('src/components/CropView.tsx', 'utf8');

// Remove setPointerCapture
content = content.replace(
  "e.currentTarget.setPointerCapture(e.pointerId);",
  "// e.currentTarget.setPointerCapture(e.pointerId); // Removed as it causes issues on some devices"
);

// Add e.preventDefault() to handlePointerDown? But pointerdown cannot be preventDefaulted in React if passive? It's not passive.
// Let's add standard onTouchStart to ensure iOS works smoothly.
content = content.replace(
  "onPointerDown={handlePointerDown(i)}",
  "onPointerDown={handlePointerDown(i)}\n        onTouchStart={handlePointerDown(i) as any}\n        onMouseDown={handlePointerDown(i) as any}"
);

// We need to fix handlePointerDown to prevent default for touch
content = content.replace(
  "  const handlePointerDown = (idx: number) => (e: React.PointerEvent) => {",
  "  const handlePointerDown = (idx: number) => (e: any) => {\n    if (e.cancelable && e.type !== 'mousedown') e.preventDefault();"
);

fs.writeFileSync('src/components/CropView.tsx', content);
console.log("Patched successfully.");

