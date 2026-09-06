// language-switcher.js - UI for switching languages
class LanguageSwitcher {
  constructor() {
    this.element = null;
  }

  createSwitcher() {
    const container = document.createElement('div');
    container.className = 'language-switcher';
    container.innerHTML = `
      <button class="lang-btn lang-en ${i18n.getLang() === 'en' ? 'active' : ''}"
              title="English"
              aria-label="Switch to English">
        EN
      </button>
      <button class="lang-btn lang-vi ${i18n.getLang() === 'vi' ? 'active' : ''}"
              title="Tiếng Việt"
              aria-label="Chuyển sang tiếng Việt">
        VI
      </button>
    `;

    // Add event listeners
    container.querySelector('.lang-en').addEventListener('click', () => {
      i18n.setLang('en');
      this.updateButtons();
    });

    container.querySelector('.lang-vi').addEventListener('click', () => {
      i18n.setLang('vi');
      this.updateButtons();
    });

    this.element = container;
    return container;
  }

  updateButtons() {
    if (!this.element) return;

    this.element.querySelectorAll('.lang-btn').forEach(btn => {
      btn.classList.remove('active');
    });

    const current = i18n.getLang();
    this.element.querySelector(`.lang-${current}`).classList.add('active');
  }

  insertIntoNavbar() {
    // Try to insert after nav-actions or at the end of navbar
    const navActions = document.querySelector('.nav-actions');
    if (navActions) {
      navActions.parentElement.insertBefore(this.createSwitcher(), navActions);
    } else {
      const navbar = document.querySelector('.navbar');
      if (navbar) {
        navbar.appendChild(this.createSwitcher());
      }
    }
  }
}

// Auto-initialize when i18n is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    const switcher = new LanguageSwitcher();
    switcher.insertIntoNavbar();
  });
} else {
  const switcher = new LanguageSwitcher();
  switcher.insertIntoNavbar();
}

// Listen to language changes to update buttons
window.addEventListener('languageChanged', () => {
  const switcher = new LanguageSwitcher();
  switcher.updateButtons();
});
