<?php

// Personal to-do list. Every note belongs to the session user and the
// ownership is part of every WHERE, so there is nothing to authorise
// beyond being logged in.

use GlpiPlugin\Notifier\Endpoint;
use GlpiPlugin\Notifier\Note;

if (!defined('GLPI_ROOT')) {
    include(dirname(__DIR__, 3) . '/inc/includes.php');
}

Endpoint::begin();
Endpoint::requireToken();

$users_id = Endpoint::currentUser();
$action   = Endpoint::stringParam('action', 16);

switch ($action) {
    case 'add':
        $remindTs = Endpoint::intParam('remind_ts');
        // A reminder more than a year out is a mistake, not a plan.
        if ($remindTs > 0 && abs($remindTs - time()) > 400 * DAY_TIMESTAMP) {
            Endpoint::fail('bad_remind_at', 400);
        }

        $link     = [];
        $itemtype = Endpoint::itemtypeParam();
        $items_id = Endpoint::intParam('items_id');
        if ($itemtype !== '' && $items_id > 0) {
            // Derived here, never taken from the client: a stored URL is a
            // redirect target the next time someone clicks the note.
            $link = [
                'itemtype' => $itemtype,
                'items_id' => $items_id,
                'url'      => $itemtype::getFormURLWithID($items_id, false),
            ];
        }

        $id = Note::add(
            $users_id,
            Endpoint::stringParam('content', Note::MAX_LENGTH),
            $remindTs > 0 ? $remindTs : null,
            $link
        );

        if ($id === false) {
            Endpoint::fail('rejected', 400);
        }
        break;

    case 'toggle':
        Note::setDone(Endpoint::intParam('id'), $users_id, (bool)Endpoint::intParam('done'));
        break;

    case 'seen':
        Note::markNotified(Endpoint::intParam('id'), $users_id);
        break;

    case 'delete':
        Note::remove(Endpoint::intParam('id'), $users_id);
        break;

    default:
        Endpoint::fail('unknown_action', 400);
}

Endpoint::json([
    'success' => true,
    'notes'   => Note::getForUser($users_id),
    'due'     => Note::countDue($users_id),
]);
