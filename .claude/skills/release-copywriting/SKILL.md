---
name: release-copywriting
description: Writes user-facing "what's new" prose for Kan-Do - release highlights in release-notes/<version>.md, the update toast, announcements and changelog text aimed at users rather than developers. Use when drafting or editing Highlights, or when a design or build task needs to explain a change to users. Not for UI strings (use copy-writer).
---

# Release copywriting

Highlights tell a user why the app got better, not what the diff did. Derived from the user's own edits of the
v0.10.0 notes (the user's wording is the reference; when they edit a draft again, update this file).
Format rules (bullet count, bold title, full stop) are in `release-notes/README.md`; UI strings follow `copy-writer`.

## Rules

1. **The title names the gain, not the removal.** "Einfachere Prioritätensetzung", not "Priorität ohne „Keine“".
   Never describe the old state or what was taken away.
2. **Give the reason in product terms.** Say what the app deliberately does and why that helps the reader
   ("kan-do beschränkt sich bewusst auf genau drei Prioritäten … So nützt es dir, ohne dich im Prio-Management zu verlieren").
   Skip mechanics: defaults, fallbacks, migrations.
3. **One outcome per bullet, in the user's words.** Use the names users know ("Seitenlayout", not "header" or "axis").
   Leave out where else a function now lives and any implementation detail; a short bullet beats a complete one.
4. **Address.** German speaks the user as "du" (see `DESIGN.md` "Voice and copy"); no "wir". German first, then English
   with the same meaning and bullet count.

## Before and after

| Draft | Final |
|---|---|
| **Priorität ohne „Keine“.** Es gibt nur noch Niedrig, Normal und Hoch: Eine neue Aufgabe startet bei Normal … | **Einfachere Prioritätensetzung.** kan-do beschränkt sich bewusst auf genau drei Prioritäten … |
| **Weniger Kopfzeilen.** Einstellungen und Papierkorb sitzen mittig unter der Leiste …, und Statistik verzichtet … | **Aufgeräumteres Seitenlayout.** Für Einstellungen und Papierkorb. |
| **Ein kleiner Moment für jedes Erledigt.** … | **Ein kurzer Moment der Freude für jede erledigte Aufgabe.** … (natural German over a clever play on a column name) |
| **Flüssigerer Rückblick.** Im Kurzen Rückblick wandert eine weggewischte Karte sichtbar ans Ende des Stapels … | **Verbesserte Animation.** Beim Swipen durch die Aufgabenstapel im Tagesrückblick. |

Fixes (`## Fixes`) are developer-facing, never shown in the app, and are not covered by these rules.
