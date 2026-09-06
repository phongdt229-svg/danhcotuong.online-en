// i18n.js - Multi-language support (EN/VI)
const i18n = {
  currentLang: 'en',
  translations: {},

  async init() {
    // Load translation file
    const response = await fetch('js/translations.json');
    this.translations = await response.json();

    // Always default to English
    this.currentLang = 'en';
    localStorage.removeItem('lang');
    this.apply();
  },

  t(key) {
    const keys = key.split('.');
    let value = this.translations[this.currentLang];

    for (const k of keys) {
      value = value?.[k];
    }

    return value || key; // Fallback to key if not found
  },

  setLang(lang) {
    if (['en', 'vi'].includes(lang)) {
      this.currentLang = lang;
      localStorage.setItem('lang', lang);
      this.apply();
    }
  },

  apply() {
    // Update all elements with data-i18n attribute
    document.querySelectorAll('[data-i18n]').forEach(el => {
      const key = el.dataset.i18n;
      const text = this.t(key);

      if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'BUTTON') {
        el.placeholder = text;
      } else {
        el.textContent = text;
      }
    });

    // Update elements with data-i18n-attr attribute (for attributes like title, alt, etc)
    document.querySelectorAll('[data-i18n-attr]').forEach(el => {
      const attrMap = JSON.parse(el.dataset.i18nAttr);
      for (const [attr, key] of Object.entries(attrMap)) {
        el.setAttribute(attr, this.t(key));
      }
    });

    // Update document title
    const titleKey = document.documentElement.dataset.i18nTitle;
    if (titleKey) {
      document.title = this.t(titleKey);
    }

    // Dispatch event so other components know language changed
    window.dispatchEvent(new Event('languageChanged'));
  },

  getLang() {
    return this.currentLang;
  }
};

// Auto-initialize when page loads
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => i18n.init());
} else {
  i18n.init();
}
