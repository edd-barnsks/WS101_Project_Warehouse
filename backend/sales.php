<?php
declare(strict_types=1);

/**
 * Sales reports (Admin only). A Sales row is written automatically whenever an order is paid.
 *   GET /sales            ?from=&to=&page=&limit=
 *   GET /sales/{id}
 *   GET /sales/summary    ?from=&to=&group=day|month|year
 *
 * TotalSales is the order's Total: after discount, including VAT.
 */

/** Builds the WHERE clause for ?from= / ?to= on Sales.SaleDate (alias "s"). Fragments are fixed text; values are bound. */
function sales_date_filter(): array
{
    $where = [];
    $params = [];
    if (($from = date_param('from')) !== null) {
        $where[] = 's.SaleDate >= ?';
        $params[] = $from;
    }
    if (($to = date_param('to')) !== null) {
        $where[] = 's.SaleDate <= ?';
        $params[] = $to;
    }
    return [$where, $params];
}

const SALES_COLUMNS = 'SELECT s.*, t.OrderID, t.PaymentMethod, t.StaffID, ' . ORDER_NO_SQL . ' AS OrderNo,
                              o.CustomerName, o.Reference, o.Subtotal, o.DiscountAmount, o.VatAmount, o.Total,
                              (SELECT CAST(COALESCE(SUM(oi.Quantity), 0) AS UNSIGNED) FROM OrderItem oi WHERE oi.OrderID = o.OrderID) AS Units';
const SALES_FROM = 'FROM Sales s
                      JOIN `Transaction` t ON t.TransactionID = s.TransactionID
                      JOIN Orders o        ON o.OrderID       = t.OrderID';

// GET /sales?from=YYYY-MM-DD&to=YYYY-MM-DD&page=&limit=
function sales_list(): never
{
    [$where, $params] = sales_date_filter();
    [$rows, $total, $limit, $page] = paged_query(SALES_COLUMNS, SALES_FROM, $where, $params, 's.SaleDate DESC, s.SalesID DESC');
    list_response($rows, $total, $limit, $page);
}

// GET /sales/{id}   (includes the order's lines)
function sales_show(int $id): never
{
    $row = fetch_one(SALES_COLUMNS . ' ' . SALES_FROM . ' WHERE s.SalesID = ?', [$id])
        ?? throw new HttpException(404, 'Sales record not found.');
    $row['items'] = order_items_for([(int) $row['OrderID']])[(int) $row['OrderID']] ?? [];
    json_response($row);
}

// GET /sales/summary?from=&to=&group=day|month|year
// Totals (sales count, money, discounts, VAT, units), a breakdown per period, the top 10 products by line revenue
// (before order discount and VAT), and the split by payment method and by category. The Reports page uses all of it.
function sales_summary(): never
{
    $group = query_str('group') ?: 'day';
    // The SQL for each choice is a fixed literal; nothing from the request is ever put into it.
    $periodSql = match ($group) {
        'day'   => "DATE_FORMAT(s.SaleDate, '%Y-%m-%d')",
        'month' => "DATE_FORMAT(s.SaleDate, '%Y-%m')",
        'year'  => "DATE_FORMAT(s.SaleDate, '%Y')",
        default => throw new HttpException(422, 'group must be one of: day, month, year.'),
    };

    [$whereParts, $params] = sales_date_filter();
    $where = $whereParts ? ' WHERE ' . implode(' AND ', $whereParts) : '';

    $totals = fetch_one(
        "SELECT COUNT(*) AS SalesCount, COALESCE(SUM(s.TotalSales), 0) AS TotalSales
           FROM Sales s $where",
        $params
    );

    $periods = fetch_all(
        "SELECT $periodSql AS Period,
                COUNT(*) AS SalesCount,
                SUM(s.TotalSales) AS TotalSales
           FROM Sales s $where
          GROUP BY Period
          ORDER BY Period",
        $params
    );

    $topProducts = fetch_all(
        "SELECT p.ProductID, p.SKU, p.ProductName,
                CAST(SUM(oi.Quantity) AS UNSIGNED) AS UnitsSold,
                CAST(SUM(oi.ReturnedQuantity) AS UNSIGNED) AS UnitsReturned,
                SUM(oi.LineTotal) AS LineRevenue
           FROM Sales s
           JOIN `Transaction` t ON t.TransactionID = s.TransactionID
           JOIN OrderItem oi    ON oi.OrderID      = t.OrderID
           JOIN Products p      ON p.ProductID     = oi.ProductID
           $where
          GROUP BY p.ProductID, p.SKU, p.ProductName
          ORDER BY SUM(oi.LineTotal) DESC, p.ProductID
          LIMIT 10",
        $params
    );

    // Money that came in, split up for the Reports page. All of it is taken from the paid orders in the date range.
    $money = fetch_one(
        "SELECT COALESCE(SUM(o.Subtotal), 0)       AS Subtotal,
                COALESCE(SUM(o.DiscountAmount), 0) AS Discounts,
                COALESCE(SUM(o.VatAmount), 0)      AS Vat,
                COALESCE(ROUND(SUM(s.TotalSales) / NULLIF(COUNT(*), 0), 2), 0) AS AverageOrder
           FROM Sales s
           JOIN `Transaction` t ON t.TransactionID = s.TransactionID
           JOIN Orders o        ON o.OrderID       = t.OrderID
           $where",
        $params
    );
    $units = fetch_one(
        "SELECT CAST(COALESCE(SUM(oi.Quantity), 0) AS UNSIGNED)         AS UnitsSold,
                CAST(COALESCE(SUM(oi.ReturnedQuantity), 0) AS UNSIGNED) AS UnitsReturned
           FROM Sales s
           JOIN `Transaction` t ON t.TransactionID = s.TransactionID
           JOIN OrderItem oi    ON oi.OrderID      = t.OrderID
           $where",
        $params
    );

    $paymentMethods = fetch_all(
        "SELECT t.PaymentMethod, COUNT(*) AS SalesCount, SUM(s.TotalSales) AS TotalSales
           FROM Sales s
           JOIN `Transaction` t ON t.TransactionID = s.TransactionID
           $where
          GROUP BY t.PaymentMethod
          ORDER BY SUM(s.TotalSales) DESC, t.PaymentMethod",
        $params
    );

    $categories = fetch_all(
        "SELECT COALESCE(c.CategoryName, 'Uncategorised') AS Category,
                CAST(SUM(oi.Quantity) AS UNSIGNED) AS UnitsSold,
                SUM(oi.LineTotal) AS LineRevenue
           FROM Sales s
           JOIN `Transaction` t ON t.TransactionID = s.TransactionID
           JOIN OrderItem oi    ON oi.OrderID      = t.OrderID
           JOIN Products p      ON p.ProductID     = oi.ProductID
           LEFT JOIN Categories c ON c.CategoryID  = p.CategoryID
           $where
          GROUP BY c.CategoryID, c.CategoryName
          ORDER BY SUM(oi.LineTotal) DESC, Category",
        $params
    );

    json_response([
        'from'            => date_param('from'),
        'to'              => date_param('to'),
        'group'           => $group,
        'totals'          => $totals + $money + $units,
        'periods'         => $periods,
        'top_products'    => $topProducts,
        'payment_methods' => $paymentMethods,
        'categories'      => $categories,
    ]);
}
