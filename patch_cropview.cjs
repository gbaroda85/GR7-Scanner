const fs = require('fs');

let content = fs.readFileSync('src/components/CropView.tsx', 'utf8');

content = content.replace(
  "  const handlePointerDown = (idx: number) => (e: React.PointerEvent) => {\n    if (isProcessing) return;\n    \n    setDraggingIdx(idx);",
  "  const handlePointerDown = (idx: number) => (e: React.PointerEvent) => {\n    if (isProcessing) return;\n    e.currentTarget.setPointerCapture(e.pointerId);\n    setDraggingIdx(idx);"
);

content = content.replace(
  /<div\s+key=\{i\}\s+onPointerDown=\{handlePointerDown\(i\)\}\s+className="absolute w-14 h-14 flex items-center justify-center cursor-move transform -translate-x-1\/2 -translate-y-1\/2 touch-none select-none z-\[100\]"\s+style=\{\{\s+left: `\$\{c\.x \* scaleX\}px`,\s+top: `\$\{c\.y \* scaleY\}px`,\s+\/\/ Add a larger transparent hit area for easier grabbing\s+padding: '20px'\s+\}\}\s+>/,
  `<div
        key={i}
        onPointerDown={handlePointerDown(i)}
        className="absolute flex items-center justify-center cursor-move transform -translate-x-1/2 -translate-y-1/2 touch-none select-none z-[100]"
        style={{
          left: \`\${c.x * scaleX}px\`,
          top: \`\${c.y * scaleY}px\`,
          width: '100px',
          height: '100px',
        }}
      >`
);

content = content.replace(
  /<div className=\{\`w-9 h-9 rounded-full border-2 border-white shadow-xl transition-all duration-75 \$\{draggingIdx === i \? 'bg-blue-400 scale-150 ring-4 ring-blue-500\/30' : 'bg-blue-600 active:scale-125'\}\`\} \/>/,
  `<div className={\`w-10 h-10 rounded-full border-4 border-white shadow-[0_0_15px_rgba(0,0,0,0.5)] transition-all duration-75 \${draggingIdx === i ? 'bg-blue-400 scale-125 ring-4 ring-blue-500/50' : 'bg-blue-500 active:scale-110'}\`} />`
);

fs.writeFileSync('src/components/CropView.tsx', content);
console.log("Patched successfully.");

