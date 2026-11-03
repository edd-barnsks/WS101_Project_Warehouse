<?php
declare(strict_types=1);

return [
    'db' => [
        'host'    => getenv('DB_HOST') ?: '127.0.0.1',
        'port'    => getenv('DB_PORT') ?: '3306',
        'name'    => getenv('DB_NAME') ?: 'warehouse_inventory',
        'user'    => getenv('DB_USER') ?: 'root',
        'pass'    => getenv('DB_PASS') ?: '',
        'charset' => 'utf8mb4',
    ],

    'debug' => (getenv('APP_DEBUG') ?: '0') === '1',
    'cors_origin' => getenv('CORS_ORIGIN') ?: '*',
    'token_ttl' => max(300, (int) (getenv('TOKEN_TTL') ?: 28800)),
    'max_failed_logins' => 5,
    'lockout_seconds'   => 900,
    'max_body_bytes' => 65536,
    'vat_rate' => (function (): string {
        $v = getenv('VAT_RATE');
        return ($v !== false && preg_match('/^(100(\.0{1,2})?|\d{1,2}(\.\d{1,2})?)$/', $v)) ? $v : '12.00';
    })(),

    'rack_slots' => 12,
    'trust_proxy' => (getenv('TRUST_PROXY') ?: '0') === '1',
];
