import { useState, type ReactNode } from 'react';
import { Alert, Button, Card, Empty, Input, Space, Table, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { PlusOutlined, ReloadOutlined } from '@ant-design/icons';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { api, query, type Page } from '../lib/api';

export interface ListPageProps<T> {
  title: string;
  /** The API path, without query string. */
  path: string;
  columns: ColumnsType<T>;
  /** Extra filters merged into the query string, and into the cache key. */
  filters?: Record<string, string | number | boolean | undefined>;
  searchPlaceholder?: string;
  /** Rendered to the right of the search box -- typically a create button. */
  actions?: ReactNode;
  /** Shown instead of an empty table. §4's "explain the next step", not "No data". */
  emptyDescription?: ReactNode;
  onRowClick?: (row: T) => void;
  rowKey?: (row: T) => string;
  /** Some endpoints (charge types, users) return a bare array rather than a page. */
  unpaged?: boolean;
}

/**
 * Every list screen in this app, once.
 *
 * The API's list endpoints share one contract -- `q`/`limit`/`offset` in,
 * `{items,total,limit,offset}` out -- so the pagination, the search box and
 * the empty state are written here rather than twenty times. A screen
 * supplies its columns and its filters; nothing else about a list differs
 * between modules.
 *
 * Pagination is server-side, deliberately: blueprint §74 requires it, and a
 * warehouse with 40,000 stock lots would otherwise ship all of them to the
 * browser to show twenty-five.
 */
export function ListPage<T extends { id: string }>({
  title,
  path,
  columns,
  filters,
  searchPlaceholder,
  actions,
  emptyDescription,
  onRowClick,
  rowKey,
  unpaged,
}: ListPageProps<T>) {
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  const params = { q: search || undefined, limit: pageSize, offset: (page - 1) * pageSize, ...filters };
  const { data, isFetching, error, refetch } = useQuery({
    queryKey: [path, params],
    queryFn: async () => {
      const result = await api<Page<T> | T[]>(`${path}${query(params)}`);
      return Array.isArray(result)
        ? { items: result, total: result.length, limit: pageSize, offset: 0 }
        : result;
    },
    placeholderData: keepPreviousData,
  });

  return (
    <Card
      // The header wraps rather than squeezing: on a phone the title and the
      // search box share one row otherwise, and the search shrinks to a slot
      // too narrow to read what you typed.
      styles={{ header: { flexWrap: 'wrap', rowGap: 8 } }}
      title={<Typography.Title level={4} style={{ margin: 0 }}>{title}</Typography.Title>}
      // `wrap` matters on a phone: unwrapped, the create button is pushed
      // off the right edge of the card and cannot be reached at all.
      extra={
        <Space wrap>
          <Input.Search
            allowClear
            placeholder={searchPlaceholder ?? 'Search'}
            style={{ width: 220, maxWidth: '60vw' }}
            onSearch={(value) => {
              setSearch(value);
              setPage(1);
            }}
          />
          <Button icon={<ReloadOutlined />} onClick={() => refetch()} />
          {actions}
        </Space>
      }
    >
      {error && <Alert type="error" showIcon message={(error as Error).message} style={{ marginBottom: 16 }} />}
      <Table<T>
        size="small"
        // The table scrolls inside its card rather than pushing the page
        // sideways. Found on a 390px phone: without this the whole document
        // scrolled horizontally, so the navigation and header drifted off
        // screen while an operator tried to read a column.
        scroll={{ x: 'max-content' }}
        rowKey={rowKey ?? ((row) => row.id)}
        loading={isFetching}
        columns={columns}
        dataSource={data?.items ?? []}
        onRow={onRowClick ? (row) => ({ onClick: () => onRowClick(row), style: { cursor: 'pointer' } }) : undefined}
        locale={{
          emptyText: (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={emptyDescription ?? 'Nothing here yet'} />
          ),
        }}
        pagination={
          unpaged
            ? false
            : {
                current: page,
                pageSize,
                total: data?.total ?? 0,
                showSizeChanger: true,
                showTotal: (total) => `${total} record${total === 1 ? '' : 's'}`,
                onChange: (nextPage, nextSize) => {
                  setPage(nextPage);
                  setPageSize(nextSize);
                },
              }
        }
      />
    </Card>
  );
}

/** The `+ New …` button, hidden when the role cannot create. */
export function CreateButton({ label, onClick, disabled }: { label: string; onClick: () => void; disabled?: boolean }) {
  return (
    <Button type="primary" icon={<PlusOutlined />} onClick={onClick} disabled={disabled}>
      {label}
    </Button>
  );
}

export { PlusOutlined };
