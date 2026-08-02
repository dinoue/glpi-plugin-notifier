<?php

// The feed for the session user. Answers 304 when nothing that could
// affect the response has changed — the common case when polling.

use GlpiPlugin\Notifier\Config as NotifierConfig;
use GlpiPlugin\Notifier\Endpoint;
use GlpiPlugin\Notifier\Note;
use GlpiPlugin\Notifier\Notification;

if (!defined('GLPI_ROOT')) {
    include(dirname(__DIR__, 3) . '/inc/includes.php');
}

Endpoint::begin();

$users_id = Endpoint::currentUser();

$limit  = Endpoint::intParam('limit', NotifierConfig::get('list_limit'));
$limit  = max(1, min(100, $limit));
$offset = max(0, min(5000, Endpoint::intParam('offset', 0)));
$search = Endpoint::stringParam('q');

$signature = Notification::stateSignature($users_id);
$etag      = '"' . $signature . ':' . $limit . ':' . $offset . ':' . md5($search) . '"';

// The client replays the ETag itself; no-store keeps the browser from
// serving a stale body behind our back.
if (trim((string)($_SERVER['HTTP_IF_NONE_MATCH'] ?? '')) === $etag) {
    header('ETag: ' . $etag);
    http_response_code(304);
    exit;
}

header('ETag: ' . $etag);

$items = Notification::getForUser($users_id, $limit, $offset, $search);

Endpoint::json([
    'unread'        => Notification::countUnread($users_id),
    'unread_groups' => Notification::countUnreadGroups($users_id),
    'total'         => Notification::countVisible($users_id),
    'offset'        => $offset,
    'limit'         => $limit,
    'items'         => $items,
    // Small and personal, so they ride along with the feed rather than
    // costing a second poll.
    'notes'         => Note::getForUser($users_id),
    'notes_due'     => Note::countDue($users_id),
]);
