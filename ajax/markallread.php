<?php

// Mutating: see markread.php.

use GlpiPlugin\Notifier\Endpoint;
use GlpiPlugin\Notifier\Notification;

if (!defined('GLPI_ROOT')) {
    include(dirname(__DIR__, 3) . '/inc/includes.php');
}

Endpoint::begin();
Endpoint::requireToken();

$users_id = Endpoint::currentUser();

$ok = Notification::markAllRead($users_id);

Endpoint::json([
    'success'       => $ok,
    'unread'        => Notification::countUnread($users_id),
    'unread_groups' => Notification::countUnreadGroups($users_id),
]);
