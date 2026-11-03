<?php
declare(strict_types=1);

/**
 * Orders (the header of a sale) and their lines (OrderItem).
 *
 *   GET  /orders             ?status=&staff_id=&product_id=&from=&to=&search=&page=&limit=
 *   GET  /orders/summary     completed-order count, units sold, units returned
 *   GET  /orders/{id}
 *   POST /orders             {Items:[{ProductID, Quantity}], CustomerName?, Reference?, DiscountRate?}
 *                            (old style {ProductID, Quantity} still works)   -> a Pending order, stock reserved
 *   POST /orders/{id}/cancel                                                  -> stock goes back
 *   POST /checkout           same body as POST /orders + {PaymentMethod?, AmountPaid?}
 *                            -> places AND pays the order in one step (what the POS "Proceed to pay" button does)
 *
 * Prices are never taken from the request: every line is priced from Products.Price at the moment of the sale.
 */

const ORDER_STATUSES = ['Pending', 'Completed', 'Cancelled'];
const MAX_ORDER_LINES = 100;

// The order number shown to people, e.g. SO-261029-00012 (built from the order date and ID, so it's always unique).
const ORDER_NO_SQL = "CONCAT('SO-', DATE_FORMAT(o.OrderDate, '%y%m%d'), '-', LPAD(o.OrderID, 5, '0'))";

const ORDER_COLUMNS = 'o.OrderID, ' . ORDER_NO_SQL . ' AS OrderNo, o.OrderDate, o.CustomerName, o.Reference,
                       o.Subtotal, o.DiscountRate, o.DiscountAmount, o.VatRate, o.VatAmount, o.Total, o.Status,
                       o.StaffID, s.StaffName, s.Username AS StaffUsername';
const ORDER_FROM = 'FROM Orders o JOIN Staff s ON s.StaffID = o.StaffID';

/** The lines of the given orders, grouped by order ID. @param int[] $orderIds @return array<int,array[]> */
function order_items_for(array $orderIds): array
{
    if (!$orderIds) {
        return [];
    }
    $rows = fetch_all(
        'SELECT oi.OrderItemID, oi.OrderID, oi.ProductID, p.SKU, p.ProductName,
                oi.Quantity, oi.UnitPrice, oi.LineTotal, oi.ReturnedQuantity
           FROM OrderItem oi
           JOIN Products p ON p.ProductID = oi.ProductID
          WHERE oi.OrderID IN (' . placeholders(count($orderIds)) . ')
          ORDER BY oi.OrderItemID',
        array_values($orderIds)
    );
    $byOrder = [];
    foreach ($rows as $row) {
        $byOrder[(int) $row['OrderID']][] = $row;
    }
    return $byOrder;
}

/** One order with its lines (and, when paid, its transaction and sales record). */
function order_detail(int $id, bool $withPayment = true): ?array
{
    $order = fetch_one('SELECT ' . ORDER_COLUMNS . ' ' . ORDER_FROM . ' WHERE o.OrderID = ?', [$id]);
    if (!$order) {
        return null;
    }
    $order['items'] = order_items_for([$id])[$id] ?? [];
    if ($withPayment) {
        $order['transaction'] = fetch_one('SELECT * FROM `Transaction` WHERE OrderID = ?', [$id]);
        $order['sale'] = $order['transaction']
            ? fetch_one('SELECT * FROM Sales WHERE TransactionID = ?', [(int) $order['transaction']['TransactionID']])
            : null;
    }
    return $order;
}

/** What people call the order: the customer's reference when there is one, otherwise the order number. */
function order_label(array $order): string
{
    $ref = $order['Reference'] ?? null;
    return ($ref !== null && $ref !== '') ? $ref : (string) $order['OrderNo'];
}

// GET /orders?...
function orders_list(): never
{
    $where = [];     // only fixed fragments with ? placeholders go in here
    $params = [];

    if (($status = enum_param('status', ORDER_STATUSES)) !== '') {
        $where[] = 'o.Status = ?';
        $params[] = $status;
    }
    if (($v = id_param('staff_id')) !== null) {
        $where[] = 'o.StaffID = ?';
        $params[] = $v;
    }
    if (($v = id_param('product_id')) !== null) {
        $where[] = 'EXISTS (SELECT 1 FROM OrderItem x WHERE x.OrderID = o.OrderID AND x.ProductID = ?)';
        $params[] = $v;
    }
    if (($from = date_param('from')) !== null) {
        $where[] = 'o.OrderDate >= ?';
        $params[] = $from . ' 00:00:00';
    }
    if (($to = date_param('to')) !== null) {
        $where[] = 'o.OrderDate < DATE_ADD(CAST(? AS DATE), INTERVAL 1 DAY)';
        $params[] = $to;
    }
    if (($search = query_str('search')) !== '') {
        $like = like_contains($search);
        $where[] = '(' . ORDER_NO_SQL . " LIKE ? ESCAPE '!'
                     OR o.CustomerName LIKE ? ESCAPE '!'
                     OR o.Reference LIKE ? ESCAPE '!'
                     OR EXISTS (SELECT 1 FROM OrderItem x JOIN Products xp ON xp.ProductID = x.ProductID
                                 WHERE x.OrderID = o.OrderID
                                   AND (xp.SKU LIKE ? ESCAPE '!' OR xp.ProductName LIKE ? ESCAPE '!')))";
        array_push($params, $like, $like, $like, $like, $like);
    }

    [$rows, $total, $limit, $page] = paged_query(
        'SELECT ' . ORDER_COLUMNS,
        ORDER_FROM,
        $where,
        $params,
        'o.OrderDate DESC, o.OrderID DESC'
    );

    $items = order_items_for(array_map(fn ($r) => (int) $r['OrderID'], $rows));
    foreach ($rows as &$row) {
        $row['items'] = $items[(int) $row['OrderID']] ?? [];
    }
    unset($row);

    list_response($rows, $total, $limit, $page);
}

// GET /orders/summary   (completed orders only)
function orders_summary(): never
{
    $row = fetch_one(
        "SELECT COUNT(DISTINCT o.OrderID) AS OrderCount,
                COALESCE(SUM(oi.Quantity), 0) AS UnitsSold,
                COALESCE(SUM(oi.ReturnedQuantity), 0) AS UnitsReturned
           FROM Orders o
           LEFT JOIN OrderItem oi ON oi.OrderID = o.OrderID
          WHERE o.Status = 'Completed'"
    );
    json_response([
        'OrderCount'    => (int) $row['OrderCount'],
        'UnitsSold'     => (int) $row['UnitsSold'],
        'UnitsReturned' => (int) $row['UnitsReturned'],
    ]);
}

/**
 * Reads and validates the order part of a request body.
 * @return array{lines:array<int,int>,customer:?string,reference:?string,discountRate:string}
 *         lines = [ProductID => total quantity]  (the same product listed twice is added together)
 */
function parse_order_input(array $in): array
{
    $items = $in['Items'] ?? null;
    if ($items === null && array_key_exists('ProductID', $in)) {
        $items = [['ProductID' => $in['ProductID'], 'Quantity' => $in['Quantity'] ?? null]];   // v2-style single product
    }
    if (!is_array($items) || !array_is_list($items) || count($items) < 1 || count($items) > MAX_ORDER_LINES) {
        throw new HttpException(422, 'Items must be a list of 1 to ' . MAX_ORDER_LINES . ' lines, each with ProductID and Quantity.');
    }

    $lines = [];
    foreach ($items as $item) {
        if (!is_array($item) || array_is_list($item)) {
            throw new HttpException(422, 'Each item must be an object with ProductID and Quantity.');
        }
        $pid = id_field($item, 'ProductID');
        $qty = int_field($item, 'Quantity', 1, true, 1000000);
        $lines[$pid] = ($lines[$pid] ?? 0) + $qty;
        if ($lines[$pid] > 1000000) {
            throw new HttpException(422, 'Quantity must be between 1 and 1000000.');
        }
    }

    return [
        'lines'        => $lines,
        'customer'     => str_field($in, 'CustomerName', 80, false),
        'reference'    => str_field($in, 'Reference', 60, false),
        'discountRate' => rate_field($in, 'DiscountRate') ?? '0.00',
    ];
}

/**
 * Creates the order, its lines, and takes the stock. Call inside with_transaction().
 * Locks every product involved, checks stock, prices each line from Products.Price, and does all money
 * arithmetic in whole cents (exact; the same rounding the front end uses).
 * @param string $verb  'Sale' or 'Order' - the first word of the stock movement note
 */
function create_order_in_tx(array $order, string $verb): int
{
    $locked = lock_products(array_keys($order['lines']));

    $subtotal = 0;
    $priced = [];
    foreach ($order['lines'] as $pid => $qty) {
        $row = $locked[$pid] ?? throw new HttpException(422, "ProductID $pid does not exist or has no inventory record.");
        if ((int) $row['StockQuantity'] < $qty) {
            throw new HttpException(409, 'Insufficient stock.', [
                'sku'       => $row['SKU'],
                'available' => (int) $row['StockQuantity'],
                'requested' => $qty,
            ]);
        }
        $unit = to_cents((string) $row['Price']);
        if ($unit <= 0) {
            throw new HttpException(422, "Set a unit price for {$row['SKU']} before selling it.", ['sku' => $row['SKU']]);
        }
        $priced[$pid] = [$unit, $unit * $qty];
        $subtotal += $unit * $qty;
    }

    $discountRate = rate_to_hundredths($order['discountRate']);
    $vatRate      = rate_to_hundredths((string) app_config()['vat_rate']);
    $discount     = percent_of_cents($subtotal, $discountRate);
    $vat          = percent_of_cents($subtotal - $discount, $vatRate);
    $total        = $subtotal - $discount + $vat;

    run('INSERT INTO Orders (StaffID, CustomerName, Reference, Subtotal, DiscountRate, DiscountAmount, VatRate, VatAmount, Total)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [
            auth_staff_id(), $order['customer'], $order['reference'],
            from_cents($subtotal), $order['discountRate'], from_cents($discount),
            from_cents($vatRate), from_cents($vat), from_cents($total),
        ]);
    $orderId = (int) db()->lastInsertId();

    $header = fetch_one('SELECT ' . ORDER_COLUMNS . ' ' . ORDER_FROM . ' WHERE o.OrderID = ?', [$orderId]);
    $label  = order_label($header);

    foreach ($order['lines'] as $pid => $qty) {
        [$unit, $lineTotal] = $priced[$pid];
        run('INSERT INTO OrderItem (OrderID, ProductID, Quantity, UnitPrice, LineTotal) VALUES (?, ?, ?, ?, ?)',
            [$orderId, $pid, $qty, from_cents($unit), from_cents($lineTotal)]);
        stock_remove($locked[$pid], $qty, "$verb $label");
    }
    return $orderId;
}

// POST /orders   -> Pending order, stock reserved
function orders_create(): never
{
    $order = parse_order_input(json_input());

    $orderId = with_transaction(function () use ($order) {
        $id = create_order_in_tx($order, 'Order');
        $o  = order_detail($id, false);
        audit_log('Sales', 'Order placed',
            'Order ' . order_label($o) . ' placed with ' . count($o['items']) . ' line item' . (count($o['items']) === 1 ? '' : 's') . ' (pending payment).');
        return $id;
    });

    json_response(order_detail($orderId), 201);
}

// POST /checkout   -> placed and paid in one step
function checkout_create(): never
{
    $in     = json_input();
    $order  = parse_order_input($in);
    $paid   = money_field($in, 'AmountPaid', false);   // when left out, the customer paid exactly the total
    $method = payment_method_field($in);

    $orderId = with_transaction(function () use ($order, $paid, $method) {
        $id = create_order_in_tx($order, 'Sale');
        pay_order_in_tx($id, $paid, $method);
        $o = order_detail($id, false);
        audit_log('Sales', 'Sale completed',
            'Order ' . order_label($o) . ' completed with ' . count($o['items']) . ' line item' . (count($o['items']) === 1 ? '' : 's') . '.');
        return $id;
    });

    json_response(order_detail($orderId), 201);
}

// GET /orders/{id}
function orders_show(int $id): never
{
    json_response(order_detail($id) ?? throw new HttpException(404, 'Order not found.'));
}

// POST /orders/{id}/cancel
// Only Pending orders can be cancelled; the reserved stock is returned to inventory.
function orders_cancel(int $id): never
{
    with_transaction(function () use ($id) {
        $order = fetch_one('SELECT OrderID, Status FROM Orders WHERE OrderID = ? FOR UPDATE', [$id]);
        if (!$order) {
            throw new HttpException(404, 'Order not found.');
        }
        if ($order['Status'] !== 'Pending') {
            throw new HttpException(409, "Only Pending orders can be cancelled (this order is {$order['Status']}).");
        }

        $items  = order_items_for([$id])[$id] ?? [];
        $locked = lock_products(array_map(fn ($i) => (int) $i['ProductID'], $items));
        $label  = order_label(order_detail($id, false));
        foreach ($items as $item) {
            $row = $locked[(int) $item['ProductID']] ?? throw new HttpException(409, 'A product on this order no longer has an inventory record.');
            stock_add($row, (int) $item['Quantity'], "Order $label cancelled");
        }
        run("UPDATE Orders SET Status = 'Cancelled' WHERE OrderID = ?", [$id]);
        audit_log('Sales', 'Order cancelled', "Order $label was cancelled and its stock returned.");
    });

    json_response(order_detail($id));
}
