import { Button, Col, Form, Input, InputNumber, Row, Space, Typography } from 'antd';
import { DeleteOutlined, PlusOutlined } from '@ant-design/icons';
import { RecordPicker } from './RecordPicker';

interface ItemLinesProps {
  name: string;
  /** Which quantity columns to show. Inward and GRN want different ones. */
  quantities: { name: string; label: string; required?: boolean }[];
  /** Batch/expiry inputs, for a batch-tracked receipt. */
  withBatch?: boolean;
  addLabel?: string;
}

/**
 * The line-item editor every receiving form uses.
 *
 * Quantities are separate fields rather than one "quantity", because the
 * inbound chain distinguishes them and the difference is the whole point:
 * expected is what the paperwork claimed, received is what came off the
 * lorry, accepted is what the warehouse is prepared to be liable for --
 * and **only accepted quantity posts to stock**. A single quantity box
 * would collapse a discrepancy into silence.
 */
export function ItemLines({ name, quantities, withBatch, addLabel = 'Add a line' }: ItemLinesProps) {
  return (
    <Form.List name={name} initialValue={[{}]}>
      {(fields, { add, remove }) => (
        <>
          {fields.map((field) => (
            <div key={field.key} style={{ border: '1px solid #f0f0f0', borderRadius: 8, padding: 12, marginBottom: 12 }}>
              <Row gutter={12} align="middle">
                <Col span={22}>
                  <Form.Item
                    {...field}
                    name={[field.name, 'productId']}
                    label="Product"
                    rules={[{ required: true, message: 'Pick a product' }]}
                  >
                    <RecordPicker<{ id: string; sku: string; name: string }>
                      path="/products"
                      label={(row) => `${row.sku} — ${row.name}`}
                    />
                  </Form.Item>
                </Col>
                <Col span={2} style={{ textAlign: 'right' }}>
                  {fields.length > 1 && (
                    <Button type="text" danger icon={<DeleteOutlined />} onClick={() => remove(field.name)} />
                  )}
                </Col>
              </Row>
              <Row gutter={12}>
                {quantities.map((quantity) => (
                  <Col span={Math.floor(24 / quantities.length)} key={quantity.name}>
                    <Form.Item
                      {...field}
                      name={[field.name, quantity.name]}
                      label={quantity.label}
                      rules={quantity.required ? [{ required: true }] : undefined}
                    >
                      <InputNumber min={0} style={{ width: '100%' }} />
                    </Form.Item>
                  </Col>
                ))}
              </Row>
              {withBatch && (
                <Row gutter={12}>
                  <Col span={8}>
                    <Form.Item {...field} name={[field.name, 'batchNo']} label="Batch">
                      <Input placeholder="Only for a batch-tracked SKU" />
                    </Form.Item>
                  </Col>
                  <Col span={8}>
                    <Form.Item {...field} name={[field.name, 'expiryDate']} label="Expiry">
                      <Input placeholder="YYYY-MM-DD" />
                    </Form.Item>
                  </Col>
                  <Col span={8}>
                    <Form.Item {...field} name={[field.name, 'packages']} label="Packages">
                      <InputNumber min={0} style={{ width: '100%' }} />
                    </Form.Item>
                  </Col>
                </Row>
              )}
            </div>
          ))}
          <Space direction="vertical" style={{ width: '100%' }}>
            <Button block type="dashed" icon={<PlusOutlined />} onClick={() => add({})}>
              {addLabel}
            </Button>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              Only the accepted quantity posts to stock. Received minus accepted minus rejected is what the
              discrepancy report is raised from.
            </Typography.Text>
          </Space>
        </>
      )}
    </Form.List>
  );
}
