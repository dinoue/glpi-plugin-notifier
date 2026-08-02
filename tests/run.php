<?php

/**
 * Dependency-free test runner: `php tests/run.php`.
 *
 * Covers the logic that can be exercised without a live GLPI — the
 * parsing, escaping and whitelisting that decide what reaches the
 * database and what reaches the browser.
 */

declare(strict_types=1);

require __DIR__ . '/bootstrap.php';

use GlpiPlugin\Notifier\Config as NotifierConfig;
use GlpiPlugin\Notifier\Endpoint;
use GlpiPlugin\Notifier\Mention;
use GlpiPlugin\Notifier\Note;
use GlpiPlugin\Notifier\Notification;
use GlpiPlugin\Notifier\QuickAction;
use GlpiPlugin\Notifier\Text;

$passed = 0;
$failed = [];
$currentGroup = '';

function group(string $name): void
{
    global $currentGroup;
    $currentGroup = $name;
    echo "\n" . $name . "\n";
}

function check(string $what, $actual, $expected): void
{
    global $passed, $failed, $currentGroup;

    if ($actual === $expected) {
        $passed++;
        echo "  ok   " . $what . "\n";
        return;
    }

    $failed[] = $currentGroup . ' :: ' . $what;
    echo "  FAIL " . $what . "\n";
    echo "       expected: " . var_export($expected, true) . "\n";
    echo "       actual:   " . var_export($actual, true) . "\n";
}

function checkTrue(string $what, $actual): void
{
    check($what, (bool)$actual, true);
}

function resetStatic(string $class, string $property, $value): void
{
    (new ReflectionProperty($class, $property))->setValue(null, $value);
}

// ---------------------------------------------------------------- Text

group('Text');

check(
    'strips markup from a rich-text body',
    Text::toPlain('<p>Hello <b>world</b></p>'),
    'Hello world'
);

check(
    'turns <br> into a newline',
    Text::toPlain('one<br>two'),
    "one\ntwo"
);

check(
    'decodes entities',
    Text::toPlain('caf&eacute; &amp; bar'),
    'café & bar'
);

check(
    'neutralises a script tag in quick-followup input',
    Text::toStoredHtml('<script>alert(1)</script>hello'),
    'alert(1)hello'
);

check(
    'html-encodes angle brackets that survive tag stripping',
    Text::toStoredHtml('5 > 3 and 2 < 4'),
    '5 &#62; 3 and 2 &#60; 4'
);

// Quotes are escaped for the database, not HTML-encoded. Harmless: every
// tag is already gone, so a bare quote in text content cannot open an
// attribute, and the core decodes it again on display.
check(
    'escapes quotes for storage',
    Text::toStoredHtml('say "hi"'),
    'say \\"hi\\"'
);

check(
    'collapses newlines into a single line',
    Text::toStoredHtml("line one\nline two"),
    'line one line two'
);

check(
    'rejects whitespace-only input',
    Text::toStoredHtml("   \n  "),
    ''
);

check(
    'strips an onerror payload along with its tag',
    Text::toStoredHtml('<img src=x onerror=alert(1)>'),
    ''
);

// ---------------------------------------------------------------- Mention

group('Mention');

$DB->fixtures['glpi_users'] = [];

check(
    'finds a GLPI native rich-text mention',
    Mention::extract('<p>hi <span data-user-mention="true" data-user-id="42">@Jane</span></p>'),
    [42]
);

check(
    'finds a native mention with the attributes reversed',
    Mention::extract('<span data-user-id="7" data-user-mention="true">@Bob</span>'),
    [7]
);

check(
    'deduplicates the same user mentioned twice',
    Mention::extract(
        '<span data-user-mention="true" data-user-id="5">@A</span>'
        . '<span data-user-mention="true" data-user-id="5">@A</span>'
    ),
    [5]
);

check(
    'ignores a span that is not a mention',
    Mention::extract('<span data-user-id="9">not a mention</span>'),
    []
);

check(
    'returns nothing for empty content',
    Mention::extract(''),
    []
);

$DB->fixtures['glpi_users'] = [['id' => 11], ['id' => 12]];

check(
    'resolves plain @logins against active users',
    Mention::extract('cc @jdoe and @asmith please'),
    [11, 12]
);

$lastQuery = $DB->queries[count($DB->queries) - 1];
check(
    'looks up logins in a single query',
    $lastQuery['WHERE']['name'],
    ['jdoe', 'asmith']
);
check(
    'excludes inactive accounts from the lookup',
    $lastQuery['WHERE']['is_active'],
    1
);
check(
    'excludes deleted accounts from the lookup',
    $lastQuery['WHERE']['is_deleted'],
    0
);

$DB->fixtures['glpi_users'] = [];
$before = count($DB->queries);
Mention::extract('mail me at john@example.com');
check(
    'does not treat an email address as a mention',
    count($DB->queries),
    $before
);

$DB->fixtures['glpi_users'] = [['id' => 3]];
check(
    'combines a native mention with a plain login',
    Mention::extract('<span data-user-mention="true" data-user-id="99">@X</span> and @jdoe'),
    [99, 3]
);

check(
    'reads the content field of an item',
    (static function () {
        $item = new Ticket();
        $item->fields['content'] = 'body text';
        return Mention::contentOf($item);
    })(),
    'body text'
);

check(
    'returns empty when an item carries no text',
    Mention::contentOf(new Ticket()),
    ''
);

// ---------------------------------------------------------------- Notification metadata

group('Notification');

$slugs = Notification::getEventSlugs();

check('exposes ten event types', count($slugs), 10);
checkTrue('includes the mention event', in_array('mention', $slugs, true));
checkTrue('includes the deadline event', in_array('deadline', $slugs, true));

$labelled = array_filter($slugs, static fn(string $s): bool => Notification::getEventLabel($s) !== $s);
check('every event has a human label', count($labelled), count($slugs));

$defaults = Notification::getDefaultPreferences();

foreach ($slugs as $slug) {
    checkTrue('default preference exists for ' . $slug, isset($defaults['notify_event_' . $slug]));
}

check('event preferences default to on', $defaults['notify_event_mention'], 1);
check('desktop notifications are opt-in', $defaults['desktop_enabled'], 0);
check('sound is opt-in', $defaults['sound_enabled'], 0);

// ---------------------------------------------------------------- Config

group('Config');

Config::$store = [];
resetStatic(NotifierConfig::class, 'cache', null);

$cfg = NotifierConfig::getAll();
check('retention defaults to 90 days', $cfg['retention_days'], 90);
check('poll interval defaults to 30 seconds', $cfg['poll_interval'], 30);
check('self-service gets a bell by default', $cfg['helpdesk_enabled'], 1);
check('mentions are on by default', $cfg['mentions_enabled'], 1);

foreach ($slugs as $slug) {
    checkTrue('event ' . $slug . ' is enabled by default', NotifierConfig::isEventEnabled($slug));
}

Config::$store = [];
resetStatic(NotifierConfig::class, 'cache', null);
NotifierConfig::save(['poll_interval' => 2, 'list_limit' => 5000, 'retention_days' => -4]);
resetStatic(NotifierConfig::class, 'cache', null);

check('poll interval is clamped up to its minimum', NotifierConfig::get('poll_interval'), 10);
check('list limit is clamped down to its maximum', NotifierConfig::get('list_limit'), 100);
check('retention cannot go negative', NotifierConfig::get('retention_days'), 0);

check(
    'an unchecked switch saves as zero',
    NotifierConfig::get('mentions_enabled'),
    0
);

Config::$store = ['plugin:notifier' => ['poll_interval' => 45]];
resetStatic(NotifierConfig::class, 'cache', null);
NotifierConfig::install();
resetStatic(NotifierConfig::class, 'cache', null);

check(
    'install leaves an existing setting alone',
    NotifierConfig::get('poll_interval'),
    45
);
check(
    'install fills in a setting that was missing',
    NotifierConfig::get('retention_days'),
    90
);

// ---------------------------------------------------------------- QuickAction

group('QuickAction');

checkTrue('supports tickets', QuickAction::supports('Ticket'));
checkTrue('supports changes', QuickAction::supports('Change'));
checkTrue('supports problems', QuickAction::supports('Problem'));
check('does not support project tasks', QuickAction::supports('ProjectTask'), false);
check('does not support an arbitrary class', QuickAction::supports('User'), false);

$statuses = QuickAction::allowedStatuses('Ticket');
checkTrue('offers the assigned status', isset($statuses[CommonITILObject::ASSIGNED]));
checkTrue('offers the pending status', isset($statuses[CommonITILObject::WAITING]));
check('refuses to set solved from the bell', isset($statuses[CommonITILObject::SOLVED]), false);
check('refuses to set closed from the bell', isset($statuses[CommonITILObject::CLOSED]), false);

check(
    'offers no statuses for an unsupported itemtype',
    QuickAction::allowedStatuses('ProjectTask'),
    []
);

check(
    'rejects an unknown itemtype before touching the database',
    QuickAction::loadWritable('User', 1),
    'unsupported_itemtype'
);

check(
    'rejects a non-positive id',
    QuickAction::loadWritable('Ticket', 0),
    'bad_request'
);

// ---------------------------------------------------------------- Endpoint

group('Endpoint');

$_GET = ['itemtype' => 'Ticket'];
check('accepts a whitelisted itemtype', Endpoint::itemtypeParam(), 'Ticket');

$_GET = ['itemtype' => 'User'];
check('rejects an itemtype outside the whitelist', Endpoint::itemtypeParam(), '');

$_GET = ['itemtype' => 'Ticket; DROP TABLE glpi_tickets'];
check('rejects an injection attempt in itemtype', Endpoint::itemtypeParam(), '');

$_GET = [];
check('returns empty when itemtype is absent', Endpoint::itemtypeParam(), '');

$_GET = ['id' => '42abc'];
check('coerces a numeric parameter', Endpoint::intParam('id'), 42);

$_GET = ['id' => ['array']];
check('refuses an array where an int is expected', Endpoint::intParam('id', -1), -1);

$_GET = [];
check('falls back to the default for a missing int', Endpoint::intParam('missing', 25), 25);

$_GET = ['q' => str_repeat('x', 500)];
check('truncates an oversized search term', strlen(Endpoint::stringParam('q')), 120);

$_GET = ['q' => '  padded  '];
check('trims a string parameter', Endpoint::stringParam('q'), 'padded');

$_GET = ['content' => ['a']];
check('refuses an array where a string is expected', Endpoint::stringParam('content'), '');

// Regression guard. stringParam() once un-escaped its input, which
// stripped the only SQL defence GLPI 10 applies to superglobals and made
// the ?q= search term injectable into the LIKE clause.
$_GET = ['q' => "O\\'Brien"];
check(
    'leaves core escaping intact on SQL-bound input',
    Endpoint::stringParam('q'),
    "O\\'Brien"
);

$_GET = ['q' => "a\\' OR 1=1 -- "];
check(
    'does not reconstitute a quote from an escaped payload',
    strpos(Endpoint::stringParam('q'), "\\'") !== false,
    true
);

// The followup path still needs plain text, so it decodes at the point
// of use rather than in the shared parameter reader.
check(
    'followup content is still decoded where it is consumed',
    Text::toStoredHtml("O\\'Brien"),
    "O\\'Brien"
);

// ---------------------------------------------------------------- Note

group('Note');

$DB->tables[] = 'glpi_plugin_notifier_notes';

check(
    'refuses an empty note',
    Note::add(1, '   ', null),
    false
);

check(
    'refuses a note that is only markup',
    Note::add(1, '<b></b>', null),
    false
);

check(
    'refuses a note for an anonymous user',
    Note::add(0, 'call Henk', null),
    false
);

$DB->rawQueries = [];
Note::add(1, 'call Henk at 15:00', 1893495600);
check(
    'writes an accepted note',
    in_array('INSERT glpi_plugin_notifier_notes', $DB->rawQueries, true),
    true
);

check(
    'caps note length at the column width',
    Note::MAX_LENGTH,
    255
);

check(
    'rejects a toggle without an id',
    Note::setDone(0, 1, true),
    false
);

check(
    'rejects a toggle without an owner',
    Note::setDone(5, 0, true),
    false
);

check(
    'rejects a delete without an owner',
    Note::remove(5, 0),
    false
);

// ---------------------------------------------------------------- summary

echo "\n" . str_repeat('-', 52) . "\n";

if (empty($failed)) {
    echo "All {$passed} assertions passed.\n";
    exit(0);
}

echo count($failed) . " failed, {$passed} passed:\n";
foreach ($failed as $name) {
    echo "  - {$name}\n";
}
exit(1);
