<?php

// Mutating: needs the header token from boot.php. See Endpoint for why
// this is not GLPI's own token.

use GlpiPlugin\Notifier\Endpoint;
use GlpiPlugin\Notifier\Notification;

if (!defined('GLPI_ROOT')) {
    include(dirname(__DIR__, 3) . '/inc/includes.php');
}

Endpoint::begin();
Endpoint::requireToken();

$users_id = Endpoint::currentUser();
$id       = Endpoint::intParam('id');

$ok = Notification::markRead($id, $users_id);

Endpoint::json([
    'success'       => $ok,
    'unread'        => Notification::countUnread($users_id),
    'unread_groups' => Notification::countUnreadGroups($users_id),
]);
