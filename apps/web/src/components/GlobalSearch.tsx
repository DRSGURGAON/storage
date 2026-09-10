import { useEffect, useMemo, useRef, useState } from 'react';
import { AutoComplete, Grid, Input, Modal, Space, Tag, Typography } from 'antd';
import { SearchOutlined } from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { api, query } from '../lib/api';
import { statusColor } from '../lib/format';

const { Text } = Typography;

interface SearchHit {
  type: string;
  id: string;
  label: string;
  summary: string;
  status: string | null;
  /** The record this hit is read on, when it is not the hit itself (a gate pass). */
  parentId: string | null;
}

const TYPE_LABELS: Record<string, string> = {
  customer: 'Customers',
  product: 'Products',
  vehicle: 'Vehicles',
  grn: 'GRNs',
  dispatch: 'Dispatches',
  gate_pass: 'Gate passes',
  pod: 'Proofs of delivery',
  invoice: 'Invoices',
  document: 'Documents',
};

/**
 * Where a hit is read.
 *
 * Four of the nine searchable types have no screen of their own in this
 * app: a product, a vehicle and a document are read in their list, and a
 * gate pass is read on its dispatch. Those land on the list *already
 * filtered to the thing you typed* rather than on an unfiltered page --
 * "navigates straight to that record" (ux-system.md §4) is the promise,
 * and dropping someone on page one of Products with their term thrown
 * away is how a search box teaches people not to use it.
 */
function destinationFor(hit: SearchHit): string {
  const term = encodeURIComponent(hit.label);
  switch (hit.type) {
    case 'customer':
      return `/customers/${hit.id}`;
    case 'grn':
      return `/grns/${hit.id}`;
    case 'dispatch':
      return `/dispatches/${hit.id}`;
    case 'pod':
      return `/pods/${hit.id}`;
    case 'invoice':
      return `/invoices/${hit.id}`;
    case 'gate_pass':
      return hit.parentId ? `/dispatches/${hit.parentId}` : `/dispatches?q=${term}`;
    case 'product':
      return `/products?q=${term}`;
    case 'vehicle':
      return `/transport?tab=vehicles&q=${term}`;
    case 'document':
      return `/documents?q=${term}`;
    default:
      return `/documents?q=${term}`;
  }
}

/**
 * `ux-system.md` §4's global search: one box over the one `GET /search`
 * endpoint, results grouped by type, each hit navigating to its record.
 *
 * The endpoint has done the hard parts since Phase 8 -- the ranked union,
 * the permission-dropped branches, the warehouse scope -- and had no UI at
 * all, which made every one of those an untested claim from a user's point
 * of view. This is the box.
 *
 * On a phone the box becomes an icon that opens a full-screen sheet: a
 * usable search field and a legible header cannot share 390px, and §4's
 * search is exactly what someone standing at a gate with a phone needs.
 */
export function GlobalSearch() {
  const [term, setTerm] = useState('');
  const [debounced, setDebounced] = useState('');
  const [mobileOpen, setMobileOpen] = useState(false);
  const navigate = useNavigate();
  const screens = Grid.useBreakpoint();
  const compact = !screens.lg;
  const inputRef = useRef<any>(null);
  const sheetRef = useRef<HTMLDivElement>(null);

  // 250ms, and never below two characters: the API refuses a one-character
  // term with a 400 rather than scanning every indexed column, so sending
  // one would turn ordinary typing into a stream of errors in the console.
  useEffect(() => {
    const id = setTimeout(() => setDebounced(term.trim()), 250);
    return () => clearTimeout(id);
  }, [term]);

  const { data, isFetching } = useQuery({
    queryKey: ['/search', debounced],
    queryFn: () => api<{ query: string; items: SearchHit[]; total: number }>(`/search${query({ q: debounced, limit: 20 })}`),
    enabled: debounced.length >= 2,
  });

  // Ctrl/Cmd+K from anywhere, the shortcut every search box in every tool
  // these people already use is bound to.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        if (compact) setMobileOpen(true);
        else inputRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [compact]);

  const options = useMemo(() => {
    const items = data?.items ?? [];
    if (debounced.length >= 2 && items.length === 0 && !isFetching) {
      return [{ label: <Text type="secondary">Nothing matches “{debounced}”</Text>, options: [] }];
    }
    const groups: { type: string; hits: SearchHit[] }[] = [];
    for (const hit of items) {
      const group = groups.find((g) => g.type === hit.type);
      if (group) group.hits.push(hit);
      else groups.push({ type: hit.type, hits: [hit] });
    }
    return groups.map((group) => ({
      label: <Text type="secondary">{TYPE_LABELS[group.type] ?? group.type}</Text>,
      options: group.hits.map((hit) => ({
        value: `${hit.type}:${hit.id}`,
        hit,
        label: (
          <Space size={8} style={{ width: '100%', justifyContent: 'space-between' }}>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
              <strong style={{ fontFamily: 'monospace' }}>{hit.label}</strong>
              <Text type="secondary" style={{ marginLeft: 8 }}>
                {hit.summary}
              </Text>
            </span>
            {hit.status && <Tag color={statusColor(hit.status)}>{hit.status}</Tag>}
          </Space>
        ),
      })),
    }));
  }, [data, debounced, isFetching]);

  const go = (_value: string, option: any) => {
    const hit: SearchHit | undefined = option?.hit;
    if (!hit) return;
    setTerm('');
    setDebounced('');
    setMobileOpen(false);
    navigate(destinationFor(hit));
  };

  const field = (
    <AutoComplete
      // In the phone sheet the list is rendered *inside* the sheet rather
      // than in the body portal: left in the body it hangs below the white
      // panel and over the dimmed page, which reads as two things on screen
      // at once rather than one search.
      getPopupContainer={compact ? () => sheetRef.current ?? document.body : undefined}
      value={term}
      options={options}
      onSearch={setTerm}
      onSelect={go}
      style={{ width: '100%' }}
      // Every hit is already the server's ranked answer; filtering them
      // again in the browser would silently drop rows that matched on a
      // column the label does not show (a GSTIN, a barcode, an LR number).
      filterOption={false}
      popupMatchSelectWidth={compact ? true : 420}
    >
      <Input
        ref={inputRef}
        allowClear
        size={compact ? 'large' : 'middle'}
        prefix={<SearchOutlined />}
        placeholder="Search anything — a number, a code, a vehicle"
      />
    </AutoComplete>
  );

  if (!compact) {
    return <div style={{ width: 360, maxWidth: '45vw', marginRight: 'auto' }}>{field}</div>;
  }
  return (
    <>
      <SearchOutlined
        aria-label="Search"
        role="button"
        style={{ fontSize: 18, cursor: 'pointer' }}
        onClick={() => setMobileOpen(true)}
      />
      <Modal
        open={mobileOpen}
        onCancel={() => setMobileOpen(false)}
        footer={null}
        title="Search"
        style={{ maxWidth: 'calc(100vw - 32px)', top: 16 }}
        afterOpenChange={(open) => open && inputRef.current?.focus()}
        // Tall enough to hold its own results: a sheet that grows as you
        // type moves the thing you are about to tap.
        styles={{ body: { minHeight: 320 } }}
      >
        <div ref={sheetRef} style={{ position: 'relative' }}>
          {field}
        </div>
      </Modal>
    </>
  );
}
