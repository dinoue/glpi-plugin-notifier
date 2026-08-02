<?php

/**
 * Minimal GLPI stand-ins so the plugin's pure logic can be tested with
 * nothing but a PHP binary. Only the surface the plugin actually touches
 * is stubbed — this is a test scaffold, not a GLPI emulator.
 */

declare(strict_types=1);

if (!defined('UPDATE')) {
    define('READ', 1);
    define('UPDATE', 2);
    define('CREATE', 4);
    define('DELETE', 8);
    define('PURGE', 16);
}

if (!defined('MINUTE_TIMESTAMP')) {
    define('MINUTE_TIMESTAMP', 60);
    define('HOUR_TIMESTAMP', 3600);
    define('DAY_TIMESTAMP', 86400);
}

// The plugin ships translatable strings; tests only care about the
// identity mapping.
function __(string $text, string $domain = ''): string
{
    return $text;
}

function _n(string $singular, string $plural, int $number, string $domain = ''): string
{
    return $number > 1 ? $plural : $singular;
}

function _sx(string $context, string $text, string $domain = ''): string
{
    return $text;
}

function htmlescape(?string $string): string
{
    return htmlspecialchars($string ?? '', ENT_QUOTES, 'UTF-8');
}

class CommonDBTM
{
    public array $fields = [];
    public array $updates = [];

    public static function getType(): string
    {
        return static::class;
    }

    public static function getTable($classname = null): string
    {
        return 'glpi_' . strtolower(static::class) . 's';
    }

    public function getFromDB($id): bool
    {
        return false;
    }
}

class CommonITILObject extends CommonDBTM
{
    const INCOMING = 1;
    const ASSIGNED = 2;
    const PLANNED  = 3;
    const WAITING  = 4;
    const SOLVED   = 5;
    const CLOSED   = 6;

    public static function getAllStatusArray($withmetaforsearch = false): array
    {
        return [
            self::INCOMING => 'New',
            self::ASSIGNED => 'Processing (assigned)',
            self::PLANNED  => 'Processing (planned)',
            self::WAITING  => 'Pending',
            self::SOLVED   => 'Solved',
            self::CLOSED   => 'Closed',
        ];
    }

    public static function getSolvedStatusArray(): array
    {
        return [self::SOLVED];
    }

    public static function getClosedStatusArray(): array
    {
        return [self::CLOSED];
    }

    public static function getFormURLWithID($id, $full = true): string
    {
        return '/front/' . strtolower(static::class) . '.form.php?id=' . (int)$id;
    }
}

class Ticket extends CommonITILObject
{
}

class Change extends CommonITILObject
{
}

class Problem extends CommonITILObject
{
}

class ProjectTask extends CommonDBTM
{
}

class ITILFollowup extends CommonDBTM
{
}

class CronTask
{
    const MODE_EXTERNAL = 2;
    const STATE_WAITING = 1;

    public int $volume = 0;

    public function addVolume(int $volume): void
    {
        $this->volume += $volume;
    }
}

class Session
{
    public static $userId = 7;

    public static function getLoginUserID($force = true)
    {
        return self::$userId;
    }
}

class Toolbox
{
    public static function substr($str, $start, $length = null)
    {
        return $length === null ? mb_substr($str, $start) : mb_substr($str, $start, $length);
    }

    public static function logInFile($name, $text, $force = false): void
    {
        // no-op in tests
    }
}

class QueryExpression
{
    private string $expression;

    public function __construct(string $expression)
    {
        $this->expression = $expression;
    }

    public function __toString(): string
    {
        return $this->expression;
    }
}

/** GLPI's global config store. */
class Config
{
    public static array $store = [];

    public static function getConfigurationValues(string $context, array $names = []): array
    {
        return self::$store[$context] ?? [];
    }

    public static function setConfigurationValues(string $context, array $values): void
    {
        self::$store[$context] = array_merge(self::$store[$context] ?? [], $values);
    }

    public static function deleteConfigurationValues(string $context, array $names): void
    {
        foreach ($names as $name) {
            unset(self::$store[$context][$name]);
        }
    }
}

/** GLPI's iterator is both foreach-able and has current(). */
class FakeResult implements IteratorAggregate, Countable
{
    private array $rows;

    public function __construct(array $rows)
    {
        $this->rows = $rows;
    }

    public function getIterator(): Iterator
    {
        return new ArrayIterator($this->rows);
    }

    public function current()
    {
        return $this->rows[0] ?? null;
    }

    public function count(): int
    {
        return count($this->rows);
    }
}

/**
 * Records every query and answers from a fixture table keyed by the
 * FROM clause, which is all the code under test distinguishes.
 */
class FakeDB
{
    public array $queries = [];
    public array $rawQueries = [];
    public array $fixtures = [];
    public array $tables = [];
    public array $fields = [];

    public function request(array $criteria): FakeResult
    {
        $this->queries[] = $criteria;
        $from = $criteria['FROM'] ?? '';
        return new FakeResult($this->fixtures[$from] ?? []);
    }

    public function doQuery(string $sql): bool
    {
        $this->rawQueries[] = $sql;
        return true;
    }

    public function tableExists(string $table): bool
    {
        return in_array($table, $this->tables, true);
    }

    public function fieldExists(string $table, string $field): bool
    {
        return in_array($table . '.' . $field, $this->fields, true);
    }

    public function quoteName(string $name): string
    {
        return '`' . str_replace('`', '', $name) . '`';
    }

    public function quoteValue($value): string
    {
        if ($value === null) {
            return 'NULL';
        }
        if (is_int($value) || is_float($value)) {
            return (string)$value;
        }
        return "'" . addslashes((string)$value) . "'";
    }

    public function insert(string $table, array $row): bool
    {
        $this->rawQueries[] = 'INSERT ' . $table;
        return true;
    }

    public function insertId(): int
    {
        return 1;
    }

    public function update(string $table, array $set, array $where): bool
    {
        $this->rawQueries[] = 'UPDATE ' . $table;
        return true;
    }

    public function delete(string $table, array $where): bool
    {
        $this->rawQueries[] = 'DELETE ' . $table;
        return true;
    }

    public function affectedRows(): int
    {
        return 0;
    }
}

$DB = new FakeDB();

// GLPI 10 escapes every superglobal on the way in and un-escapes on the
// way out. Its presence is what Text::hasSanitizer() keys off, so the
// suite exercises the GLPI 10 path — the one where stripping this
// escaping before a query would be a SQL injection.
spl_autoload_register(static function (string $class): void {
    if ($class !== 'Glpi\\Toolbox\\Sanitizer') {
        return;
    }
    eval('
        namespace Glpi\\Toolbox;
        class Sanitizer
        {
            public static function sanitize($value, $db_escape = true)
            {
                $value = str_replace(["&", "<", ">"], ["&#38;", "&#60;", "&#62;"], (string)$value);
                return $db_escape ? addslashes($value) : $value;
            }

            public static function unsanitize($value)
            {
                $value = stripslashes((string)$value);
                return str_replace(["&#38;", "&#60;", "&#62;"], ["&", "<", ">"], $value);
            }
        }
    ');
});

spl_autoload_register(static function (string $class): void {
    $prefix = 'GlpiPlugin\\Notifier\\';
    if (!str_starts_with($class, $prefix)) {
        return;
    }
    $file = __DIR__ . '/../src/' . str_replace('\\', '/', substr($class, strlen($prefix))) . '.php';
    if (is_file($file)) {
        require_once $file;
    }
});
