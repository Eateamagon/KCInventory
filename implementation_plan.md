# Implementation Plan - Codebase Refactoring

## Problem
The `Index.html` file was becoming too large and contained a mix of HTML, CSS, and JavaScript. The `Code.gs` file used hardcoded strings for sheet names, making it fragile.

## Proposed Changes

### 1. Extract CSS
- Create `Styles.html`
- Move all CSS and Tailwind configuration from `Index.html` to `Styles.html`.

### 2. Extract JavaScript
- Create `JavaScript.html`
- Move all client-side JavaScript from `Index.html` to `JavaScript.html`.

### 3. Update Index.html
- Use Google Apps Script templating `<?!= include('Styles'); ?>` to include the styles.
- Use `<?!= include('JavaScript'); ?>` to include the scripts.

### 4. Refactor Code.gs
- Add constants for all sheet names (`Inventory`, `Replacement_Pool`, `Teachers`, `Audit_Log`).
- Update functions to use these constants.
- Ensure `include` function exists.

## Verification
- Verify `Index.html` renders correctly.
- Verify user interactions (modals, saving, etc.) still work.
- Verify server-side functions still access the correct sheets.
