<?php

// ?save=1 upserts and needs the header token; plain GET just reads.

use GlpiPlugin\Notifier\Endpoint;
use GlpiPlugin\Notifier\Notification;

if (!defined('GLPI_ROOT')) {
    include(dirname(__DIR__, 3) . '/inc/includes.php');
}

Endpoint::begin();

$users_id = Endpoint::currentUser();

if (!empty($_GET['save'])) {
    Endpoint::requireToken();

    Notification::savePreferences($users_id, $_GET);

    Endpoint::json([
        'success'     => true,
        'preferences' => Notification::getPreferences($users_id),
    ]);
    return;
}

Endpoint::json([
    'preferences' => Notification::getPreferences($users_id),
]);
