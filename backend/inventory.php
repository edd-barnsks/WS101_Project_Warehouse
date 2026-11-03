<?php
declare(strict_types=1);

const INVENTORY_COLUMNS = 'SELECT i.*, p.SKU, p.ProductName, p.Size, p.ReorderLevel, c.CategoryName AS Category';
const INVENTORY_FROM = 'FROM Inventory i
                          JOIN Products p        ON p.ProductID  = i.ProductID
                          LEFT JOIN Categories c ON c.CategoryID = p.CategoryID';

function inventory_or_404(int $id): array
{
    $row = fetch_one(INVENTORY_COLUMNS . ' ' . INVENTORY_FROM . ' WHERE i.InventoryID = ?', [$id]);
    if (!$row) {
        throw new HttpException(404, 'Inventory record not found.');
    }
    return $row;
}

function inventory_list(): never
{
    $where = [];
    $params = [];

    if (($low = query_str('low')) !== '') {
        if (!ctype_digit($low) || strlen($low) > 9) {
            throw new HttpException(422, 'low must be a whole number.');
        }
        $where[] = 'i.StockQuantity <= ?';
        $params[] = (int) $low;
    }
    $belowReorder = query_str('below_reorder');
    if ($belowReorder !== '' && $belowReorder !== '0' && $belowReorder !== '1') {
        throw new HttpException(422, 'below_reorder must be 1 or 0.');
    }
    if ($belowReorder === '1') {
        $where[] = 'i.StockQuantity < p.ReorderLevel';
    }
    if (($search = query_str('search')) !== '') {
        $where[] = "(p.ProductName LIKE ? ESCAPE '!' OR p.SKU LIKE ? ESCAPE '!')";
        $params[] = like_contains($search);
        $params[] = like_contains($search);
    }

    [$rows, $total, $limit, $page] = paged_query(INVENTORY_COLUMNS, INVENTORY_FROM, $where, $params, 'p.ProductName, i.InventoryID');
    list_response($rows, $total, $limit, $page);
}

function inventory_show(int $id): never
{
    json_response(inventory_or_404($id));
}

function inventory_update(int $id): never
{
    $old = inventory_or_404($id);
    $in = json_input();
    $sets = [];
    $params = [];
    $newQty = null;

    if (array_key_exists('StockQuantity', $in)) {
        $newQty = int_field($in, 'StockQuantity', 0, true, 100000000);
        $sets[] = 'StockQuantity = ?';
        $params[] = $newQty;
    }
    if (array_key_exists('Unit', $in)) {
        $sets[] = 'Unit = ?';
        $params[] = str_field($in, 'Unit', 20);
    }
    if (!$sets) {
        throw new HttpException(422, 'Provide at least one of: StockQuantity, Unit.');
    }

    with_transaction(function () use ($id, $old, $sets, $params, $newQty) {
        $current = fetch_one('SELECT StockQuantity FROM Inventory WHERE InventoryID = ? FOR UPDATE', [$id]);
        $params[] = $id;
        run('UPDATE Inventory SET ' . implode(', ', $sets) . ' WHERE InventoryID = ?', $params);

        if ($newQty !== null && $current && $newQty !== (int) $current['StockQuantity']) {
            $diff = $newQty - (int) $current['StockQuantity'];
            record_movement((int) $old['ProductID'], $diff > 0 ? 'IN' : 'OUT', abs($diff), 'Stock correction');
            audit_log('Inventory', 'Stock corrected', "{$old['SKU']} count corrected from {$current['StockQuantity']} to $newQty.");
        } else {
            audit_log('Inventory', 'Inventory updated', "{$old['SKU']} inventory record updated.");
        }
    });

    json_response(inventory_or_404($id));
}

function inventory_restock(int $id): never
{
    $old  = inventory_or_404($id);
    $in   = json_input();
    $quantity = int_field($in, 'Quantity', 1, true, 100000000);
    $note = str_field($in, 'Note', 200, false);

    with_transaction(function () use ($old, $quantity, $note) {
        $locked = lock_products([(int) $old['ProductID']])[(int) $old['ProductID']]
            ?? throw new HttpException(404, 'Inventory record not found.');
        stock_add($locked, $quantity, $note ?? 'Restock');
        audit_log('Inventory', 'Stock in', "$quantity units of {$old['SKU']} received" . ($note !== null ? "; $note" : '; restock') . '.');
    });

    json_response(inventory_or_404($id));
}
