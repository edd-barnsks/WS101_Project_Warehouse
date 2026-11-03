<?php
declare(strict_types=1);

/**
 * Front controller. Every request is routed through this file.
 *
 *   Apache : .htaccess rewrites everything here
 *   Dev    : php -S localhost:8000 index.php
 */

// Never print PHP errors into the response (they leak file paths and can reflect user input as HTML).
// They are written to the server's error log instead.
ini_set('display_errors', '0');
ini_set('log_errors', '1');
error_reporting(E_ALL);

require __DIR__ . '/helpers.php';
foreach (['auth', 'audit', 'stock', 'categories', 'suppliers', 'products', 'staff', 'inventory', 'orders', 'transactions', 'returns', 'sales'] as $module) {
    require __DIR__ . "/$module.php";
}

$config = app_config();
send_api_headers();

// [HTTP method, path pattern, handler function, who may call it]
//   'public' = anyone   'auth' = any logged-in user   'admin' = Admin role only
$routes = [
    ['POST',   '/auth/login',               'auth_login',            'public'],
    ['POST',   '/auth/logout',              'auth_logout',           'auth'],
    ['GET',    '/auth/me',                  'auth_me',               'auth'],
    ['POST',   '/auth/change-password',     'auth_change_password',  'auth'],
    ['POST',   '/auth/change-username',     'auth_change_username',  'auth'],
    ['GET',    '/meta',                     'app_meta',              'auth'],

    ['GET',    '/products',                 'products_list',         'auth'],
    ['POST',   '/products',                 'products_create',       'admin'],
    ['GET',    '/products/{id}',            'products_show',         'auth'],
    ['PUT',    '/products/{id}',            'products_update',       'admin'],
    ['DELETE', '/products/{id}',            'products_delete',       'admin'],

    ['GET',    '/categories',               'categories_list',       'auth'],
    ['POST',   '/categories',               'categories_create',     'admin'],
    ['PUT',    '/categories/{id}',          'categories_update',     'admin'],
    ['DELETE', '/categories/{id}',          'categories_delete',     'admin'],

    ['GET',    '/suppliers',                'suppliers_list',        'admin'],
    ['POST',   '/suppliers',                'suppliers_create',      'admin'],
    ['GET',    '/suppliers/{id}',           'suppliers_show',        'admin'],
    ['PUT',    '/suppliers/{id}',           'suppliers_update',      'admin'],
    ['DELETE', '/suppliers/{id}',           'suppliers_delete',      'admin'],

    ['GET',    '/staff',                    'staff_list',            'admin'],
    ['POST',   '/staff',                    'staff_create',          'admin'],
    ['GET',    '/staff/{id}',               'staff_show',            'admin'],
    ['PUT',    '/staff/{id}',               'staff_update',          'admin'],
    ['DELETE', '/staff/{id}',               'staff_delete',          'admin'],

    ['GET',    '/inventory',                'inventory_list',        'auth'],
    ['GET',    '/inventory/{id}',           'inventory_show',        'auth'],
    ['PUT',    '/inventory/{id}',           'inventory_update',      'admin'],
    ['POST',   '/inventory/{id}/restock',   'inventory_restock',     'auth'],

    ['GET',    '/movements',                'movements_list',        'auth'],
    ['POST',   '/movements',                'movements_create',      'auth'],

    ['GET',    '/orders',                   'orders_list',           'auth'],
    ['GET',    '/orders/summary',           'orders_summary',        'auth'],
    ['POST',   '/orders',                   'orders_create',         'auth'],
    ['GET',    '/orders/{id}',              'orders_show',           'auth'],
    ['POST',   '/orders/{id}/cancel',       'orders_cancel',         'auth'],
    ['POST',   '/checkout',                 'checkout_create',       'auth'],

    ['GET',    '/transactions',             'transactions_list',     'auth'],
    ['POST',   '/transactions',             'transactions_create',   'auth'],
    ['GET',    '/transactions/{id}',        'transactions_show',     'auth'],

    ['GET',    '/returns',                  'returns_list',          'auth'],
    ['POST',   '/returns',                  'returns_create',        'auth'],
    ['POST',   '/returns/{id}/review',      'returns_review',        'admin'],

    ['GET',    '/audit-logs',               'audit_list',            'admin'],

    ['GET',    '/sales',                    'sales_list',            'admin'],
    ['GET',    '/sales/summary',            'sales_summary',         'admin'],
    ['GET',    '/sales/{id}',               'sales_show',            'admin'],
];

try {
    $method = strtoupper($_SERVER['REQUEST_METHOD'] ?? 'GET');
    if ($method === 'OPTIONS') {
        http_response_code(204);   // CORS preflight; the headers were already sent above
        exit;
    }

    // Work out the request path relative to wherever this app is mounted.
    $path = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?: '/';
    $base = rtrim(str_replace('\\', '/', dirname($_SERVER['SCRIPT_NAME'] ?? '')), '/');
    if ($base !== '' && str_starts_with($path, $base)) {
        $path = substr($path, strlen($base));
    }
    if (str_starts_with($path, '/index.php')) {
        $path = substr($path, strlen('/index.php'));
    }
    $path = '/' . trim($path, '/');

    if ($path === '/') {
        json_response(['name' => 'Warehouse Inventory API', 'status' => 'ok']);
    }

    $pathExists = false;
    foreach ($routes as [$routeMethod, $pattern, $handler, $access]) {
        $regex = '#^' . str_replace('{id}', '(\d+)', $pattern) . '$#';
        if (!preg_match($regex, $path, $matches)) {
            continue;
        }
        $pathExists = true;
        if ($routeMethod !== $method) {
            continue;
        }
        require_access($access);                      // 401 / 403 happen here, before any handler code runs
        array_shift($matches);
        $handler(...array_map('intval', $matches));   // handlers end with json_response()
    }

    throw new HttpException($pathExists ? 405 : 404, $pathExists ? 'Method not allowed.' : 'Route not found.');
} catch (HttpException $e) {
    foreach ($e->headers as $name => $value) {
        header("$name: $value");
    }
    $body = ['error' => $e->getMessage()];
    if ($e->details) {
        $body['details'] = $e->details;
    }
    json_response($body, $e->status);
} catch (PDOException $e) {
    error_log('[warehouse-api] ' . $e->getMessage());
    // 23000 = integrity constraint violation (duplicate key, foreign key, ...)
    if ($e->getCode() === '23000') {
        json_response(['error' => 'The request conflicts with existing data (duplicate or referenced record).'], 409);
    }
    json_response(['error' => 'Database error.'] + ($config['debug'] ? ['debug' => $e->getMessage()] : []), 500);
} catch (Throwable $e) {
    error_log('[warehouse-api] ' . $e->getMessage());
    json_response(['error' => 'Internal server error.'] + ($config['debug'] ? ['debug' => $e->getMessage()] : []), 500);
}
