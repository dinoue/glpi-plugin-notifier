<?php

namespace GlpiPlugin\Notifier;

use Session;

/**
 * Shared plumbing for the ajax/ endpoints: JSON framing and CSRF.
 *
 * Mutating endpoints require a per-session secret in a custom header. No
 * form, image or prefetch can set one, and cross-origin fetch needs a
 * preflight we never answer. GLPI's own token is not usable here: GLPI 11
 * consumes it in Symfony before our code runs, and GLPI 10's single-use
 * tokens would force a round trip before every mark-as-read.
 */
class Endpoint
{
    public const TOKEN_HEADER = 'X-Notifier-Token';

    private const SESSION_KEY = 'plugin_notifier_token';
    private const SERVER_KEY  = 'HTTP_X_NOTIFIER_TOKEN';
    private const MAX_SEARCH  = 120;

    public static function begin(): void
    {
        header('Content-Type: application/json; charset=UTF-8');
        header('X-Content-Type-Options: nosniff');
        header('Cache-Control: no-store, private');
        header('Referrer-Policy: same-origin');

        Session::checkLoginUser();
    }

    public static function token(): string
    {
        if (empty($_SESSION[self::SESSION_KEY]) || !is_string($_SESSION[self::SESSION_KEY])) {
            $_SESSION[self::SESSION_KEY] = bin2hex(random_bytes(32));
        }
        return $_SESSION[self::SESSION_KEY];
    }

    /** Terminates the request with 403 when the header is absent or wrong. */
    public static function requireToken(): void
    {
        $site = $_SERVER['HTTP_SEC_FETCH_SITE'] ?? '';
        if ($site !== '' && !in_array($site, ['same-origin', 'none'], true)) {
            self::fail('cross_origin', 403);
        }

        $provided = $_SERVER[self::SERVER_KEY] ?? '';
        $expected = $_SESSION[self::SESSION_KEY] ?? '';

        if (
            !is_string($provided) || $provided === ''
            || !is_string($expected) || $expected === ''
            || !hash_equals($expected, $provided)
        ) {
            self::fail('invalid_token', 403);
        }
    }

    public static function json(array $payload): void
    {
        echo json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    }

    public static function fail(string $error, int $status = 400): void
    {
        http_response_code($status);
        echo json_encode(['success' => false, 'error' => $error]);
        exit;
    }

    public static function currentUser(): int
    {
        return (int)Session::getLoginUserID();
    }

    public static function intParam(string $name, int $default = 0): int
    {
        $raw = $_GET[$name] ?? $_POST[$name] ?? null;
        if ($raw === null || !is_scalar($raw)) {
            return $default;
        }
        return (int)$raw;
    }

    /**
     * Returned exactly as the core handed it over. GLPI 10 escapes
     * superglobals and its query builder does not escape again, so
     * un-escaping here would strip the only SQL defence in place.
     * Callers needing plain text decode at the point of use.
     */
    public static function stringParam(string $name, int $maxLength = self::MAX_SEARCH): string
    {
        $raw = $_GET[$name] ?? $_POST[$name] ?? '';
        if (!is_scalar($raw)) {
            return '';
        }
        return mb_substr(trim((string)$raw), 0, $maxLength);
    }

    public static function itemtypeParam(string $name = 'itemtype'): string
    {
        $raw = (string)($_GET[$name] ?? $_POST[$name] ?? '');
        return in_array($raw, ['Ticket', 'Change', 'Problem', 'ProjectTask'], true) ? $raw : '';
    }
}
