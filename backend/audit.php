<?php
declare(strict_types=1);

function audit_log(string $module, string $action, string $description, ?string $handledBy = null, ?int $staffId = null): void
{
    $user = auth_user();
    $handledBy ??= $user['Username'] ?? 'system';
    $staffId   ??= isset($user['StaffID']) ? (int) $user['StaffID'] : null;

    run('INSERT INTO AuditLog (StaffID, HandledBy, Module, Action, Description, IpAddress) VALUES (?, ?, ?, ?, ?, ?)',
        [
            $staffId,
            mb_substr($handledBy, 0, 50),
            mb_substr($module, 0, 40),
            mb_substr($action, 0, 60),
            mb_substr($description, 0, 500),
            client_ip(),
        ]);
}

function audit_list(): never
{
    $where = [];
    $params = [];
    if (($module = query_str('module')) !== '') {
        $where[] = "a.Module LIKE ? ESCAPE '!'";
        $params[] = like_contains($module);
    }

    if (($search = query_str('search')) !== '') {
        $like = like_contains($search);
        $where[] = "(a.Module LIKE ? ESCAPE '!' OR a.Action LIKE ? ESCAPE '!' OR a.Description LIKE ? ESCAPE '!' OR a.HandledBy LIKE ? ESCAPE '!')";
        array_push($params, $like, $like, $like, $like);
    }

    $column = match (query_str('sort') ?: 'created_at') {
        'created_at'  => 'a.CreatedAt',
        'handled_by'  => 'a.HandledBy',
        'module'      => 'a.Module',
        'action'      => 'a.Action',
        'description' => 'a.Description',
        'ip_address'  => 'a.IpAddress',
        default       => throw new HttpException(422, 'sort must be one of: created_at, handled_by, module, action, description, ip_address.'),
    };
    $dir = match (strtolower(query_str('dir') ?: 'desc')) {
        'asc'   => 'ASC',
        'desc'  => 'DESC',
        default => throw new HttpException(422, 'dir must be asc or desc.'),
    };

    [$rows, $total, $limit, $page] = paged_query(
        'SELECT a.AuditID, a.CreatedAt, a.HandledBy, a.Module, a.Action, a.Description, a.IpAddress',
        'FROM AuditLog a',
        $where,
        $params,
        "$column $dir, a.AuditID $dir"
    );
    list_response($rows, $total, $limit, $page);
}
