const fs = require('fs');

let appContent = fs.readFileSync('src/App.tsx', 'utf8');

const targetStr = `            </label>
          </div>
        </div>`;

const newStr = `            </label>
          </div>
        </div>

        <div className={\`rounded-2xl border p-5 shadow-xs space-y-4 \${theme === 'dark' ? 'bg-slate-900 border-slate-800 text-white' : 'bg-white border-gray-100 text-gray-900'}\`}>
          <h3 className={\`font-bold text-sm \${theme === 'dark' ? 'text-white' : 'text-gray-900'}\`}>Preferences</h3>
          
          <div className={\`flex items-center justify-between py-2\`}>
            <div>
              <p className={\`text-sm font-semibold \${theme === 'dark' ? 'text-slate-200' : 'text-gray-800'}\`}>Trash Auto-Cleanup</p>
              <p className={\`text-xs \${theme === 'dark' ? 'text-slate-400' : 'text-gray-400'}\`}>Automatically empty trash.</p>
            </div>
            <select 
              value={autoCleanupDays}
              onChange={(e) => setAutoCleanupDays(parseInt(e.target.value, 10))}
              className={\`border text-xs font-semibold rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-500 \${theme === 'dark' ? 'bg-slate-950 border-slate-800 text-white' : 'bg-gray-50 border-gray-200 text-gray-800'}\`}
            >
              <option value={0} className={theme === 'dark' ? 'bg-slate-900 text-white' : 'bg-white'}>Never</option>
              <option value={7} className={theme === 'dark' ? 'bg-slate-900 text-white' : 'bg-white'}>7 days</option>
              <option value={15} className={theme === 'dark' ? 'bg-slate-900 text-white' : 'bg-white'}>15 days</option>
              <option value={30} className={theme === 'dark' ? 'bg-slate-900 text-white' : 'bg-white'}>30 days</option>
              <option value={90} className={theme === 'dark' ? 'bg-slate-900 text-white' : 'bg-white'}>90 days</option>
            </select>
          </div>
        </div>`;

appContent = appContent.replace(targetStr, newStr);

fs.writeFileSync('src/App.tsx', appContent);
