<?php
declare(strict_types=1);

// Staff accounts (Admin only). PasswordHash is never selected, so it can never be returned.
const STAFF_COLUMNS = 'StaffID, StaffName, FirstName, LastName, Email, Username, Role, IsActive';

function staff_or_404(int $id): array
{
    $row = fetch_one('SELECT ' . STAFF_COLUMNS . ' FROM Staff WHERE StaffID = ?', [$id]);
    if (!$row) {
        throw new HttpException(404, 'Staff member not found.');
    }
    return $row;
}

/** What the front end calls the roles. */
function role_label(string $role): string
{
    return $role === 'Admin' ? 'Admin' : 'Cashier';
}

/**
 * Reads the person's name from the body. Send FirstName and/or LastName, or just StaffName (split at the first space).
 * Returns null when no name field was sent.
 * @return array{0:string,1:string,2:string}|null [FirstName, LastName, StaffName]
 */
function staff_names(array $in, ?array $existing = null): ?array
{
    $hasParts = array_key_exists('FirstName', $in) || array_key_exists('LastName', $in);

    if ($hasParts) {
        $first = array_key_exists('FirstName', $in) ? str_field($in, 'FirstName', 60) : ($existing['FirstName'] ?? '');
        $last  = array_key_exists('LastName', $in)  ? (str_field($in, 'LastName', 60, false) ?? '') : ($existing['LastName'] ?? '');
    } elseif (array_key_exists('StaffName', $in)) {
        $full  = str_field($in, 'StaffName', 100);
        $parts = preg_split('/\s+/', $full, 2);
        $first = mb_substr($parts[0], 0, 60);
        $last  = mb_substr($parts[1] ?? '', 0, 60);
    } else {
        return null;
    }
    return [$first, $last, trim("$first $last")];
}

// GET /staff?search=&page=&limit=
function staff_list(): never
{
    $where = [];
    $params = [];
    if (($search = query_str('search')) !== '') {
        $where[] = "Username LIKE ? ESCAPE '!'";
        $params[] = like_contains($search);
    }
    [$rows, $total, $limit, $page] = paged_query('SELECT ' . STAFF_COLUMNS, 'FROM Staff', $where, $params, 'StaffName, StaffID');
    list_response($rows, $total, $limit, $page);
}

// POST /staff   {FirstName, LastName, Email?, Username, Password, Role?, IsActive?}   (or StaffName instead of the two names)
// Role defaults to Staff (shown as "Cashier" in the app).
function staff_create(): never
{
    $in       = json_input();
    $names    = staff_names($in) ?? throw new HttpException(422, 'FirstName (or StaffName) is required.');
    $email    = email_field($in);
    $username = username_field($in);
    $password = password_field($in, 'Password');
    $role     = array_key_exists('Role', $in) ? role_field($in) : 'Staff';
    $active   = array_key_exists('IsActive', $in) ? bool_field($in, 'IsActive') : 1;

    if (strtolower($password) === $username) {
        throw new HttpException(422, 'Password must not be the same as the username.');
    }
    if (fetch_one('SELECT 1 AS found FROM Staff WHERE Username = ?', [$username])) {
        throw new HttpException(409, 'That username is already taken.');
    }

    $id = with_transaction(function () use ($names, $email, $username, $password, $role, $active) {
        run('INSERT INTO Staff (StaffName, FirstName, LastName, Email, Username, PasswordHash, Role, IsActive) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
            [$names[2], $names[0], $names[1], $email, $username, hash_password($password), $role, $active]);
        $id = (int) db()->lastInsertId();
        audit_log('Users', 'Created', "User $username (" . role_label($role) . ') was created.');
        return $id;
    });

    json_response(staff_or_404($id), 201);
}

// GET /staff/{id}
function staff_show(int $id): never
{
    json_response(staff_or_404($id));
}

// PUT /staff/{id}   any of {FirstName, LastName, StaffName, Email, Username, Role, IsActive, Password}
// Setting a Password (admin reset) or IsActive=false logs that person out everywhere.
// Admins cannot change their own Role, IsActive or Username here (use Settings), so the last admin can never
// lock everyone out and a stolen session can't rename the account without the password.
function staff_update(int $id): never
{
    $old  = staff_or_404($id);
    $in   = json_input();
    $self = $id === auth_staff_id();
    $sets = [];      // only fixed "Column = ?" fragments written below go in here
    $params = [];
    $revokeTokens = false;
    $passwordReset = false;

    if (($names = staff_names($in, $old)) !== null) {
        array_push($sets, 'FirstName = ?', 'LastName = ?', 'StaffName = ?');
        array_push($params, ...$names);
    }
    if (array_key_exists('Email', $in)) {
        $sets[] = 'Email = ?';
        $params[] = email_field($in);
    }
    if (array_key_exists('Username', $in)) {
        $username = username_field($in);
        if ($username !== $old['Username']) {
            if ($self) {
                throw new HttpException(403, 'You cannot rename your own account here. Use Settings > Change username.');
            }
            if (fetch_one('SELECT 1 AS found FROM Staff WHERE Username = ? AND StaffID <> ?', [$username, $id])) {
                throw new HttpException(409, 'That username is already taken.');
            }
            $sets[] = 'Username = ?';
            $params[] = $username;
        }
    }
    if (array_key_exists('Role', $in)) {
        $role = role_field($in);
        if ($self && $role !== $old['Role']) {
            throw new HttpException(403, 'You cannot change your own role.');
        }
        $sets[] = 'Role = ?';
        $params[] = $role;
    }
    if (array_key_exists('IsActive', $in)) {
        $active = bool_field($in, 'IsActive');
        if ($self && $active === 0) {
            throw new HttpException(403, 'You cannot deactivate your own account.');
        }
        $sets[] = 'IsActive = ?';
        $params[] = $active;
        $revokeTokens = $revokeTokens || $active === 0;
    }
    if (array_key_exists('Password', $in)) {
        $password = password_field($in, 'Password');
        if (strtolower($password) === strtolower($old['Username'])) {
            throw new HttpException(422, 'Password must not be the same as the username.');
        }
        $sets[] = 'PasswordHash = ?';
        $params[] = hash_password($password);
        $sets[] = 'FailedLogins = 0';     // a reset also clears any lockout
        $sets[] = 'LockedUntil = NULL';
        $revokeTokens = true;
        $passwordReset = true;
    }
    if (!$sets) {
        throw new HttpException(422, 'Provide at least one of: FirstName, LastName, StaffName, Email, Username, Role, IsActive, Password.');
    }

    with_transaction(function () use ($id, $sets, $params, $revokeTokens, $passwordReset, $old) {
        $params[] = $id;
        run('UPDATE Staff SET ' . implode(', ', $sets) . ' WHERE StaffID = ?', $params);   // $sets holds only fixed fragments written above

        if ($revokeTokens) {
            run('DELETE FROM ApiToken WHERE StaffID = ?', [$id]);
        }
        $new = staff_or_404($id);
        audit_log('Users', 'Updated',
            "User {$new['Username']} (" . role_label($new['Role']) . ') was updated' . ($passwordReset ? ' (password reset).' : '.'));
    });

    json_response(staff_or_404($id));
}

// DELETE /staff/{id}   (blocked for yourself, and while the person has any history on record)
function staff_delete(int $id): never
{
    $old = staff_or_404($id);

    if ($id === auth_staff_id()) {
        throw new HttpException(403, 'You cannot delete your own account.');
    }

    $used = fetch_one(
        'SELECT (SELECT COUNT(*) FROM Orders        WHERE StaffID = ?)
              + (SELECT COUNT(*) FROM `Transaction` WHERE StaffID = ?)
              + (SELECT COUNT(*) FROM StockMovement WHERE StaffID = ?)
              + (SELECT COUNT(*) FROM SalesReturn   WHERE StaffID = ?) AS refs',
        [$id, $id, $id, $id]
    );
    if ((int) $used['refs'] > 0) {
        throw new HttpException(409, 'This user has sales or stock activity on record and cannot be deleted. Mark the account inactive instead.');
    }

    with_transaction(function () use ($id, $old) {
        run('DELETE FROM Staff WHERE StaffID = ?', [$id]);   // their ApiToken rows go too (ON DELETE CASCADE); audit rows keep the username
        audit_log('Users', 'Deleted', "User {$old['Username']} was deleted.");
    });
    json_response(['deleted' => true]);
}
