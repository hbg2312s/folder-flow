# Folder Flow

Read a folder like a book: flip to the next note without going back to the file explorer, and come back to where you stopped reading.

Built for mobile first, but works on desktop.

## What it does

- **Bottom bar**: `‹ Note name 3/12 ›` above the bottom edge. Tap the arrows or swipe the bar to move through the folder.
- **Collapse**: swipe down on the bar (or tap `▾`) and it becomes a small dot at the bottom right. Tap the dot to expand, swipe it left or right to change note, long press it to open the sheet. The dot shows the position number.
- **Folder sheet**: tap the note name to open a bottom sheet with every note in the current folder, the current one highlighted and scrolled into view. Optional subfolder notes, an unread-only filter and a filter box.
- **Row menu**: tap and hold a row (right click on desktop) to open it in a new tab, mark it read, add it to the reading queue, copy its path or link, rename it, delete it, or create a new note in that folder.
- **Scroll memory**: every note remembers its own scroll position, so going back to the previous note puts you where you left off.
- **Resume**: the last note you read is remembered; on startup with an empty workspace it is reopened at the saved position.
- **Read state**: mark notes read or unread manually, optionally mark them automatically when you leave them scrolled to the bottom, see how many are left unread and jump to the next unread note.
- **Reading queue**: pin notes from different folders into one ordered queue, then flip through the queue instead of the folder ("书单" badge on the bar).
- **Safe boundaries**: at the first or last note you get a notice instead of silently reopening the current note (which would jump you back to the top).
- **Sorting fallback**: order follows the file explorer. When its sort order cannot be read (common on mobile), the configured fallback is used instead of an undefined comparator.

## Commands

| Command | Description |
| --- | --- |
| Folder Flow: Next note | Next note in the same folder |
| Folder Flow: Previous note | Previous note in the same folder |
| Folder Flow: First note in folder | Jump to the first note |
| Folder Flow: Last note in folder | Jump to the last note |
| Folder Flow: Open folder sheet | Open the folder sheet |
| Folder Flow: Resume last position | Reopen the last note you read |
| Folder Flow: Next unread / Previous unread | Jump to the next note without a read mark |
| Folder Flow: Toggle read | Mark the current note read or unread |
| Folder Flow: Add to queue / Remove from queue / Clear queue | Manage the reading queue |
| Folder Flow: Toggle queue mode | Flip the bar between folder order and queue order |

All commands can be assigned to hotkeys, and on mobile they can be placed on the toolbar.

## Settings

- Show bottom bar on desktop / on mobile.
- Hide the bar while the on-screen keyboard is open (keeps the mobile toolbar clear).
- Include notes from subfolders (current folder first, then subfolders by name).
- Loop inside the folder.
- Remember scroll position per note.
- Fallback sort order (alphabetical, by created/modified time, and their reverse).

## Order semantics

The sequence is the notes of the current folder, ordered like the file explorer
(`alphabetical`, `byCreatedTime`, `byModifiedTime` and their reverse variants).
With subfolders enabled, the folder's own notes come first, then each subfolder
by name, depth first.

## Mobile

The plugin is not desktop-only. On iOS and Android the bottom bar is the main
control, because the mobile toolbar only appears while editing.

Installing a custom build on iOS: the Files app cannot see dot-folders, so use a
file manager that can (for example Taio or a-shell), or install through BRAT.

## Credits

Navigation and sorting semantics are inspired by
[Neighbouring Files](https://github.com/FabianUntermoser/obsidian-neighbouring-files-plugin)
by Fabian Untermoser (MIT). This plugin reimplements them as pure functions and
adds the bottom bar, the folder sheet and scroll memory.

## License

MIT