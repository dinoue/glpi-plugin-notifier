/**
 * Notifier plugin — bell widget. setup.php decides which interfaces load
 * this at all, so there is no runtime interface guard here.
 */
(function() {
    'use strict';

    var LS_COLLAPSED_KEY = 'notifier:collapsed';
    var LS_TAB_KEY       = 'notifier:tab';

    // Backoff ceiling for a session where nothing changes.
    var MAX_IDLE_FACTOR  = 8;
    var SEARCH_DEBOUNCE  = 300;

    // document.currentScript is null once we run from a DOMContentLoaded callback.
    var SELF_SRC = (function() {
        if (document.currentScript && document.currentScript.src) {
            return document.currentScript.src;
        }
        var tag = document.querySelector('script[src*="notifier.js"]');
        return tag ? tag.src : '';
    })();

    var BASE_URL     = null;
    var TOKEN        = null;
    var pollTimer    = null;
    var pollInFlight = false;
    var reloadQueued = false;
    var idleFactor   = 1;
    var feedEtag     = null;
    var feedKey      = '';
    var audioCtx     = null;
    var baseTitle    = null;
    var highWaterId  = null;
    // One failed poll is a hiccup, not an outage; only say so after two.
    var failedPolls  = 0;

    var PREF_TYPES = [
        { slug: 'ticket',      typeLabelKey: 'typeTicket',      direct: 'notify_ticket_direct',      group: 'notify_ticket_group' },
        { slug: 'change',      typeLabelKey: 'typeChange',      direct: 'notify_change_direct',      group: 'notify_change_group' },
        { slug: 'problem',     typeLabelKey: 'typeProblem',     direct: 'notify_problem_direct',     group: 'notify_problem_group' },
        { slug: 'projecttask', typeLabelKey: 'typeProjectTask', direct: 'notify_projecttask_direct', group: 'notify_projecttask_group' }
    ];

    // Hydrated by ajax/boot.php before first paint.
    var T = {
        notifications:       'Notifications',
        markAllRead:         'Mark all as read',
        markAsRead:          'Mark as read',
        markAsUnread:        'Mark as unread',
        noNotifications:     'No notifications',
        noNotificationsHint: "You're all caught up.",
        noResults:           'Nothing matches your search',
        noResultsHint:       'Try a different word, or clear the search box.',
        minimize:            'Minimize',
        expand:              'Expand notifications',
        tabAll:              'All',
        tabUnread:           'Unread',
        settings:            'Settings',
        preferencesTitle:    'Notification preferences',
        preferencesIntro:    'Choose which updates you want to receive.',
        colDirect:           'Assigned to me',
        colGroup:            'Assigned to my group',
        typeTicket:          'Tickets',
        typeChange:          'Changes',
        typeProblem:         'Problems',
        typeProjectTask:     'Project tasks',
        save:                'Save',
        cancel:              'Cancel',
        saved:               'Preferences saved',
        close:               'Close',
        groupedUpdates:      '{n} updates',
        expandGroup:         'Show all updates',
        collapseGroup:       'Hide updates',
        search:              'Search',
        searchPlaceholder:   'Search notifications',
        clearSearch:         'Clear search',
        loadMore:            'Load more',
        loading:             'Loading',
        refresh:             'Refresh',
        offline:             'Reconnecting',
        snooze:              'Snooze',
        snooze1h:            'For 1 hour',
        snooze3h:            'For 3 hours',
        snoozeTomorrow:      'Until tomorrow morning',
        snoozed:             'Snoozed',
        quickActions:        'Quick actions',
        actionTake:          'Assign to me',
        actionStatus:        'Change status',
        actionFollowup:      'Reply',
        followupPlaceholder: 'Write a short reply…',
        send:                'Send',
        actionDone:          'Done',
        actionFailed:        'That did not work',
        actionForbidden:     'You are not allowed to do that',
        sectionTypes:        'Which items',
        sectionEvents:       'Which events',
        sectionDelivery:     'How to be alerted',
        eventsIntro:         'Turn off the event types you never want to see in the bell.',
        desktopEnabled:      'Desktop notifications',
        desktopHint:         'Show a system notification when something new arrives.',
        soundEnabled:        'Play a sound',
        soundHint:           'A short chime when a new notification arrives.',
        permissionDenied:    'Your browser blocked notifications for this site.',
        newNotification:     'New notification',
        andOthers:           '{name} and {n} others',
        tabNotes:            'Reminders',
        notePlaceholder:     'What still needs doing?',
        noteNew:             'New task',
        noteWhen:            'Remind me at',
        noteIn1h:            'In 1 hour',
        noteTomorrow:        'Tomorrow 9:00',
        noteAdd:             'Add',
        noteEmpty:           'Nothing on your list',
        noteEmptyHint:       'Jot something down and it will find you here.',
        noteDone:            'Mark as done',
        noteUndo:            'Not done yet',
        noteDelete:          'Delete',
        noteOverdue:         'Due',
        noteReminder:        'Reminder'
    };

    var CFG = {
        poll_interval:         30,
        list_limit:            25,
        quick_actions_enabled: true,
        snooze_enabled:        true,
        statuses:              {}
    };

    var EVENTS = [];

    var state = {
        items:        [],
        unread:       0,
        unreadGroups: 0,
        total:        0,
        loaded:       0,
        tab:          loadTab(),
        search:       '',
        expanded:     new Set(),
        prefs:        {},
        notes:        [],
        notesDue:     0,
        loading:      false,
        offline:      false
    };

    // ------------------------------------------------------------------ utils

    // Our own <script src> is the only reliable anchor: GLPI serves the
    // plugin from plugins/ or marketplace/ depending on the install.
    function resolveBaseUrl() {
        var match = SELF_SRC.match(/^(.*?)\/(?:public|js)\/notifier\.js(?:[?#]|$)/);
        if (match) {
            return match[1];
        }

        var root = (window.CFG_GLPI && window.CFG_GLPI.root_doc) || '';
        return root + '/plugins/notifier';
    }

    function escapeHtml(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    function t(key, vars) {
        var value = T[key] != null ? String(T[key]) : key;
        if (vars) {
            Object.keys(vars).forEach(function(name) {
                value = value.split('{' + name + '}').join(String(vars[name]));
            });
        }
        return value;
    }

    function isSameOrigin(url) {
        try {
            return new URL(url, window.location.href).origin === window.location.origin;
        } catch (e) {
            return false;
        }
    }

    function timeAgo(epochSeconds) {
        if (!epochSeconds) return '';
        var diff = Math.max(0, (Date.now() / 1000) - epochSeconds);
        if (diff < 60)    return Math.floor(diff) + 's';
        if (diff < 3600)  return Math.floor(diff / 60) + 'm';
        if (diff < 86400) return Math.floor(diff / 3600) + 'h';
        if (diff < 2592000) return Math.floor(diff / 86400) + 'd';
        return Math.floor(diff / 2592000) + 'mo';
    }

    function initialsOf(name) {
        var parts = String(name || '').trim().split(/\s+/).filter(Boolean);
        if (!parts.length) return '';
        if (parts.length === 1) return parts[0].substring(0, 2).toUpperCase();
        return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    }

    // Stable per person, so a colleague keeps their colour everywhere.
    function hueOf(name) {
        var hash = 0;
        var str  = String(name || '');
        for (var i = 0; i < str.length; i++) {
            hash = (hash * 31 + str.charCodeAt(i)) % 360;
        }
        return hash;
    }

    function loadTab() {
        try {
            var stored = localStorage.getItem(LS_TAB_KEY);
            return (stored === 'all' || stored === 'notes') ? stored : 'unread';
        } catch (e) { return 'unread'; }
    }

    function saveTab(tab) {
        try { localStorage.setItem(LS_TAB_KEY, tab); } catch (e) { /* ignore */ }
    }

    function isStoredCollapsed() {
        try { return localStorage.getItem(LS_COLLAPSED_KEY) === '1'; } catch (e) { return false; }
    }

    function wrap() {
        return document.querySelector('.notifier-bell-wrap');
    }

    // ------------------------------------------------------------------ api

    function apiUrl(path, params) {
        var url = BASE_URL + '/ajax/' + path;
        if (params) {
            var qs = new URLSearchParams();
            Object.keys(params).forEach(function(k) {
                if (params[k] !== undefined && params[k] !== null && params[k] !== '') {
                    qs.append(k, params[k]);
                }
            });
            var query = qs.toString();
            if (query) url += '?' + query;
        }
        return url;
    }

    function request(path, params, extraHeaders) {
        var headers = { 'X-Requested-With': 'XMLHttpRequest' };
        if (TOKEN) headers['X-Notifier-Token'] = TOKEN;
        if (extraHeaders) {
            Object.keys(extraHeaders).forEach(function(k) { headers[k] = extraHeaders[k]; });
        }
        return fetch(apiUrl(path, params), {
            credentials: 'same-origin',
            headers: headers
        });
    }

    /** A rotated session invalidates the boot token; re-boot and replay. */
    function call(path, params) {
        return request(path, params).then(function(response) {
            if (response.status === 403) {
                return refreshToken().then(function() {
                    return request(path, params).then(readJson);
                });
            }
            return readJson(response);
        });
    }

    function readJson(response) {
        if (!response.ok) throw new Error('HTTP ' + response.status);
        return response.json();
    }

    function refreshToken() {
        return request('boot.php').then(readJson).then(function(data) {
            if (data && data.token) TOKEN = data.token;
        });
    }

    // ------------------------------------------------------------------ alerts

    function desktopAllowed() {
        return !!state.prefs.desktop_enabled
            && 'Notification' in window
            && window.Notification.permission === 'granted';
    }

    function showDesktop(items) {
        if (!desktopAllowed() || !items.length) return;

        // One popup per batch: a fan-out can produce a dozen rows at once.
        var primary = items[0];
        var body    = items.length > 1
            ? t('groupedUpdates', { n: items.length })
            : (primary.actor_name ? primary.actor_name + ' — ' + primary.message : primary.message);

        try {
            var note = new window.Notification(primary.title || t('newNotification'), {
                body: body,
                tag:  'notifier-bell',
                icon: (window.CFG_GLPI && window.CFG_GLPI.root_doc)
                    ? window.CFG_GLPI.root_doc + '/plugins/notifier/pics/Notifier-Logo.png'
                    : undefined
            });
            note.onclick = function() {
                window.focus();
                if (primary.url && isSameOrigin(primary.url)) window.location.href = primary.url;
                note.close();
            };
        } catch (e) { /* the OS refused; the in-page bell still works */ }
    }

    // Synthesised, not shipped: no binary asset and nothing for a CSP to block.
    function playChime() {
        if (!state.prefs.sound_enabled) return;
        var Ctx = window.AudioContext || window.webkitAudioContext;
        if (!Ctx) return;

        try {
            if (!audioCtx) audioCtx = new Ctx();
            if (audioCtx.state === 'suspended') audioCtx.resume();

            [[880, 0], [1320, 0.09]].forEach(function(pair) {
                var osc  = audioCtx.createOscillator();
                var gain = audioCtx.createGain();
                var at   = audioCtx.currentTime + pair[1];

                osc.type = 'sine';
                osc.frequency.setValueAtTime(pair[0], at);
                gain.gain.setValueAtTime(0.0001, at);
                gain.gain.exponentialRampToValueAtTime(0.12, at + 0.01);
                gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.18);

                osc.connect(gain);
                gain.connect(audioCtx.destination);
                osc.start(at);
                osc.stop(at + 0.2);
            });
        } catch (e) { /* audio is a nicety, never a failure */ }
    }

    function announceArrivals(items) {
        var fresh = items.filter(function(item) {
            return !item.is_read && highWaterId !== null && item.id > highWaterId;
        });

        var maxId = items.reduce(function(acc, item) {
            return item.id > acc ? item.id : acc;
        }, highWaterId || 0);

        // First load only sets the baseline; no alert storm on page load.
        var isFirstLoad = highWaterId === null;
        highWaterId = maxId;
        if (isFirstLoad || !fresh.length) return;

        showDesktop(fresh);
        playChime();

        var bell = wrap();
        if (bell) {
            bell.classList.remove('has-arrival');
            void bell.offsetWidth;
            bell.classList.add('has-arrival');
        }
    }

    function syncDocumentTitle() {
        if (baseTitle === null) baseTitle = document.title;

        var stripped = document.title.replace(/^\(\d+\+?\)\s*/, '');
        if (stripped !== baseTitle) baseTitle = stripped;

        var count = state.unreadGroups;
        document.title = count > 0
            ? '(' + (count > 99 ? '99+' : count) + ') ' + baseTitle
            : baseTitle;
    }

    // ------------------------------------------------------------------ mount

    function buildBell() {
        var el = document.createElement('div');
        el.className = 'notifier-bell-wrap';
        el.innerHTML = ''
            + '<button type="button" class="notifier-bell-btn" aria-label="' + escapeHtml(T.notifications) + '" aria-haspopup="dialog" aria-expanded="false">'
            +   '<i class="fas fa-bell" aria-hidden="true"></i>'
            +   '<span class="notifier-bell-badge" hidden>0</span>'
            + '</button>'
            + '<button type="button" class="notifier-bell-restore" aria-label="' + escapeHtml(T.expand) + '" title="' + escapeHtml(T.expand) + '">'
            +   '<i class="fas fa-chevron-left" aria-hidden="true"></i>'
            + '</button>'
            + '<div class="notifier-bell-panel" role="dialog" aria-label="' + escapeHtml(T.notifications) + '" hidden>'
            +   '<div class="notifier-bell-panel-header">'
            +     '<div class="notifier-bell-panel-titlebar">'
            +       '<span class="notifier-bell-panel-title">'
            +         escapeHtml(T.notifications)
            +         ' <span class="notifier-bell-panel-count">0</span>'
            +       '</span>'
            +       '<div class="notifier-bell-panel-tools">'
            +         '<span class="notifier-bell-offline" hidden role="status">'
            +           '<i class="fas fa-triangle-exclamation" aria-hidden="true"></i>'
            +           '<span>' + escapeHtml(T.offline) + '</span>'
            +         '</span>'
            +         '<button type="button" class="notifier-bell-minimize" title="' + escapeHtml(T.minimize) + '" aria-label="' + escapeHtml(T.minimize) + '">'
            +           '<i class="fas fa-minus" aria-hidden="true"></i>'
            +         '</button>'
            +       '</div>'
            +     '</div>'
            +     '<div class="notifier-bell-search">'
            +       '<i class="fas fa-magnifying-glass" aria-hidden="true"></i>'
            +       '<input type="search" class="notifier-bell-search-input" autocomplete="off"'
            +         ' placeholder="' + escapeHtml(T.searchPlaceholder) + '"'
            +         ' aria-label="' + escapeHtml(T.search) + '">'
            +       '<button type="button" class="notifier-bell-search-clear" hidden'
            +         ' title="' + escapeHtml(T.clearSearch) + '" aria-label="' + escapeHtml(T.clearSearch) + '">'
            +         '<i class="fas fa-times" aria-hidden="true"></i>'
            +       '</button>'
            +     '</div>'
            +     '<div class="notifier-bell-tabs" role="tablist">'
            +       '<button type="button" class="notifier-bell-tab" data-tab="unread" role="tab" aria-selected="true">' + escapeHtml(T.tabUnread) + '</button>'
            +       '<button type="button" class="notifier-bell-tab" data-tab="all" role="tab" aria-selected="false">' + escapeHtml(T.tabAll) + '</button>'
            +       '<button type="button" class="notifier-bell-tab" data-tab="notes" role="tab" aria-selected="false">'
            +         escapeHtml(T.tabNotes) + ' <span class="notifier-bell-tab-count" hidden>0</span>'
            +       '</button>'
            +       '<button type="button" class="notifier-bell-markall">'
            +         '<i class="fas fa-check-double" aria-hidden="true"></i> ' + escapeHtml(T.markAllRead)
            +       '</button>'
            +     '</div>'
            +   '</div>'
            +   '<div class="notifier-bell-panel-body">'
            +     '<div class="notifier-notes" hidden>'
            +       '<form class="notifier-notes-add">'
            +         '<input type="text" class="notifier-notes-input" maxlength="255"'
            +           ' placeholder="' + escapeHtml(T.notePlaceholder) + '"'
            +           ' aria-label="' + escapeHtml(T.noteNew) + '">'
            +         '<div class="notifier-notes-add-row">'
            +           '<input type="datetime-local" class="notifier-notes-when"'
            +             ' aria-label="' + escapeHtml(T.noteWhen) + '">'
            +           '<button type="button" class="notifier-notes-quick" data-minutes="60">' + escapeHtml(T.noteIn1h) + '</button>'
            +           '<button type="button" class="notifier-notes-quick" data-tomorrow="1">' + escapeHtml(T.noteTomorrow) + '</button>'
            +           '<button type="submit" class="notifier-btn notifier-btn-primary notifier-notes-save">'
            +             escapeHtml(T.noteAdd)
            +           '</button>'
            +         '</div>'
            +       '</form>'
            +       '<ul class="notifier-notes-list" role="list"></ul>'
            +       '<div class="notifier-notes-empty" hidden>'
            +         '<div class="notifier-bell-empty-art" aria-hidden="true"><i class="fas fa-list-check"></i></div>'
            +         '<div class="notifier-bell-empty-title">' + escapeHtml(T.noteEmpty) + '</div>'
            +         '<div class="notifier-bell-empty-hint">' + escapeHtml(T.noteEmptyHint) + '</div>'
            +       '</div>'
            +     '</div>'
            +     '<ul class="notifier-bell-list" role="list"></ul>'
            +     '<div class="notifier-bell-empty" hidden>'
            +       '<div class="notifier-bell-empty-art" aria-hidden="true"><i class="fas fa-bell-slash"></i></div>'
            +       '<div class="notifier-bell-empty-title"></div>'
            +       '<div class="notifier-bell-empty-hint"></div>'
            +     '</div>'
            +     '<button type="button" class="notifier-bell-loadmore" hidden>' + escapeHtml(T.loadMore) + '</button>'
            +   '</div>'
            +   '<div class="notifier-bell-panel-footer">'
            +     '<button type="button" class="notifier-bell-settings" title="' + escapeHtml(T.settings) + '">'
            +       '<i class="fas fa-cog" aria-hidden="true"></i> ' + escapeHtml(T.settings)
            +     '</button>'
            +   '</div>'
            + '</div>';
        return el;
    }

    function setCollapsed(bell, collapsed) {
        try { localStorage.setItem(LS_COLLAPSED_KEY, collapsed ? '1' : '0'); } catch (e) { /* ignore */ }
        if (!bell) return;

        bell.classList.toggle('is-collapsed', !!collapsed);
        var btn = bell.querySelector('.notifier-bell-btn');
        if (btn) btn.setAttribute('aria-hidden', collapsed ? 'true' : 'false');

        if (collapsed) {
            closePanel(bell);
        }
    }

    function installBell() {
        if (wrap()) return;
        // Fixed bottom-right: GLPI header DOM varies too much by theme for
        // a selector-based mount to be reliable.
        var bell = buildBell();
        bell.classList.add('notifier-bell-floating');
        document.body.appendChild(bell);
        wireEvents(bell);
    }

    // ------------------------------------------------------------------ render

    function visibleItems() {
        if (state.tab === 'unread') {
            return state.items.filter(function(i) { return !i.is_read; });
        }
        return state.items;
    }

    function groupKey(item) {
        return item.itemtype + ':' + item.items_id;
    }

    function groupItems(items) {
        var byKey = Object.create(null);
        var order = [];
        items.forEach(function(item) {
            var key = groupKey(item);
            if (!byKey[key]) {
                byKey[key] = {
                    key:      key,
                    itemtype: item.itemtype,
                    items_id: item.items_id,
                    title:    item.title,
                    url:      item.url,
                    events:   []
                };
                order.push(key);
            }
            byKey[key].events.push(item);
        });
        return order.map(function(k) { return byKey[k]; });
    }

    // Group actions need every matching event, not just the tab-filtered ones.
    function eventsForKey(key) {
        var sep = key.indexOf(':');
        if (sep < 0) return [];
        var itemtype = key.substring(0, sep);
        var itemsId  = parseInt(key.substring(sep + 1), 10);
        return state.items.filter(function(ev) {
            return ev.itemtype === itemtype && ev.items_id === itemsId;
        });
    }

    function actorSummary(events) {
        var names = [];
        events.forEach(function(ev) {
            if (ev.actor_name && names.indexOf(ev.actor_name) === -1) names.push(ev.actor_name);
        });
        if (!names.length) return '';
        if (names.length === 1) return names[0];
        return t('andOthers', { name: names[0], n: names.length - 1 });
    }

    function render() {
        var bell = wrap();
        if (!bell) return;

        // An overdue task needs attention just as much as an unread bell,
        // so both feed the same badge. Counted locally so a reminder
        // maturing does not have to wait for the next poll to show up.
        state.notesDue = dueNoteCount();
        var displayCount = state.unreadGroups + state.notesDue;

        var badge = bell.querySelector('.notifier-bell-badge');
        if (displayCount > 0) {
            badge.textContent = displayCount > 99 ? '99+' : String(displayCount);
            badge.hidden = false;
            bell.classList.add('has-unread');
        } else {
            badge.hidden = true;
            bell.classList.remove('has-unread');
        }

        var countEl = bell.querySelector('.notifier-bell-panel-count');
        if (countEl) countEl.textContent = displayCount > 99 ? '99+' : String(displayCount);

        var offlineEl = bell.querySelector('.notifier-bell-offline');
        if (offlineEl) offlineEl.hidden = !state.offline;

        bell.querySelectorAll('.notifier-bell-tab').forEach(function(btn) {
            var isActive = btn.dataset.tab === state.tab;
            btn.classList.toggle('is-active', isActive);
            btn.setAttribute('aria-selected', String(isActive));
        });

        // Only overdue tasks get a number. A pending one is a list entry,
        // not an alert, and a badge on it reads as "act on this now".
        var tabCount = bell.querySelector('.notifier-bell-tab-count');
        if (tabCount) {
            tabCount.textContent = String(state.notesDue);
            tabCount.hidden = state.notesDue === 0;
        }

        var clearBtn = bell.querySelector('.notifier-bell-search-clear');
        if (clearBtn) clearBtn.hidden = state.search === '';

        var notesPane = bell.querySelector('.notifier-notes');
        var isNotes   = state.tab === 'notes';

        // The search box and "mark all" only mean anything for the feed.
        var searchBox = bell.querySelector('.notifier-bell-search');
        var markAll   = bell.querySelector('.notifier-bell-markall');
        if (searchBox) searchBox.hidden = isNotes;
        if (markAll)   markAll.hidden = isNotes;
        if (notesPane) notesPane.hidden = !isNotes;

        var list  = bell.querySelector('.notifier-bell-list');
        var empty = bell.querySelector('.notifier-bell-empty');

        if (isNotes) {
            list.hidden  = true;
            empty.hidden = true;
            var loadMoreEl = bell.querySelector('.notifier-bell-loadmore');
            if (loadMoreEl) loadMoreEl.hidden = true;
            renderNotes(bell);
            syncDocumentTitle();
            return;
        }

        list.hidden = false;
        list.innerHTML = '';

        var items = visibleItems();
        if (!items.length) {
            empty.hidden = false;
            empty.querySelector('.notifier-bell-empty-title').textContent =
                state.search ? T.noResults : T.noNotifications;
            empty.querySelector('.notifier-bell-empty-hint').textContent =
                state.search ? T.noResultsHint : T.noNotificationsHint;
        } else {
            empty.hidden = true;
            groupItems(items).forEach(function(group) {
                list.appendChild(buildGroupNode(group));
            });
        }

        var loadMore = bell.querySelector('.notifier-bell-loadmore');
        if (loadMore) {
            loadMore.hidden = state.loaded >= state.total;
            loadMore.disabled = state.loading;
            loadMore.textContent = state.loading ? T.loading : T.loadMore;
        }

        syncDocumentTitle();
    }

    // ------------------------------------------------------------------ notes

    function dueNoteCount() {
        var now = Date.now() / 1000;
        return state.notes.filter(function(n) {
            return !n.is_done && n.remind_ts && n.remind_ts <= now;
        }).length;
    }

    function renderNotes(bell) {
        var list  = bell.querySelector('.notifier-notes-list');
        var empty = bell.querySelector('.notifier-notes-empty');
        if (!list) return;

        list.innerHTML = '';

        if (!state.notes.length) {
            empty.hidden = false;
            return;
        }
        empty.hidden = true;

        state.notes.forEach(function(note) {
            list.appendChild(buildNoteNode(note));
        });
    }

    function buildNoteNode(note) {
        var overdue = !note.is_done && note.remind_ts && note.remind_ts * 1000 <= Date.now();

        var li = document.createElement('li');
        li.className = 'notifier-note'
            + (note.is_done ? ' is-done' : '')
            + (overdue ? ' is-overdue' : '');
        li.dataset.id = note.id;

        var when = '';
        if (note.remind_ts) {
            when = '<span class="notifier-note-when">'
                + '<i class="fas fa-clock" aria-hidden="true"></i> '
                + escapeHtml(formatWhen(note.remind_ts))
                + '</span>';
        }

        var link = '';
        if (note.url && note.itemtype && note.items_id) {
            link = '<a class="notifier-note-link" href="' + escapeHtml(note.url) + '">'
                + escapeHtml(note.itemtype + ' #' + note.items_id) + '</a>';
        }

        var toggleLabel = note.is_done ? T.noteUndo : T.noteDone;

        li.innerHTML = ''
            + '<button type="button" class="notifier-note-check" data-note="toggle"'
            +   ' role="checkbox" aria-checked="' + (note.is_done ? 'true' : 'false') + '"'
            +   ' title="' + escapeHtml(toggleLabel) + '" aria-label="' + escapeHtml(toggleLabel) + '">'
            +   '<i class="fas fa-check" aria-hidden="true"></i>'
            + '</button>'
            + '<div class="notifier-note-body">'
            +   '<span class="notifier-note-text">' + escapeHtml(note.content) + '</span>'
            +   (when || link ? '<span class="notifier-note-meta">' + when + link + '</span>' : '')
            + '</div>'
            + '<button type="button" class="notifier-note-delete" data-note="delete"'
            +   ' title="' + escapeHtml(T.noteDelete) + '" aria-label="' + escapeHtml(T.noteDelete) + '">'
            +   '<i class="fas fa-trash-can" aria-hidden="true"></i>'
            + '</button>';

        return li;
    }

    function formatWhen(epochSeconds) {
        var due   = new Date(epochSeconds * 1000);
        var now   = new Date();
        var time  = due.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        var sameDay = due.toDateString() === now.toDateString();

        return sameDay ? time : due.toLocaleDateString([], { day: 'numeric', month: 'short' }) + ' ' + time;
    }

    /**
     * Fires once per due reminder while a page is open, and catches up on
     * anything that came due while the user was away.
     */
    function announceDueNotes() {
        var now = Date.now() / 1000;

        state.notes.forEach(function(note) {
            if (note.is_done || note.notified || !note.remind_ts) return;
            if (note.remind_ts > now) return;

            note.notified = true;
            call('notes.php', { action: 'seen', id: note.id }).catch(function() {});

            if (desktopAllowed()) {
                try {
                    var popup = new window.Notification(T.noteReminder, { body: note.content, tag: 'notifier-note-' + note.id });
                    popup.onclick = function() { window.focus(); popup.close(); };
                } catch (e) { /* the in-page list still shows it */ }
            }
            playChime();
        });
    }

    function addNote(bell) {
        var input = bell.querySelector('.notifier-notes-input');
        var when  = bell.querySelector('.notifier-notes-when');
        var text  = input ? input.value.trim() : '';

        if (!text) {
            if (input) input.focus();
            return;
        }

        var params = { action: 'add', content: text };
        if (when && when.value) {
            var ts = Math.floor(new Date(when.value).getTime() / 1000);
            if (ts > 0) params.remind_ts = ts;
        }

        call('notes.php', params).then(function(resp) {
            if (resp && resp.notes) {
                state.notes    = resp.notes;
                state.notesDue = resp.due || 0;
            }
            if (input) input.value = '';
            if (when)  when.value = '';
            render();
            if (input) input.focus();
        }).catch(function(err) {
            if (window.console) console.error('[notifier] add note failed:', err);
        });
    }

    function setNoteWhen(bell, date) {
        var when = bell.querySelector('.notifier-notes-when');
        if (!when) return;
        // datetime-local wants a local-time string, not an ISO instant.
        var pad = function(n) { return String(n).padStart(2, '0'); };
        when.value = date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate())
            + 'T' + pad(date.getHours()) + ':' + pad(date.getMinutes());
    }

    function buildGroupNode(group) {
        var unreadEvents = group.events.filter(function(e) { return !e.is_read; });
        var groupUnread  = unreadEvents.length > 0;
        var primary      = group.events[0];
        var batched      = group.events.length > 1;
        var isExpanded   = state.expanded.has(group.key);

        var li = document.createElement('li');
        li.className = 'notifier-bell-group notifier-event-' + escapeHtml(primary.event)
            + (groupUnread ? ' is-unread' : ' is-read')
            + (batched     ? ' is-batched' : '')
            + (isExpanded  ? ' is-expanded' : '');
        li.dataset.key = group.key;
        li.dataset.url = group.url;

        var header = document.createElement('div');
        header.className = 'notifier-bell-item notifier-bell-group-header'
            + (groupUnread ? ' is-unread' : ' is-read');

        var summary = actorSummary(group.events);
        var meta    = escapeHtml(timeAgo(primary.created_ts));
        if (batched) {
            meta += ' <span class="notifier-bell-group-meta-count">· '
                + escapeHtml(t('groupedUpdates', { n: group.events.length })) + '</span>';
        }

        // Buttons sit outside the activatable region: a role="button"
        // must not contain other controls.
        header.innerHTML = ''
            + '<div class="notifier-bell-group-main" role="button" tabindex="0"'
            +   ' aria-label="' + escapeHtml(group.title + ' — ' + primary.message) + '">'
            +   avatarHtml(primary)
            +   '<div class="notifier-bell-item-body">'
            +     '<div class="notifier-bell-item-title">' + escapeHtml(group.title) + '</div>'
            +     '<div class="notifier-bell-item-msg">'
            +       (summary ? '<strong>' + escapeHtml(summary) + '</strong> ' : '')
            +       escapeHtml(primary.message)
            +     '</div>'
            +     '<div class="notifier-bell-item-meta">' + meta + '</div>'
            +   '</div>'
            + '</div>'
            + '<div class="notifier-bell-item-actions">'
            +   (batched ? expandButtonHtml(isExpanded) : '')
            +   (CFG.snooze_enabled && groupUnread ? snoozeButtonHtml() : '')
            +   toggleButtonHtml(groupUnread ? 'group-read' : 'group-unread', groupUnread)
            + '</div>';
        li.appendChild(header);

        if (isExpanded) {
            var drawer = document.createElement('div');
            drawer.className = 'notifier-bell-drawer';

            if (CFG.quick_actions_enabled && CFG.statuses[group.itemtype]) {
                drawer.appendChild(buildQuickActions(group));
            }

            if (batched) {
                var ul = document.createElement('ul');
                ul.className = 'notifier-bell-subs';
                group.events.forEach(function(ev) { ul.appendChild(buildSubNode(ev)); });
                drawer.appendChild(ul);
            }

            li.appendChild(drawer);
        }

        return li;
    }

    /** Initials plus an event badge: you see who acted before reading. */
    function avatarHtml(item) {
        var initials = initialsOf(item.actor_name);
        var icon     = '<span class="notifier-avatar-badge notifier-event-badge-' + escapeHtml(item.event) + '">'
            + '<i class="fas ' + eventIcon(item.event) + '" aria-hidden="true"></i></span>';

        if (!initials) {
            return '<div class="notifier-avatar is-system" aria-hidden="true">'
                + '<i class="fas ' + eventIcon(item.event) + '"></i>' + icon + '</div>';
        }

        return '<div class="notifier-avatar" aria-hidden="true" style="--notifier-avatar-hue:'
            + hueOf(item.actor_name) + '">'
            + '<span class="notifier-avatar-initials">' + escapeHtml(initials) + '</span>'
            + icon + '</div>';
    }

    function toggleButtonHtml(action, isUnread) {
        var label = isUnread ? T.markAsRead : T.markAsUnread;
        return '<button type="button" class="notifier-bell-item-toggle"'
            + ' data-action="' + escapeHtml(action) + '"'
            + ' title="' + escapeHtml(label) + '" aria-label="' + escapeHtml(label) + '">'
            + '<i class="fas ' + (isUnread ? 'fa-check' : 'fa-rotate-left') + '" aria-hidden="true"></i>'
            + '</button>';
    }

    function expandButtonHtml(isExpanded) {
        var label = isExpanded ? T.collapseGroup : T.expandGroup;
        return '<button type="button" class="notifier-bell-group-expand" data-action="expand"'
            + ' aria-expanded="' + (isExpanded ? 'true' : 'false') + '"'
            + ' title="' + escapeHtml(label) + '" aria-label="' + escapeHtml(label) + '">'
            + '<i class="fas fa-chevron-down" aria-hidden="true"></i></button>';
    }

    function snoozeButtonHtml() {
        return '<button type="button" class="notifier-bell-snooze" data-action="snooze"'
            + ' title="' + escapeHtml(T.snooze) + '" aria-label="' + escapeHtml(T.snooze) + '"'
            + ' aria-haspopup="menu">'
            + '<i class="fas fa-clock" aria-hidden="true"></i></button>';
    }

    function buildQuickActions(group) {
        var box = document.createElement('div');
        box.className = 'notifier-qa';

        var statuses = CFG.statuses[group.itemtype] || [];
        var options  = statuses.map(function(s) {
            return '<option value="' + escapeHtml(s.id) + '">' + escapeHtml(s.label) + '</option>';
        }).join('');

        box.innerHTML = ''
            + '<div class="notifier-qa-label">' + escapeHtml(T.quickActions) + '</div>'
            + '<div class="notifier-qa-row">'
            +   '<button type="button" class="notifier-qa-btn" data-qa="take">'
            +     '<i class="fas fa-user-check" aria-hidden="true"></i> ' + escapeHtml(T.actionTake)
            +   '</button>'
            +   '<label class="notifier-qa-status">'
            +     '<span class="notifier-visually-hidden">' + escapeHtml(T.actionStatus) + '</span>'
            +     '<select class="notifier-qa-select" data-qa="status">'
            +       '<option value="">' + escapeHtml(T.actionStatus) + '</option>'
            +       options
            +     '</select>'
            +   '</label>'
            + '</div>'
            + '<div class="notifier-qa-row">'
            +   '<input type="text" class="notifier-qa-input" maxlength="500"'
            +     ' placeholder="' + escapeHtml(T.followupPlaceholder) + '"'
            +     ' aria-label="' + escapeHtml(T.actionFollowup) + '">'
            +   '<button type="button" class="notifier-qa-btn notifier-qa-send" data-qa="followup">'
            +     '<i class="fas fa-paper-plane" aria-hidden="true"></i> ' + escapeHtml(T.send)
            +   '</button>'
            + '</div>'
            + '<div class="notifier-qa-feedback" hidden></div>';

        return box;
    }

    function buildSubNode(item) {
        var li = document.createElement('li');
        li.className = 'notifier-bell-sub-item notifier-event-' + escapeHtml(item.event)
            + (item.is_read ? ' is-read' : ' is-unread');
        li.dataset.id  = item.id;
        li.dataset.url = item.url;

        var label = item.is_read ? T.markAsUnread : T.markAsRead;

        li.innerHTML = ''
            + '<div class="notifier-bell-sub-icon notifier-event-badge-' + escapeHtml(item.event) + '">'
            +   '<i class="fas ' + eventIcon(item.event) + '" aria-hidden="true"></i>'
            + '</div>'
            + '<div class="notifier-bell-sub-body">'
            +   '<div class="notifier-bell-sub-msg">'
            +     (item.actor_name ? '<strong>' + escapeHtml(item.actor_name) + '</strong> ' : '')
            +     escapeHtml(item.message)
            +   '</div>'
            +   '<div class="notifier-bell-item-meta">' + escapeHtml(timeAgo(item.created_ts)) + '</div>'
            + '</div>'
            + '<button type="button" class="notifier-bell-item-toggle"'
            +   ' data-action="' + (item.is_read ? 'unread' : 'read') + '"'
            +   ' title="' + escapeHtml(label) + '" aria-label="' + escapeHtml(label) + '">'
            +   '<i class="fas ' + (item.is_read ? 'fa-rotate-left' : 'fa-check') + '" aria-hidden="true"></i>'
            + '</button>';
        return li;
    }

    function eventIcon(event) {
        switch (event) {
            case 'assigned':       return 'fa-user-check';
            case 'commented':      return 'fa-comment-dots';
            case 'status_changed': return 'fa-arrows-rotate';
            case 'solution':       return 'fa-lightbulb';
            case 'task_added':     return 'fa-list-check';
            case 'created':        return 'fa-plus';
            case 'updated':        return 'fa-pen';
            case 'validation':     return 'fa-stamp';
            case 'mention':        return 'fa-at';
            case 'deadline':       return 'fa-hourglass-half';
            default:               return 'fa-bell';
        }
    }

    // ------------------------------------------------------------------ mutations

    function markRead(id)   { return call('markread.php', { id: id }); }
    function markUnread(id) { return call('markunread.php', { id: id }); }

    function snoozeGroup(group, minutes) {
        return call('snooze.php', {
            itemtype: group.itemtype,
            items_id: group.items_id,
            minutes:  minutes
        });
    }

    function minutesUntilTomorrowMorning() {
        var now  = new Date();
        var then = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 9, 0, 0, 0);
        return Math.max(1, Math.round((then - now) / 60000));
    }

    // ------------------------------------------------------------------ snooze menu

    function openSnoozeMenu(anchor, group) {
        closeSnoozeMenu();

        var menu = document.createElement('div');
        menu.className = 'notifier-snooze-menu';
        menu.setAttribute('role', 'menu');
        menu.innerHTML = [
            { minutes: 60,  label: T.snooze1h },
            { minutes: 180, label: T.snooze3h },
            { minutes: minutesUntilTomorrowMorning(), label: T.snoozeTomorrow }
        ].map(function(option) {
            return '<button type="button" role="menuitem" data-minutes="' + option.minutes + '">'
                + escapeHtml(option.label) + '</button>';
        }).join('');

        anchor.parentNode.appendChild(menu);
        anchor.setAttribute('aria-expanded', 'true');

        menu.addEventListener('click', function(e) {
            var btn = e.target.closest('[data-minutes]');
            if (!btn) return;
            e.preventDefault();
            e.stopPropagation();
            closeSnoozeMenu();
            snoozeGroup(group, parseInt(btn.dataset.minutes, 10)).then(reload);
        });

        var first = menu.querySelector('button');
        if (first) first.focus();
    }

    function closeSnoozeMenu() {
        var open = document.querySelector('.notifier-snooze-menu');
        if (open) open.remove();
        document.querySelectorAll('.notifier-bell-snooze[aria-expanded="true"]').forEach(function(btn) {
            btn.setAttribute('aria-expanded', 'false');
        });
    }

    // ------------------------------------------------------------------ quick actions

    function runQuickAction(box, group, action, extra) {
        var feedback = box.querySelector('.notifier-qa-feedback');
        var params   = {
            action:   action,
            itemtype: group.itemtype,
            items_id: group.items_id
        };
        Object.keys(extra || {}).forEach(function(k) { params[k] = extra[k]; });

        box.classList.add('is-busy');

        return request('action.php', params).then(function(response) {
            if (response.status === 403) {
                // Stale token or real denial; retry once before blaming the user.
                return refreshToken()
                    .then(function() { return request('action.php', params); })
                    .then(function(retry) {
                        if (retry.status === 403) throw new Error('forbidden');
                        if (!retry.ok) throw new Error('failed');
                        return retry.json();
                    });
            }
            if (!response.ok) throw new Error('failed');
            return response.json();
        }).then(function() {
            showFeedback(feedback, T.actionDone, true);
            reload();
        }).catch(function(err) {
            var message = String(err && err.message) === 'forbidden' ? T.actionForbidden : T.actionFailed;
            showFeedback(feedback, message, false);
        }).then(function() {
            box.classList.remove('is-busy');
        });
    }

    function showFeedback(el, message, ok) {
        if (!el) return;
        el.textContent = message;
        el.classList.toggle('is-error', !ok);
        el.hidden = false;
        setTimeout(function() { el.hidden = true; }, 2600);
    }

    // ------------------------------------------------------------------ preferences modal

    function buildPreferencesModal() {
        var overlay = document.createElement('div');
        overlay.className = 'notifier-modal-overlay';
        overlay.setAttribute('role', 'dialog');
        overlay.setAttribute('aria-modal', 'true');
        overlay.setAttribute('aria-label', T.preferencesTitle);
        overlay.hidden = true;

        var typeRows = PREF_TYPES.map(function(p) {
            return ''
                + '<tr>'
                +   '<th scope="row">' + escapeHtml(T[p.typeLabelKey] || p.slug) + '</th>'
                +   '<td>' + switchHtml(p.direct, T.colDirect) + '</td>'
                +   '<td>' + switchHtml(p.group, T.colGroup) + '</td>'
                + '</tr>';
        }).join('');

        var eventRows = EVENTS.map(function(ev) {
            return ''
                + '<li class="notifier-pref-event">'
                +   '<span class="notifier-pref-event-icon notifier-event-badge-' + escapeHtml(ev.slug) + '">'
                +     '<i class="fas ' + eventIcon(ev.slug) + '" aria-hidden="true"></i>'
                +   '</span>'
                +   '<span class="notifier-pref-event-label">' + escapeHtml(ev.label) + '</span>'
                +   switchHtml('notify_event_' + ev.slug, ev.label)
                + '</li>';
        }).join('');

        overlay.innerHTML = ''
            + '<div class="notifier-modal">'
            +   '<div class="notifier-modal-header">'
            +     '<h3 class="notifier-modal-title"><i class="fas fa-cog" aria-hidden="true"></i> ' + escapeHtml(T.preferencesTitle) + '</h3>'
            +     '<button type="button" class="notifier-modal-close" aria-label="' + escapeHtml(T.close) + '" title="' + escapeHtml(T.close) + '">'
            +       '<i class="fas fa-times" aria-hidden="true"></i>'
            +     '</button>'
            +   '</div>'
            +   '<div class="notifier-modal-body">'
            +     '<p class="notifier-modal-intro">' + escapeHtml(T.preferencesIntro) + '</p>'

            +     '<h4 class="notifier-pref-heading">' + escapeHtml(T.sectionTypes) + '</h4>'
            +     '<table class="notifier-pref-table">'
            +       '<thead><tr><th></th>'
            +         '<th>' + escapeHtml(T.colDirect) + '</th>'
            +         '<th>' + escapeHtml(T.colGroup) + '</th>'
            +       '</tr></thead>'
            +       '<tbody>' + typeRows + '</tbody>'
            +     '</table>'

            +     '<h4 class="notifier-pref-heading">' + escapeHtml(T.sectionEvents) + '</h4>'
            +     '<p class="notifier-pref-sub">' + escapeHtml(T.eventsIntro) + '</p>'
            +     '<ul class="notifier-pref-events">' + eventRows + '</ul>'

            +     '<h4 class="notifier-pref-heading">' + escapeHtml(T.sectionDelivery) + '</h4>'
            +     '<ul class="notifier-pref-events">'
            +       '<li class="notifier-pref-event">'
            +         '<span class="notifier-pref-event-icon"><i class="fas fa-desktop" aria-hidden="true"></i></span>'
            +         '<span class="notifier-pref-event-label">' + escapeHtml(T.desktopEnabled)
            +           '<small>' + escapeHtml(T.desktopHint) + '</small></span>'
            +         switchHtml('desktop_enabled', T.desktopEnabled)
            +       '</li>'
            +       '<li class="notifier-pref-event">'
            +         '<span class="notifier-pref-event-icon"><i class="fas fa-volume-high" aria-hidden="true"></i></span>'
            +         '<span class="notifier-pref-event-label">' + escapeHtml(T.soundEnabled)
            +           '<small>' + escapeHtml(T.soundHint) + '</small></span>'
            +         switchHtml('sound_enabled', T.soundEnabled)
            +       '</li>'
            +     '</ul>'
            +     '<div class="notifier-modal-warning" hidden></div>'
            +     '<div class="notifier-modal-toast" hidden><i class="fas fa-check-circle" aria-hidden="true"></i> ' + escapeHtml(T.saved) + '</div>'
            +   '</div>'
            +   '<div class="notifier-modal-footer">'
            +     '<button type="button" class="notifier-btn notifier-btn-secondary" data-action="cancel">' + escapeHtml(T.cancel) + '</button>'
            +     '<button type="button" class="notifier-btn notifier-btn-primary" data-action="save">' + escapeHtml(T.save) + '</button>'
            +   '</div>'
            + '</div>';

        return overlay;
    }

    function switchHtml(prefKey, label) {
        return '<label class="notifier-switch" title="' + escapeHtml(label) + '">'
            + '<input type="checkbox" data-pref="' + escapeHtml(prefKey) + '"'
            + ' aria-label="' + escapeHtml(label) + '" checked>'
            + '<span class="notifier-switch-slider"></span></label>';
    }

    function ensurePreferencesModal() {
        var existing = document.querySelector('.notifier-modal-overlay');
        if (existing) return existing;
        var overlay = buildPreferencesModal();
        document.body.appendChild(overlay);
        wirePreferencesModal(overlay);
        return overlay;
    }

    function wirePreferencesModal(overlay) {
        var modal = overlay.querySelector('.notifier-modal');

        overlay.addEventListener('click', function(e) {
            if (e.target === overlay) closePreferences(overlay);
        });
        modal.addEventListener('click', function(e) { e.stopPropagation(); });

        overlay.querySelector('.notifier-modal-close')
            .addEventListener('click', function() { closePreferences(overlay); });
        overlay.querySelector('[data-action="cancel"]')
            .addEventListener('click', function() { closePreferences(overlay); });
        overlay.querySelector('[data-action="save"]')
            .addEventListener('click', function() { savePreferences(overlay); });

        // Permission needs a user gesture, so it happens on the toggle.
        var desktopToggle = overlay.querySelector('input[data-pref="desktop_enabled"]');
        if (desktopToggle) {
            desktopToggle.addEventListener('change', function() {
                if (!desktopToggle.checked) return;
                requestDesktopPermission(overlay, desktopToggle);
            });
        }

        overlay.addEventListener('keydown', function(e) {
            if (e.key === 'Escape') {
                e.stopPropagation();
                closePreferences(overlay);
                return;
            }
            if (e.key === 'Tab') trapFocus(e, modal);
        });
    }

    function requestDesktopPermission(overlay, toggle) {
        var warning = overlay.querySelector('.notifier-modal-warning');

        if (!('Notification' in window)) {
            toggle.checked = false;
            showWarning(warning, T.permissionDenied);
            return;
        }
        if (window.Notification.permission === 'granted') return;
        if (window.Notification.permission === 'denied') {
            toggle.checked = false;
            showWarning(warning, T.permissionDenied);
            return;
        }

        window.Notification.requestPermission().then(function(result) {
            if (result !== 'granted') {
                toggle.checked = false;
                showWarning(warning, T.permissionDenied);
            }
        });
    }

    function showWarning(el, message) {
        if (!el) return;
        el.textContent = message;
        el.hidden = false;
    }

    function trapFocus(e, container) {
        var focusable = container.querySelectorAll(
            'button:not([disabled]), input:not([disabled]), select, textarea, [href], [tabindex]:not([tabindex="-1"])'
        );
        if (!focusable.length) return;

        var first = focusable[0];
        var last  = focusable[focusable.length - 1];

        if (e.shiftKey && document.activeElement === first) {
            e.preventDefault();
            last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
            e.preventDefault();
            first.focus();
        }
    }

    function openPreferences() {
        var overlay = ensurePreferencesModal();
        overlay.hidden = false;

        applyPrefsToModal(overlay, state.prefs);

        call('preferences.php').then(function(resp) {
            var prefs = (resp && resp.preferences) || {};
            state.prefs = prefs;
            applyPrefsToModal(overlay, prefs);
        }).catch(function() { /* keep whatever we already had */ });

        var firstInput = overlay.querySelector('input[data-pref]');
        if (firstInput) firstInput.focus();
    }

    function applyPrefsToModal(overlay, prefs) {
        overlay.querySelectorAll('input[data-pref]').forEach(function(input) {
            var key = input.dataset.pref;
            input.checked = prefs[key] === undefined ? true : !!Number(prefs[key]);
        });
    }

    function closePreferences(overlay) {
        overlay.hidden = true;
        var toast = overlay.querySelector('.notifier-modal-toast');
        if (toast) toast.hidden = true;
        var warning = overlay.querySelector('.notifier-modal-warning');
        if (warning) warning.hidden = true;

        var settings = document.querySelector('.notifier-bell-settings');
        if (settings) settings.focus();
    }

    function savePreferences(overlay) {
        var params = { save: '1' };
        overlay.querySelectorAll('input[data-pref]').forEach(function(input) {
            params[input.dataset.pref] = input.checked ? '1' : '0';
        });

        var saveBtn = overlay.querySelector('[data-action="save"]');
        saveBtn.disabled = true;

        call('preferences.php', params).then(function(resp) {
            if (resp && resp.preferences) state.prefs = resp.preferences;

            var toast = overlay.querySelector('.notifier-modal-toast');
            if (toast) {
                toast.hidden = false;
                setTimeout(function() { toast.hidden = true; }, 1800);
            }
            setTimeout(function() { closePreferences(overlay); }, 900);

            // The filter runs server-side; the feed is stale as of now.
            reload();
        }).catch(function(err) {
            if (window.console) console.error('[notifier] save preferences failed:', err);
        }).then(function() {
            saveBtn.disabled = false;
        });
    }

    // ------------------------------------------------------------------ panel

    function openPanel(bell) {
        var panel = bell.querySelector('.notifier-bell-panel');
        var btn   = bell.querySelector('.notifier-bell-btn');
        panel.hidden = false;
        btn.setAttribute('aria-expanded', 'true');
        idleFactor = 1;
        reload();
        schedulePoll();
    }

    function closePanel(bell) {
        var panel = bell.querySelector('.notifier-bell-panel');
        var btn   = bell.querySelector('.notifier-bell-btn');
        if (panel) panel.hidden = true;
        if (btn) btn.setAttribute('aria-expanded', 'false');
        closeSnoozeMenu();
    }

    function isPanelOpen(bell) {
        var panel = bell.querySelector('.notifier-bell-panel');
        return panel && !panel.hidden;
    }

    function moveFocus(list, direction) {
        var rows = Array.prototype.slice.call(list.querySelectorAll('.notifier-bell-group-main'));
        if (!rows.length) return;
        var index = rows.indexOf(document.activeElement);
        var next  = index === -1
            ? (direction > 0 ? 0 : rows.length - 1)
            : Math.min(rows.length - 1, Math.max(0, index + direction));
        rows[next].focus();
    }

    // ------------------------------------------------------------------ events

    function wireEvents(bell) {
        var btn      = bell.querySelector('.notifier-bell-btn');
        var panel    = bell.querySelector('.notifier-bell-panel');
        var list     = bell.querySelector('.notifier-bell-list');
        var markAll  = bell.querySelector('.notifier-bell-markall');
        var minimize = bell.querySelector('.notifier-bell-minimize');
        var restore  = bell.querySelector('.notifier-bell-restore');
        var settings = bell.querySelector('.notifier-bell-settings');
        var loadMore = bell.querySelector('.notifier-bell-loadmore');
        var search   = bell.querySelector('.notifier-bell-search-input');
        var clear    = bell.querySelector('.notifier-bell-search-clear');

        btn.addEventListener('click', function(e) {
            e.stopPropagation();
            if (bell.classList.contains('is-collapsed')) {
                setCollapsed(bell, false);
                openPanel(bell);
                return;
            }
            if (isPanelOpen(bell)) closePanel(bell);
            else openPanel(bell);
        });

        if (restore) {
            restore.addEventListener('click', function(e) {
                e.stopPropagation();
                setCollapsed(bell, false);
                openPanel(bell);
            });
        }

        if (minimize) {
            minimize.addEventListener('click', function(e) {
                e.preventDefault();
                e.stopPropagation();
                setCollapsed(bell, true);
                btn.focus();
            });
        }

        bell.querySelectorAll('.notifier-bell-tab').forEach(function(tab) {
            tab.addEventListener('click', function(e) {
                e.preventDefault();
                e.stopPropagation();
                state.tab = tab.dataset.tab;
                saveTab(state.tab);
                render();
            });
        });

        if (settings) {
            settings.addEventListener('click', function(e) {
                e.preventDefault();
                e.stopPropagation();
                openPreferences();
            });
        }

        if (loadMore) {
            loadMore.addEventListener('click', function(e) {
                e.preventDefault();
                e.stopPropagation();
                loadNextPage();
            });
        }

        if (search) {
            var debounce = null;
            search.addEventListener('input', function() {
                clearTimeout(debounce);
                debounce = setTimeout(function() {
                    state.search = search.value.trim();
                    reload();
                }, SEARCH_DEBOUNCE);
            });
            search.addEventListener('keydown', function(e) {
                if (e.key === 'Escape' && search.value) {
                    e.stopPropagation();
                    search.value = '';
                    state.search = '';
                    reload();
                }
            });
        }

        if (clear) {
            clear.addEventListener('click', function(e) {
                e.preventDefault();
                e.stopPropagation();
                if (search) search.value = '';
                state.search = '';
                reload();
                if (search) search.focus();
            });
        }

        document.addEventListener('click', function(e) {
            if (!isPanelOpen(bell)) return;
            if (bell.contains(e.target)) return;
            var overlay = document.querySelector('.notifier-modal-overlay');
            if (overlay && !overlay.hidden && overlay.contains(e.target)) return;
            closePanel(bell);
        });

        panel.addEventListener('keydown', function(e) {
            if (e.key === 'Escape') {
                closePanel(bell);
                btn.focus();
                return;
            }
            if (e.key === 'ArrowDown') { e.preventDefault(); moveFocus(list, 1); }
            if (e.key === 'ArrowUp')   { e.preventDefault(); moveFocus(list, -1); }
        });

        list.addEventListener('keydown', function(e) {
            if (e.key !== 'Enter' && e.key !== ' ') return;
            var main = e.target.closest('.notifier-bell-group-main');
            if (!main) return;
            e.preventDefault();
            main.click();
        });

        list.addEventListener('click', onListClick);

        var notesForm = bell.querySelector('.notifier-notes-add');
        if (notesForm) {
            notesForm.addEventListener('submit', function(e) {
                e.preventDefault();
                e.stopPropagation();
                addNote(bell);
            });

            notesForm.addEventListener('click', function(e) {
                var quick = e.target.closest('.notifier-notes-quick');
                if (!quick) return;
                e.preventDefault();
                e.stopPropagation();

                var when = new Date();
                if (quick.dataset.tomorrow) {
                    when.setDate(when.getDate() + 1);
                    when.setHours(9, 0, 0, 0);
                } else {
                    when.setMinutes(when.getMinutes() + parseInt(quick.dataset.minutes, 10));
                }
                setNoteWhen(bell, when);
            });
        }

        var notesList = bell.querySelector('.notifier-notes-list');
        if (notesList) {
            notesList.addEventListener('click', function(e) {
                var btn = e.target.closest('[data-note]');
                if (!btn) return;

                var li = btn.closest('.notifier-note');
                var id = li ? parseInt(li.dataset.id, 10) : 0;
                if (!id) return;

                e.preventDefault();
                e.stopPropagation();

                var note   = state.notes.filter(function(n) { return n.id === id; })[0];
                var params = btn.dataset.note === 'delete'
                    ? { action: 'delete', id: id }
                    : { action: 'toggle', id: id, done: (note && note.is_done) ? 0 : 1 };

                call('notes.php', params).then(function(resp) {
                    if (resp && resp.notes) {
                        state.notes    = resp.notes;
                        state.notesDue = resp.due || 0;
                    }
                    render();
                }).catch(function(err) {
                    if (window.console) console.error('[notifier] note action failed:', err);
                });
            });
        }

        // Keeps relative timestamps honest, and fires a reminder on the
        // minute it is due rather than waiting for the next poll.
        setInterval(function() {
            announceDueNotes();
            if (isPanelOpen(bell)) render();
        }, 15000);
    }

    function onListClick(e) {
        var subLi = e.target.closest('.notifier-bell-sub-item');
        if (subLi) {
            e.stopPropagation();
            var subId = parseInt(subLi.dataset.id, 10);
            if (!subId) return;

            var subToggle = e.target.closest('.notifier-bell-item-toggle');
            if (subToggle) {
                e.preventDefault();
                var op = subToggle.dataset.action === 'unread' ? markUnread : markRead;
                op(subId).then(reload);
                return;
            }

            navigateTo(subLi.dataset.url, [markRead(subId)]);
            return;
        }

        var groupLi = e.target.closest('.notifier-bell-group');
        if (!groupLi) return;
        var key = groupLi.dataset.key;
        if (!key) return;

        var group = {
            key:      key,
            itemtype: key.substring(0, key.indexOf(':')),
            items_id: parseInt(key.substring(key.indexOf(':') + 1), 10)
        };

        var qaBox = e.target.closest('.notifier-qa');
        if (qaBox) {
            e.preventDefault();
            e.stopPropagation();
            handleQuickAction(e, qaBox, group);
            return;
        }

        var expandBtn = e.target.closest('.notifier-bell-group-expand');
        if (expandBtn) {
            e.preventDefault();
            e.stopPropagation();
            if (state.expanded.has(key)) state.expanded.delete(key);
            else                         state.expanded.add(key);
            render();
            return;
        }

        var snoozeBtn = e.target.closest('.notifier-bell-snooze');
        if (snoozeBtn) {
            e.preventDefault();
            e.stopPropagation();
            if (document.querySelector('.notifier-snooze-menu')) closeSnoozeMenu();
            else openSnoozeMenu(snoozeBtn, group);
            return;
        }

        var toggleBtn = e.target.closest('.notifier-bell-item-toggle');
        if (toggleBtn) {
            e.preventDefault();
            e.stopPropagation();
            var events = eventsForKey(key);
            if (!events.length) return;

            var wantRead = toggleBtn.dataset.action === 'group-read';
            var ops = events
                .filter(function(ev) { return wantRead ? !ev.is_read : ev.is_read; })
                .map(function(ev) { return wantRead ? markRead(ev.id) : markUnread(ev.id); });

            Promise.all(ops).then(reload);
            return;
        }

        // Open-redirect guard: `url` is an unconstrained VARCHAR, so refuse
        // off-origin even though getFormURLWithID() never produces one.
        var unreadOps = eventsForKey(key)
            .filter(function(ev) { return !ev.is_read; })
            .map(function(ev) { return markRead(ev.id); });

        navigateTo(groupLi.dataset.url, unreadOps);
    }

    function navigateTo(url, pending) {
        if (url && isSameOrigin(url)) {
            Promise.all(pending).then(function() { window.location.href = url; });
        } else {
            Promise.all(pending).then(reload);
        }
    }

    function handleQuickAction(e, box, group) {
        var select = e.target.closest('.notifier-qa-select');
        if (select) return; // handled by its own change listener

        var btn = e.target.closest('[data-qa]');
        if (!btn) return;

        if (btn.dataset.qa === 'take') {
            runQuickAction(box, group, 'take');
            return;
        }

        if (btn.dataset.qa === 'followup') {
            var input = box.querySelector('.notifier-qa-input');
            var text  = input ? input.value.trim() : '';
            if (!text) {
                if (input) input.focus();
                return;
            }
            runQuickAction(box, group, 'followup', { content: text }).then(function() {
                if (input) input.value = '';
            });
        }
    }

    // The select fires `change`, not `click`.
    document.addEventListener('change', function(e) {
        var select = e.target.closest ? e.target.closest('.notifier-qa-select') : null;
        if (!select || !select.value) return;

        var box     = select.closest('.notifier-qa');
        var groupLi = select.closest('.notifier-bell-group');
        if (!box || !groupLi) return;

        var key = groupLi.dataset.key;
        runQuickAction(box, {
            itemtype: key.substring(0, key.indexOf(':')),
            items_id: parseInt(key.substring(key.indexOf(':') + 1), 10)
        }, 'status', { status: select.value });

        select.value = '';
    });

    document.addEventListener('click', function(e) {
        if (!e.target.closest('.notifier-snooze-menu') && !e.target.closest('.notifier-bell-snooze')) {
            closeSnoozeMenu();
        }
    });

    // ------------------------------------------------------------------ polling

    // Keyed on what goes over the wire: deriving it from the loaded count
    // would change between request and response, so the ETag never matched.
    function feedKeyFor(limit, offset, search) {
        return search + '|' + limit + '|' + offset;
    }

    function fetchFeed(offset, limit, replace) {
        var params  = { limit: limit, offset: offset };
        if (state.search) params.q = state.search;

        var headers = {};
        var key     = feedKeyFor(limit, offset, state.search);
        // Only replay the ETag for the exact request that produced it.
        if (replace && feedEtag && feedKey === key) headers['If-None-Match'] = feedEtag;

        state.loading = true;
        var wasOffline = state.offline;

        return request('list.php', params, headers).then(function(response) {
            failedPolls   = 0;
            state.offline = false;

            if (response.status === 304) {
                idleFactor = Math.min(idleFactor * 1.5, MAX_IDLE_FACTOR);
                // Only the reconnected state is worth repainting.
                if (wasOffline) render();
                return null;
            }
            if (!response.ok) throw new Error('HTTP ' + response.status);

            if (replace) {
                feedEtag = response.headers.get('ETag');
                feedKey  = key;
            }

            return response.json();
        }).then(function(data) {
            if (!data) return;

            idleFactor = 1;

            state.unread       = data.unread || 0;
            state.unreadGroups = data.unread_groups || 0;
            state.total        = data.total || 0;

            if (data.notes) {
                state.notes    = data.notes;
                state.notesDue = data.notes_due || 0;
            }

            var incoming = data.items || [];
            if (replace) {
                state.items  = incoming;
                state.loaded = incoming.length;
            } else {
                state.items  = state.items.concat(incoming);
                state.loaded = state.items.length;
            }

            announceArrivals(state.items);
            announceDueNotes();
            render();
        }).catch(function() {
            failedPolls  += 1;
            state.offline = failedPolls >= 2;
            idleFactor = Math.min(idleFactor * 2, MAX_IDLE_FACTOR);
            render();
        }).then(function() {
            state.loading = false;
        });
    }

    function reload() {
        // Collapse concurrent callers, but remember the ask so a mark-read
        // is never dropped because a poll was running.
        if (pollInFlight) {
            reloadQueued = true;
            return Promise.resolve();
        }
        pollInFlight = true;

        // Re-request what is on screen so the list cannot shrink underfoot.
        var limit = Math.max(CFG.list_limit, state.loaded || 0);
        return fetchFeed(0, Math.min(limit, 100), true).then(function() {
            pollInFlight = false;
            if (reloadQueued) {
                reloadQueued = false;
                return reload();
            }
        });
    }

    function loadNextPage() {
        if (state.loading || state.loaded >= state.total) return;
        render();
        fetchFeed(state.loaded, CFG.list_limit, false).then(render);
    }

    function schedulePoll() {
        clearTimeout(pollTimer);

        // Resumes on visibilitychange.
        if (document.hidden) return;

        var delay = CFG.poll_interval * 1000 * idleFactor;
        pollTimer = setTimeout(function() {
            reload().then(schedulePoll);
        }, delay);
    }

    function startPolling() {
        reload().then(schedulePoll);

        document.addEventListener('visibilitychange', function() {
            if (document.hidden) {
                clearTimeout(pollTimer);
                return;
            }
            idleFactor = 1;
            reload().then(schedulePoll);
        });

        window.addEventListener('online', function() {
            idleFactor = 1;
            reload().then(schedulePoll);
        });
    }

    // ------------------------------------------------------------------ boot

    function applyBootstrap(data) {
        if (!data) return;

        if (data.token) TOKEN = data.token;
        if (data.i18n) {
            Object.keys(data.i18n).forEach(function(k) { T[k] = data.i18n[k]; });
        }
        if (data.config) {
            Object.keys(data.config).forEach(function(k) { CFG[k] = data.config[k]; });
        }
        if (data.preferences) state.prefs = data.preferences;
        if (data.events) EVENTS = data.events;
    }

    function boot() {
        BASE_URL  = resolveBaseUrl();
        baseTitle = document.title;

        request('boot.php').then(readJson).then(applyBootstrap).catch(function() {
            // English fallbacks and default config; the bell still works.
        }).then(function() {
            installBell();
            var bell = wrap();
            if (bell && isStoredCollapsed()) setCollapsed(bell, true);
            startPolling();
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot);
    } else {
        boot();
    }
})();
