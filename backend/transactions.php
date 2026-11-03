<?php
declare(strict_types=1);

const PAYMENT_METHODS = ['Cash', 'Card', 'E-Wallet', 'Bank Transfer'];

function transaction_detail(int $id): ?array
{
    $t = fetch_one(
        'SELECT t.*, s.StaffName
           FROM `Transaction` t
           JOIN Staff s ON s.StaffID = t.StaffID
          WHERE t.TransactionID = ?',
        [$id]
    );
    if (!$t) {
        return null;
    }
    $t['order'] = order_detail((int) $t['OrderID'], false);
    $t['sale']  = fetch_one('SELECT * FROM Sales WHERE TransactionID = ?', [$id]);
    return $t;
}

function transactions_list(): never
{
    $where = [];
    $params = [];

    if (($v = id_param('staff_id')) !== null) {
        $where[] = 't.StaffID = ?';
        $params[] = $v;
    }
    if (($method = enum_param('payment_method', PAYMENT_METHODS)) !== '') {
        $where[] = 't.PaymentMethod = ?';
        $params[] = $method;
    }
    if (($from = date_param('from')) !== null) {
        $where[] = 't.TransactionDate >= ?';
        $params[] = $from . ' 00:00:00';
    }
    if (($to = date_param('to')) !== null) {
        $where[] = 't.TransactionDate < DATE_ADD(CAST(? AS DATE), INTERVAL 1 DAY)';
        $params[] = $to;
    }

    [$rows, $total, $limit, $page] = paged_query(
        'SELECT t.*, s.StaffName',
        'FROM `Transaction` t JOIN Staff s ON s.StaffID = t.StaffID',
        $where,
        $params,
        't.TransactionDate DESC, t.TransactionID DESC'
    );
    list_response($rows, $total, $limit, $page);
}

function payment_method_field(array $in): string
{
    $method = str_field($in, 'PaymentMethod', 20, false) ?? 'Cash';
    if (!in_array($method, PAYMENT_METHODS, true)) {
        throw new HttpException(422, 'PaymentMethod must be one of: ' . implode(', ', PAYMENT_METHODS) . '.');
    }
    return $method;
}

function pay_order_in_tx(int $orderId, ?string $paid, string $method): int
{
    $order = fetch_one('SELECT OrderID, Total, Status FROM Orders WHERE OrderID = ? FOR UPDATE', [$orderId]);
    if (!$order) {
        throw new HttpException(404, 'Order not found.');
    }
    if ($order['Status'] !== 'Pending') {
        throw new HttpException(409, "Order is {$order['Status']} and cannot be paid.");
    }

    $totalCents = to_cents((string) $order['Total']);
    $paidCents  = $paid === null ? $totalCents : to_cents($paid);
    if ($paidCents < $totalCents) {
        throw new HttpException(422, 'AmountPaid is less than the order total.', [
            'total'       => $order['Total'],
            'amount_paid' => from_cents($paidCents),
        ]);
    }
    $change = $paidCents - $totalCents;

    run('INSERT INTO `Transaction` (OrderID, StaffID, AmountPaid, PaymentMethod, `Change`) VALUES (?, ?, ?, ?, ?)',
        [$orderId, auth_staff_id(), from_cents($paidCents), $method, from_cents($change)]);
    $transactionId = (int) db()->lastInsertId();
    run('INSERT INTO Sales (TransactionID, SaleDate, TotalSales) VALUES (?, CURDATE(), ?)',
        [$transactionId, $order['Total']]);

    run("UPDATE Orders SET Status = 'Completed' WHERE OrderID = ?", [$orderId]);
    return $transactionId;
}

function transactions_create(): never
{
    $in      = json_input();
    $orderId = id_field($in, 'OrderID');
    $paid    = money_field($in, 'AmountPaid');
    $method  = payment_method_field($in);

    $transactionId = with_transaction(function () use ($orderId, $paid, $method) {
        $id = pay_order_in_tx($orderId, $paid, $method);
        $o  = order_detail($orderId, false);
        audit_log('Sales', 'Order paid', 'Order ' . order_label($o) . " paid by $method.");
        return $id;
    });

    json_response(transaction_detail($transactionId), 201);
}

function transactions_show(int $id): never
{
    json_response(transaction_detail($id) ?? throw new HttpException(404, 'Transaction not found.'));
}
