<?php

// Notifier — instance-wide settings. Reachable from Setup > Plugins.

use GlpiPlugin\Notifier\Config as NotifierConfig;

if (!defined('GLPI_ROOT')) {
    include(dirname(__DIR__, 3) . '/inc/includes.php');
}

Session::checkRight('config', UPDATE);

if (isset($_POST['update'])) {
    // GLPI 11 routes legacy plugin files through Symfony, whose
    // CheckCsrfListener has already validated and consumed the token;
    // checking again here would fail on a token that no longer exists.
    if (version_compare(GLPI_VERSION, '11.0', '<')) {
        Session::checkCSRF($_POST);
    }

    NotifierConfig::save($_POST);
    Session::addMessageAfterRedirect(__('Settings saved', 'notifier'), false, INFO);
    Html::back();
}

Html::header(
    __('Notifier - In-app notifications', 'notifier'),
    $_SERVER['PHP_SELF'],
    'config',
    'plugins'
);

NotifierConfig::showForm();

Html::footer();
