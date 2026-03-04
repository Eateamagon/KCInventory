## 2025-05-15 - [Keyboard-Accessible Collapsible Panels]
**Learning:** In apps using custom collapsible elements (like the teacher cards and management panel here), they are often implemented with mouse-only `onclick` events. To make them accessible, they need `role="button"`, `tabindex="0"`, `aria-expanded` state management, and an explicit `onkeydown` handler for Enter/Space.
**Action:** Apply `role="button"`, `tabindex="0"`, `aria-expanded`, and keyboard handlers to all custom interactive containers that aren't native `<button>` or `<a>` tags.
