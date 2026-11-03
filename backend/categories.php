<?php
declare(strict_types=1);

const CATEGORY_SELECT = 'SELECT c.CategoryID, c.CategoryName,
                                (SELECT COUNT(*) FROM Products p WHERE p.CategoryID = c.CategoryID) AS ProductCount
                           FROM Categories c';

function category_or_404(int $id): array
{
    return fetch_one(CATEGORY_SELECT . ' WHERE c.CategoryID = ?', [$id])
        ?? throw new HttpException(404, 'Category not found.');
}

function category_id_or_422(array $in): int
{
    $id = int_field($in, 'CategoryID', 1, true, 4294967295);
    if (!fetch_one('SELECT 1 AS found FROM Categories WHERE CategoryID = ?', [$id])) {
        throw new HttpException(422, 'CategoryID does not exist.');
    }
    return $id;
}

function category_id_by_name(string $name): int
{
    $row = fetch_one('SELECT CategoryID FROM Categories WHERE CategoryName = ?', [$name]);
    if ($row) {
        return (int) $row['CategoryID'];
    }
    run('INSERT INTO Categories (CategoryName) VALUES (?)', [$name]);
    $id = (int) db()->lastInsertId();
    audit_log('Inventory', 'Category created', "$name category created.");
    return $id;
}

function categories_list(): never
{
    $where = [];
    $params = [];
    if (($search = query_str('search')) !== '') {
        $where[] = "c.CategoryName LIKE ? ESCAPE '!'";
        $params[] = like_contains($search);
    }
    [$rows, $total, $limit, $page] = paged_query(
        'SELECT c.CategoryID, c.CategoryName, (SELECT COUNT(*) FROM Products p WHERE p.CategoryID = c.CategoryID) AS ProductCount',
        'FROM Categories c',
        $where,
        $params,
        'c.CategoryName'
    );
    list_response($rows, $total, $limit, $page);
}

function categories_create(): never
{
    $name = str_field(json_input(), 'CategoryName', 60);
    if (fetch_one('SELECT 1 AS found FROM Categories WHERE CategoryName = ?', [$name])) {
        throw new HttpException(409, 'That category already exists.');
    }
    run('INSERT INTO Categories (CategoryName) VALUES (?)', [$name]);
    $id = (int) db()->lastInsertId();
    audit_log('Inventory', 'Category created', "$name category created.");
    json_response(category_or_404($id), 201);
}

function categories_update(int $id): never
{
    $old  = category_or_404($id);
    $name = str_field(json_input(), 'CategoryName', 60);
    if (fetch_one('SELECT 1 AS found FROM Categories WHERE CategoryName = ? AND CategoryID <> ?', [$name, $id])) {
        throw new HttpException(409, 'That category already exists.');
    }
    run('UPDATE Categories SET CategoryName = ? WHERE CategoryID = ?', [$name, $id]);
    audit_log('Inventory', 'Category updated', "{$old['CategoryName']} category renamed to $name.");
    json_response(category_or_404($id));
}

function categories_delete(int $id): never
{
    $old = category_or_404($id);
    run('DELETE FROM Categories WHERE CategoryID = ?', [$id]);   // products keep existing: ON DELETE SET NULL
    audit_log('Inventory', 'Category deleted',
        "{$old['CategoryName']} category deleted" . ((int) $old['ProductCount'] > 0 ? " ({$old['ProductCount']} products are now uncategorised)." : '.'));
    json_response(['deleted' => true, 'uncategorised_products' => (int) $old['ProductCount']]);
}
