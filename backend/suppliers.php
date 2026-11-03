<?php
declare(strict_types=1);

/**
 * Suppliers page (contact details for purchasing). All Admin only.
 *   GET    /suppliers        ?search=&page=&limit=
 *   POST   /suppliers        {SupplierName, ContactPerson?, Phone?, Email?, Address?, IsActive?}
 *   GET    /suppliers/{id}
 *   PUT    /suppliers/{id}   any of the same fields
 *   DELETE /suppliers/{id}
 */

const SUPPLIER_COLUMNS = 'SupplierID, SupplierName, ContactPerson, Phone, Email, Address, IsActive';

function supplier_or_404(int $id): array
{
    return fetch_one('SELECT ' . SUPPLIER_COLUMNS . ' FROM Suppliers WHERE SupplierID = ?', [$id])
        ?? throw new HttpException(404, 'Supplier not found.');
}

function supplier_email(array $in): string
{
    return email_field($in, 'Email') ?? '';
}

// GET /suppliers?search=
function suppliers_list(): never
{
    $where = [];
    $params = [];
    if (($search = query_str('search')) !== '') {
        $where[] = "SupplierName LIKE ? ESCAPE '!'";
        $params[] = like_contains($search);
    }
    [$rows, $total, $limit, $page] = paged_query('SELECT ' . SUPPLIER_COLUMNS, 'FROM Suppliers', $where, $params, 'SupplierName');
    list_response($rows, $total, $limit, $page);
}

function suppliers_show(int $id): never
{
    json_response(supplier_or_404($id));
}

// POST /suppliers
function suppliers_create(): never
{
    $in      = json_input();
    $name    = str_field($in, 'SupplierName', 100);
    $contact = str_field($in, 'ContactPerson', 100, false) ?? '';
    $phone   = phone_field($in);
    $email   = supplier_email($in);
    $address = str_field($in, 'Address', 160, false) ?? '';
    $active  = array_key_exists('IsActive', $in) ? bool_field($in, 'IsActive') : 1;

    if (fetch_one('SELECT 1 AS found FROM Suppliers WHERE SupplierName = ?', [$name])) {
        throw new HttpException(409, 'A supplier with that name already exists.');
    }
    run('INSERT INTO Suppliers (SupplierName, ContactPerson, Phone, Email, Address, IsActive) VALUES (?, ?, ?, ?, ?, ?)',
        [$name, $contact, $phone, $email, $address, $active]);
    $id = (int) db()->lastInsertId();
    audit_log('Suppliers', 'Created', $name . ($contact !== '' ? " — contact: $contact" : '') . '.');
    json_response(supplier_or_404($id), 201);
}

// PUT /suppliers/{id}
function suppliers_update(int $id): never
{
    $old  = supplier_or_404($id);
    $in   = json_input();
    $sets = [];      // only fixed "Column = ?" fragments written below go in here
    $params = [];
    $changedStatusOnly = true;

    if (array_key_exists('SupplierName', $in)) {
        $name = str_field($in, 'SupplierName', 100);
        if (fetch_one('SELECT 1 AS found FROM Suppliers WHERE SupplierName = ? AND SupplierID <> ?', [$name, $id])) {
            throw new HttpException(409, 'A supplier with that name already exists.');
        }
        $sets[] = 'SupplierName = ?';  $params[] = $name;  $changedStatusOnly = false;
    }
    if (array_key_exists('ContactPerson', $in)) {
        $sets[] = 'ContactPerson = ?'; $params[] = str_field($in, 'ContactPerson', 100, false) ?? '';  $changedStatusOnly = false;
    }
    if (array_key_exists('Phone', $in)) {
        $sets[] = 'Phone = ?';         $params[] = phone_field($in);  $changedStatusOnly = false;
    }
    if (array_key_exists('Email', $in)) {
        $sets[] = 'Email = ?';         $params[] = supplier_email($in);  $changedStatusOnly = false;
    }
    if (array_key_exists('Address', $in)) {
        $sets[] = 'Address = ?';       $params[] = str_field($in, 'Address', 160, false) ?? '';  $changedStatusOnly = false;
    }
    if (array_key_exists('IsActive', $in)) {
        $sets[] = 'IsActive = ?';      $params[] = bool_field($in, 'IsActive');
    }
    if (!$sets) {
        throw new HttpException(422, 'Provide at least one of: SupplierName, ContactPerson, Phone, Email, Address, IsActive.');
    }

    $params[] = $id;
    run('UPDATE Suppliers SET ' . implode(', ', $sets) . ' WHERE SupplierID = ?', $params);
    $new = supplier_or_404($id);

    if ($changedStatusOnly) {
        audit_log('Suppliers', 'Status changed', "{$new['SupplierName']} marked " . ((int) $new['IsActive'] === 1 ? 'active' : 'inactive') . '.');
    } else {
        audit_log('Suppliers', 'Updated', $new['SupplierName'] . ($new['ContactPerson'] !== '' ? " — contact: {$new['ContactPerson']}" : '') . '.');
    }
    json_response($new);
}

// DELETE /suppliers/{id}
function suppliers_delete(int $id): never
{
    $old = supplier_or_404($id);
    run('DELETE FROM Suppliers WHERE SupplierID = ?', [$id]);
    audit_log('Suppliers', 'Deleted', "{$old['SupplierName']} was deleted.");
    json_response(['deleted' => true]);
}
