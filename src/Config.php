<?php

namespace GlpiPlugin\Notifier;

use Config as GlpiConfig;
use Html;
use Session;

/**
 * Instance-wide settings, stored in glpi_configs under the
 * `plugin:notifier` context so uninstall is a single delete.
 */
class Config
{
    public const CONTEXT = 'plugin:notifier';

    private static ?array $cache = null;

    public static function getDefaults(): array
    {
        $defaults = [
            // 0 disables the purge entirely.
            'retention_days'        => 90,
            'poll_interval'         => 30,
            'list_limit'            => 25,
            'helpdesk_enabled'      => 1,
            'mentions_enabled'      => 1,
            'quick_actions_enabled' => 1,
            'snooze_enabled'        => 1,
            'deadline_enabled'      => 1,
            'deadline_lead_minutes' => 60,
        ];

        foreach (Notification::getEventSlugs() as $slug) {
            $defaults['event_' . $slug . '_enabled'] = 1;
        }

        return $defaults;
    }

    /** Applied on save and on read, so a hand-edited row cannot break the UI. */
    private const RANGES = [
        'retention_days'        => [0, 3650],
        'poll_interval'         => [10, 600],
        'list_limit'            => [5, 100],
        'deadline_lead_minutes' => [5, 10080],
    ];

    public static function getAll(): array
    {
        if (self::$cache !== null) {
            return self::$cache;
        }

        $values = self::getDefaults();

        $stored = GlpiConfig::getConfigurationValues(self::CONTEXT);
        foreach ($values as $key => $default) {
            if (array_key_exists($key, $stored) && $stored[$key] !== null && $stored[$key] !== '') {
                $values[$key] = self::clamp($key, (int)$stored[$key]);
            }
        }

        return self::$cache = $values;
    }

    public static function get(string $key): int
    {
        $all = self::getAll();
        return $all[$key] ?? 0;
    }

    public static function isEventEnabled(string $slug): bool
    {
        return (bool)self::get('event_' . $slug . '_enabled');
    }

    private static function clamp(string $key, int $value): int
    {
        if (!isset(self::RANGES[$key])) {
            return $value ? 1 : 0;
        }
        [$min, $max] = self::RANGES[$key];
        return max($min, min($max, $value));
    }

    public static function save(array $input): void
    {
        $values = [];
        foreach (self::getDefaults() as $key => $default) {
            if (isset(self::RANGES[$key])) {
                $values[$key] = self::clamp($key, (int)($input[$key] ?? $default));
            } else {
                $values[$key] = !empty($input[$key]) ? 1 : 0;
            }
        }

        GlpiConfig::setConfigurationValues(self::CONTEXT, $values);
        self::$cache = null;
    }

    // Only fills gaps: re-running install must not reset an admin's choices.
    public static function install(): void
    {
        $stored  = GlpiConfig::getConfigurationValues(self::CONTEXT);
        $missing = [];
        foreach (self::getDefaults() as $key => $default) {
            if (!array_key_exists($key, $stored)) {
                $missing[$key] = $default;
            }
        }
        if (!empty($missing)) {
            GlpiConfig::setConfigurationValues(self::CONTEXT, $missing);
        }
        self::$cache = null;
    }

    public static function uninstall(): void
    {
        GlpiConfig::deleteConfigurationValues(self::CONTEXT, array_keys(self::getDefaults()));
        self::$cache = null;
    }

    // ------------------------------------------------------------------ form

    public static function getTypeName($nb = 0): string
    {
        return __('Notifier', 'notifier');
    }

    public static function getConfigPageURL(): string
    {
        return \Plugin::getWebDir('notifier') . '/front/config.form.php';
    }

    public static function showForm(): void
    {
        $cfg = self::getAll();

        echo '<form name="notifier-config" method="post" action="'
            . htmlescape(self::getConfigPageURL()) . '">';
        echo '<div class="card notifier-config-card">';
        echo '<div class="card-body">';

        echo '<h3 class="card-title">' . htmlescape(__('Notification bell settings', 'notifier')) . '</h3>';

        echo '<table class="tab_cadre_fixe notifier-config-table">';

        echo '<tr class="tab_bg_1"><th colspan="2">'
            . htmlescape(__('General', 'notifier')) . '</th></tr>';

        self::numberRow(
            'poll_interval',
            __('Polling interval (seconds)', 'notifier'),
            $cfg['poll_interval'],
            self::RANGES['poll_interval'],
            __('How often an open page checks for new notifications. Hidden tabs pause automatically.', 'notifier')
        );

        self::numberRow(
            'list_limit',
            __('Notifications per page', 'notifier'),
            $cfg['list_limit'],
            self::RANGES['list_limit'],
            __('Size of one batch in the panel. Users can load more.', 'notifier')
        );

        self::numberRow(
            'retention_days',
            __('Retention (days)', 'notifier'),
            $cfg['retention_days'],
            self::RANGES['retention_days'],
            __('Read notifications older than this are purged by the NotifierCleanup cron task. 0 keeps everything.', 'notifier')
        );

        self::boolRow(
            'helpdesk_enabled',
            __('Show the bell in the self-service interface', 'notifier'),
            $cfg['helpdesk_enabled'],
            __('On by default. Turn this off to limit the bell to the central (technician) interface.', 'notifier')
        );

        echo '<tr class="tab_bg_1"><th colspan="2">'
            . htmlescape(__('Features', 'notifier')) . '</th></tr>';

        self::boolRow(
            'mentions_enabled',
            __('Enable @-mentions', 'notifier'),
            $cfg['mentions_enabled'],
            __('Naming a user in a followup, task or solution notifies them even when they are not an actor on the item.', 'notifier')
        );

        self::boolRow(
            'quick_actions_enabled',
            __('Enable quick actions', 'notifier'),
            $cfg['quick_actions_enabled'],
            __('Take the item, change its status or post a followup straight from the bell. Every action is rights-checked.', 'notifier')
        );

        self::boolRow(
            'snooze_enabled',
            __('Enable snooze', 'notifier'),
            $cfg['snooze_enabled'],
            __('Lets users hide a notification until later instead of marking it read.', 'notifier')
        );

        self::boolRow(
            'deadline_enabled',
            __('Enable deadline notifications', 'notifier'),
            $cfg['deadline_enabled'],
            __('The NotifierDeadline cron task warns assignees before and after the resolution deadline is reached.', 'notifier')
        );

        self::numberRow(
            'deadline_lead_minutes',
            __('Deadline warning lead time (minutes)', 'notifier'),
            $cfg['deadline_lead_minutes'],
            self::RANGES['deadline_lead_minutes'],
            __('How long before time to resolve the first warning fires.', 'notifier')
        );

        echo '<tr class="tab_bg_1"><th colspan="2">'
            . htmlescape(__('Event types', 'notifier')) . '</th></tr>';
        echo '<tr class="tab_bg_1"><td colspan="2" class="notifier-config-hint">'
            . htmlescape(__('Turn an event off here and it is never recorded for anyone. Users can additionally opt out per event in their own preferences.', 'notifier'))
            . '</td></tr>';

        foreach (Notification::getEventSlugs() as $slug) {
            self::boolRow(
                'event_' . $slug . '_enabled',
                Notification::getEventLabel($slug),
                $cfg['event_' . $slug . '_enabled'],
                ''
            );
        }

        echo '<tr class="tab_bg_2"><td colspan="2" class="center">';
        echo '<button type="submit" name="update" class="btn btn-primary">'
            . htmlescape(_sx('button', 'Save')) . '</button>';
        echo '</td></tr>';

        echo '</table>';
        echo '</div></div>';

        Html::closeForm();
    }

    private static function numberRow(string $name, string $label, int $value, array $range, string $hint): void
    {
        [$min, $max] = $range;
        echo '<tr class="tab_bg_1">';
        echo '<td><label for="notifier-' . htmlescape($name) . '">' . htmlescape($label) . '</label>';
        if ($hint !== '') {
            echo '<div class="notifier-config-hint">' . htmlescape($hint) . '</div>';
        }
        echo '</td>';
        echo '<td><input type="number" class="form-control" style="max-width:160px"'
            . ' id="notifier-' . htmlescape($name) . '"'
            . ' name="' . htmlescape($name) . '"'
            . ' value="' . htmlescape((string)$value) . '"'
            . ' min="' . (int)$min . '" max="' . (int)$max . '"></td>';
        echo '</tr>';
    }

    private static function boolRow(string $name, string $label, int $value, string $hint): void
    {
        echo '<tr class="tab_bg_1">';
        echo '<td><label for="notifier-' . htmlescape($name) . '">' . htmlescape($label) . '</label>';
        if ($hint !== '') {
            echo '<div class="notifier-config-hint">' . htmlescape($hint) . '</div>';
        }
        echo '</td>';
        echo '<td><label class="form-check form-switch">'
            . '<input type="checkbox" class="form-check-input"'
            . ' id="notifier-' . htmlescape($name) . '"'
            . ' name="' . htmlescape($name) . '" value="1"'
            . ($value ? ' checked' : '') . '></label></td>';
        echo '</tr>';
    }
}
