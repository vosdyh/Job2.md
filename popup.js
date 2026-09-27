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

      const { platform, title, company, markdown } = response;

      // Sanitize names for the filename
      const cleanPlatform = sanitizeFilename(platform) || 'Unknown Platform';
      const cleanCompany = sanitizeFilename(company) || 'Unknown Company';
      const cleanTitle = sanitizeFilename(title) || 'Unknown Title';
      const filename = `Job_Descriptions/${cleanPlatform} - ${cleanCompany} - ${cleanTitle}.md`;

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
