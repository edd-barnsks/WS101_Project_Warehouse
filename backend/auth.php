<?php
declare(strict_types=1);

/**
 * Login system.
 *
 *   POST /auth/login            {Username, Password}  -> {token, ...}      (public)
 *   POST /auth/logout                                                        (any logged-in user)
 *   GET  /auth/me                                                            (any logged-in user)
 *   POST /auth/change-password  {CurrentPassword, NewPassword}               (any logged-in user)
 *   POST /auth/change-username  {CurrentPassword, NewUsername}               (any logged-in user)
 *   GET  /meta                                                               (any logged-in user: VAT rate etc.)
 *
 * Every other request must send:   Authorization: Bearer <token>
 *
 * How it stays safe:
 *  - Passwords are stored only as bcrypt hashes (password_hash), never as text.
 *  - A token is 256 random bits. Only its SHA-256 hash is stored in ApiToken.
 *  - Wrong username and wrong password give the same error and take about the same time.
 *  - 5 wrong passwords in a row lock the account for 15 minutes.
 *  - Role and IsActive are re-read from the database on every request, so disabling
 *    someone or changing their role takes effect immediately.
 */

/**
 * A valid bcrypt hash of a random string nobody knows. It is checked when the username
 * does not exist, so "no such user" and "wrong password" take about the same time.
 */
const DUMMY_PASSWORD_HASH = '$2y$12$TJCDt2Q5ZRTT36ij.Gio4eczhho2d/dlaFvpKqwcpD/o3cV0dJz4W';

const BCRYPT_OPTIONS = ['cost' => 12];

function hash_password(string $password): string
{
    return password_hash($password, PASSWORD_DEFAULT, BCRYPT_OPTIONS);
}

// ---------------------------------------------------------------
// Current user for this request
// ---------------------------------------------------------------

/** Holds (and returns) the logged-in user for the current request. */
function auth_user(?array $set = null): ?array
{
    static $user = null;
    if ($set !== null) {
        $user = $set;
    }
    return $user;
}

function auth_staff_id(): int
{
    $user = auth_user();
    if ($user === null) {
        throw unauthorized();
    }
    return (int) $user['StaffID'];
}

function unauthorized(): HttpException
{
    return new HttpException(401, 'Authentication required.', [], ['WWW-Authenticate' => 'Bearer']);
}

/** The bearer token from the Authorization header, or null if missing/malformed (tokens are exactly 64 hex characters). */
function bearer_token(): ?string
{
    $header = $_SERVER['HTTP_AUTHORIZATION'] ?? $_SERVER['REDIRECT_HTTP_AUTHORIZATION'] ?? null;

    if ($header === null && function_exists('getallheaders')) {
        foreach (getallheaders() as $name => $value) {
            if (strcasecmp((string) $name, 'Authorization') === 0) {
                $header = $value;
                break;
            }
        }
    }
    if (!is_string($header) || !preg_match('/^Bearer\s+([A-Fa-f0-9]{64})$/i', trim($header), $m)) {
        return null;
    }
    return strtolower($m[1]);
}

/** Looks up the logged-in user from the bearer token or throws 401. */
function authenticate(): array
{
    $token = bearer_token();
    if ($token !== null) {
        $user = fetch_one(
            'SELECT s.StaffID, s.StaffName, s.Username, s.Role, t.TokenID
               FROM ApiToken t
               JOIN Staff s ON s.StaffID = t.StaffID
              WHERE t.TokenHash = ? AND t.ExpiresAt > NOW() AND s.IsActive = 1',
            [hash('sha256', $token)]
        );
        if ($user) {
            auth_user($user);
            return $user;
        }
    }
    throw unauthorized();
}

/**
 * Called by the router before every handler.
 *   'public' -> anyone
 *   'auth'   -> any logged-in, active user
 *   'admin'  -> logged-in Admin only
 */
function require_access(string $level): void
{
    if ($level === 'public') {
        return;
    }
    $user = authenticate();
    if ($level === 'admin' && $user['Role'] !== 'Admin') {
        throw new HttpException(403, 'You do not have permission to do that.');
    }
}

// ---------------------------------------------------------------
// Brute-force protection
// ---------------------------------------------------------------

function register_failed_login(int $staffId): void
{
    $cfg = app_config();
    // Assignments are written so both use the value from BEFORE this update.
    run('UPDATE Staff
            SET LockedUntil  = IF(FailedLogins + 1 >= ?, DATE_ADD(NOW(), INTERVAL ? SECOND), LockedUntil),
                FailedLogins = IF(FailedLogins + 1 >= ?, 0, FailedLogins + 1)
          WHERE StaffID = ?',
        [(int) $cfg['max_failed_logins'], (int) $cfg['lockout_seconds'], (int) $cfg['max_failed_logins'], $staffId]);
}

function locked_out(): HttpException
{
    return new HttpException(
        429,
        'Too many failed attempts. Try again later.',
        [],
        ['Retry-After' => (string) app_config()['lockout_seconds']]
    );
}

// ---------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------

// POST /auth/login   {Username, Password}
function auth_login(): never
{
    $in = json_input();
    $username = $in['Username'] ?? null;
    $password = $in['Password'] ?? null;

    if (!is_string($username) || !is_string($password) || $username === '' || $password === ''
        || strlen($username) > 100 || strlen($password) > 1024) {
        throw new HttpException(422, 'Username and Password are required.');
    }

    // Parameterised query: a username like  ' OR '1'='1  is just a name that does not exist.
    $user = fetch_one(
        'SELECT StaffID, StaffName, FirstName, LastName, Email, Username, PasswordHash, Role, IsActive,
                (LockedUntil IS NOT NULL AND LockedUntil > NOW()) AS Locked
           FROM Staff
          WHERE Username = ?',
        [strtolower(trim($username))]
    );

    if ($user && (int) $user['Locked'] === 1) {
        throw locked_out();
    }

    // Always run a password check, even for unknown usernames, so response time doesn't reveal which usernames exist.
    $passwordOk = password_verify($password, $user['PasswordHash'] ?? DUMMY_PASSWORD_HASH);

    if (!$user || !$passwordOk || (int) $user['IsActive'] !== 1) {
        if ($user) {
            $id = (int) $user['StaffID'];
            register_failed_login($id);
            // Only real accounts are logged (a stranger guessing random names must not be able to fill the log).
            audit_log('Authentication', 'Login failed', 'Wrong password or inactive account.', $user['Username'], $id);
            if (fetch_one('SELECT 1 AS found FROM Staff WHERE StaffID = ? AND LockedUntil > NOW()', [$id])) {
                audit_log('Authentication', 'Account locked', 'Too many failed attempts; locked for a while.', $user['Username'], $id);
            }
        }
        throw new HttpException(401, 'Invalid username or password.');
    }

    $staffId = (int) $user['StaffID'];
    run('UPDATE Staff SET FailedLogins = 0, LockedUntil = NULL WHERE StaffID = ?', [$staffId]);

    if (password_needs_rehash($user['PasswordHash'], PASSWORD_DEFAULT, BCRYPT_OPTIONS)) {
        run('UPDATE Staff SET PasswordHash = ? WHERE StaffID = ?', [hash_password($password), $staffId]);
    }

    run('DELETE FROM ApiToken WHERE ExpiresAt < NOW()');   // tidy up old logins

    $ttl   = (int) app_config()['token_ttl'];
    $token = bin2hex(random_bytes(32));
    run('INSERT INTO ApiToken (StaffID, TokenHash, ExpiresAt) VALUES (?, ?, DATE_ADD(NOW(), INTERVAL ? SECOND))',
        [$staffId, hash('sha256', $token), $ttl]);

    audit_log('Authentication', 'Signed in', 'User signed in.', $user['Username'], $staffId);

    json_response([
        'token'      => $token,
        'token_type' => 'Bearer',
        'expires_in' => $ttl,
        'staff'      => [
            'StaffID'   => $staffId,
            'StaffName' => $user['StaffName'],
            'FirstName' => $user['FirstName'],
            'LastName'  => $user['LastName'],
            'Email'     => $user['Email'],
            'Username'  => $user['Username'],
            'Role'      => $user['Role'],
        ],
    ]);
}

// POST /auth/logout   (ends only the login used for this request)
function auth_logout(): never
{
    audit_log('Authentication', 'Signed out', 'User signed out.');
    run('DELETE FROM ApiToken WHERE TokenID = ?', [(int) auth_user()['TokenID']]);
    json_response(['logged_out' => true]);
}

// GET /auth/me
function auth_me(): never
{
    json_response(staff_or_404(auth_staff_id()));
}

/**
 * Checks the logged-in user's current password (counting wrong guesses toward the lockout, so a stolen
 * token can't be used to guess it). Returns the row: Username, PasswordHash.
 */
function verify_current_password(array $in): array
{
    $current = $in['CurrentPassword'] ?? null;
    if (!is_string($current) || $current === '') {
        throw new HttpException(422, 'CurrentPassword is required.');
    }
    $id  = auth_staff_id();
    $row = fetch_one(
        'SELECT Username, PasswordHash, (LockedUntil IS NOT NULL AND LockedUntil > NOW()) AS Locked
           FROM Staff WHERE StaffID = ?',
        [$id]
    );
    if (!$row) {
        throw unauthorized();
    }
    if ((int) $row['Locked'] === 1) {
        throw locked_out();
    }
    if (!password_verify($current, $row['PasswordHash'])) {
        register_failed_login($id);
        throw new HttpException(422, 'CurrentPassword is incorrect.');
    }
    return $row;
}

// POST /auth/change-password   {CurrentPassword, NewPassword}
// Ends every login of this user (all devices), so they log in again with the new password.
function auth_change_password(): never
{
    $in = json_input();
    if (!is_string($in['CurrentPassword'] ?? null) || $in['CurrentPassword'] === '') {
        throw new HttpException(422, 'CurrentPassword is required.');
    }
    $new = password_field($in, 'NewPassword');
    $id  = auth_staff_id();
    $row = verify_current_password($in);

    if (hash_equals((string) $in['CurrentPassword'], $new)) {
        throw new HttpException(422, 'NewPassword must be different from the current password.');
    }
    if (strtolower($new) === $row['Username']) {
        throw new HttpException(422, 'NewPassword must not be the same as the username.');
    }

    with_transaction(function () use ($id, $new) {
        run('UPDATE Staff SET PasswordHash = ?, FailedLogins = 0, LockedUntil = NULL WHERE StaffID = ?',
            [hash_password($new), $id]);
        audit_log('Settings', 'Password changed', 'Account password was changed.');
        run('DELETE FROM ApiToken WHERE StaffID = ?', [$id]);
    });

    json_response(['changed' => true, 'message' => 'Password changed. Please log in again.']);
}

// POST /auth/change-username   {CurrentPassword, NewUsername}
// The login stays valid (the token isn't tied to the name); the person just signs in with the new name next time.
function auth_change_username(): never
{
    $in = json_input();
    if (!is_string($in['CurrentPassword'] ?? null) || $in['CurrentPassword'] === '') {
        throw new HttpException(422, 'CurrentPassword is required.');
    }
    $new = username_field($in, 'NewUsername');
    $id  = auth_staff_id();
    $row = verify_current_password($in);

    if ($new === $row['Username']) {
        throw new HttpException(422, 'NewUsername is the same as your current username.');
    }
    if (fetch_one('SELECT 1 AS found FROM Staff WHERE Username = ? AND StaffID <> ?', [$new, $id])) {
        throw new HttpException(409, 'That username is already taken.');
    }

    with_transaction(function () use ($id, $new, $row) {
        run('UPDATE Staff SET Username = ? WHERE StaffID = ?', [$new, $id]);
        audit_log('Settings', 'Username changed', "Username changed from {$row['Username']} to $new.", $new, $id);
    });

    json_response(['changed' => true, 'staff' => staff_or_404($id)]);
}

// GET /meta   settings the front end needs in order to show the same totals as the server
function app_meta(): never
{
    $cfg = app_config();
    json_response(['VatRate' => $cfg['vat_rate'], 'RackSlots' => (int) $cfg['rack_slots']]);
}
