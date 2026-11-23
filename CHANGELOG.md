# 0.1.1

- The bottom bar no longer disappears in editing mode on mobile. It is now hidden only while the on-screen keyboard is open, so it stays available when the keyboard is closed and still keeps the mobile toolbar clear.
- Migrates the old `hideWhenEditing` setting to `hideWhenKeyboard`.
- Adds tests for the keyboard detection ratio.

# 0.1.0

- Bottom bar with previous/next, position label (`3/12`), tap-to-open folder sheet.
- Folder sheet listing the current folder's notes, optional subfolders, filter box.
- Per-note scroll position memory, restored when returning to a note.
- Boundary notice instead of reopening the current note.
- Sort order follows the file explorer with a configurable fallback.
- Commands for next, previous, first, last and open sheet.
- Settings: bar visibility per platform, hide while editing, subfolders, loop, scroll memory, fallback order.