const fs = require('fs');

let appContent = fs.readFileSync('src/App.tsx', 'utf8');

// 1. Insert handleDownloadCombinedPDF
const mergeFuncStart = appContent.indexOf("const handleMergeSelected = async () => {");
const downloadCombinedFunc = `
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
      title: \`Combined PDF \${new Date().toLocaleDateString()}\`,
      createdAt: Date.now(),
      pages: allPages
    };
    
    try {
      const blob = await generatePDF(combinedDoc, { drawBorder: addPdfBorder });
      downloadFile(blob, \`Combined_PDF_\${new Date().getTime()}.pdf\`);
      setIsMultiSelect(false);
      setSelectedDocs(new Set());
    } catch (e) {
      console.error("Failed to generate combined PDF", e);
      setErrorMessage("Could not generate combined PDF.");
    }
  };

`;

if (!appContent.includes("const handleDownloadCombinedPDF")) {
  appContent = appContent.substring(0, mergeFuncStart) + downloadCombinedFunc + appContent.substring(mergeFuncStart);
}

// 2. Insert the button in the UI
// Look for handleMergeSelected in the UI
// We have:
//               {selectedDocs.size > 1 && (
//                 <button 
//                   onClick={handleMergeSelected} 

const mergeBtnSearch = "onClick={handleMergeSelected}";
const mergeBtnIndex = appContent.indexOf(mergeBtnSearch);

if (mergeBtnIndex !== -1) {
  // Let's find the closing tag of the condition or button
  // Wait, let's insert the new button before the handleMergeSelected button inside the {selectedDocs.size > 1 && ( ... )}
  // The structure is:
  /*
              {selectedDocs.size > 1 && (
                <button 
                  onClick={handleMergeSelected} 
                  className={`p-2 rounded-full transition-all ${theme === 'dark' ? 'text-blue-400 hover:bg-slate-800' : 'text-blue-600 hover:bg-blue-100'}`}
                  title="Merge into single document"
                >
                   <Combine className="w-5 h-5" />
                </button>
              )}
  */
  
  const selectedDocsCheckStr = "{selectedDocs.size > 1 && (";
  // actually, let's find the exact string
  
  const replaceRegex = /(\{selectedDocs\.size > 1 && \(\s*)(<button[^>]*onClick=\{handleMergeSelected\}[^>]*>[\s\S]*?<\/button>)/;
  
  appContent = appContent.replace(replaceRegex, (match, p1, p2) => {
    return p1 + `
                <button 
                  onClick={handleDownloadCombinedPDF} 
                  className={\`p-2 rounded-full transition-all \${theme === 'dark' ? 'text-red-400 hover:bg-slate-800' : 'text-red-600 hover:bg-red-100'}\`}
                  title="Download as Combined PDF"
                >
                   <FileDown className="w-5 h-5" />
                </button>
                ` + p2;
  });
}

// 3. Make sure FileDown is imported from lucide-react
if (!appContent.includes("FileDown")) {
  appContent = appContent.replace("import { ", "import { FileDown, ");
}

fs.writeFileSync('src/App.tsx', appContent);
