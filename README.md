# Folder Flow

Read a folder like a book: flip to the next note without going back to the file explorer, and come back to where you stopped reading.

Built for mobile first, but works on desktop.

## What it does

- **Bottom bar**: `‹ Note name 3/12 ›` above the bottom edge. Tap the arrows or swipe the bar to move through the folder.
- **Folder sheet**: tap the note name to open a bottom sheet with every note in the current folder, the current one highlighted and scrolled into view. Optional subfolder notes and a filter box.
- **Scroll memory**: every note remembers its own scroll position, so going back to the previous note puts you where you left off.
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