// Tab Bar Renderer - Vanilla JS version (no React bundling needed)
// This runs in a separate renderer process from the tab content

let tabs = [];
let activeTabId = null;
let windowId = null;
let platform = window.tabBarAPI?.platform || 'linux';
let useNativeFrame = false;
let isFullScreen = false;
let canGoBack = false;
let canGoForward = false;

// Initialize on DOM load
document.addEventListener('DOMContentLoaded', async () => {
  await loadInitialState();
  setupEventListeners();
  await loadInitialTheme();
  render();
});

// Load initial state from main process
async function loadInitialState() {
  try {
    const state = await window.tabBarAPI.getInitialState();
    tabs = state.tabs || [];
    activeTabId = state.activeTabId || null;
    windowId = state.windowId || null;
    platform = state.platform || window.tabBarAPI?.platform || 'linux';
    useNativeFrame = !!state.useNativeFrame;
    isFullScreen = !!state.isFullScreen;
    canGoBack = !!state.canGoBack;
    canGoForward = !!state.canGoForward;
    console.log('Tab bar loaded:', { tabs, activeTabId, windowId, platform, useNativeFrame, isFullScreen, canGoBack, canGoForward });
  } catch (error) {
    console.error('Failed to load initial tab state:', error);
  }
}

// Setup IPC event listeners
function setupEventListeners() {
  // Listen for tab updates from main process
  window.tabBarAPI.onTabsUpdated((data) => {
    tabs = data.tabs;
    render();
  });

  window.tabBarAPI.onTabActivated((tabId) => {
    activeTabId = tabId;
    render();
  });

  // Listen for theme changes
  if (window.tabBarAPI.onThemeChanged) {
    window.tabBarAPI.onThemeChanged((themeName) => {
      console.log('Theme changed to:', themeName);
      applyLotionTheme(themeName);
    });
  }

  // Listen for fullscreen state changes
  if (window.tabBarAPI.onFullscreenChanged) {
    window.tabBarAPI.onFullscreenChanged((fullscreenState) => {
      isFullScreen = fullscreenState;
      render();
    });
  }

  // Listen for navigation state changes (back/forward history)
  if (window.tabBarAPI.onNavigationStateChanged) {
    window.tabBarAPI.onNavigationStateChanged((navState) => {
      canGoBack = !!navState.canGoBack;
      canGoForward = !!navState.canGoForward;
      updateNavigationButtons();
    });
  }
}

// Render tab bar UI
function render() {
  const container = document.getElementById('root');
  if (!container) return;

  const showTrafficLightSpacer = platform === 'darwin' && !useNativeFrame && !isFullScreen;
  const showWindowControls = !useNativeFrame && platform !== 'darwin';

  container.innerHTML = `
    <div class="tab-bar">
      ${showTrafficLightSpacer ? '<div class="traffic-lights-spacer"></div>' : ''}
      <div class="nav-controls">
        <div class="app-logo" id="app-logo" title="Lotion">
          <img src="./logo.png" alt="L" style="width: 100%; height: 100%;" onerror="this.parentElement.textContent='L'">
        </div>
        <button class="nav-btn" id="back-btn" title="Go Back" ${canGoBack ? '' : 'disabled'}>‹</button>
        <button class="nav-btn" id="forward-btn" title="Go Forward" ${canGoForward ? '' : 'disabled'}>›</button>
        <button class="nav-btn" id="refresh-btn" title="Refresh">↻</button>
      </div>
      <div class="tab-list">
        ${renderTabGroups(tabs)}
      </div>
      <button class="new-tab-btn" id="new-tab-btn" title="New Tab">+</button>
      <div class="window-drag-area" title="Drag to move window"></div>
      ${showWindowControls ? `
      <div class="window-controls">
        <button class="window-control-btn minimize" id="minimize-btn" title="Minimize">−</button>
        <button class="window-control-btn maximize" id="maximize-btn" title="Maximize">□</button>
        <button class="window-control-btn close" id="close-btn" title="Close">×</button>
      </div>
      ` : ''}
    </div>
  `;

  // Add event listeners after rendering
  addEventListeners();
  setupTabDragAndDrop();
  setupTabListWheelScroll();
}

// Distinct pastel tint palettes for workspace clusters
const WORKSPACE_PALETTES = [
  // 0: Sky / Frost Blue
  {
    lightBg: 'rgba(59, 130, 246, 0.16)',
    lightBorder: 'rgba(59, 130, 246, 0.40)',
    darkBg: 'rgba(59, 130, 246, 0.22)',
    darkBorder: 'rgba(59, 130, 246, 0.45)',
    accent: '#3b82f6',
  },
  // 1: Emerald / Sage Green
  {
    lightBg: 'rgba(16, 185, 129, 0.16)',
    lightBorder: 'rgba(16, 185, 129, 0.40)',
    darkBg: 'rgba(16, 185, 129, 0.22)',
    darkBorder: 'rgba(16, 185, 129, 0.45)',
    accent: '#10b981',
  },
  // 2: Violet / Lavender Purple
  {
    lightBg: 'rgba(139, 92, 246, 0.16)',
    lightBorder: 'rgba(139, 92, 246, 0.40)',
    darkBg: 'rgba(139, 92, 246, 0.22)',
    darkBorder: 'rgba(139, 92, 246, 0.45)',
    accent: '#8b5cf6',
  },
  // 3: Warm Coral / Amber Orange
  {
    lightBg: 'rgba(245, 158, 11, 0.16)',
    lightBorder: 'rgba(245, 158, 11, 0.42)',
    darkBg: 'rgba(245, 158, 11, 0.22)',
    darkBorder: 'rgba(245, 158, 11, 0.45)',
    accent: '#f59e0b',
  },
  // 4: Rose / Crimson Pink
  {
    lightBg: 'rgba(244, 63, 94, 0.15)',
    lightBorder: 'rgba(244, 63, 94, 0.40)',
    darkBg: 'rgba(244, 63, 94, 0.22)',
    darkBorder: 'rgba(244, 63, 94, 0.45)',
    accent: '#f43f5e',
  },
  // 5: Cyan / Teal
  {
    lightBg: 'rgba(6, 182, 212, 0.16)',
    lightBorder: 'rgba(6, 182, 212, 0.40)',
    darkBg: 'rgba(6, 182, 212, 0.22)',
    darkBorder: 'rgba(6, 182, 212, 0.45)',
    accent: '#06b6d4',
  },
];

// Render tabs grouped into workspace clusters
function renderTabGroups(tabList) {
  if (!tabList || tabList.length === 0) return '';

  const isDark = document.body.classList.contains('dark-mode') ||
                 Array.from(document.body.classList).some(c => c.startsWith('theme-'));

  // Assign each distinct workspace in this window a unique color palette
  const uniqueWorkspaces = Array.from(new Set(tabList.map(t => t.workspaceName).filter(Boolean)));
  const workspaceColorMap = new Map();
  uniqueWorkspaces.forEach((name, index) => {
    workspaceColorMap.set(name, WORKSPACE_PALETTES[index % WORKSPACE_PALETTES.length]);
  });

  const groups = [];
  let currentGroup = null;

  for (const tab of tabList) {
    const wsName = tab.workspaceName || '';
    if (!currentGroup || currentGroup.name !== wsName) {
      currentGroup = {
        name: wsName,
        tabs: [tab],
      };
      groups.push(currentGroup);
    } else {
      currentGroup.tabs.push(tab);
    }
  }

  return groups.map(group => {
    const palette = group.name ? workspaceColorMap.get(group.name) : null;
    let styleAttr = '';
    if (palette) {
      const bg = isDark ? palette.darkBg : palette.lightBg;
      const border = isDark ? palette.darkBorder : palette.lightBorder;
      styleAttr = `style="background-color: ${bg}; border-color: ${border};"`;
    }
    const renderedTabs = group.tabs.map(tab => renderTab(tab, palette)).join('');
    const titleAttr = group.name ? `title="Workspace: ${escapeHtml(group.name)}"` : '';
    return `<div class="workspace-group" ${styleAttr} ${titleAttr}>${renderedTabs}</div>`;
  }).join('');
}

// Translate vertical scroll wheel into horizontal panning over the tab
// list so users can navigate overflowing tabs without reaching for the
// (intentionally hidden) scrollbar.
function setupTabListWheelScroll() {
  const list = document.querySelector('.tab-list');
  if (!list) return;
  list.addEventListener('wheel', (e) => {
    // If the user is already scrolling horizontally (touchpad), let the
    // native behavior handle it.
    if (e.deltaY === 0 || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
    if (list.scrollWidth <= list.clientWidth) return; // No overflow
    e.preventDefault();
    list.scrollLeft += e.deltaY;
  }, { passive: false });

  list.addEventListener('scroll', updateOverflowIndicators, { passive: true });
  // Initial classification + reclassify whenever the window resizes.
  updateOverflowIndicators();
  if (!setupTabListWheelScroll._resizeHooked) {
    window.addEventListener('resize', () => updateOverflowIndicators());
    setupTabListWheelScroll._resizeHooked = true;
  }
}

// Toggle `.overflow-left` / `.overflow-right` on the tab list so the
// mask gradient fades whichever edges have hidden tabs. Acts as a
// visual "more tabs that way" cue.
function updateOverflowIndicators() {
  const list = document.querySelector('.tab-list');
  if (!list) return;
  const hasOverflow = list.scrollWidth > list.clientWidth + 1;
  const atStart = list.scrollLeft <= 0;
  const atEnd = list.scrollLeft + list.clientWidth >= list.scrollWidth - 1;
  list.classList.toggle('overflow-left', hasOverflow && !atStart);
  list.classList.toggle('overflow-right', hasOverflow && !atEnd);
}

// Render individual tab
function renderTab(tab, palette) {
  const isActive = tab.tabId === activeTabId;
  const isPinned = tab.isPinned;
  const title = truncateTitle(tab.title || 'New Tab', 20);

  // Workspace icon (if available)
  let workspaceIconHtml = '';
  if (tab.workspaceIcon && !isPinned) {
    const isUrl = tab.workspaceIcon.startsWith('http://') ||
                  tab.workspaceIcon.startsWith('https://') ||
                  tab.workspaceIcon.startsWith('data:') ||
                  tab.workspaceIcon.startsWith('/');
    if (isUrl) {
      workspaceIconHtml = `<img src="${escapeHtml(tab.workspaceIcon)}" class="workspace-icon" alt="" title="${escapeHtml(tab.workspaceName || 'Workspace')}" onerror="this.style.display='none'">`;
    } else {
      workspaceIconHtml = `<span class="workspace-icon workspace-icon-text" title="${escapeHtml(tab.workspaceName || 'Workspace')}">${escapeHtml(tab.workspaceIcon)}</span>`;
    }
  }

  // Use favicon if available, otherwise show a default icon or emoji
  const faviconHtml = tab.favicon
    ? `<img src="${escapeHtml(tab.favicon)}" class="favicon" alt="" onerror="this.style.display='none'">`
    : '<span class="favicon">📄</span>';

  const activeStyle = (isActive && palette)
    ? `style="border-bottom-color: ${palette.accent};"`
    : '';

  return `
    <div class="tab ${isActive ? 'active' : ''} ${isPinned ? 'pinned' : ''}"
         data-tab-id="${tab.tabId}"
         ${activeStyle}
         draggable="true"
         title="${escapeHtml(tab.title || 'Untitled')}">
      ${workspaceIconHtml}
      ${faviconHtml}
      <span class="tab-title">${escapeHtml(title)}</span>
      ${!isPinned ? `<button class="close-btn" data-tab-id="${tab.tabId}" title="Close Tab">×</button>` : ''}
    </div>
  `;
}

// Compute the new tab order if `draggedId` is dropped at the position of `targetId`.
// `before` = true drops to the left of target, false drops to the right.
function computeReorderedIds(draggedId, targetId, before) {
  const ids = tabs.map(t => t.tabId);
  const fromIdx = ids.indexOf(draggedId);
  if (fromIdx === -1 || draggedId === targetId) return null;
  ids.splice(fromIdx, 1);
  let toIdx = ids.indexOf(targetId);
  if (toIdx === -1) return null;
  if (!before) toIdx += 1;
  ids.splice(toIdx, 0, draggedId);
  return ids;
}

function setupTabDragAndDrop() {
  let draggedId = null;

  document.querySelectorAll('.tab').forEach(el => {
    el.addEventListener('dragstart', (e) => {
      draggedId = el.dataset.tabId;
      e.dataTransfer.effectAllowed = 'move';
      // Some browsers require dataTransfer.setData to start a drag.
      try { e.dataTransfer.setData('text/plain', draggedId); } catch (_) {}
      el.classList.add('dragging');
    });

    el.addEventListener('dragend', () => {
      draggedId = null;
      document.querySelectorAll('.tab').forEach(t => {
        t.classList.remove('dragging', 'drop-before', 'drop-after');
      });
    });

    el.addEventListener('dragover', (e) => {
      if (!draggedId || el.dataset.tabId === draggedId) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      const rect = el.getBoundingClientRect();
      const before = (e.clientX - rect.left) < rect.width / 2;
      el.classList.toggle('drop-before', before);
      el.classList.toggle('drop-after', !before);
    });

    el.addEventListener('dragleave', () => {
      el.classList.remove('drop-before', 'drop-after');
    });

    el.addEventListener('drop', (e) => {
      if (!draggedId) return;
      e.preventDefault();
      const targetId = el.dataset.tabId;
      const rect = el.getBoundingClientRect();
      const before = (e.clientX - rect.left) < rect.width / 2;
      const newOrder = computeReorderedIds(draggedId, targetId, before);
      if (newOrder && window.tabBarAPI.reorderTabs) {
        // Optimistically reorder locally so the UI doesn't lag the IPC roundtrip
        tabs = newOrder.map(id => tabs.find(t => t.tabId === id)).filter(Boolean);
        render();
        window.tabBarAPI.reorderTabs(windowId, newOrder);
      }
    });
  });
}

// Escape HTML to prevent XSS
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Add click event listeners
function addEventListeners() {
  // Tab click - switch to tab
  document.querySelectorAll('.tab').forEach(tabEl => {
    tabEl.addEventListener('click', (e) => {
      if (!e.target.classList.contains('close-btn')) {
        const tabId = tabEl.dataset.tabId;
        window.tabBarAPI.switchTab(tabId);
      }
    });
  });

  // Close button click
  document.querySelectorAll('.close-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const tabId = btn.dataset.tabId;
      window.tabBarAPI.closeTab(tabId);
    });
  });

  // New tab button click
  const newTabBtn = document.getElementById('new-tab-btn');
  if (newTabBtn) {
    newTabBtn.addEventListener('click', () => {
      window.tabBarAPI.createTab({ windowId });
    });
  }

  // Navigation buttons
  const backBtn = document.getElementById('back-btn');
  const forwardBtn = document.getElementById('forward-btn');
  const refreshBtn = document.getElementById('refresh-btn');

  if (backBtn) {
    backBtn.addEventListener('click', () => {
      window.tabBarAPI.navigateBack();
    });
  }

  if (forwardBtn) {
    forwardBtn.addEventListener('click', () => {
      window.tabBarAPI.navigateForward();
    });
  }

  if (refreshBtn) {
    refreshBtn.addEventListener('click', () => {
      window.tabBarAPI.refresh();
    });
  }

  // Window control buttons
  const minimizeBtn = document.getElementById('minimize-btn');
  const maximizeBtn = document.getElementById('maximize-btn');
  const closeBtn = document.getElementById('close-btn');

  if (minimizeBtn) {
    minimizeBtn.addEventListener('click', () => {
      window.tabBarAPI.minimizeWindow();
    });
  }

  if (maximizeBtn) {
    maximizeBtn.addEventListener('click', () => {
      window.tabBarAPI.maximizeWindow();
    });
  }

  if (closeBtn) {
    closeBtn.addEventListener('click', () => {
      window.tabBarAPI.closeWindow();
    });
  }

  // Logo menu - show native popup menu
  const appLogo = document.getElementById('app-logo');

  if (appLogo) {
    appLogo.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      window.tabBarAPI.showLogoMenu();
    });
  }

  updateNavigationButtons();
}

// Update disabled state on navigation buttons
function updateNavigationButtons() {
  const backBtn = document.getElementById('back-btn');
  const forwardBtn = document.getElementById('forward-btn');
  if (backBtn) {
    backBtn.disabled = !canGoBack;
  }
  if (forwardBtn) {
    forwardBtn.disabled = !canGoForward;
  }
}

// Utility function to truncate long titles
function truncateTitle(title, maxLength) {
  if (title.length <= maxLength) return title;
  return title.substring(0, maxLength - 3) + '...';
}

// Detect and apply theme
function detectTheme() {
  // Check system dark mode preference
  const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;

  // Apply theme
  applyTheme(prefersDark);

  // Listen for system theme changes
  if (window.matchMedia) {
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
      applyTheme(e.matches);
    });
  }
}

function applyTheme(isDark) {
  if (isDark) {
    document.body.classList.add('dark-mode');
  } else {
    document.body.classList.remove('dark-mode');
  }
}

function applyLotionTheme(themeName) {
  // Remove all theme classes
  document.body.classList.remove(
    'dark-mode',
    'theme-dracula', 'theme-nord', 'theme-gruvbox-dark',
    'theme-monokai', 'theme-noir', 'theme-sakura',
    'theme-catppuccin-mocha', 'theme-catppuccin-macchiato',
    'theme-catppuccin-frappe', 'theme-catppuccin-latte',
  );

  // Apply new theme class (default theme has no class)
  if (themeName && themeName !== 'default' && themeName !== 'none') {
    document.body.classList.add(`theme-${themeName}`);
  } else {
    // If theme is default, apply system theme
    const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    applyTheme(prefersDark);
  }
}

async function loadInitialTheme() {
  try {
    if (window.tabBarAPI.getTheme) {
      const theme = await window.tabBarAPI.getTheme();
      console.log('Initial theme loaded:', theme);
      applyLotionTheme(theme);
    }
  } catch (error) {
    console.error('Failed to load initial theme:', error);
  }
}
