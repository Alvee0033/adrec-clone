import '../styles/style.css'

// ===========================
// PRELOADER DISMISS
// ===========================
document.addEventListener('DOMContentLoaded', () => {
  const preloader = document.getElementById('pagePreloader');
  if (preloader) {
    setTimeout(() => {
      preloader.style.opacity = '0';
      preloader.style.visibility = 'hidden';
      setTimeout(() => {
        preloader.remove();
      }, 400);
    }, 100);
  }
});

// ===========================
// SERVICE TABS
// ===========================
function initServiceTabs() {
  const tabs = document.querySelectorAll('.service-tab')
  const grids = document.querySelectorAll('.services-grid-panel')

  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const target = tab.dataset.tab
      tabs.forEach(t => {
        t.classList.remove('active')
        t.setAttribute('aria-selected', 'false')
      })
      grids.forEach(g => {
        g.classList.remove('active')
        g.hidden = true
      })
      tab.classList.add('active')
      tab.setAttribute('aria-selected', 'true')
      const panel = document.getElementById(`services-${target}`)
      if (panel) {
        panel.classList.add('active')
        panel.hidden = false
      }
    })
  })

  // Show consumer panel on load
  const consumerPanel = document.getElementById('services-consumer')
  if (consumerPanel) consumerPanel.hidden = false
}

// ===========================
// EXPERIENCE TABS
// ===========================
function initExperienceTabs() {
  const tabs = document.querySelectorAll('.exp-tab')
  const panels = document.querySelectorAll('.experience-content')

  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const target = tab.dataset.exp
      tabs.forEach(t => t.classList.remove('active'))
      panels.forEach(p => p.classList.remove('active'))
      tab.classList.add('active')
      const panel = document.getElementById(`exp-${target}`)
      if (panel) panel.classList.add('active')
    })
  })
}

// ===========================
// SEARCH MODAL
// ===========================
function initSearch() {
  const searchBtn = document.getElementById('searchBtn')
  const searchOverlay = document.getElementById('searchOverlay')
  const searchClose = document.getElementById('searchClose')
  const searchInput = document.getElementById('searchInput')

  if (!searchBtn || !searchOverlay) return

  searchBtn.addEventListener('click', () => {
    searchOverlay.classList.add('open')
    setTimeout(() => searchInput && searchInput.focus(), 100)
  })

  const closeSearch = () => searchOverlay.classList.remove('open')

  searchClose && searchClose.addEventListener('click', closeSearch)
  searchOverlay.addEventListener('click', (e) => {
    if (e.target === searchOverlay) closeSearch()
  })

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeSearch()
  })
}

// ===========================
// CHATBOT WIDGET
// ===========================
function initChatbot() {
  const btn = document.getElementById('chatbotBtn')
  const modal = document.getElementById('chatbotModal')
  const closeBtn = document.getElementById('chatbotCloseBtn')
  const maximizeBtn = modal?.querySelector('[aria-label="Maximize chatbot"]')
  if (!btn || !modal) return

  const setMaximized = (on) => {
    modal.classList.toggle('maximized', on)
    if (maximizeBtn) {
      maximizeBtn.setAttribute('aria-label', on ? 'Restore chatbot' : 'Maximize chatbot')
      maximizeBtn.setAttribute('title', on ? 'Restore' : 'Maximize')
    }
  }

  btn.addEventListener('click', () => {
    modal.classList.toggle('open')
    if (!modal.classList.contains('open')) setMaximized(false)
  })

  closeBtn && closeBtn.addEventListener('click', () => {
    modal.classList.remove('open')
    setMaximized(false)
  })

  maximizeBtn && maximizeBtn.addEventListener('click', (e) => {
    e.stopPropagation()
    if (!modal.classList.contains('open')) modal.classList.add('open')
    setMaximized(!modal.classList.contains('maximized'))
  })

  document.addEventListener('click', (e) => {
    if (!btn.contains(e.target) && !modal.contains(e.target)) {
      modal.classList.remove('open')
      setMaximized(false)
    }
  })

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && modal.classList.contains('open')) {
      if (modal.classList.contains('maximized')) {
        setMaximized(false)
      } else {
        modal.classList.remove('open')
      }
    }
  })
}

// ===========================
// DARK MODE TOGGLE
// ===========================
function initDarkMode() {
  const btn = document.getElementById('darkModeBtn')
  if (!btn) return

  // Restore preference
  if (localStorage.getItem('darkMode') === 'true') {
    document.body.classList.add('dark-mode')
    btn.classList.add('active-icon')
  }

  btn.addEventListener('click', () => {
    document.body.classList.toggle('dark-mode')
    const isDark = document.body.classList.contains('dark-mode')
    localStorage.setItem('darkMode', isDark)
    btn.classList.toggle('active-icon', isDark)
  })
}

// ===========================
// FONT SIZE TOGGLE
// ===========================
function initFontSize() {
  const btn = document.getElementById('fontSizeBtn')
  if (!btn) return

  const sizes = ['', 'fs-large', 'fs-small']
  let idx = 0

  btn.addEventListener('click', () => {
    document.body.classList.remove(sizes[idx])
    idx = (idx + 1) % sizes.length
    if (sizes[idx]) document.body.classList.add(sizes[idx])
  })
}

// ===========================
// STICKY HEADER SHADOW
// ===========================
function initStickyHeader() {
  const header = document.querySelector('.site-header')
  if (!header) return

  // Set initial box shadow to none
  header.style.boxShadow = 'none'

  window.addEventListener('scroll', () => {
    if (window.scrollY > 10) {
      header.style.boxShadow = '0 2px 12px rgba(0,0,0,0.08)'
    } else {
      header.style.boxShadow = 'none'
    }
  })
}

// ===========================
// SKELETON LOADER
// ===========================
function initSkeletonLoader() {
  const targets = document.querySelectorAll(
    '.hero-content h1, .hero-content p, .hero-image, .service-card, .branch-card-main, .branch-card-side, .trustee-panel-content, .stat-card, .news-card'
  );
  
  targets.forEach(el => el.classList.add('skeleton'));

  setTimeout(() => {
    targets.forEach(el => {
      el.classList.remove('skeleton');
      el.style.opacity = '0';
      el.style.transition = 'opacity 0.4s ease';
      setTimeout(() => {
        el.style.opacity = '1';
      }, 30);
    });
  }, 750);
}

// ===========================
// ANIMATE ON SCROLL
// ===========================
function initScrollAnimations() {
  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.style.opacity = '1';
        entry.target.style.transform = 'translateY(0)';
        observer.unobserve(entry.target);
      }
    });
  }, { threshold: 0.05 });

  const items = document.querySelectorAll('.stat-card, .service-card, .branch-card-main, .branch-card-side, .trustee-panel-content, .news-card');
  items.forEach((el, idx) => {
    el.style.opacity = '0';
    el.style.transform = 'translateY(24px)';
    el.style.transition = 'opacity 0.6s cubic-bezier(0.16, 1, 0.3, 1), transform 0.6s cubic-bezier(0.16, 1, 0.3, 1)';
    el.style.transitionDelay = `${(idx % 3) * 0.08}s`;
    observer.observe(el);
  });
}

// ===========================
// MOBILE DRAWER
// ===========================
function initMobileDrawer() {
  const menuBtn = document.getElementById('menuBtn');
  const drawer = document.getElementById('mobileDrawer');
  const closeBtn = document.getElementById('drawerCloseBtn');
  
  if (!menuBtn || !drawer) return;

  // Create overlay element dynamically
  const overlay = document.createElement('div');
  overlay.className = 'drawer-overlay';
  document.body.appendChild(overlay);

  const openDrawer = () => {
    drawer.classList.add('open');
    overlay.classList.add('open');
    document.body.style.overflow = 'hidden';
  };

  const closeDrawer = () => {
    drawer.classList.remove('open');
    overlay.classList.remove('open');
    document.body.style.overflow = '';
  };

  menuBtn.addEventListener('click', openDrawer);
  closeBtn && closeBtn.addEventListener('click', closeDrawer);
  overlay.addEventListener('click', closeDrawer);

  // Sync dark mode toggle inside drawer
  const drawerDarkCheckbox = document.getElementById('drawerDarkModeCheckbox');
  if (drawerDarkCheckbox) {
    drawerDarkCheckbox.checked = document.body.classList.contains('dark-mode');

    drawerDarkCheckbox.addEventListener('change', () => {
      const isDark = drawerDarkCheckbox.checked;
      if (isDark) {
        document.body.classList.add('dark-mode');
      } else {
        document.body.classList.remove('dark-mode');
      }
      localStorage.setItem('darkMode', isDark);
      
      const desktopBtn = document.getElementById('darkModeBtn');
      if (desktopBtn) {
        desktopBtn.classList.toggle('active-icon', isDark);
      }
    });

    const desktopBtn = document.getElementById('darkModeBtn');
    if (desktopBtn) {
      desktopBtn.addEventListener('click', () => {
        drawerDarkCheckbox.checked = document.body.classList.contains('dark-mode');
      });
    }
  }

  // Font Size action in drawer
  const drawerFontBtn = document.getElementById('drawerFontSizeBtn');
  if (drawerFontBtn) {
    const desktopFontBtn = document.getElementById('fontSizeBtn');
    drawerFontBtn.addEventListener('click', () => {
      if (desktopFontBtn) {
        desktopFontBtn.click();
      }
    });
  }
}

// ===========================
// INIT ALL
// ===========================
document.addEventListener('DOMContentLoaded', () => {
  initSkeletonLoader()
  initServiceTabs()
  initExperienceTabs()
  initSearch()
  initChatbot()
  initDarkMode()
  initFontSize()
  initStickyHeader()
  initMobileDrawer()

  // Small delay for scroll animations so DOM is ready
  setTimeout(initScrollAnimations, 100)
})
