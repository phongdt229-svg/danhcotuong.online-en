# Multi-Language Support (i18n) Guide

This document explains how to add and manage multi-language support in Chinesechess Online.

## Overview

The application supports **English (EN)** and **Vietnamese (VI)**, with **English** as the default language.

- **i18n.js** — Core translation system
- **translations.json** — All text strings in EN and VI
- **language-switcher.js** — UI component for language switching
- Language preference is saved in `localStorage`

## How to Add Multi-Language Text

### Method 1: HTML Elements (Most Common)

Add the `data-i18n` attribute to any HTML element. The system will replace its text content with the translation.

```html
<!-- HTML with i18n -->
<button data-i18n="nav.signIn">Sign in</button>

<!-- Result (when language = 'en') -->
<button data-i18n="nav.signIn">Sign in</button>

<!-- Result (when language = 'vi') -->
<button data-i18n="nav.signIn">Đăng nhập</button>
```

### Method 2: Form Inputs & Placeholders

For form inputs, the translation becomes the `placeholder`:

```html
<input type="email" data-i18n="auth.email" placeholder="Email">
<!-- Becomes placeholder based on language -->
```

### Method 3: Element Attributes (title, alt, aria-label)

Use `data-i18n-attr` with a JSON map:

```html
<button data-i18n-attr='{"title":"nav.home","aria-label":"nav.home"}'>
  Home
</button>
```

### Method 4: JavaScript

Access translations directly in JavaScript:

```javascript
const text = i18n.t('nav.signIn');  // Gets translated text
console.log(i18n.getLang());         // Current language: 'en' or 'vi'
i18n.setLang('vi');                  // Switch to Vietnamese
```

## Translation Keys Structure

Keys use dot notation: `section.key`

**Example:**
```
nav.home        → Navigation > Home
auth.email      → Authentication > Email
points.balance  → Points > Balance
```

## Adding New Translations

### 1. Add to `translations.json`

```json
{
  "en": {
    "mySection": {
      "myKey": "English text"
    }
  },
  "vi": {
    "mySection": {
      "myKey": "Text tiếng Việt"
    }
  }
}
```

### 2. Use in HTML

```html
<p data-i18n="mySection.myKey">English text</p>
```

### 3. Result

The text automatically changes based on selected language.

## Language Switcher

The language switcher appears automatically in the navbar:

```
[EN] [VI]
```

- Click to switch languages
- Selection is saved to `localStorage` with key `lang`
- Page content updates immediately
- Fires `languageChanged` event for other components

## Complete Example: New HTML Page

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <title>My Page</title>
  <link rel="stylesheet" href="css/style.css?v=14" />
</head>
<body>
  <header class="navbar">
    <div class="nav-inner container">
      <h1 data-i18n="mySection.pageTitle">My Page Title</h1>
      <!-- Language switcher auto-inserted here -->
    </div>
  </header>

  <main>
    <h2 data-i18n="mySection.heading">Section Heading</h2>
    <p data-i18n="mySection.description">Description text...</p>
    <button data-i18n="common.submit">Submit</button>
  </main>

  <!-- Scripts: i18n must load FIRST -->
  <script src="js/i18n.js?v=14"></script>
  <script src="js/language-switcher.js?v=14"></script>
  <!-- Your other scripts after -->
  <script src="js/your-script.js?v=14"></script>
</body>
</html>
```

## Script Loading Order

**Important:** Load scripts in this order:

```html
<!-- 1. Core i18n system (must be first) -->
<script src="js/i18n.js?v=14"></script>

<!-- 2. Language switcher UI -->
<script src="js/language-switcher.js?v=14"></script>

<!-- 3. Your custom scripts (if needed) -->
<script src="js/your-script.js?v=14"></script>
```

## API Reference

### i18n Object

```javascript
// Get translated text
i18n.t(key)              // Returns translated string

// Language management
i18n.getLang()           // Returns 'en' or 'vi'
i18n.setLang(lang)       // Set language ('en' or 'vi')

// Internal
i18n.currentLang         // Current language
i18n.translations        // All translation data
i18n.apply()             // Re-apply all translations
```

### Events

```javascript
// Listen for language changes
window.addEventListener('languageChanged', () => {
  console.log('Language changed to:', i18n.getLang());
});
```

## Local Storage

Language preference is stored:
- **Key:** `lang`
- **Values:** `'en'` or `'vi'`
- **Default:** `'en'` (if not set)

```javascript
// Check saved language
localStorage.getItem('lang');  // 'en', 'vi', or null

// Clear saved language (resets to default)
localStorage.removeItem('lang');
```

## Common Issues & Solutions

### Translation not updating?
✓ Make sure `data-i18n` attribute matches exactly with `translations.json` key
✓ Check browser console for errors
✓ Reload page after adding new translations

### Language switcher not showing?
✓ Verify `language-switcher.js` is loaded after `i18n.js`
✓ Check that navbar has `.navbar` class
✓ Check browser console for JavaScript errors

### Text shows as key instead of translation?
✓ Key doesn't exist in `translations.json`
✓ Check spelling of the key
✓ Add missing translations to both 'en' and 'vi'

## Translation Checklist for New Pages

- [ ] Add `data-i18n` to all text elements
- [ ] Add translations to `translations.json` (both EN and VI)
- [ ] Load `i18n.js` before `language-switcher.js`
- [ ] Test switching between EN and VI
- [ ] Check `localStorage` for saved language
- [ ] Verify language persists on page reload

## Performance Notes

- Translations are loaded once on page load
- DOM updates are batched (efficient)
- No external API calls
- JSON file is ~15KB gzipped

## Future Enhancements

Possible improvements:
- [ ] Add more languages (Chinese, French, etc.)
- [ ] Pluralization support
- [ ] Date/number formatting by locale
- [ ] RTL language support
- [ ] Lazy loading translations
- [ ] Translation management UI

## Support

For questions or issues:
1. Check this guide
2. Review `translations.json` structure
3. Check browser console for errors
4. Look at `i18n.js` implementation
