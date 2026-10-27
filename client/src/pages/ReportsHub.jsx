import { useState } from 'react';
import { Btn, PageHeader, Icon } from '../components/ui';
import ReportsListPage from './ReportsListPage';
import NewReportPage from './NewReportPage';
import ZeltReportPage from './ZeltReportPage';
import SheetReaderPage from './SheetReaderPage';

// One Reports entry: browse, create, and generate-from-Zelt as tabs of a single
// dashboard. Templates are not a tab — they live inside the New report flow.
const TABS = [
  { id: 'list',  label: 'My reports', icon: 'FolderOpen' },
  { id: 'new',   label: 'New report', icon: 'Plus' },
  { id: 'sheet', label: 'From Sheet', icon: 'ScanLine' },
  { id: 'zelt',  label: 'From Zelt',  icon: 'Table' },
];

export default function ReportsHub() {
  const [tab, setTab] = useState('list');

  return (
    <div className="animate-slide-up">
      <PageHeader
        eyebrow="WORKSPACE"
        title="Reports Dashboard"
        subtitle="Create, browse, and generate reports — all in one place."
        actions={tab !== 'new' ? <Btn variant="primary" icon="Plus" onClick={() => setTab('new')}>New report</Btn> : null}
      />

      <div style={{ display: 'flex', alignItems: 'center', gap: 4, padding: 3, background: 'var(--ink-100)', borderRadius: 'var(--r-pill)', width: 'fit-content', marginBottom: 18 }}>
        {TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 16px', borderRadius: 'var(--r-pill)',
              background: tab === t.id ? '#fff' : 'transparent',
              color: tab === t.id ? 'var(--ink-900)' : 'var(--ink-600)',
              boxShadow: tab === t.id ? 'var(--shadow-sm)' : 'none',
              fontSize: 13, fontWeight: 700, border: 'none', cursor: 'pointer', letterSpacing: '-0.01em',
            }}
          >
            <Icon name={t.icon} size={14} /> {t.label}
          </button>
        ))}
      </div>

      {tab === 'list'  && <ReportsListPage embedded />}
      {tab === 'new'   && <NewReportPage embedded />}
      {tab === 'sheet' && <SheetReaderPage embedded />}
      {tab === 'zelt'  && <ZeltReportPage embedded />}
    </div>
  );
}
