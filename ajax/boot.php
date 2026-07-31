<?php

// One round trip on page load, so the bell renders in-language on the
// first paint.

use GlpiPlugin\Notifier\Config as NotifierConfig;
use GlpiPlugin\Notifier\Endpoint;
use GlpiPlugin\Notifier\Notification;
use GlpiPlugin\Notifier\QuickAction;

if (!defined('GLPI_ROOT')) {
    include(dirname(__DIR__, 3) . '/inc/includes.php');
}

Endpoint::begin();

$users_id = Endpoint::currentUser();
$prefs    = Notification::getPreferences($users_id);

$statuses = [];
foreach (['Ticket', 'Change', 'Problem'] as $itemtype) {
    foreach (QuickAction::allowedStatuses($itemtype) as $id => $label) {
        $statuses[$itemtype][] = ['id' => $id, 'label' => $label];
    }
}

Endpoint::json([
    'token' => Endpoint::token(),

    'config' => [
        'poll_interval'         => NotifierConfig::get('poll_interval'),
        'list_limit'            => NotifierConfig::get('list_limit'),
        'quick_actions_enabled' => (bool)NotifierConfig::get('quick_actions_enabled'),
        'snooze_enabled'        => (bool)NotifierConfig::get('snooze_enabled'),
        'statuses'              => $statuses,
    ],

    'preferences' => $prefs,

    'events' => array_map(
        static fn(string $slug): array => [
            'slug'  => $slug,
            'label' => Notification::getEventLabel($slug),
        ],
        Notification::getEventSlugs()
    ),

    'i18n' => [
        'notifications'        => __('Notifications', 'notifier'),
        'markAllRead'          => __('Mark all as read', 'notifier'),
        'markAsRead'           => __('Mark as read', 'notifier'),
        'markAsUnread'         => __('Mark as unread', 'notifier'),
        'noNotifications'      => __('No notifications', 'notifier'),
        'noNotificationsHint'  => __("You're all caught up.", 'notifier'),
        'noResults'            => __('Nothing matches your search', 'notifier'),
        'noResultsHint'        => __('Try a different word, or clear the search box.', 'notifier'),
        'minimize'             => __('Minimize', 'notifier'),
        'expand'               => __('Expand notifications', 'notifier'),
        'tabAll'               => __('All', 'notifier'),
        'tabUnread'            => __('Unread', 'notifier'),
        'settings'             => __('Settings', 'notifier'),
        'preferencesTitle'     => __('Notification preferences', 'notifier'),
        'preferencesIntro'     => __('Choose which updates you want to receive. Direct updates are about items assigned to you; group updates are about items assigned to one of your groups.', 'notifier'),
        'colDirect'            => __('Assigned to me', 'notifier'),
        'colGroup'             => __('Assigned to my group', 'notifier'),
        'typeTicket'           => __('Tickets', 'notifier'),
        'typeChange'           => __('Changes', 'notifier'),
        'typeProblem'          => __('Problems', 'notifier'),
        'typeProjectTask'      => __('Project tasks', 'notifier'),
        'save'                 => __('Save', 'notifier'),
        'cancel'               => __('Cancel', 'notifier'),
        'saved'                => __('Preferences saved', 'notifier'),
        'close'                => __('Close', 'notifier'),
        'groupedUpdates'       => __('{n} updates', 'notifier'),
        'expandGroup'          => __('Show all updates', 'notifier'),
        'collapseGroup'        => __('Hide updates', 'notifier'),

        'search'               => __('Search', 'notifier'),
        'searchPlaceholder'    => __('Search notifications', 'notifier'),
        'clearSearch'          => __('Clear search', 'notifier'),
        'loadMore'             => __('Load more', 'notifier'),
        'loading'              => __('Loading', 'notifier'),
        'refresh'              => __('Refresh', 'notifier'),
        'offline'              => __('Reconnecting', 'notifier'),

        'snooze'               => __('Snooze', 'notifier'),
        'snooze1h'             => __('For 1 hour', 'notifier'),
        'snooze3h'             => __('For 3 hours', 'notifier'),
        'snoozeTomorrow'       => __('Until tomorrow morning', 'notifier'),
        'snoozed'              => __('Snoozed', 'notifier'),

        'quickActions'         => __('Quick actions', 'notifier'),
        'actionTake'           => __('Assign to me', 'notifier'),
        'actionStatus'         => __('Change status', 'notifier'),
        'actionFollowup'       => __('Reply', 'notifier'),
        'followupPlaceholder'  => __('Write a short reply…', 'notifier'),
        'send'                 => __('Send', 'notifier'),
        'actionDone'           => __('Done', 'notifier'),
        'actionFailed'         => __('That did not work', 'notifier'),
        'actionForbidden'      => __('You are not allowed to do that', 'notifier'),

        'sectionTypes'         => __('Which items', 'notifier'),
        'sectionEvents'        => __('Which events', 'notifier'),
        'sectionDelivery'      => __('How to be alerted', 'notifier'),
        'eventsIntro'          => __('Turn off the event types you never want to see in the bell.', 'notifier'),
        'desktopEnabled'       => __('Desktop notifications', 'notifier'),
        'desktopHint'          => __('Show a system notification when something new arrives. Your browser will ask for permission.', 'notifier'),
        'soundEnabled'         => __('Play a sound', 'notifier'),
        'soundHint'            => __('A short chime when a new notification arrives.', 'notifier'),
        'permissionDenied'     => __('Your browser blocked notifications for this site.', 'notifier'),

        'newNotification'      => __('New notification', 'notifier'),
        'andOthers'            => __('{name} and {n} others', 'notifier'),

        'tabNotes'             => __('Reminders', 'notifier'),
        'notePlaceholder'      => __('What still needs doing?', 'notifier'),
        'noteNew'              => __('New task', 'notifier'),
        'noteWhen'             => __('Remind me at', 'notifier'),
        'noteIn1h'             => __('In 1 hour', 'notifier'),
        'noteTomorrow'         => __('Tomorrow 9:00', 'notifier'),
        'noteAdd'              => __('Add', 'notifier'),
        'noteEmpty'            => __('Nothing on your list', 'notifier'),
        'noteEmptyHint'        => __('Jot something down and it will find you here.', 'notifier'),
        'noteDone'             => __('Mark as done', 'notifier'),
        'noteUndo'             => __('Not done yet', 'notifier'),
        'noteDelete'           => __('Delete', 'notifier'),
        'noteOverdue'          => __('Due', 'notifier'),
        'noteReminder'         => __('Reminder', 'notifier'),
    ],
]);
