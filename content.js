// --- Helpers ---

// Async polling helper to handle asynchronous DOM hydration in SPAs
async function pollWithRetry(callback, interval = 250, timeout = 3000) {
  const startTime = Date.now();
  return new Promise((resolve) => {
    const checkCondition = () => {
      const result = callback();
      if (result) {
        resolve(result);
      } else if (Date.now() - startTime >= timeout) {
        resolve(null);
      } else {
        setTimeout(checkCondition, interval);
      }
    };
    checkCondition();
  });
}

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
async function extractTextWithFallbacks(selectors, root = document) {
  return pollWithRetry(() => {
    for (const selector of selectors) {
      const el = deepQuerySelector(selector, root);
      if (el && el.textContent.trim()) {
        return el.textContent.trim().replace(/\s+/g, ' '); // Normalize whitespace
      }
    }
    return null;
  });
}

// Tries a list of selectors and returns the sanitized HTML of the first matching, visible element
async function extractHtmlWithFallbacks(selectors, root = document) {
  return pollWithRetry(() => {
    for (const selector of selectors) {
      const el = deepQuerySelector(selector, root);
      if (el) {
        const sanitized = sanitizeNode(el);
        return sanitized.innerHTML;
      }
    }
    return null;
  });
}

// --- Strategies ---

class LinkedInStrategy {
  async extract() {
    // 1. Find the Root
    let root = null;
    const leftList = deepQuerySelector('[data-testid="lazy-column"]');

    if (leftList && leftList.nextElementSibling) {
        // Multi-pane: The right job detail pane is the direct sibling of the left list
        root = leftList.nextElementSibling;
    } else {
        // Single-pane: Safely default to main workspace
        root = deepQuerySelector('main[id="workspace"]') || deepQuerySelector('main') || document.body;
    }

    if (!root) {
        return { platform: 'LinkedIn', title: 'Unknown Title', company: 'Unknown Company', metadata: [], html: null, url: window.location.href };
    }

    // 2. Extract Title by Largest Font Size
    const candidates = deepQuerySelectorAll('h1, h2, h3, p, a', root);
    let maxFontSize = 0;
    let bestTitle = 'Unknown Title';

    for (const candidate of candidates) {
        if (!isElementVisible(candidate)) continue;

        const clone = candidate.cloneNode(true);
        // Strip visual badges
        const artifacts = clone.querySelectorAll('svg, img, [aria-label*="Verified"], [aria-label*="Promoted"]');
        artifacts.forEach(el => el.remove());
        
        const text = clone.textContent.replace(/\s+/g, ' ').trim();
        const lowerText = text.toLowerCase();
        
        // Standard Noise Filters
        const isExactMatchUI = ['home', 'my network', 'jobs', 'messaging', 'notifications', 'me', 'hiring', 'apply', 'save'].includes(lowerText);
        const isRegexMatchUI = /^\d+\s*notifications?$/i.test(text) || /^\d+\s*applicants?$/i.test(text) || /^\d+\s*people clicked apply$/i.test(text);
        const isFeedHeader = lowerText.includes('jobs based on your preferences') || lowerText.includes('top job picks') || lowerText.includes('suggested searches') || lowerText.includes('search results');

        if (isExactMatchUI || isRegexMatchUI || isFeedHeader) continue;
        if (text.length <= 5 || text.length > 80) continue;

        // Evaluate Font Size
        const style = window.getComputedStyle(candidate);
        const fontSize = parseFloat(style.fontSize) || 0;

        // The largest valid text node is guaranteed to be the Job Title
        if (fontSize > maxFontSize) {
            maxFontSize = fontSize;
            bestTitle = text;
        }
    }

    let title = bestTitle;

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
      company = (await extractTextWithFallbacks(companySelectors, root)) || 'Unknown Company';
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
        '.jobs-description__content',
        '.jobs-description-content__text',
        '.show-more-less-html__markup',
        'article'
      ];
      html = await extractHtmlWithFallbacks(descSelectors, root);
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
  async extract() {
    // 1. Find the Root
    let root = deepQuerySelector('[data-testid="viewjob-main-content"]');

    if (!root) {
        // Fallback for single-pane or alternate layouts
        root = deepQuerySelector('.jobsearch-JobComponent') || deepQuerySelector('main') || document.body;
    }

    if (!root) {
        return { platform: 'Indeed', title: 'Unknown Title', company: 'Unknown Company', metadata: [], html: null, url: window.location.href };
    }

    // 2. Extract Title
    let title = 'Unknown Title';
    const titleElement = deepQuerySelector('[data-testid="vj-job-title"]', root) || deepQuerySelector('h1.jobsearch-JobInfoHeader-title', root);

    if (titleElement && isElementVisible(titleElement)) {
        const clone = titleElement.cloneNode(true);
        // Strip any potential visual badges (though rare on Indeed titles)
        const artifacts = clone.querySelectorAll('svg, img');
        artifacts.forEach(el => el.remove());

        const text = clone.textContent.replace(/\s+/g, ' ').trim();
        if (text.length > 3 && text.length <= 100) {
            title = text;
        }
    }

    // 3. Extract Company Name
    let company = 'Unknown Company';
    // Target the company profile link or standard test ID
    const companyNode = deepQuerySelector('a[href*="/cmp/"]', root) || deepQuerySelector('[data-testid="inlineHeader-companyName"]', root) || deepQuerySelector('[data-testid="company-name"]', root);

    if (companyNode && isElementVisible(companyNode)) {
        const clone = companyNode.cloneNode(true);
        // Strip external link SVGs
        clone.querySelectorAll('svg, img').forEach(el => el.remove());
        const text = clone.textContent.replace(/\s+/g, ' ').trim();
        if (text.length > 0) {
            company = text;
        }
    }

    // 4. Extract Location (Metadata)
    const metadata = [];
    const locationNode = deepQuerySelector('[data-testid="inlineHeader-companyLocation"]', root) || deepQuerySelector('[data-testid="job-location"]', root);

    if (locationNode && isElementVisible(locationNode)) {
        metadata.push(locationNode.textContent.replace(/\s+/g, ' ').trim());
    } else if (companyNode) {
        // Structural Fallback: If no test ID exists, check the immediate sibling wrappers of the company node
        let currentParent = companyNode.parentElement;
        let fallbackLocation = null;

        // Walk up a few levels to find the adjacent location div
        for (let i = 0; i < 3; i++) {
            if (!currentParent || currentParent === root) break;
            const nextSibling = currentParent.nextElementSibling;
            if (nextSibling && isElementVisible(nextSibling)) {
                const siblingText = nextSibling.textContent.replace(/\s+/g, ' ').trim();
                // Locations are typically short strings (e.g., "Fort Myers, FL 33901")
                if (siblingText.length > 0 && siblingText.length < 50) {
                    fallbackLocation = siblingText;
                    break;
                }
            }
            currentParent = currentParent.parentElement;
        }

        if (fallbackLocation) {
            metadata.push(fallbackLocation);
        }
    }

    const descSelectors = [
        '#jobDescriptionText',
        '.jobsearch-JobComponent-description',
        '#vjs-desc',
        '.react-native-html-content',
        '.simple-job-description-html'
    ];

    return {
      platform: "Indeed",
      title: title,
      company: company,
      metadata: metadata,
      html: await extractHtmlWithFallbacks(descSelectors, root),
      url: window.location.href
    };
  }
}

class ZipRecruiterStrategy {
  async extract() {
    const root = document;

    // 1. Extract Title
    let title = 'Unknown Title';
    const titleContainer = deepQuerySelector('[data-testid="serp-job-details-title"]', root);
    const titleNode = titleContainer ? deepQuerySelector('h2', titleContainer) : deepQuerySelector('h1.job_title', root);

    if (titleNode && isElementVisible(titleNode)) {
        const text = titleNode.textContent.replace(/\s+/g, ' ').trim();
        if (text.length > 3 && text.length <= 100) {
            title = text;
        }
    }

    // 2. Extract Company
    let company = 'Unknown Company';
    const companyContainer = deepQuerySelector('[data-testid="employer-details-header"]', root) || deepQuerySelector('[data-testid="employer-details-section"]', root);
    const companyNode = companyContainer ? deepQuerySelector('span.font-bold', companyContainer) : deepQuerySelector('.hiring_company_text', root);

    if (companyNode && isElementVisible(companyNode)) {
        const text = companyNode.textContent.replace(/\s+/g, ' ').trim();
        if (text.length > 0) {
            company = text;
        }
    }

    // 3. Extract Location (Metadata)
    const metadata = [];
    // In the multi-pane view, location is typically the first paragraph after the title container
    if (titleContainer) {
        const locationNode = titleContainer.nextElementSibling;
        if (locationNode && locationNode.tagName.toLowerCase() === 'div') {
            const pNode = deepQuerySelector('p', locationNode);
            if (pNode && isElementVisible(pNode)) {
                const locText = pNode.textContent.replace(/\s+/g, ' ').trim();
                if (locText.length > 0) {
                    metadata.push(locText);
                }
            }
        }
    }

    // Extract Job Highlights as an HTML list instead of metadata
    const highlightNodes = root.querySelectorAll('.flex.flex-col.gap-y-8 .flex.gap-x-12 p');
    let highlightsHtml = '';
    if (highlightNodes.length > 0) {
        highlightsHtml = '<ul>';
        highlightNodes.forEach(node => {
            if (isElementVisible(node)) {
                const text = node.textContent.replace(/\s+/g, ' ').trim();
                if (text.length > 0) {
                    highlightsHtml += `<li>${text}</li>`;
                }
            }
        });
        highlightsHtml += '</ul>';
    }

    const descSelectors = [
        '.whitespace-pre-line',
        '.job_description',
        '[data-testid="job-details-scroll-container"]'
    ];

    let html = await extractHtmlWithFallbacks(descSelectors, root);

    // Extract Key responsibilities and fix Markdown double-spacing
    const headers = root.querySelectorAll('h2');
    let responsibilitiesHtml = '';
    for (const h2 of headers) {
        if (h2.textContent.trim().toLowerCase() === 'key responsibilities') {
            const ul = h2.nextElementSibling;
            if (ul && ul.tagName.toLowerCase() === 'ul') {
                // Strip inner <p> tags to prevent double-spaced markdown bullets
                const cleanUlHtml = ul.outerHTML.replace(/<\/?p[^>]*>/gi, '');
                responsibilitiesHtml = `<h2>Key responsibilities</h2>${cleanUlHtml}`;
            }
            break;
        }
    }

    // Prepend both sections to the main HTML payload
    let prependContent = '';
    if (highlightsHtml) prependContent += highlightsHtml;
    if (responsibilitiesHtml && html && !html.includes('Key responsibilities')) prependContent += responsibilitiesHtml;

    if (prependContent) {
        html = prependContent + html;
    }

    return {
        platform: 'ZipRecruiter',
        title: title,
        company: company,
        metadata: metadata, // Now only contains the Location string
        html: html,
        url: window.location.href
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

  async scrape() {
    if (!this.strategy) {
      return { error: 'Unsupported site. Please run on LinkedIn, Indeed, or ZipRecruiter.' };
    }

    try {
      const data = await this.strategy.extract();

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
    scraper.scrape().then(result => {
      sendResponse(result);
    }).catch(error => {
      sendResponse({ error: `Scraping failed: ${error.message}` });
    });
    return true; // Keep the message channel open for the async response
  }
  return false;
});
