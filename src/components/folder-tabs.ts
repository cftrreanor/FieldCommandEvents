/**
 * The shared tabs pattern (views of one thing: sign-ups, stations, rooms, zones,
 * rounds). Folder-style: the open tab is raised, filled, and joined to the page
 * below; the others sit back. Filters and settings menus have their own looks.
 */

/** The row the tabs sit on (a `ul` or `div`, inside a sideways-scrolling wrapper). */
export const folderTabRow = "flex min-w-max items-end gap-1 border-b-2 border-field-border";

/** One tab (a link or a button): its name inherits this; a status line under it sets its own size and color. */
export function folderTab(active: boolean) {
  return `flex min-h-11 cursor-pointer flex-col items-start rounded-t-[10px] px-4 text-left text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand ${
    active
      ? // Dark mode: white on a stronger fill, so the open tab stands out instead of fading back.
        "-mb-0.5 border-2 border-b-[3px] border-field-border border-b-brand bg-brand-soft py-2.5 font-semibold text-brand dark:bg-[#1b3a57] dark:text-foreground"
      : "border-[1.5px] border-b-2 border-field-border bg-surface py-2 font-medium text-muted hover:bg-brand-soft/60 dark:bg-background"
  }`;
}

/** The line under a tab's name: amber with a diamond when something there needs doing. */
export function folderTabNote(needs = false) {
  return `text-xs ${needs ? "font-medium text-warning" : "font-normal text-muted"}`;
}
