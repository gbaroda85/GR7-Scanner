const fs = require('fs');

let content = fs.readFileSync('src/App.tsx', 'utf8');

const target = `{selectedDocs.size > 1 && (
                <button 
                  onClick={handleDownloadCombinedPDF}`;

const replacement = `{selectedDocs.size > 1 && (
                <>
                <button 
                  onClick={handleDownloadCombinedPDF}`;

content = content.replace(target, replacement);

const targetEnd = `                  <Combine className="w-5 h-5" />
                </button>
              )}`;

const replacementEnd = `                  <Combine className="w-5 h-5" />
                </button>
                </>
              )}`;

content = content.replace(targetEnd, replacementEnd);

fs.writeFileSync('src/App.tsx', content);
