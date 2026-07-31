<?php

namespace GlpiPlugin\Notifier;

/**
 * Rich-text helpers that survive the GLPI 10 -> 11 sanitizer change.
 * GLPI 10 escapes every superglobal and expects the same encoding back
 * on write; GLPI 11 dropped that and stores raw.
 */
class Text
{
    private const SANITIZER = 'Glpi\\Toolbox\\Sanitizer';

    /** Present on GLPI 10, dropped in GLPI 11. */
    public static function hasSanitizer(): bool
    {
        return class_exists(self::SANITIZER);
    }

    public static function unsanitize(string $value): string
    {
        if (self::hasSanitizer() && method_exists(self::SANITIZER, 'unsanitize')) {
            return (string)call_user_func([self::SANITIZER, 'unsanitize'], $value);
        }
        return $value;
    }

    public static function sanitize(string $value): string
    {
        if (self::hasSanitizer() && method_exists(self::SANITIZER, 'sanitize')) {
            return (string)call_user_func([self::SANITIZER, 'sanitize'], $value);
        }
        return $value;
    }

    public static function toPlain(string $raw): string
    {
        $value = self::unsanitize($raw);
        $value = preg_replace('/<br\s*\/?>/i', "\n", $value) ?? $value;
        $value = preg_replace('#</p\s*>#i', "\n", $value) ?? $value;
        $value = strip_tags($value);
        $value = html_entity_decode($value, ENT_QUOTES | ENT_HTML5, 'UTF-8');
        return trim($value);
    }

    /**
     * User-supplied text -> content safe to store on an ITIL object.
     * Tags are stripped rather than filtered: the quick followup is a
     * one-line box, not an editor.
     */
    public static function toStoredHtml(string $rawInput): string
    {
        $plain = self::unsanitize($rawInput);
        $plain = strip_tags($plain);
        $plain = html_entity_decode($plain, ENT_QUOTES | ENT_HTML5, 'UTF-8');
        $plain = trim((string)preg_replace('/\s*\R\s*/u', ' ', $plain));

        if ($plain === '') {
            return '';
        }

        // Exactly one encoder: GLPI 10's sanitizer encodes on the way in,
        // so encoding here too would double-encode on display.
        return self::hasSanitizer()
            ? self::sanitize($plain)
            : htmlspecialchars($plain, ENT_QUOTES, 'UTF-8');
    }
}
