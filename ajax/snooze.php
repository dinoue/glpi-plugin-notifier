<?php

// Hide one notification, or every unread one for an item, until later.

use GlpiPlugin\Notifier\Config as NotifierConfig;
use GlpiPlugin\Notifier\Endpoint;
use GlpiPlugin\Notifier\Notification;

if (!defined('GLPI_ROOT')) {
    include(dirname(__DIR__, 3) . '/inc/includes.php');
}

Endpoint::begin();
Endpoint::requireToken();

if (!NotifierConfig::get('snooze_enabled')) {
    Endpoint::fail('disabled', 403);
}

$users_id = Endpoint::currentUser();

// A week is the ceiling: past that, snoozing is really ignoring.
$minutes = max(1, min(10080, Endpoint::intParam('minutes')));

$itemtype = Endpoint::itemtypeParam();
$items_id = Endpoint::intParam('items_id');
$id       = Endpoint::intParam('id');

if ($itemtype !== '' && $items_id > 0) {
    $ok = Notification::snoozeItem($users_id, $itemtype, $items_id, $minutes);
} elseif ($id > 0) {
    $ok = Notification::snooze($id, $users_id, $minutes);
} else {
    Endpoint::fail('bad_request', 400);
}

Endpoint::json([
    'success'       => $ok,
    'unread'        => Notification::countUnread($users_id),
    'unread_groups' => Notification::countUnreadGroups($users_id),
]);
