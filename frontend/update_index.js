const fs = require('fs');
let html = fs.readFileSync('index.html', 'utf8');

// Replace styles
html = html.replace(/<link href="https:\/\/fonts\.googleapis\.com\/css2\?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet" \/>\r?\n\s*<style>[\s\S]*?<\/style>/, 
`<link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;600;700&family=IBM+Plex+Mono:wght@400;500&display=swap" rel="stylesheet" />`);

// Replace loading overlay
html = html.replace(/<!-- Loading overlay -->[\s\S]*?<\/div>\r?\n  <\/div>/,
`<!-- Loading overlay -->
  <div id="loadingOverlay" class="loading-overlay">
    <div class="loading-card">
      <div class="loading-logo">
        <div class="loading-logo-icon">
          <svg width="22" height="22" viewBox="0 0 28 28" fill="none">
            <path d="M7 20V12l7-4 7 4v8l-7 4-7-4Z" stroke="#08160e" stroke-width="2" fill="none"/>
            <path d="M14 8l-7 4m7-4 7 4m-7-4v4m0 0-7 4m7-4 7 4m-7-4v8" stroke="#08160e" stroke-width="1.4" opacity=".7"/>
          </svg>
        </div>
        <span class="loading-logo-name">StockLogger</span>
      </div>
      <div class="spinner"></div>
      <div class="loading-text">Authenticating...</div>
    </div>
  </div>`);

fs.writeFileSync('index.html', html);
console.log('index.html updated successfully!');
