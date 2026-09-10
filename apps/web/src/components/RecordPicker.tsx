import { useMemo, useState } from 'react';
import { Select } from 'antd';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { api, query, type Page } from '../lib/api';

interface RecordPickerProps<T> {
  /** The list endpoint to search, e.g. `/customers`. */
  path: string;
  value?: string;
  onChange?: (value: string | undefined) => void;
  /**
   * Passed down by `Form.Item`, along with `value`/`onChange`. Forwarding
   * it is what connects the field's `<label for=…>` to the input -- and
   * what lets anything driving this app by field name (a test, a
   * screen reader, a browser's autofill) find it at all. Dropped, antd
   * falls back to an internal `rc_select_7`.
   */
  id?: string;
  label: (row: T) => string;
  placeholder?: string;
  allowClear?: boolean;
  disabled?: boolean;
  /** Extra filters, e.g. `{ warehouseId }` on a location picker. */
  filters?: Record<string, string | number | boolean | undefined>;
  /** For endpoints that return a bare array rather than a page. */
  unpaged?: boolean;
}

/**
 * `workflow-and-statuses.md` §6 / saas-layer §28's searchable selector:
 * one combobox, backed by the list endpoint's own `q` search, used
 * everywhere a master record is picked.
 *
 * It searches server-side rather than loading the list and filtering in
 * the browser. That is not an optimisation -- every list endpoint caps
 * `limit` at 100, so a "load them all" picker silently shows a tenant's
 * first hundred customers and quietly omits the rest. Searching is the
 * only version that is correct for a real warehouse.
 */
export function RecordPicker<T extends { id: string }>({
  path,
  value,
  onChange,
  id,
  label,
  placeholder,
  allowClear = true,
  disabled,
  filters,
  unpaged,
}: RecordPickerProps<T>) {
  const [search, setSearch] = useState('');

  const params = { q: search || undefined, limit: 50, ...filters };
  const { data, isFetching } = useQuery({
    queryKey: [path, 'picker', params],
    queryFn: async () => {
      const result = await api<Page<T> | T[]>(`${path}${query(unpaged ? { ...filters } : params)}`);
      return Array.isArray(result) ? result : result.items;
    },
    placeholderData: keepPreviousData,
  });

  const options = useMemo(() => (data ?? []).map((row) => ({ value: row.id, label: label(row) })), [data, label]);

  return (
    <Select
      id={id}
      showSearch
      allowClear={allowClear}
      disabled={disabled}
      value={value}
      placeholder={placeholder}
      loading={isFetching}
      onChange={onChange}
      onSearch={setSearch}
      // The server already matched; filtering again in the browser would
      // hide rows that matched on a field the label does not show.
      filterOption={false}
      options={options}
      style={{ width: '100%' }}
    />
  );
}
