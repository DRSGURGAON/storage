import { useMemo, useState } from 'react';
import { Alert, Button, Card, DatePicker, Empty, Input, Select, Space, Spin, Table, Typography } from 'antd';
import { useQuery } from '@tanstack/react-query';
import dayjs, { type Dayjs } from 'dayjs';
import { RecordPicker } from '../components/RecordPicker';
import { api, fileUrl, query as toQuery } from '../lib/api';
import { useSession } from '../lib/session';
import { date as formatDate, dateTime, humanise, money, quantity } from '../lib/format';

interface ReportColumn {
  key: string;
  label: string;
  type?: 'text' | 'number' | 'money' | 'date' | 'datetime';
  total?: boolean;
}

interface CatalogueEntry {
  code: string;
  name: string;
  group: string;
  description: string;
  filters: string[];
  columns: ReportColumn[];
}

interface ReportResult {
  code: string;
  name: string;
  description: string;
  columns: ReportColumn[];
  filters: Record<string, string | undefined>;
  rows: Record<string, unknown>[];
  totals: Record<string, number> | null;
  rowCount: number;
  generatedAt: string;
}

const GROUP_LABELS: Record<string, string> = {
  operations: 'Operations',
  stock: 'Stock',
  billing: 'Billing',
  documents: 'Documents',
};

const render = (column: ReportColumn) => (value: unknown) => {
  if (value === null || value === undefined || value === '') return '—';
  if (column.type === 'money') return money(Number(value));
  if (column.type === 'number') return quantity(Number(value));
  if (column.type === 'date') return formatDate(String(value));
  if (column.type === 'datetime') return dateTime(String(value));
  return typeof value === 'string' && /^[a-z]+(_[a-z]+)+$/.test(value) ? humanise(value) : String(value);
};

/**
 * Blueprint §55's reports, all of them, through one screen.
 *
 * The catalogue is the API's (`GET /reports/catalogue`), filtered server-
 * side to what this caller may actually run — so the list of reports on
 * offer cannot drift from the list the server would allow, and adding a
 * report to the backend catalogue makes it appear here with no frontend
 * change at all. The filters a report accepts, its columns and their types
 * come from the same place.
 */
export function Reports() {
  const { can } = useSession();
  const [code, setCode] = useState<string | null>(null);
  const [range, setRange] = useState<[Dayjs, Dayjs]>([dayjs().subtract(30, 'day'), dayjs()]);
  const [customerId, setCustomerId] = useState<string | undefined>();
  const [warehouseId, setWarehouseId] = useState<string | undefined>();
  const [status, setStatus] = useState<string | undefined>();

  const catalogue = useQuery({
    queryKey: ['/reports/catalogue'],
    queryFn: () => api<CatalogueEntry[]>('/reports/catalogue'),
  });

  const selected = catalogue.data?.find((entry) => entry.code === code) ?? null;
  const takes = (filter: string) => Boolean(selected?.filters.includes(filter));

  const params = useMemo(
    () => ({
      from: takes('dateRange') ? range[0].format('YYYY-MM-DD') : undefined,
      to: takes('dateRange') ? range[1].format('YYYY-MM-DD') : undefined,
      customerId: takes('customerId') ? customerId : undefined,
      warehouseId: takes('warehouseId') ? warehouseId : undefined,
      status: takes('status') ? status : undefined,
    }),
    [selected, range, customerId, warehouseId, status],
  );

  const result = useQuery({
    queryKey: ['/reports/run', code, params],
    queryFn: () => api<ReportResult>(`/reports/run/${code}${toQuery(params)}`),
    enabled: Boolean(code),
  });

  const options = useMemo(() => {
    const groups = new Map<string, CatalogueEntry[]>();
    for (const entry of catalogue.data ?? []) {
      groups.set(entry.group, [...(groups.get(entry.group) ?? []), entry]);
    }
    return [...groups.entries()].map(([group, entries]) => ({
      label: GROUP_LABELS[group] ?? humanise(group),
      options: entries.map((entry) => ({ value: entry.code, label: entry.name })),
    }));
  }, [catalogue.data]);

  const download = async () => {
    const href = await fileUrl(`/reports/run/${code}/csv${toQuery(params)}`);
    const link = document.createElement('a');
    link.href = href;
    link.download = `${code}.csv`;
    link.click();
    URL.revokeObjectURL(href);
  };

  return (
    <Space direction="vertical" size={16} style={{ display: 'flex' }}>
      <Card
        loading={catalogue.isLoading}
        title={<Typography.Title level={4} style={{ margin: 0 }}>Reports</Typography.Title>}
      >
        <Space wrap align="start" size={12}>
          <Select
            showSearch
            optionFilterProp="label"
            placeholder="Pick a report"
            style={{ minWidth: 260, maxWidth: '80vw' }}
            value={code}
            onChange={setCode}
            options={options}
          />
          {takes('dateRange') && (
            <DatePicker.RangePicker
              value={range}
              allowClear={false}
              onChange={(value) => value && setRange(value as [Dayjs, Dayjs])}
            />
          )}
          {takes('customerId') && (
            <RecordPicker<{ id: string; name: string; code: string }>
              path="/customers"
              value={customerId}
              onChange={setCustomerId}
              label={(row) => `${row.name} (${row.code})`}
              placeholder="Every customer"
              allowClear
            />
          )}
          {takes('warehouseId') && (
            <RecordPicker<{ id: string; name: string; code: string }>
              path="/warehouses"
              value={warehouseId}
              onChange={setWarehouseId}
              label={(row) => `${row.code} — ${row.name}`}
              placeholder="Every warehouse"
              allowClear
            />
          )}
          {takes('status') && (
            <Input
              placeholder="Any status"
              allowClear
              style={{ width: 160 }}
              value={status}
              onChange={(event) => setStatus(event.target.value || undefined)}
            />
          )}
          {code && can('export_reports') && (
            <Button onClick={download} disabled={result.isFetching || !result.data?.rowCount}>
              Export CSV
            </Button>
          )}
        </Space>

        {selected && (
          <Typography.Paragraph type="secondary" style={{ marginTop: 12, marginBottom: 0 }}>
            {selected.description}
          </Typography.Paragraph>
        )}
      </Card>

      {!code && (
        <Card>
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description="Pick a report above. Every one of them reads the same tables the rest of the application writes — a report never recomputes a balance of its own."
          />
        </Card>
      )}

      {code && (
        <Card
          title={result.data?.name ?? selected?.name}
          extra={
            result.data && (
              <Typography.Text type="secondary">
                {result.data.rowCount} row{result.data.rowCount === 1 ? '' : 's'} · run {dateTime(result.data.generatedAt)}
              </Typography.Text>
            )
          }
        >
          {result.isError && <Alert type="error" showIcon message="That report could not be run" />}
          {result.isFetching && !result.data ? (
            <div style={{ display: 'grid', placeItems: 'center', padding: 32 }}>
              <Spin />
            </div>
          ) : (
            <Table
              size="small"
              rowKey="__row"

              scroll={{ x: 'max-content' }}
              pagination={{ pageSize: 50, showSizeChanger: true, hideOnSinglePage: true }}
              // Report rows have no id of their own -- they are the output
              // of a query, not records -- so the index becomes the key
              // here rather than through the deprecated rowKey callback.
              dataSource={(result.data?.rows ?? []).map((row, index) => ({ ...row, __row: index }))}
              locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Nothing in that range." /> }}
              columns={(result.data?.columns ?? []).map((column) => ({
                title: column.label,
                dataIndex: column.key,
                align: column.type === 'number' || column.type === 'money' ? ('right' as const) : undefined,
                render: render(column),
              }))}
              summary={() =>
                result.data?.totals ? (
                  <Table.Summary.Row>
                    {result.data.columns.map((column, index) => (
                      <Table.Summary.Cell key={column.key} index={index} align={column.total ? 'right' : undefined}>
                        {index === 0 ? <strong>Total</strong> : column.total ? <strong>{render(column)(result.data!.totals![column.key])}</strong> : null}
                      </Table.Summary.Cell>
                    ))}
                  </Table.Summary.Row>
                ) : null
              }
            />
          )}
        </Card>
      )}
    </Space>
  );
}
