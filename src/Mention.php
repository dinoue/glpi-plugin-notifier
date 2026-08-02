<?php

namespace GlpiPlugin\Notifier;

/**
 * Resolves @-mentions out of an ITIL rich-text field. GLPI 10.0.7+ writes
 * editor mentions as a data-user-mention span; anything typed by hand,
 * pasted or arriving over the API is matched as a plain @login.
 */
class Mention
{
    // Logins, not display names: display names contain spaces and collide.
    private const LOGIN_PATTERN = '/(?<![\w@.\-])@([A-Za-z0-9._\-]{2,64})/';

    /** @return array<int, int> user ids, deduplicated */
    public static function extract(string $rawContent): array
    {
        if ($rawContent === '') {
            return [];
        }

        $content = Text::unsanitize($rawContent);
        $ids     = self::fromMarkup($content);

        foreach (self::fromLogins($content) as $id) {
            $ids[$id] = $id;
        }

        return array_values($ids);
    }

    /** @return array<int, int> */
    private static function fromMarkup(string $content): array
    {
        $ids = [];

        if (stripos($content, 'data-user-mention') === false) {
            return $ids;
        }
        if (!preg_match_all('/<span\b[^>]*>/i', $content, $tags)) {
            return $ids;
        }

        // Match the whole tag: attribute order is not guaranteed.
        foreach ($tags[0] as $tag) {
            if (stripos($tag, 'data-user-mention') === false) {
                continue;
            }
            if (preg_match('/data-user-id\s*=\s*["\']?(\d+)/i', $tag, $m)) {
                $id = (int)$m[1];
                if ($id > 0) {
                    $ids[$id] = $id;
                }
            }
        }

        return $ids;
    }

    /** @return array<int, int> */
    private static function fromLogins(string $content): array
    {
        global $DB;

        $plain = strip_tags(preg_replace('/<br\s*\/?>/i', ' ', $content) ?? $content);
        $plain = html_entity_decode($plain, ENT_QUOTES | ENT_HTML5, 'UTF-8');

        if (!preg_match_all(self::LOGIN_PATTERN, $plain, $matches)) {
            return [];
        }

        $logins = array_values(array_unique($matches[1]));
        if (empty($logins)) {
            return [];
        }

        $rs = $DB->request([
            'SELECT' => ['id'],
            'FROM'   => 'glpi_users',
            'WHERE'  => [
                'name'       => $logins,
                'is_active'  => 1,
                'is_deleted' => 0,
            ],
        ]);

        $ids = [];
        foreach ($rs as $row) {
            $id = (int)$row['id'];
            if ($id > 0) {
                $ids[$id] = $id;
            }
        }

        return $ids;
    }

    public static function contentOf(\CommonDBTM $item): string
    {
        foreach (['content', 'comment'] as $field) {
            if (!empty($item->fields[$field]) && is_string($item->fields[$field])) {
                return $item->fields[$field];
            }
        }
        return '';
    }
}
