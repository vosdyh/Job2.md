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
    // Locate the active job details pane first, ensuring we are within the correct active pane.
    let rootCandidates = Array.from(deepQuerySelectorAll('[data-sdui-screen*="JobDetails"]'));
    if (rootCandidates.length === 0) {
        rootCandidates = Array.from(deepQuerySelectorAll('section[aria-label="Primary content"]'));
    }
    let root = rootCandidates.find(isElementVisible);

    if (!root) {
        root = deepQuerySelector('.jobs-search__job-details--container') || 
               deepQuerySelector('.scaffold-layout__detail') || 
               deepQuerySelector('.job-details') ||
               deepQuerySelector('[aria-label="Primary content"]'); 
    }

    if (!root) {
        return {
            platform: "LinkedIn",
            title: 'Unknown Title',
            company: 'Unknown Company',
            metadata: [],
            html: null,
            url: window.location.href
        };
    }

    // 1. Job Title
    let title = 'Unknown Title';
    const candidates = deepQuerySelectorAll('h1, h2, p', root);
    
    for (const candidate of candidates) {
        const clone = candidate.cloneNode(true);
        const elementsToRemove = clone.querySelectorAll('svg, img, [aria-label*="Verified"], [aria-label*="Promoted"]');
        elementsToRemove.forEach(el => el.remove());
        
        const text = clone.textContent.replace(/\s+/g, ' ').trim();
        const lowerText = text.toLowerCase();
        
        const isExactMatchUI = ['home', 'my network', 'jobs', 'messaging', 'notifications', 'me', 'hiring'].includes(lowerText);
        const isRegexMatchUI = /^\d+\s*notifications?$/i.test(text) || 
                               /^\d+\s*applicants?$/i.test(text) || 
                               /^\d+\s*people clicked apply$/i.test(text);
        const isFeedHeader = lowerText.includes('jobs based on your preferences') ||
                             lowerText.includes('top job picks') ||
                             lowerText.includes('suggested searches') ||
                             lowerText.includes('search results');

        if (isExactMatchUI || isRegexMatchUI || isFeedHeader) {
            continue;
        }

        if (text.length > 5 && text.length <= 80) {
            title = text;
            break;
        }
    }

    // 2. Company Name
    let company = 'Unknown Company';
    const companyContainers = Array.from(root.querySelectorAll('div[aria-label^="Company, "]')).filter(el => el.offsetParent !== null);
    const companyContainer = companyContainers[0]; // enforce offsetParent !== null
    if (companyContainer) {
      const companyLink = companyContainer.querySelector('a');
      if (companyLink) {
        company = companyLink.textContent.replace(/\s+/g, ' ').trim();
      }
    } else {
      // Fallback
      const companySelectors = [
        '.job-details-jobs-unified-top-card__company-name a',
        '.job-details-jobs-unified-top-card__company-name',
        '.topcard__org-name-link',
        'a[data-test-company-name]',
        '.job-details-jobs-unified-top-card__subtitle-primary-grouping'
      ];
      company = extractTextWithFallbacks(companySelectors, root) || 'Unknown Company';
    }

    // 3. Metadata
    let metadata = [];
    const paragraphs = deepQuerySelectorAll('p', root); // Find a container that holds metadata
    for (const p of paragraphs) {
      if (isElementVisible(p) && p.textContent.includes('·')) {
        const spans = p.querySelectorAll('span');
        if (spans.length >= 2) {
          const parts = [];
          for (const span of spans) {
            const text = span.textContent.replace(/\s+/g, ' ').trim();
            if (text && text !== '·' && !parts.includes(text)) {
              parts.push(text);
            }
          }
          if (parts.length > 0) {
            metadata = parts;
            break;
          }
        }
      }
    }

    // 4. Job Description
    let html = null;
    const descContainers = Array.from(root.querySelectorAll('span[data-testid="expandable-text-box"]')).filter(el => el.offsetParent !== null);
    const descContainer = descContainers[0]; // enforce offsetParent !== null
    if (descContainer) {
      const sanitized = sanitizeNode(descContainer);
      html = sanitized.innerHTML;
    } else {
      // Fallback
      const descSelectors = [
        '#job-details',
        '.jobs-description-content__text',
        '.show-more-less-html__markup',
        'article'
      ];
      html = extractHtmlWithFallbacks(descSelectors, root);
    }

    // 5. Job URL
    let url = window.location.href;
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.has('currentJobId')) {
      const jobId = urlParams.get('currentJobId');
      url = `https://www.linkedin.com/jobs/view/${jobId}/`;
    } else {
      url = window.location.origin + window.location.pathname;
    }

    return {
      platform: "LinkedIn",
      title,
      company,
      metadata,
      html,
      url
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
      platform: "Indeed",
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
      platform: "ZipRecruiter",
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

      let markdownBody = this.turndownService.turndown(data.html);

      let header = `# ${data.title}`;
      let companyAndMetaParts = [`**${data.company}**`];

      if (Array.isArray(data.metadata)) {
         data.metadata.forEach(item => {
             companyAndMetaParts.push(`**${item}**`);
         });
      } else if (data.metadata && typeof data.metadata === 'string') {
         companyAndMetaParts.push(`**${data.metadata}**`);
      }

      let metaLine = companyAndMetaParts.join(' | ');

      let footer = '';
      if (data.url) {
         footer = `\n\n---\n${data.url}`;
      } else {
         footer = `\n\n---\n${window.location.href}`;
      }

      let finalMarkdown = `${header}\n${metaLine}\n\n${markdownBody}${footer}`;

      return {
        platform: data.platform,
        title: data.title,
        company: data.company,
        markdown: finalMarkdown,
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
