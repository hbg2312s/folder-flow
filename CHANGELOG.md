# 0.2.0

- **Resume**: remembers the last note you read and its scroll offset; on startup, if the workspace is empty, it reopens that note and restores the position. New command "回到上次阅读的位置".
- **Row menu in the folder sheet** (tap and hold on mobile, right click on desktop): open in new tab, open to the right (desktop), mark read/unread, add to or remove from the reading queue, copy path, copy link, rename, delete, create a new note in this folder.
- **Read state**: manual mark read/unread per note, optional automatic mark when you leave a note scrolled to the bottom, an unread count in the sheet, an "only unread" filter, and commands "下一篇未读 / 上一篇未读".
- **Reading queue**: pin notes from any folder into an ordered queue, switch the bar between folder order and queue order ("书单" badge), commands to add, remove, clear and toggle the queue. Missing notes are dropped from the queue automatically.

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