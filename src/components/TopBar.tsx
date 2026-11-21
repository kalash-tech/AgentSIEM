import React from 'react';
import { Play, ShieldAlert } from 'lucide-react';

export type ActiveTab = 'live' | 'traces' | 'rules' | 'vectors' | 'sdk';

interface TopBarProps {
  activeTab: ActiveTab;
  onSelectTab: (tab: ActiveTab) => void;
  onRunPoisonedDemo: () => void;
  isSimulating: boolean;
}

const NAV_ITEMS: Array<{ id: ActiveTab; label: string; mobileLabel: string }> = [
  { id: 'live', label: 'Live Lab', mobileLabel: 'Lab' },
  { id: 'traces', label: 'Case Traces', mobileLabel: 'Traces' },
  { id: 'rules', label: 'Security Rules', mobileLabel: 'Rules' },
  { id: 'vectors', label: 'Vector Store', mobileLabel: 'Vectors' },
  { id: 'sdk', label: 'OpenSearch & SDK', mobileLabel: 'SDK' },
];

export const TopBar: React.FC<TopBarProps> = ({
  activeTab,
  onSelectTab,
  onRunPoisonedDemo,
  isSimulating,
}) => {
  return (
    <header className="border-b border-zinc-800 bg-black/95 backdrop-blur md:sticky md:top-0 md:z-30">
      <div className="mx-auto flex max-w-[1400px] items-center justify-between gap-8 px-4 py-3.5 sm:px-6 lg:px-8">
        {/* Zone 1: Single text element wordmark */}
        <a
          href="#top"
          onClick={(e) => {
            e.preventDefault();
            onSelectTab('live');
          }}
          className="font-display flex items-center gap-2.5 text-lg font-bold tracking-tight text-white whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500"
        >
          <ShieldAlert className="h-5 w-5 text-blue-500" aria-hidden="true" />
          <span>AgentSIEM</span>
        </a>

        {/* Zone 2: 5 concise single-line nav links */}
        <nav aria-label="Primary navigation" className="hidden md:flex items-center gap-6">
          {NAV_ITEMS.map((item) => {
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onSelectTab(item.id)}
                aria-current={isActive ? 'page' : undefined}
                className={`relative py-1 text-sm font-medium whitespace-nowrap shrink-0 transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-blue-500 ${
                  isActive ? 'text-white' : 'text-zinc-400 hover:text-zinc-100'
                }`}
              >
                {item.label}
                {isActive && (
                  <span
                    aria-hidden="true"
                    className="absolute inset-x-0 -bottom-[15px] h-0.5 bg-blue-500"
                  />
                )}
              </button>
            );
          })}
        </nav>

        {/* Zone 3: 1 primary action CTA */}
        <div className="flex items-center shrink-0">
          <button
            type="button"
            onClick={onRunPoisonedDemo}
            disabled={isSimulating}
            className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors duration-150 hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-60 whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500"
          >
            <Play className="h-4 w-4" aria-hidden="true" />
            <span>{isSimulating ? 'Scanning...' : 'Run Attack Demo'}</span>
          </button>
        </div>
      </div>

      {/* Mobile navigation strip */}
      <nav
        aria-label="Mobile navigation"
        className="flex items-center justify-between gap-1 overflow-x-auto border-t border-zinc-900 px-3 py-2 md:hidden"
      >
        {NAV_ITEMS.map((item) => {
          const isActive = activeTab === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onSelectTab(item.id)}
              className={`px-2.5 py-1 text-xs font-medium whitespace-nowrap shrink-0 rounded ${
                isActive
                  ? 'bg-zinc-800 text-white'
                  : 'text-zinc-400 hover:text-zinc-100'
              }`}
            >
              {item.mobileLabel}
            </button>
          );
        })}
      </nav>
    </header>
  );
};
