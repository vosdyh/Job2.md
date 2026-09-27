# Job Markdown Extractor Extension

This repository contains the complete source code for a Firefox Manifest V3 WebExtension that extracts job titles, company names, and descriptions from LinkedIn, Indeed, and ZipRecruiter, and converts them into high-quality Markdown.

## Structural Decisions & Explanations

### `manifest.json`

The manifest sets up the extension strictly according to MV3 guidelines for Firefox:
- **`manifest_version: 3`**: Ensures compliance with the latest extension architecture.
- **Permissions**: `activeTab` to query the current page, `scripting` to potentially interact if needed (though `content_scripts` handles the main injection), and `downloads` to trigger the local file save.
- **Content Scripts**: Targeted explicitly at LinkedIn, Indeed, and ZipRecruiter domains. Crucially, `all_frames: true` is included so the scripts run inside Indeed's often complex iframe layouts. The `lib/turndown.js` scripts are declared *before* `content.js` so they are globally available within the extension's isolated world context.

```json
{
  "manifest_version": 3,
  "name": "Job Details to Markdown Extractor",
  "version": "1.0",
  "description": "Extracts job titles, companies, and descriptions from LinkedIn, Indeed, and ZipRecruiter and downloads them as Markdown.",
  "permissions": [
    "activeTab",
    "scripting",
    "downloads"
  ],
  "host_permissions": [
    "*://*.linkedin.com/*",
    "*://*.indeed.com/*",
    "*://*.ziprecruiter.com/*"
  ],
  "action": {
    "default_popup": "popup.html",
    "default_title": "Extract Job to Markdown"
  },
  "content_scripts": [
    {
      "matches": [
        "*://*.linkedin.com/*",
        "*://*.indeed.com/*",
        "*://*.ziprecruiter.com/*"
      ],
      "all_frames": true,
      "js": [
        "lib/turndown.js",
        "lib/turndown-plugin-gfm.js",
        "content.js"
      ]
    }
  ],
  "browser_specific_settings": {
    "gecko": {
      "id": "job-markdown-extractor@example.com",
      "strict_min_version": "109.0"
    }
  }
}
```

### `popup.html`

The popup provides a minimalist, fast-loading UI with a single main action button and a status feedback area. It uses standard system fonts to feel native and avoids external stylesheets.

```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Job Markdown Extractor</title>
  <style>
    body {
      width: 300px;
      padding: 16px;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      background-color: #f9fafb;
      margin: 0;
      color: #111827;
    }
    h2 {
      margin-top: 0;
      font-size: 16px;
      font-weight: 600;
      color: #1f2937;
    }
    button {
      width: 100%;
      padding: 10px;
      background-color: #2563eb;
      color: white;
      border: none;
      border-radius: 6px;
      font-size: 14px;
      font-weight: 500;
      cursor: pointer;
      transition: background-color 0.2s;
    }
    button:hover {
      background-color: #1d4ed8;
    }
    button:disabled {
      background-color: #9ca3af;
      cursor: not-allowed;
    }
    #status {
      margin-top: 12px;
      padding: 8px;
      border-radius: 4px;
      font-size: 12px;
      min-height: 40px;
      white-space: pre-wrap;
      word-wrap: break-word;
      background-color: #fff;
      border: 1px solid #e5e7eb;
      display: none;
    }
    .error {
      color: #dc2626;
      border-color: #fecaca !important;
      background-color: #fef2f2 !important;
    }
    .success {
      color: #166534;
      border-color: #bbf7d0 !important;
      background-color: #f0fdf4 !important;
    }
  </style>
</head>
<body>
  <h2>Job Details Extractor</h2>
  <button id="extractBtn">Extract Job to Markdown</button>
  <div id="status"></div>
  <script src="popup.js"></script>
</body>
</html>
```

### `popup.js`

This script bridges the user action with the extension logic.
- **Message Passing**: It queries for the active tab and sends an `extract` message to the `content.js` running on that tab.
- **File Naming & Safety**: It sanitizes the returned Title and Company names to strip illegal characters, ensuring the filename is robust.
- **Downloading**: It utilizes `browser.downloads.download` to generate and save the file via a `Blob` object, specifically routing it to the `Job_Descriptions/` subfolder.

```javascript
document.addEventListener('DOMContentLoaded', () => {
  const extractBtn = document.getElementById('extractBtn');
  const statusDiv = document.getElementById('status');

  function showStatus(message, isError = false) {
    statusDiv.textContent = message;
    statusDiv.style.display = 'block';
    if (isError) {
      statusDiv.classList.add('error');
      statusDiv.classList.remove('success');
    } else {
      statusDiv.classList.add('success');
      statusDiv.classList.remove('error');
    }
  }

  function sanitizeFilename(name) {
    // Remove illegal characters for filenames
    return name.replace(/[<>:"/\\|?*\x00-\x1F]/g, '').trim();
  }

  extractBtn.addEventListener('click', async () => {
    extractBtn.disabled = true;
    showStatus('Extracting...');

    try {
      // Get the active tab
      const tabs = await browser.tabs.query({ active: true, currentWindow: true });
      if (!tabs || tabs.length === 0) {
        throw new Error('No active tab found.');
      }

      const activeTab = tabs[0];

      // Send message to content script
      const response = await browser.tabs.sendMessage(activeTab.id, { action: 'extract' });

      if (!response) {
        throw new Error('No response from content script. Ensure you are on a supported job board and the page is fully loaded.');
      }

      if (response.error) {
        throw new Error(response.error);
      }

      const { title, company, markdown } = response;

      // Sanitize names for the filename
      const cleanCompany = sanitizeFilename(company) || 'Unknown Company';
      const cleanTitle = sanitizeFilename(title) || 'Unknown Title';
      const filename = `Job_Descriptions/${cleanCompany} - ${cleanTitle}.md`;

      // Create a Blob from the Markdown text
      const blob = new Blob([markdown], { type: 'text/markdown' });
      const url = URL.createObjectURL(blob);

      // Trigger the download using browser.downloads API
      const downloadId = await browser.downloads.download({
        url: url,
        filename: filename,
        saveAs: false, // Save silently to the specified folder
        conflictAction: 'uniquify'
      });

      if (downloadId) {
        showStatus('Success! Markdown file downloaded.');
      } else {
        throw new Error('Download failed to start.');
      }

    } catch (err) {
      showStatus(`Error: ${err.message}`, true);
    } finally {
      extractBtn.disabled = false;
    }
  });
});
```

### `content.js`

This is the core engine, implementing a strict Strategy Pattern.
- **SPA & Stale DOM Handling**: Contains `isElementVisible` to actively ignore elements that SPAs (like LinkedIn) keep hidden in the DOM but render invisible (`display: none` or null `offsetParent`).
- **Shadow DOM Piercing**: Uses `deepQuerySelectorAll` to recursively traverse and pierce `shadowRoot` elements, future-proofing against job boards transitioning to Web Components.
- **Sanitization**: `sanitizeNode` strips noisy elements (`script`, `style`, `svg`, apply buttons) before the HTML is passed to Turndown.
- **Context Awareness**: `LinkedInStrategy` and `IndeedStrategy` check the URL to determine if the user is in a split-pane "Search" view or a full-page "Single" view, adjusting the root DOM element search boundary accordingly so the wrong job text is not scraped.

```javascript
// --- Helpers ---

// Checks if an element is visible in the DOM (The SPA Problem)
function isElementVisible(el) {
  if (!el) return false;
  // If the element has no offsetParent (and is not fixed), it's likely hidden.
  // Note: 'fixed' elements might have null offsetParent but be visible.
  const style = window.getComputedStyle(el);
  if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
    return false;
  }
  if (el.offsetParent === null && style.position !== 'fixed') {
    return false;
  }
  return true;
}

// Deep query selector that pierces Shadow Roots
function deepQuerySelectorAll(selector, root = document) {
  const results = [];

  function traverse(node) {
    if (node.nodeType !== Node.ELEMENT_NODE && node.nodeType !== Node.DOCUMENT_NODE && node.nodeType !== Node.DOCUMENT_FRAGMENT_NODE) {
      return;
    }

    // Check current node's children
    if (node.querySelectorAll) {
      const matches = node.querySelectorAll(selector);
      matches.forEach(match => {
        if (!results.includes(match)) {
          results.push(match);
        }
      });
    }

    // Pierce Shadow DOM
    if (node.shadowRoot) {
      traverse(node.shadowRoot);
    }

    // Traverse children
    node.childNodes.forEach(child => traverse(child));
  }

  traverse(root);
  return results;
}

function deepQuerySelector(selector, root = document) {
  const elements = deepQuerySelectorAll(selector, root);
  // Return the first one that is actually visible
  return elements.find(isElementVisible) || null;
}

// Cleans a DOM node for Turndown conversion
function sanitizeNode(node) {
  const cloned = node.cloneNode(true);

  // Elements to remove completely
  const removeSelectors = [
    'script', 'style', 'svg', 'button', 'iframe', 'canvas',
    'form', 'input', 'textarea', 'select', 'img',
    '.apply-button', '#apply-now', '[aria-label*="Apply"]',
    'nav', 'header', 'footer'
  ];

  removeSelectors.forEach(selector => {
    const els = cloned.querySelectorAll(selector);
    els.forEach(el => el.remove());
  });

  return cloned;
}

// Tries a list of selectors and returns the text content of the first matching, visible element
function extractTextWithFallbacks(selectors, root = document) {
  for (const selector of selectors) {
    const el = deepQuerySelector(selector, root);
    if (el && el.textContent.trim()) {
      return el.textContent.trim().replace(/\s+/g, ' '); // Normalize whitespace
    }
  }
  return null;
}

// Tries a list of selectors and returns the sanitized HTML of the first matching, visible element
function extractHtmlWithFallbacks(selectors, root = document) {
  for (const selector of selectors) {
    const el = deepQuerySelector(selector, root);
    if (el) {
      const sanitized = sanitizeNode(el);
      return sanitized.innerHTML;
    }
  }
  return null;
}

// --- Strategies ---

class LinkedInStrategy {
  extract() {
    // Determine context: Split view (search) vs Single job view
    const isSplitView = window.location.pathname.includes('/jobs/search/');
    const root = isSplitView ? (deepQuerySelector('.job-details') || document) : document;

    const titleSelectors = [
      'h1.job-details-jobs-unified-top-card__job-title', // Modern detailed view
      'h1.t-24', // Fallback standard header
      '.top-card-layout__title',
      '[data-test-job-title]'
    ];

    const companySelectors = [
      '.job-details-jobs-unified-top-card__company-name a',
      '.job-details-jobs-unified-top-card__company-name',
      '.topcard__org-name-link',
      'a[data-test-company-name]',
      '.job-details-jobs-unified-top-card__subtitle-primary-grouping'
    ];

    const descSelectors = [
      '#job-details', // The primary container
      '.jobs-description-content__text',
      '.show-more-less-html__markup',
      'article'
    ];

    return {
      title: extractTextWithFallbacks(titleSelectors, root) || 'Unknown Title',
      company: extractTextWithFallbacks(companySelectors, root) || 'Unknown Company',
      html: extractHtmlWithFallbacks(descSelectors, root)
    };
  }
}

class IndeedStrategy {
  extract() {
    // Indeed often uses iframes for the split view right-hand pane.
    // Due to all_frames: true, this script runs in the iframe as well.
    // If we're in the top window of a search page, we might want to tell the user to click a job,
    // or rely on the script running in the active iframe.
    // For Indeed, usually the job detail is in a container called vjs-container or jobsearch-ViewJobLayout

    let root = document;
    if (window.location.pathname.includes('/jobs')) {
       // Search page, look for the split pane container if it exists
       root = deepQuerySelector('.jobsearch-RightPane') || document;
    }

    const titleSelectors = [
      'h1.jobsearch-JobInfoHeader-title',
      'h1[data-testid="jobsearch-JobInfoHeader-title"]',
      '.jobsearch-JobInfoHeader-title-container h1',
      'h1'
    ];

    const companySelectors = [
      '[data-testid="inlineHeader-companyName"]',
      '.jobsearch-CompanyInfoContainer a',
      '.jobsearch-JobInfoHeader-subtitle div[data-company-name="true"]',
      '.jobsearch-CompanyReview--heading'
    ];

    const descSelectors = [
      '#jobDescriptionText',
      '.jobsearch-jobDescriptionText',
      '[data-testid="jobsearch-jobDescriptionText"]'
    ];

    return {
      title: extractTextWithFallbacks(titleSelectors, root) || 'Unknown Title',
      company: extractTextWithFallbacks(companySelectors, root) || 'Unknown Company',
      html: extractHtmlWithFallbacks(descSelectors, root)
    };
  }
}

class ZipRecruiterStrategy {
  extract() {
    const root = document;

    const titleSelectors = [
      'h1.job_title',
      'h1[data-testid="job-title"]',
      '.job_title_and_company h1',
      'h1'
    ];

    const companySelectors = [
      '.job_company_name',
      '[data-testid="job-company"]',
      '.job_title_and_company a.company_name',
      '.company_name'
    ];

    const descSelectors = [
      '.job_description',
      '[data-testid="job-description"]',
      '#job_desc'
    ];

    return {
      title: extractTextWithFallbacks(titleSelectors, root) || 'Unknown Title',
      company: extractTextWithFallbacks(companySelectors, root) || 'Unknown Company',
      html: extractHtmlWithFallbacks(descSelectors, root)
    };
  }
}

// --- Engine ---

class JobScraper {
  constructor() {
    const hostname = window.location.hostname;
    if (hostname.includes('linkedin.com')) {
      this.strategy = new LinkedInStrategy();
    } else if (hostname.includes('indeed.com')) {
      this.strategy = new IndeedStrategy();
    } else if (hostname.includes('ziprecruiter.com')) {
      this.strategy = new ZipRecruiterStrategy();
    } else {
      this.strategy = null;
    }

    // Initialize Turndown (available globally via content_scripts array)
    if (typeof TurndownService !== 'undefined') {
      this.turndownService = new TurndownService({
        headingStyle: 'atx',
        hr: '---',
        bulletListMarker: '-',
        codeBlockStyle: 'fenced'
      });
      // Add GFM plugin for tables if available
      if (typeof turndownPluginGfm !== 'undefined') {
        this.turndownService.use(turndownPluginGfm.gfm);
      }
    }
  }

  scrape() {
    if (!this.strategy) {
      return { error: 'Unsupported site. Please run on LinkedIn, Indeed, or ZipRecruiter.' };
    }

    try {
      const data = this.strategy.extract();

      if (!data.html) {
        return { error: 'Could not find the job description on this page.' };
      }

      if (!this.turndownService) {
         return { error: 'Markdown converter failed to initialize.' };
      }

      const markdown = this.turndownService.turndown(data.html);

      return {
        title: data.title,
        company: data.company,
        markdown: markdown,
        error: null
      };

    } catch (e) {
      return { error: `Extraction failed: ${e.message}` };
    }
  }
}

// --- Message Listener ---

// Listen for messages from the popup
browser.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'extract') {
    const scraper = new JobScraper();
    const result = scraper.scrape();
    sendResponse(result);
  }
  // Return true if sendResponse will be called asynchronously, but we are synchronous here.
  // Returning nothing or false is fine for synchronous responses in MV3 Firefox.
});
```
