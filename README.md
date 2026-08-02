<p align="center">
  <img src="pics/Notifier-Logo.png" alt="Notifier Logo" width="200">
</p>

<h1 align="center">Notifier</h1>

<p align="center">
  <strong>In-app notification bell, right inside GLPI.</strong>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/GLPI-10.0%20%7C%2011.0-blue" alt="GLPI 10/11">
  <img src="https://img.shields.io/badge/PHP-8.1+-purple" alt="PHP 8.1+">
  <img src="https://img.shields.io/badge/License-GPLv3-green" alt="GPLv3">
</p>

---

A bell floats in the bottom-right of every GLPI page. Everything that happens on an item you are involved in lands there, grouped per ticket, one click away from the item itself.

## Features

- **Personal task list** — a checklist tab for the things that are not tickets: "call Henk at 15:00". Optional reminder time, overdue tasks go red and count into the badge, and a desktop alert fires the minute one comes due
- **Full ITIL coverage** — Ticket, Change, Problem and Project task: created, assigned, commented, task added, status changed, updated, solution proposed, approval requested and answered. Group assignments and group validators fan out to every member
- **@-mentions** — naming someone in a followup, task, solution or description notifies them even when they are not an actor on the item. Understands GLPI's native rich-text mentions and plain `@login`
- **Deadline warnings** — a cron task warns assignees before `time to resolve` lands, and again once it is breached
- **Quick actions** — assign the item to yourself, change its status or post a short reply without leaving the page
- **Snooze** — hide a notification for an hour, three hours, or until tomorrow morning
- **Desktop notifications and sound** — opt-in per user, one popup per batch
- **Grouped per item** — one row per ticket showing its latest event, actors summarised as "Jane and 2 others", expandable to the full history
- **Search, paging, unread count in the tab title**
- **Per-user preferences** — per item type, per channel (assigned to me / to my group) and per event type
- **Admin settings** under Setup > Plugins — polling interval, page size, retention, deadline lead time, feature toggles, per-event kill switches, self-service on or off
- **Entity aware** — a bell never outlives the access that produced it
- **Efficient** — hidden tabs stop polling, unchanged responses return `304`, idle sessions back off
- **Accessible** — keyboard navigation, focus trapping, `prefers-reduced-motion`
- **English, Dutch, French, Spanish**

## Requirements

GLPI 10.0+ / 11.0+, PHP 8.1+.

## Installation

1. Download the latest release
2. Extract and rename the folder to `notifier`
3. Place it in your GLPI `plugins/` directory
4. **Setup > Plugins** → Install, then Enable

Every logged-in user gets a bell straight away, in both the central and the self-service interface. There are no rights to configure.

**Upgrading:** copy the new files over the existing folder and re-run Install from **Setup > Plugins**. That runs the migration and registers the cron tasks.

### Cron tasks

| Task | Default | Does |
|------|---------|------|
| `NotifierCleanup` | daily | Purges read notifications past the retention window, unread ones at three times that age |
| `NotifierDeadline` | every 15 min | Warns assignees before and after `time to resolve` |

Without GLPI cron the bell still works; you only lose the purge and the deadline warnings.

## Usage

| Event | Fires when |
|-------|-----------|
| **Assigned** | You, or a group you are in, is added as assignee |
| **Created** | An item is created and you are one of its actors |
| **Commented** | A followup is posted on an item where you are actor |
| **New task** | A task is added, or you are its assigned technician |
| **Status changed** | The status of an item you are linked to changes |
| **Updated** | Name, content, priority or urgency changes |
| **Solution** | A solution is proposed on your item |
| **Approval requested** | You are added as an approver |
| **Approval status changed** | Your approver accepts or refuses |
| **Mention** | Someone names you in a followup, task, solution or description |
| **Deadline** | An item assigned to you is nearing or past its resolution deadline |

You never get a bell for your own actions.

Click a row to jump to the item and mark its events read. The chevron expands the history and the quick actions, the clock snoozes, the cog opens preferences. Arrow keys move between rows, Enter opens, Escape closes.

### Preferences

Three sections: **which items** (per type, per channel), **which events**, and **how to be alerted** (desktop, sound). Everything defaults to on except desktop and sound. Mentions and deadline warnings ignore the item/channel matrix — both are explicitly about you — but honour their own event switch.

## Security notes

- Every mutating endpoint requires a per-session secret in an `X-Notifier-Token` header. No form, image or prefetch can set a custom header, and cross-origin fetch needs a preflight that is never answered. Requests are also rejected on a cross-origin `Sec-Fetch-Site`.
- Quick actions never trust the notification row: the item is re-loaded and put through GLPI's own `can(..., UPDATE)`. Solved and closed are not offered, because those need a real solution.
- Quick-reply text has its markup stripped and is encoded exactly once, using GLPI 10's sanitizer where it exists.
- Parameters bound for SQL are passed through untouched — un-escaping them would strip the only SQL defence GLPI 10 applies to superglobals.
- The bell refuses to navigate to any URL that is not same-origin.
- Notifications are filtered by the viewer's active entities on read.

## Development

```bash
php tests/run.php              # unit tests, no dependencies
bash tools/sync-assets.sh      # regenerate public/ from css/ and js/
bash tools/check-version.sh    # setup.php / notifier.xml / CHANGELOG.md agree
```

`css/` and `js/` are the sources; `public/` is generated for GLPI 11 and CI fails on drift — that mistake shipped twice before it was automated away.

## Layout

```
src/       Notification (store, dispatch, cron) · Note · Config · Endpoint · Mention · QuickAction · Text
ajax/      boot · list · markread · markunread · markallread · snooze · action · notes · preferences
front/     config.form.php
css/ js/   sources          public/  generated for GLPI 11
tests/     dependency-free suite     tools/  asset sync, version check
```

## License

GPLv3 — see [LICENSE](LICENSE). Copyright &copy; 2026 DVBNL
