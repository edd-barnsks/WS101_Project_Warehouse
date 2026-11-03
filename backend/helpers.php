<?php
declare(strict_types=1);

/**
 * Thrown anywhere in the app to produce a JSON error response.
 * $headers are extra HTTP headers to send with it (e.g. WWW-Authenticate, Retry-After).
 */
final class HttpException extends RuntimeException
{
    public function __construct(
        public readonly int $status,
        string $message,
        public readonly array $details = [],
        public readonly array $headers = []
    ) {
        parent::__construct($message);
    }
}

// ---------------------------------------------------------------
// Config and database
// ---------------------------------------------------------------

function app_config(): array
{
    static $config = null;
    return $config ??= require __DIR__ . '/config.php';
}

function db(): PDO
{
    static $pdo = null;
    if ($pdo === null) {
        $d = app_config()['db'];
        $dsn = "mysql:host={$d['host']};port={$d['port']};dbname={$d['name']};charset={$d['charset']}";
        $options = [
            PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            // Real server-side prepared statements: values are sent separately from the SQL text,
            // so user input can never be parsed as SQL.
            PDO::ATTR_EMULATE_PREPARES   => false,
        ];
        // Belt and braces: refuse "stacked" queries (SELECT ...; DROP TABLE ...).
        if (defined('PDO::MYSQL_ATTR_MULTI_STATEMENTS')) {
            $options[PDO::MYSQL_ATTR_MULTI_STATEMENTS] = false;
        }
        $pdo = new PDO($dsn, $d['user'], $d['pass'], $options);
    }
    return $pdo;
}

/**
 * Prepares and runs a statement with positional (?) params.
 * RULE FOR THIS WHOLE CODEBASE: SQL text is only ever written out literally in the source.
 * Every value that comes from a request is passed in $params, never joined into the SQL string.
 */
function exec_stmt(string $sql, array $params = []): PDOStatement
{
    $stmt = db()->prepare($sql);
    foreach (array_values($params) as $i => $v) {
        $type = match (true) {
            is_int($v)  => PDO::PARAM_INT,
            is_null($v) => PDO::PARAM_NULL,
            is_bool($v) => PDO::PARAM_BOOL,
            default     => PDO::PARAM_STR,
        };
        $stmt->bindValue($i + 1, $v, $type);
    }
    $stmt->execute();
    return $stmt;
}

function fetch_all(string $sql, array $params = []): array
{
    return exec_stmt($sql, $params)->fetchAll();
}

function fetch_one(string $sql, array $params = []): ?array
{
    $row = exec_stmt($sql, $params)->fetch();
    return $row === false ? null : $row;
}

/** Runs INSERT/UPDATE/DELETE and returns the affected row count. */
function run(string $sql, array $params = []): int
{
    return exec_stmt($sql, $params)->rowCount();
}

/**
 * Runs $fn inside a DB transaction. Commits on success, rolls back on any error.
 */
function with_transaction(callable $fn): mixed
{
    $pdo = db();
    $pdo->beginTransaction();
    try {
        $result = $fn($pdo);
        $pdo->commit();
        return $result;
    } catch (Throwable $e) {
        if ($pdo->inTransaction()) {
            $pdo->rollBack();
        }
        throw $e;
    }
}

// ---------------------------------------------------------------
// Response
// ---------------------------------------------------------------

/** Headers sent on every response. Call once at the start of a web request. */
function send_api_headers(): void
{
    $config = app_config();

    header_remove('X-Powered-By');
    header('Content-Type: application/json; charset=utf-8');
    header('X-Content-Type-Options: nosniff');                       // browser must not guess "HTML" from JSON
    header("Content-Security-Policy: default-src 'none'; frame-ancestors 'none'");
    header('X-Frame-Options: DENY');
    header('Referrer-Policy: no-referrer');
    header('Cache-Control: no-store');                                // tokens and personal data are never cached
    header('Pragma: no-cache');
    if (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') {
        header('Strict-Transport-Security: max-age=31536000');
    }

    header('Access-Control-Allow-Origin: ' . $config['cors_origin']);
    header('Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS');
    header('Access-Control-Allow-Headers: Content-Type, Authorization');
    header('Access-Control-Max-Age: 600');
    if ($config['cors_origin'] !== '*') {
        header('Vary: Origin');
    }
}

function json_response(mixed $data, int $status = 200): never
{
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    // The HEX flags write < > & ' " inside strings as < > & ' ".
    // The JSON means exactly the same to any client, but the raw text can never contain
    // a usable <script> tag even if something displays it as HTML. (XSS defence in depth.)
    echo json_encode(
        $data,
        JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES
        | JSON_HEX_TAG | JSON_HEX_AMP | JSON_HEX_APOS | JSON_HEX_QUOT
        | JSON_THROW_ON_ERROR
    );
    exit;
}

// ---------------------------------------------------------------
// Request input
// ---------------------------------------------------------------

function json_input(): array
{
    $max = (int) app_config()['max_body_bytes'];

    if ((int) ($_SERVER['CONTENT_LENGTH'] ?? 0) > $max) {
        throw new HttpException(413, 'Request body is too large.');
    }
    $raw = file_get_contents('php://input', false, null, 0, $max + 1);
    if ($raw === false) {
        $raw = '';
    }
    if (strlen($raw) > $max) {
        throw new HttpException(413, 'Request body is too large.');
    }
    if (trim($raw) === '') {
        return [];
    }

    try {
        $data = json_decode($raw, true, 16, JSON_THROW_ON_ERROR);
    } catch (JsonException) {
        throw new HttpException(400, 'Request body must be valid JSON.');
    }
    if (!is_array($data) || ($data !== [] && array_is_list($data))) {
        throw new HttpException(400, 'Request body must be a JSON object.');
    }
    return $data;
}

/** A query-string value as a trimmed string, at most 200 characters ('' when missing or not a plain value). */
function query_str(string $key): string
{
    $v = $_GET[$key] ?? '';
    return is_string($v) ? mb_substr(trim($v), 0, 200) : '';
}

/** @return array{0:int,1:int} [limit, offset] from ?limit= and ?page= */
function page_params(): array
{
    $limit = filter_var($_GET['limit'] ?? 50, FILTER_VALIDATE_INT);
    $page  = filter_var($_GET['page'] ?? 1, FILTER_VALIDATE_INT);
    $limit = ($limit === false || $limit < 1) ? 50 : min($limit, 200);
    $page  = ($page === false || $page < 1) ? 1 : min($page, 1000000);
    return [$limit, ($page - 1) * $limit];
}

/**
 * Turns user text into a LIKE pattern that matches it literally ("100%" no longer means "100 then anything").
 * Use with:  column LIKE ? ESCAPE '!'
 */
function like_contains(string $text): string
{
    return '%' . str_replace(['!', '%', '_'], ['!!', '!%', '!_'], $text) . '%';
}

// ---------------------------------------------------------------
// Validation helpers (each throws a 422 HttpException on bad input)
// ---------------------------------------------------------------

/**
 * Plain text field. Rejects '<' and '>' (so HTML/script tags can never be stored)
 * and control characters. Output encoding in json_response() is a second layer.
 */
function str_field(array $in, string $key, int $max, bool $required = true): ?string
{
    $v = $in[$key] ?? null;
    if ($v === null || (is_string($v) && trim($v) === '')) {
        if ($required) {
            throw new HttpException(422, "$key is required.");
        }
        return null;
    }
    if (!is_string($v)) {
        throw new HttpException(422, "$key must be a string.");
    }
    $v = trim($v);
    if (mb_strlen($v) > $max) {
        throw new HttpException(422, "$key must be at most $max characters.");
    }
    if (preg_match('/[<>\x00-\x1F\x7F]/', $v)) {
        throw new HttpException(422, "$key must not contain < or > or control characters.");
    }
    return $v;
}

function int_field(array $in, string $key, int $min = 1, bool $required = true, int $max = 1000000): ?int
{
    $v = $in[$key] ?? null;
    if ($v === null || $v === '') {
        if ($required) {
            throw new HttpException(422, "$key is required.");
        }
        return null;
    }
    if (is_bool($v) || is_float($v) || is_array($v) || filter_var($v, FILTER_VALIDATE_INT) === false) {
        throw new HttpException(422, "$key must be a whole number.");
    }
    $n = (int) $v;
    if ($n < $min || $n > $max) {
        throw new HttpException(422, "$key must be between $min and $max.");
    }
    return $n;
}

/** A required positive ID (e.g. ProductID) from the JSON body. */
function id_field(array $in, string $key): int
{
    return int_field($in, $key, 1, true, 4294967295);
}

/** Money as a string with at most 2 decimals, e.g. "89.99". Kept as a string to avoid float errors. */
function money_field(array $in, string $key, bool $required = true): ?string
{
    $v = $in[$key] ?? null;
    if ($v === null || $v === '') {
        if ($required) {
            throw new HttpException(422, "$key is required.");
        }
        return null;
    }
    if (is_bool($v) || is_array($v)) {
        throw new HttpException(422, "$key must be a number.");
    }
    $s = is_float($v) ? rtrim(rtrim(sprintf('%.6F', $v), '0'), '.') : (string) $v;
    if (!preg_match('/^\d{1,10}(\.\d{1,2})?$/', $s)) {
        throw new HttpException(422, "$key must be a non-negative amount with at most 2 decimal places.");
    }
    return $s;
}

/** Login name: 3-50 letters, digits, dot, underscore or hyphen. Returned lowercase. */
function username_field(array $in, string $key = 'Username'): string
{
    $v = str_field($in, $key, 50);
    if (!preg_match('/^[A-Za-z0-9._-]{3,50}$/', $v)) {
        throw new HttpException(422, "$key must be 3-50 characters: letters, digits, dot, underscore or hyphen.");
    }
    return strtolower($v);
}

/** A new password. NOT trimmed (spaces are allowed). 8-72 bytes (bcrypt ignores anything past 72). */
function password_field(array $in, string $key): string
{
    $v = $in[$key] ?? null;
    if (!is_string($v) || $v === '') {
        throw new HttpException(422, "$key is required.");
    }
    if (strlen($v) < 8) {
        throw new HttpException(422, "$key must be at least 8 characters.");
    }
    if (strlen($v) > 72) {
        throw new HttpException(422, "$key must be at most 72 bytes.");
    }
    if (str_contains($v, "\0")) {
        throw new HttpException(422, "$key contains an invalid character.");
    }
    return $v;
}

function role_field(array $in, string $key = 'Role'): string
{
    $v = $in[$key] ?? null;
    if (!is_string($v) || !in_array($v, ['Admin', 'Staff'], true)) {
        throw new HttpException(422, "$key must be one of: Admin, Staff.");
    }
    return $v;
}

/** true/false (or 1/0) -> 1/0 */
function bool_field(array $in, string $key): int
{
    $v = $in[$key] ?? null;
    if ($v === true || $v === 1) {
        return 1;
    }
    if ($v === false || $v === 0) {
        return 0;
    }
    throw new HttpException(422, "$key must be true or false.");
}

/** Validates ?from= / ?to= style YYYY-MM-DD query parameters. */
function date_param(string $key): ?string
{
    $v = $_GET[$key] ?? null;
    if ($v === null || $v === '') {
        return null;
    }
    $d = is_string($v) ? DateTime::createFromFormat('!Y-m-d', $v) : false;
    if ($d === false || $d->format('Y-m-d') !== $v) {
        throw new HttpException(422, "$key must be a date in YYYY-MM-DD format.");
    }
    return $v;
}

// ---------------------------------------------------------------
// v3 helpers: money in whole cents, lists with totals, extra field types
// ---------------------------------------------------------------

/** "12.34" -> 1234. Only accepts what money_field() produces (digits with up to 2 decimals). */
function to_cents(string $money): int
{
    if (!preg_match('/^(\d{1,10})(?:\.(\d{1,2}))?$/', $money, $m)) {
        throw new InvalidArgumentException('Not a money amount.');
    }
    return (int) $m[1] * 100 + (int) str_pad($m[2] ?? '', 2, '0');
}

/** 1234 -> "12.34" */
function from_cents(int $cents): string
{
    return sprintf('%d.%02d', intdiv($cents, 100), $cents % 100);
}

/** "12.5" -> 1250 (hundredths of a percent). */
function rate_to_hundredths(string $rate): int
{
    if (!preg_match('/^(\d{1,3})(?:\.(\d{1,2}))?$/', $rate, $m)) {
        throw new InvalidArgumentException('Not a percentage.');
    }
    return (int) $m[1] * 100 + (int) str_pad($m[2] ?? '', 2, '0');
}

/** $cents x rate% rounded half-up to a whole cent. The front end uses the same rule, so totals match to the cent. */
function percent_of_cents(int $cents, int $rateHundredths): int
{
    return intdiv($cents * $rateHundredths + 5000, 10000);
}

/** A percentage 0..100 with up to 2 decimals, returned as text ("12.50"). */
function rate_field(array $in, string $key, bool $required = false): ?string
{
    $v = $in[$key] ?? null;
    if ($v === null || $v === '') {
        if ($required) {
            throw new HttpException(422, "$key is required.");
        }
        return null;
    }
    if (is_bool($v) || is_array($v)) {
        throw new HttpException(422, "$key must be a number from 0 to 100.");
    }
    $s = is_float($v) ? rtrim(rtrim(sprintf('%.6F', $v), '0'), '.') : (string) $v;
    if (!preg_match('/^(\d{1,3})(\.\d{1,2})?$/', $s) || rate_to_hundredths($s) > 10000) {
        throw new HttpException(422, "$key must be a number from 0 to 100 with at most 2 decimal places.");
    }
    return from_cents(rate_to_hundredths($s));   // same "x.yy" layout
}

/** Optional e-mail address. '' / null -> null. */
function email_field(array $in, string $key = 'Email', bool $required = false): ?string
{
    $v = str_field($in, $key, 120, $required);
    if ($v === null) {
        return null;
    }
    if (filter_var($v, FILTER_VALIDATE_EMAIL) === false) {
        throw new HttpException(422, "$key must be a valid e-mail address.");
    }
    return $v;
}

/** Product code: letters, digits and . _ - / ; 1-40 characters. Returned UPPERCASE. */
function sku_field(array $in, string $key = 'SKU', bool $required = true): ?string
{
    $v = str_field($in, $key, 40, $required);
    if ($v === null) {
        return null;
    }
    if (!preg_match('/^[A-Za-z0-9][A-Za-z0-9._\/-]{0,39}$/', $v)) {
        throw new HttpException(422, "$key may only contain letters, digits and . _ - / (up to 40 characters).");
    }
    return strtoupper($v);
}

/** Phone number: digits, spaces and + ( ) - . # ; 3-40 characters. Empty -> ''. */
function phone_field(array $in, string $key = 'Phone'): string
{
    $v = str_field($in, $key, 40, false) ?? '';
    if ($v !== '' && !preg_match('/^[0-9+().\-#\s]{3,40}$/', $v)) {
        throw new HttpException(422, "$key may only contain digits, spaces and + ( ) - . #");
    }
    return $v;
}

/** A whole-number query parameter such as ?staff_id=3 (null when absent). */
function id_param(string $key): ?int
{
    $v = query_str($key);
    if ($v === '') {
        return null;
    }
    if (!ctype_digit($v) || strlen($v) > 10) {
        throw new HttpException(422, "$key must be a whole number.");
    }
    return (int) $v;
}

/** "?x=a,b" style choice from a fixed list; '' when absent, 422 when not in the list. */
function enum_param(string $key, array $allowed): string
{
    $v = query_str($key);
    if ($v !== '' && !in_array($v, $allowed, true)) {
        throw new HttpException(422, "$key must be one of: " . implode(', ', $allowed) . '.');
    }
    return $v;
}

/** "?, ?, ?" for an IN (...) list. Contains only question marks, never request data. */
function placeholders(int $count): string
{
    if ($count < 1) {
        throw new InvalidArgumentException('Need at least one placeholder.');
    }
    return implode(',', array_fill(0, $count, '?'));
}

/**
 * Runs a list query and also counts the total, for paged tables.
 * $select, $from and $orderBy are fixed text written in the source code (never request data);
 * $where holds fixed fragments with ? placeholders and $params holds the bound values.
 * @return array{0:array,1:int,2:int,3:int} [rows, total, limit, page]
 */
function paged_query(string $select, string $from, array $where, array $params, string $orderBy): array
{
    [$limit, $offset] = page_params();
    $whereSql = $where ? ' WHERE ' . implode(' AND ', $where) : '';

    $total = (int) fetch_one("SELECT COUNT(*) AS n $from$whereSql", $params)['n'];
    $rows  = fetch_all("$select $from$whereSql ORDER BY $orderBy LIMIT ? OFFSET ?", [...$params, $limit, $offset]);

    return [$rows, $total, $limit, intdiv($offset, $limit) + 1];
}

/** The standard list response: {data, total, page, limit}. */
function list_response(array $rows, int $total, int $limit, int $page): never
{
    json_response(['data' => $rows, 'total' => $total, 'page' => $page, 'limit' => $limit]);
}

/** The caller's IP address for the audit log. Proxy headers are only believed when TRUST_PROXY=1. */
function client_ip(): string
{
    $ip = (string) ($_SERVER['REMOTE_ADDR'] ?? '');
    if (app_config()['trust_proxy'] && !empty($_SERVER['HTTP_X_FORWARDED_FOR'])) {
        $first = trim(explode(',', (string) $_SERVER['HTTP_X_FORWARDED_FOR'])[0]);
        if (filter_var($first, FILTER_VALIDATE_IP) !== false) {
            $ip = $first;
        }
    }
    return filter_var($ip, FILTER_VALIDATE_IP) !== false ? $ip : 'unknown';
}
