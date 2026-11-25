# 0.4.0

- All four swipe directions on the bar and on the collapsed dot can be bound to any command, including commands registered by other plugins. Configure them in settings under "手势".
- Defaults: left = previous note, right = next note, down = collapse the bar, up = none.
- The down-swipe no longer hard-codes collapsing: it runs whatever command is bound to it (the `▾` button always collapses).
- Adds the `收起阅读薄条` command, so the down-swipe default (and any other entry point) can collapse the bar.
- Swipe detection is shared between the bar and the dot and now respects a proper axis rule for diagonal swipes.

# 0.3.0

- The bar can be collapsed into a small dot at the bottom right. Tap the dot to expand it again, swipe the dot left or right to change note, long press it to open the folder sheet. Swiping down on the bar, or the new `▾` button, collapses it.
- The collapsed dot shows the current position number, and greys out when the note is marked read.
- New command "展开 / 收起阅读薄条" so the state can be toggled from a hotkey or the mobile toolbar.
- The collapsed state is remembered between sessions.

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