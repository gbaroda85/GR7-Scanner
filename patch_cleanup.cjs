const fs = require('fs');

let appContent = fs.readFileSync('src/App.tsx', 'utf8');

// 1. Add state for autoCleanupDays
const themeStateStr = `  const [theme, setTheme] = useState<'light' | 'dark'>(() => {`;
const cleanupState = `
  const [autoCleanupDays, setAutoCleanupDays] = useState<number>(() => {
    try {
      const stored = localStorage.getItem('docscanner_cleanup');
      return stored ? parseInt(stored, 10) : 30;
    } catch {
      return 30;
    }
  });

  useEffect(() => {
    localStorage.setItem('docscanner_cleanup', autoCleanupDays.toString());
  }, [autoCleanupDays]);
`;

appContent = appContent.replace(themeStateStr, cleanupState + themeStateStr);

// 2. Add cleanup logic in loadData
const loadDataStr = `
    try {
      const docs = await getDocuments();
      setDocuments(docs);
      
      const folds = await getFolders();
`;

const loadDataStrNew = `
    try {
      const rawDocs = await getDocuments();
      const now = Date.now();
      const validDocs = [];
      for (const doc of rawDocs) {
        if (doc.isTrash && doc.trashedAt && autoCleanupDays > 0) {
          const daysInTrash = (now - doc.trashedAt) / (1000 * 60 * 60 * 24);
          if (daysInTrash >= autoCleanupDays) {
            deleteDocument(doc.id); // fire and forget
            continue;
          }
        }
        validDocs.push(doc);
      }
      setDocuments(validDocs);
      
      const folds = await getFolders();
`;

appContent = appContent.replace(loadDataStr, loadDataStrNew);

// 3. Add to Settings tab
const settingsSectionStr = `<h3 className={\`text-lg font-bold mb-4 \${theme === 'dark' ? 'text-white' : 'text-gray-900'}\`}>Preferences</h3>`;

const settingsSectionStrNew = `<h3 className={\`text-lg font-bold mb-4 \${theme === 'dark' ? 'text-white' : 'text-gray-900'}\`}>Preferences</h3>

            <div className={\`p-4 rounded-xl border mb-4 \${theme === 'dark' ? 'bg-slate-900/50 border-slate-800' : 'bg-[var(--color-warm-card)] border-[var(--color-warm-border)]'}\`}>
              <p className={\`text-sm font-semibold \${theme === 'dark' ? 'text-slate-200' : 'text-gray-800'}\`}>Trash Auto-Cleanup</p>
              <p className={\`text-xs mb-3 \${theme === 'dark' ? 'text-slate-400' : 'text-gray-400'}\`}>Automatically delete documents in the Trash after a period of time.</p>
              <select 
                value={autoCleanupDays}
                onChange={(e) => setAutoCleanupDays(parseInt(e.target.value, 10))}
                className={\`w-full p-2 text-sm rounded-lg border focus:ring-2 focus:ring-blue-500 outline-none transition-colors \${theme === 'dark' ? 'bg-slate-800 border-slate-700 text-white' : 'bg-white border-gray-300 text-gray-900'}\`}
              >
                <option value={0}>Never empty trash automatically</option>
                <option value={7}>After 7 days</option>
                <option value={15}>After 15 days</option>
                <option value={30}>After 30 days</option>
                <option value={90}>After 90 days</option>
              </select>
            </div>
`;

appContent = appContent.replace(settingsSectionStr, settingsSectionStrNew);

fs.writeFileSync('src/App.tsx', appContent);
