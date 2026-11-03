<?php
declare(strict_types=1);

if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit;
}

require __DIR__ . '/helpers.php';
require __DIR__ . '/auth.php';

$username = strtolower(trim($argv[1] ?? ''));
$fullName = trim($argv[2] ?? '');

if (!preg_match('/^[a-z0-9._-]{3,50}$/', $username) || $fullName === '' || mb_strlen($fullName) > 100
    || preg_match('/[<>\x00-\x1F\x7F]/', $fullName)) {
    fwrite(STDERR, "Usage: php create_admin.php <username> \"<Full Name>\"\n"
        . "  username: 3-50 characters, letters/digits/dot/underscore/hyphen\n");
    exit(1);
}

fwrite(STDOUT, "Password for $username (8-72 characters; what you type is visible): ");
$password = rtrim((string) fgets(STDIN), "\r\n");

if (strlen($password) < 8 || strlen($password) > 72) {
    fwrite(STDERR, "Password must be 8-72 characters.\n");
    exit(1);
}
if (strtolower($password) === $username) {
    fwrite(STDERR, "Password must not be the same as the username.\n");
    exit(1);
}

try {
    if (fetch_one('SELECT 1 AS found FROM Staff WHERE Username = ?', [$username])) {
        fwrite(STDERR, "The username '$username' already exists.\n");
        exit(1);
    }
    $parts = preg_split('/\s+/', $fullName, 2);
    run("INSERT INTO Staff (StaffName, FirstName, LastName, Username, PasswordHash, Role) VALUES (?, ?, ?, ?, ?, 'Admin')",
        [$fullName, mb_substr($parts[0], 0, 60), mb_substr($parts[1] ?? '', 0, 60), $username, hash_password($password)]);
} catch (Throwable $e) {
    fwrite(STDERR, 'Could not create the admin: ' . $e->getMessage() . "\n");
    exit(1);
}

fwrite(STDOUT, "Admin '$username' created. You can log in with POST /auth/login.\n");
