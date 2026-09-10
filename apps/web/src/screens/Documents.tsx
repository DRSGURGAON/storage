import { Card, Descriptions, Empty, List, Space, Spin, Tag, Timeline, Typography } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';
import { ListPage } from '../components/ListPage';
import { OpenDocumentButton } from '../components/DocumentActions';
import { api } from '../lib/api';
import { dateTime, humanise, statusColor } from '../lib/format';

interface DocumentRow {
  id: string;
  documentType: string;
  documentNumber: string;
  versionNo: number;
  isLatest: boolean;
  statusAtGeneration: string | null;
  generatedAt: string;
  customerId: string | null;
  qrToken: string;
  sourceId: string;
}

/**
 * `ux-system.md` §5's Document Centre: every generated document, whatever
 * produced it. Superseded versions are kept and marked rather than hidden
 * — a customer may be holding one, and its QR resolves as `revoked`, which
 * is a different and more useful answer than "not found".
 */
export function Documents() {
  const navigate = useNavigate();
  return (
    <ListPage<DocumentRow>
      title="Documents"
      path="/documents"
      searchPlaceholder="Document number"
      onRowClick={(row) => navigate(`/documents/${row.documentType}/${row.sourceId}`)}
      emptyDescription="No documents generated yet. Nothing here is produced automatically — a document exists because someone chose to issue it."
      columns={[
        { title: 'Number', dataIndex: 'documentNumber', width: 200 },
        { title: 'Type', dataIndex: 'documentType', width: 180, render: (v) => <Tag>{humanise(v)}</Tag> },
        {
          title: 'Version',
          dataIndex: 'versionNo',
          width: 120,
          render: (version: number, row) => (
            <Space size={4}>
              v{version}
              {!row.isLatest && <Tag color="error">superseded</Tag>}
            </Space>
          ),
        },
        {
          title: 'Source status when issued',
          dataIndex: 'statusAtGeneration',
          width: 200,
          render: (v: string | null) => (v ? <Tag color={statusColor(v)}>{humanise(v)}</Tag> : '—'),
        },
        { title: 'Generated', dataIndex: 'generatedAt', width: 190, render: (v) => dateTime(v) },
        {
          title: '',
          width: 110,
          render: (_, row) => <OpenDocumentButton documentId={row.id} />,
        },
      ]}
    />
  );
}

interface RelatedRecord {
  type: string;
  id: string;
  number: string;
  status: string | null;
  date: string | null;
  via: string;
}

interface Relations {
  record: RelatedRecord;
  createdFrom: RelatedRecord[];
  related: RelatedRecord[];
  documents: {
    id: string;
    documentType: string;
    documentNumber: string;
    versionNo: number;
    isLatest: boolean;
    generatedAt: string;
  }[];
  chain: { records: RelatedRecord[]; truncated: boolean };
}

/** Which screen each record type lives on, so the chain is clickable. */
const ROUTE_FOR: Record<string, string> = {
  gate_entries: '/gate-entries',
  inwards: '/inwards',
  grns: '/grns',
  putaways: '/putaways',
  warehouse_receipts: '/warehouse-receipts',
  release_orders: '/release-orders',
  pick_lists: '/pick-lists',
  dispatches: '/dispatches',
  invoices: '/invoices',
};

/**
 * `document-engine.md` §8 / `ux-system.md` §7: Created From, Related
 * Documents, and the §68 chain — all computed from the foreign-key graph
 * by the API, none of it stored.
 *
 * The chain's hops are not all alike, and the screen says so: a record
 * reached over `stock_ledger` was found because it moved *the same goods*,
 * not because it shares paperwork. That is the only link between the
 * inbound and outbound halves, and flattening it into "related" would
 * overstate what is known.
 */
export function DocumentRelations() {
  const { sourceType = '', sourceId = '' } = useParams();
  const navigate = useNavigate();
  const { data, isLoading, error } = useQuery({
    queryKey: ['/documents/relations', sourceType, sourceId],
    queryFn: () => api<Relations>(`/documents/relations/${sourceType}/${sourceId}`),
  });

  if (isLoading) return <Spin size="large" />;
  if (error) return <Card><Empty description={(error as Error).message} /></Card>;
  if (!data) return null;

  const open = (record: RelatedRecord) => {
    const route = ROUTE_FOR[record.type];
    if (route) navigate(`${route}/${record.id}`);
  };

  const recordList = (records: RelatedRecord[], empty: string) =>
    records.length === 0 ? (
      <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={empty} />
    ) : (
      <List
        size="small"
        dataSource={records}
        renderItem={(record) => (
          <List.Item
            style={{ cursor: ROUTE_FOR[record.type] ? 'pointer' : 'default' }}
            onClick={() => open(record)}
          >
            <Space direction="vertical" size={0}>
              <Space size={6}>
                <Tag>{humanise(record.type)}</Tag>
                <strong>{record.number}</strong>
                {record.status && <Tag color={statusColor(record.status)}>{humanise(record.status)}</Tag>}
              </Space>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                via {record.via === 'stock_ledger' ? 'the goods themselves' : record.via}
              </Typography.Text>
            </Space>
          </List.Item>
        )}
      />
    );

  return (
    <Space direction="vertical" size={16} style={{ display: 'flex' }}>
      <Card
        title={
          <Space>
            <Typography.Title level={4} style={{ margin: 0 }}>
              {data.record.number}
            </Typography.Title>
            <Tag>{humanise(data.record.type)}</Tag>
            {data.record.status && <Tag color={statusColor(data.record.status)}>{humanise(data.record.status)}</Tag>}
          </Space>
        }
      >
        <Descriptions size="small" column={2}>
          <Descriptions.Item label="Created from">{data.createdFrom.length}</Descriptions.Item>
          <Descriptions.Item label="Related records">{data.related.length}</Descriptions.Item>
        </Descriptions>
      </Card>

      <Card title="Created from">{recordList(data.createdFrom, 'Nothing upstream — this is where the chain starts.')}</Card>
      <Card title="Related documents">{recordList(data.related, 'Nothing points back at this record yet.')}</Card>

      <Card title="This record’s own documents">
        {data.documents.length === 0 ? (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No document has been generated for this record." />
        ) : (
          <List
            size="small"
            dataSource={data.documents}
            renderItem={(document) => (
              <List.Item actions={[<OpenDocumentButton key="open" documentId={document.id} />]}>
                <Space>
                  <Tag>{humanise(document.documentType)}</Tag>
                  <strong>{document.documentNumber}</strong>
                  <Typography.Text type="secondary">
                    v{document.versionNo} · {dateTime(document.generatedAt)}
                  </Typography.Text>
                  {!document.isLatest && <Tag color="error">superseded</Tag>}
                </Space>
              </List.Item>
            )}
          />
        )}
      </Card>

      <Card
        title="The whole chain"
        extra={data.chain.truncated && <Tag color="warning">partial — too many linked records to show them all</Tag>}
      >
        {data.chain.records.length === 0 ? (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Nothing else is linked to this record." />
        ) : (
          <Timeline
            items={data.chain.records.map((record) => ({
              color: record.via === 'stock_ledger' ? 'orange' : 'blue',
              children: (
                <Space direction="vertical" size={0}>
                  <Space size={6} style={{ cursor: ROUTE_FOR[record.type] ? 'pointer' : 'default' }} onClick={() => open(record)}>
                    <Tag>{humanise(record.type)}</Tag>
                    <strong>{record.number}</strong>
                    {record.status && <Tag color={statusColor(record.status)}>{humanise(record.status)}</Tag>}
                  </Space>
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    {record.via === 'stock_ledger'
                      ? 'reached over the goods — the same customer’s stock, product and batch'
                      : `reached over ${record.via}`}
                  </Typography.Text>
                </Space>
              ),
            }))}
          />
        )}
      </Card>
    </Space>
  );
}
