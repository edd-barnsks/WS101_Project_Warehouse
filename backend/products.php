<?php
declare(strict_types=1);

// Every product comes back with its category name and its inventory row (Products 1 -- Tracks -- 1 Inventory).
const PRODUCT_SELECT = 'SELECT p.ProductID, p.SKU, p.ProductName, p.CategoryID, c.CategoryName AS Category,
                               p.Size, p.Price, p.RackSlot, p.ReorderLevel, i.InventoryID, i.StockQuantity, i.Unit
                          FROM Products p
                          LEFT JOIN Categories c ON c.CategoryID = p.CategoryID
                          LEFT JOIN Inventory i  ON i.ProductID  = p.ProductID';

function product_or_404(int $id): array
{
    $row = fetch_one(PRODUCT_SELECT . ' WHERE p.ProductID = ?', [$id]);
    if (!$row) {
        throw new HttpException(404, 'Product not found.');
    }
    return $row;
}

/**
 * Reads the category from a request body: CategoryID (number, or null for none) or Category (a name,
 * created on the fly if it doesn't exist yet).
 * @return array{0:bool,1:?int} [was one given?, CategoryID or null]
 */
function product_category_input(array $in): array
{
    if (array_key_exists('CategoryID', $in)) {
        return [true, ($in['CategoryID'] === null || $in['CategoryID'] === '') ? null : category_id_or_422($in)];
    }
    if (array_key_exists('Category', $in)) {
        $name = str_field($in, 'Category', 60, false);
        return [true, $name === null ? null : category_id_by_name($name)];
    }
    return [false, null];
}

/** Rack position 0 .. rack_slots-1, or null for "not on the rack". */
function slot_field(array $in, string $key = 'RackSlot'): ?int
{
    if (($in[$key] ?? null) === null || $in[$key] === '') {
        return null;
    }
    return int_field($in, $key, 0, true, (int) app_config()['rack_slots'] - 1);
}

function assert_slot_free(int $slot, ?int $exceptProductId = null): void
{
    $row = fetch_one('SELECT ProductID FROM Products WHERE RackSlot = ?', [$slot]);
    if ($row && (int) $row['ProductID'] !== $exceptProductId) {
        throw new HttpException(409, 'That rack slot is already used by another product.');
    }
}

function assert_sku_free(string $sku, ?int $exceptProductId = null): void
{
    $row = fetch_one('SELECT ProductID FROM Products WHERE SKU = ?', [$sku]);
    if ($row && (int) $row['ProductID'] !== $exceptProductId) {
        throw new HttpException(409, 'That SKU is already used by another product.');
    }
}

// GET /products?search=&category=&category_id=&low_stock=1&page=&limit=
function products_list(): never
{
    $where = [];     // only fixed fragments with ? placeholders go in here
    $params = [];

    if (($search = query_str('search')) !== '') {
        $where[] = "(p.ProductName LIKE ? ESCAPE '!' OR p.SKU LIKE ? ESCAPE '!')";
        $params[] = like_contains($search);
        $params[] = like_contains($search);
    }
    if (($category = query_str('category')) !== '') {
        $where[] = 'c.CategoryName = ?';
        $params[] = $category;
    }
    if (($categoryId = id_param('category_id')) !== null) {
        $where[] = 'p.CategoryID = ?';
        $params[] = $categoryId;
    }
    // ?low_stock=1 -> only products whose stock is below their own low-stock level (ReorderLevel)
    $lowStock = query_str('low_stock');
    if ($lowStock !== '' && $lowStock !== '0' && $lowStock !== '1') {
        throw new HttpException(422, 'low_stock must be 1 or 0.');
    }
    if ($lowStock === '1') {
        $where[] = 'COALESCE(i.StockQuantity, 0) < p.ReorderLevel';
    }

    [$rows, $total, $limit, $page] = paged_query(
        'SELECT p.ProductID, p.SKU, p.ProductName, p.CategoryID, c.CategoryName AS Category,
                p.Size, p.Price, p.RackSlot, p.ReorderLevel, i.InventoryID, i.StockQuantity, i.Unit',
        'FROM Products p
           LEFT JOIN Categories c ON c.CategoryID = p.CategoryID
           LEFT JOIN Inventory i  ON i.ProductID  = p.ProductID',
        $where,
        $params,
        'p.ProductName, p.ProductID'
    );
    list_response($rows, $total, $limit, $page);
}

// POST /products   {ProductName, SKU?, Category? | CategoryID?, Size?, Price?, StockQuantity?, Unit?, RackSlot?, ReorderLevel?}
// Creates the product AND its inventory row together. SKU defaults to P00012-style, RackSlot to the next free one.
function products_create(): never
{
    $in    = json_input();
    $name  = str_field($in, 'ProductName', 150);
    $sku   = sku_field($in, 'SKU', false);
    $size  = str_field($in, 'Size', 50, false);
    $price = money_field($in, 'Price', false) ?? '0.00';
    $stock = int_field($in, 'StockQuantity', 0, false, 100000000) ?? 0;
    $unit  = str_field($in, 'Unit', 20, false) ?? 'pcs';
    $reorder = int_field($in, 'ReorderLevel', 0, false, 1000000) ?? 10;
    $slotGiven = array_key_exists('RackSlot', $in);
    $slot      = slot_field($in);

    $id = with_transaction(function (PDO $pdo) use ($in, $name, $sku, $size, $price, $stock, $unit, $reorder, $slotGiven, $slot) {
        [, $categoryId] = product_category_input($in);

        if ($sku !== null) {
            assert_sku_free($sku);
        }
        if ($slotGiven) {
            if ($slot !== null) {
                assert_slot_free($slot);
            }
        } else {
            $slot = next_free_slot();     // null when the rack is full: the product just isn't drawn on it
        }

        // A random placeholder SKU keeps the UNIQUE key happy until the real, ID-based one is set below.
        run('INSERT INTO Products (SKU, ProductName, CategoryID, Size, Price, RackSlot, ReorderLevel) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [$sku ?? bin2hex(random_bytes(10)), $name, $categoryId, $size, $price, $slot, $reorder]);
        $productId = (int) $pdo->lastInsertId();
        if ($sku === null) {
            $sku = sprintf('P%05d', $productId);
            run('UPDATE Products SET SKU = ? WHERE ProductID = ?', [$sku, $productId]);
        }

        run('INSERT INTO Inventory (ProductID, StockQuantity, Unit) VALUES (?, ?, ?)', [$productId, $stock, $unit]);
        if ($stock > 0) {
            record_movement($productId, 'IN', $stock, 'Opening stock');
        }
        audit_log('Inventory', 'Product created', "$sku ($name) created with $stock units.");
        return $productId;
    });

    json_response(product_or_404($id), 201);
}

// GET /products/{id}
function products_show(int $id): never
{
    json_response(product_or_404($id));
}

// PUT /products/{id}   any of {ProductName, SKU, Category | CategoryID, Size, Price, RackSlot, ReorderLevel, Unit}
// Changing Price does not change past orders (they keep the UnitPrice they were placed at).
function products_update(int $id): never
{
    $old = product_or_404($id);
    $in = json_input();
    $sets = [];      // only fixed "Column = ?" fragments written below go in here
    $params = [];
    $changed = [];
    $newPrice = null;

    with_transaction(function () use ($id, $in, $old, &$sets, &$params, &$changed, &$newPrice) {
        if (array_key_exists('ProductName', $in)) {
            $sets[] = 'ProductName = ?';
            $params[] = str_field($in, 'ProductName', 150);
            $changed[] = 'name';
        }
        if (array_key_exists('SKU', $in)) {
            $sku = sku_field($in);
            assert_sku_free($sku, $id);
            $sets[] = 'SKU = ?';
            $params[] = $sku;
            $changed[] = 'SKU';
        }
        [$categoryGiven, $categoryId] = product_category_input($in);
        if ($categoryGiven) {
            $sets[] = 'CategoryID = ?';
            $params[] = $categoryId;
            $changed[] = 'category';
        }
        if (array_key_exists('Size', $in)) {
            $sets[] = 'Size = ?';
            $params[] = str_field($in, 'Size', 50, false);
            $changed[] = 'size';
        }
        if (array_key_exists('Price', $in)) {
            $newPrice = money_field($in, 'Price');
            $sets[] = 'Price = ?';
            $params[] = $newPrice;
            $changed[] = 'price';
        }
        if (array_key_exists('RackSlot', $in)) {
            $slot = slot_field($in);
            if ($slot !== null) {
                assert_slot_free($slot, $id);
            }
            $sets[] = 'RackSlot = ?';
            $params[] = $slot;
            $changed[] = 'rack slot';
        }
        if (array_key_exists('ReorderLevel', $in)) {
            $sets[] = 'ReorderLevel = ?';
            $params[] = int_field($in, 'ReorderLevel', 0, true, 1000000);
            $changed[] = 'low-stock level';
        }
        $unit = array_key_exists('Unit', $in) ? str_field($in, 'Unit', 20) : null;
        if ($unit !== null) {
            $changed[] = 'unit';
        }
        if (!$changed) {
            throw new HttpException(422, 'Provide at least one of: ProductName, SKU, Category, CategoryID, Size, Price, RackSlot, ReorderLevel, Unit.');
        }

        if ($sets) {
            $params[] = $id;
            run('UPDATE Products SET ' . implode(', ', $sets) . ' WHERE ProductID = ?', $params);
        }
        if ($unit !== null) {
            run('UPDATE Inventory SET Unit = ? WHERE ProductID = ?', [$unit, $id]);
        }

        $detail = $newPrice !== null ? " Price {$old['Price']} → $newPrice." : '';
        audit_log('Inventory', 'Product updated', "{$old['SKU']} ({$old['ProductName']}) updated: " . implode(', ', $changed) . '.' . $detail);
    });

    json_response(product_or_404($id));
}

// DELETE /products/{id}   (blocked once the product appears on any order)
function products_delete(int $id): never
{
    $old = product_or_404($id);

    if (fetch_one('SELECT 1 AS found FROM OrderItem WHERE ProductID = ? LIMIT 1', [$id])) {
        throw new HttpException(409, 'This product appears on existing orders and cannot be deleted.');
    }

    with_transaction(function () use ($id, $old) {
        run('DELETE FROM Products WHERE ProductID = ?', [$id]);   // inventory row and stock history go too (ON DELETE CASCADE)
        audit_log('Inventory', 'Product deleted', "{$old['SKU']} ({$old['ProductName']}) was deleted.");
    });
    json_response(['deleted' => true]);
}
