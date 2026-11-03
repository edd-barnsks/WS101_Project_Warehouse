<?php
declare(strict_types=1);

const RETURN_STATUSES = ['Subject for review', 'Reviewed'];

const RETURN_COLUMNS = 'r.ReturnID, r.CreatedAt, r.Quantity, r.Reason, r.Status, r.ReviewedAt,
                        oi.OrderItemID, o.OrderID, ' . ORDER_NO_SQL . ' AS OrderNo, o.Reference,
                        p.SKU, p.ProductName, s.Username AS HandledBy, s.StaffName';
const RETURN_FROM = 'FROM SalesReturn r
                       JOIN OrderItem oi ON oi.OrderItemID = r.OrderItemID
                       JOIN Orders o     ON o.OrderID      = oi.OrderID
                       JOIN Products p   ON p.ProductID    = oi.ProductID
                       JOIN Staff s      ON s.StaffID      = r.StaffID';

function return_or_404(int $id): array
{
    return fetch_one('SELECT ' . RETURN_COLUMNS . ' ' . RETURN_FROM . ' WHERE r.ReturnID = ?', [$id])
        ?? throw new HttpException(404, 'Return not found.');
}

function returns_list(): never
{
    $where = [];
    $params = [];
    if (($status = enum_param('status', RETURN_STATUSES)) !== '') {
        $where[] = 'r.Status = ?';
        $params[] = $status;
    }
    if (($orderId = id_param('order_id')) !== null) {
        $where[] = 'o.OrderID = ?';
        $params[] = $orderId;
    }
    [$rows, $total, $limit, $page] = paged_query('SELECT ' . RETURN_COLUMNS, RETURN_FROM, $where, $params, 'r.CreatedAt DESC, r.ReturnID DESC');
    list_response($rows, $total, $limit, $page);
}

function returns_create(): never
{
    $in     = json_input();
    $itemId = id_field($in, 'OrderItemID');
    $qty    = int_field($in, 'Quantity', 1, true, 1000000);
    $reason = str_field($in, 'Reason', 120);

    $returnId = with_transaction(function (PDO $pdo) use ($itemId, $qty, $reason) {
        $item = fetch_one(
            'SELECT oi.OrderItemID, oi.OrderID, oi.ProductID, oi.Quantity, oi.ReturnedQuantity, o.Status
               FROM OrderItem oi
               JOIN Orders o ON o.OrderID = oi.OrderID
              WHERE oi.OrderItemID = ?
                FOR UPDATE',
            [$itemId]
        ) ?? throw new HttpException(404, 'Order line not found.');

        if ($item['Status'] !== 'Completed') {
            throw new HttpException(409, "Only completed sales can have returns (this order is {$item['Status']}).");
        }
        $remaining = (int) $item['Quantity'] - (int) $item['ReturnedQuantity'];
        if ($qty > $remaining) {
            throw new HttpException(422, 'Return quantity is more than what is left on this order line.', ['remaining' => $remaining]);
        }

        $locked = lock_products([(int) $item['ProductID']])[(int) $item['ProductID']]
            ?? throw new HttpException(409, 'This product no longer has an inventory record, so it cannot be restocked.');

        run('UPDATE OrderItem SET ReturnedQuantity = ReturnedQuantity + ? WHERE OrderItemID = ?', [$qty, $itemId]);
        run('INSERT INTO SalesReturn (OrderItemID, StaffID, Quantity, Reason) VALUES (?, ?, ?, ?)',
            [$itemId, auth_staff_id(), $qty, $reason]);
        $id = (int) $pdo->lastInsertId();

        $label = order_label(order_detail((int) $item['OrderID'], false));
        stock_add($locked, $qty, "Return $label");
        audit_log('Sales', 'Return restocked', "$qty × {$locked['ProductName']} returned for order $label.");
        return $id;
    });

    json_response(return_or_404($returnId), 201);
}

function returns_review(int $id): never
{
    with_transaction(function () use ($id) {
        $row = fetch_one('SELECT ReturnID, Status FROM SalesReturn WHERE ReturnID = ? FOR UPDATE', [$id])
            ?? throw new HttpException(404, 'Return not found.');
        if ($row['Status'] === 'Reviewed') {
            throw new HttpException(409, 'This return has already been reviewed.');
        }
        run("UPDATE SalesReturn SET Status = 'Reviewed', ReviewedBy = ?, ReviewedAt = NOW() WHERE ReturnID = ?",
            [auth_staff_id(), $id]);
        $r = return_or_404($id);
        audit_log('Sales', 'Return reviewed', "Return of {$r['Quantity']} × {$r['ProductName']} for order " . ($r['Reference'] ?: $r['OrderNo']) . ' marked reviewed.');
    });
    json_response(return_or_404($id));
}
