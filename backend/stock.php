<?php
declare(strict_types=1);

/**
 * Everything that changes how many units are on the shelf goes through this file, so every change
 * is locked properly and leaves a row in StockMovement (the dashboard's "Movement log").
 *
 *   GET  /movements    ?type=IN|OUT&product_id=&page=&limit=
 *   POST /movements    {SKU, Type: IN|OUT, Quantity, Note?, ProductName?, CategoryID?, Price?, Size?, Unit?, ReorderLevel?}
 *
 * The helper functions must be called inside with_transaction().
 */

const MOVEMENT_TYPES = ['IN', 'OUT'];

/**
 * Locks the product + inventory rows (lowest ProductID first, so two checkouts can't deadlock each other)
 * and returns them keyed by ProductID. A product without an inventory row is left out.
 * @param int[] $productIds
 * @return array<int,array>
 */
function lock_products(array $productIds): array
{
    $ids = array_values(array_unique(array_map('intval', $productIds)));
    sort($ids);
    if (!$ids) {
        return [];
    }
    $rows = fetch_all(
        'SELECT p.ProductID, p.SKU, p.ProductName, p.Price, i.InventoryID, i.StockQuantity
           FROM Products p
           JOIN Inventory i ON i.ProductID = p.ProductID
          WHERE p.ProductID IN (' . placeholders(count($ids)) . ')
          ORDER BY p.ProductID
            FOR UPDATE',
        $ids
    );
    $byId = [];
    foreach ($rows as $row) {
        $byId[(int) $row['ProductID']] = $row;
    }
    return $byId;
}

/** Writes the StockMovement row and returns its ID. */
function record_movement(int $productId, string $type, int $quantity, ?string $note): int
{
    run('INSERT INTO StockMovement (ProductID, StaffID, MovementType, Quantity, Note) VALUES (?, ?, ?, ?, ?)',
        [$productId, auth_staff_id(), $type, $quantity, $note !== null ? mb_substr($note, 0, 200) : null]);
    return (int) db()->lastInsertId();
}

/** Adds units to a locked product and logs a stock-IN movement. */
function stock_add(array $locked, int $quantity, ?string $note): int
{
    run('UPDATE Inventory SET StockQuantity = StockQuantity + ? WHERE InventoryID = ?',
        [$quantity, (int) $locked['InventoryID']]);
    return record_movement((int) $locked['ProductID'], 'IN', $quantity, $note);
}

/** Removes units from a locked product (409 when there aren't enough) and logs a stock-OUT movement. */
function stock_remove(array $locked, int $quantity, ?string $note): int
{
    $available = (int) $locked['StockQuantity'];
    if ($available < $quantity) {
        throw new HttpException(409, 'Insufficient stock.', [
            'sku'       => $locked['SKU'],
            'available' => $available,
            'requested' => $quantity,
        ]);
    }
    run('UPDATE Inventory SET StockQuantity = StockQuantity - ? WHERE InventoryID = ?',
        [$quantity, (int) $locked['InventoryID']]);
    return record_movement((int) $locked['ProductID'], 'OUT', $quantity, $note);
}

/** Lowest unused rack position, or null when every position is taken. Call inside a transaction. */
function next_free_slot(): ?int
{
    $used = array_map('intval', array_column(
        fetch_all('SELECT RackSlot FROM Products WHERE RackSlot IS NOT NULL ORDER BY RackSlot FOR UPDATE'),
        'RackSlot'
    ));
    for ($slot = 0, $max = (int) app_config()['rack_slots']; $slot < $max; $slot++) {
        if (!in_array($slot, $used, true)) {
            return $slot;
        }
    }
    return null;
}

// GET /movements?type=&product_id=&page=&limit=
function movements_list(): never
{
    $where = [];
    $params = [];
    if (($type = enum_param('type', MOVEMENT_TYPES)) !== '') {
        $where[] = 'm.MovementType = ?';
        $params[] = $type;
    }
    if (($pid = id_param('product_id')) !== null) {
        $where[] = 'm.ProductID = ?';
        $params[] = $pid;
    }

    [$rows, $total, $limit, $page] = paged_query(
        'SELECT m.MovementID, m.CreatedAt, m.MovementType, m.Quantity, m.Note,
                m.ProductID, p.SKU, p.ProductName, s.Username AS HandledBy',
        'FROM StockMovement m
           JOIN Products p ON p.ProductID = m.ProductID
           JOIN Staff s    ON s.StaffID   = m.StaffID',
        $where,
        $params,
        'm.CreatedAt DESC, m.MovementID DESC'
    );
    list_response($rows, $total, $limit, $page);
}

// POST /movements   {SKU, Type, Quantity, Note?, ProductName?, CategoryID?, Price?, Size?, Unit?, ReorderLevel?}
//   IN  of a known SKU      -> adds stock
//   IN  of a NEW SKU        -> Admin only: creates the product (needs ProductName), gives it the next free rack
//                              position; optional CategoryID, Price (0.00 until set), Size, Unit (pcs), ReorderLevel (10)
//   OUT                     -> removes stock (409 if there isn't enough)
function movements_create(): never
{
    $in       = json_input();
    $sku      = sku_field($in);
    $type     = $in['Type'] ?? null;
    $quantity = int_field($in, 'Quantity', 1, true, 100000000);
    $note     = str_field($in, 'Note', 200, false);
    if (!is_string($type) || !in_array($type, MOVEMENT_TYPES, true)) {
        throw new HttpException(422, 'Type must be IN or OUT.');
    }

    [$productId, $movementId] = with_transaction(function () use ($in, $sku, $type, $quantity, $note) {
        $product = fetch_one('SELECT ProductID FROM Products WHERE SKU = ? FOR UPDATE', [$sku]);

        if ($product === null) {
            if ($type === 'OUT') {
                throw new HttpException(422, "SKU $sku isn't in the warehouse. Log a stock in first.");
            }
            if (auth_user()['Role'] !== 'Admin') {
                throw new HttpException(403, "SKU $sku is new. Only an Admin can add a new product; ask one to log this stock in.");
            }
            $name       = str_field($in, 'ProductName', 150, false)
                ?? throw new HttpException(422, 'New SKU: add an item name (ProductName).');
            $categoryId = isset($in['CategoryID']) && $in['CategoryID'] !== '' ? category_id_or_422($in) : null;
            $price      = money_field($in, 'Price', false) ?? '0.00';
            $size       = str_field($in, 'Size', 50, false);
            $unit       = str_field($in, 'Unit', 20, false) ?? 'pcs';
            $reorder    = int_field($in, 'ReorderLevel', 0, false, 1000000) ?? 10;

            $slot = next_free_slot();
            if ($slot === null) {
                throw new HttpException(409, 'All rack slots are full. Stock out or remove a product first.');
            }
            run('INSERT INTO Products (SKU, ProductName, CategoryID, Size, Price, RackSlot, ReorderLevel) VALUES (?, ?, ?, ?, ?, ?, ?)',
                [$sku, $name, $categoryId, $size, $price, $slot, $reorder]);
            $productId = (int) db()->lastInsertId();
            run('INSERT INTO Inventory (ProductID, StockQuantity, Unit) VALUES (?, 0, ?)', [$productId, $unit]);
            audit_log('Inventory', 'Product created', "New SKU $sku ($name) added to rack slot " . ($slot + 1) . '.');
        } else {
            $productId = (int) $product['ProductID'];
        }

        $locked = lock_products([$productId])[$productId]
            ?? throw new HttpException(409, 'This product has no inventory record.');

        $movementId = $type === 'IN'
            ? stock_add($locked, $quantity, $note)
            : stock_remove($locked, $quantity, $note);

        audit_log('Inventory', $type === 'IN' ? 'Stock in' : 'Stock out',
            "$quantity units of $sku " . ($type === 'IN' ? 'received' : 'dispatched') . ($note !== null ? "; $note" : '') . '.');

        return [$productId, $movementId];
    });

    json_response([
        'product'  => product_or_404($productId),
        'movement' => fetch_one(
            'SELECT m.MovementID, m.CreatedAt, m.MovementType, m.Quantity, m.Note, m.ProductID, p.SKU, p.ProductName, s.Username AS HandledBy
               FROM StockMovement m
               JOIN Products p ON p.ProductID = m.ProductID
               JOIN Staff s    ON s.StaffID   = m.StaffID
              WHERE m.MovementID = ?',
            [$movementId]
        ),
    ], 201);
}
