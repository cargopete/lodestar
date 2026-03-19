'use client';

import { useState, useMemo } from 'react';
import Link from 'next/link';
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  flexRender,
  createColumnHelper,
  type SortingState,
  type RowSelectionState,
} from '@tanstack/react-table';
import { useIndexers, useNetworkStats } from '@/hooks/useNetworkStats';
import {
  weiToGRT,
  formatGRT,
  formatPPM,
  shortenAddress,
  calculateCapacityUsed,
  cn,
} from '@/lib/utils';
import type { Indexer } from '@/lib/queries';
import { Card } from '@/components/ui/Card';
import { ProgressBar } from '@/components/ui/ProgressBar';
import { Badge } from '@/components/ui/Badge';
import { IndexerComparison } from '@/components/ui/IndexerComparison';

interface IndexerRow {
  id: string;
  name: string;
  address: string;
  selfStake: number;
  delegated: number;
  capacity: number;
  rewardCut: number;
  queryCut: number;
  allocations: number;
  allocated: number;
  rewards: number;
  raw: Indexer;
}

const columnHelper = createColumnHelper<IndexerRow>();

export function IndexerTable() {
  const [sorting, setSorting] = useState<SortingState>([
    { id: 'selfStake', desc: true },
  ]);
  const [globalFilter, setGlobalFilter] = useState('');
  const [minStake, setMinStake] = useState(0);
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  const [showComparison, setShowComparison] = useState(false);

  const { data: indexersData, isLoading } = useIndexers({
    first: 100,
    orderBy: 'stakedTokens',
    orderDirection: 'desc',
  });

  const { data: networkData } = useNetworkStats();
  const delegationRatio = networkData?.graphNetwork?.delegationRatio ?? 16;

  const tableData: IndexerRow[] = useMemo(() => {
    if (!indexersData?.indexers) return [];

    return indexersData.indexers
      .map((indexer: Indexer) => {
        const selfStake = weiToGRT(indexer.stakedTokens);
        const delegated = weiToGRT(indexer.delegatedTokens);
        const allocated = weiToGRT(indexer.allocatedTokens);
        const rewards = weiToGRT(indexer.rewardsEarned);

        return {
          id: indexer.id,
          name: indexer.account?.defaultDisplayName || shortenAddress(indexer.id),
          address: indexer.id,
          selfStake,
          delegated,
          capacity: calculateCapacityUsed(selfStake, delegated, delegationRatio),
          rewardCut: indexer.indexingRewardCut,
          queryCut: indexer.queryFeeCut,
          allocations: indexer.allocationCount,
          allocated,
          rewards,
          raw: indexer,
        };
      })
      .filter((row) => row.selfStake >= minStake);
  }, [indexersData, delegationRatio, minStake]);

  const columns = useMemo(
    () => [
      columnHelper.display({
        id: 'select',
        header: ({ table }) => (
          <input
            type="checkbox"
            checked={table.getIsAllRowsSelected()}
            onChange={table.getToggleAllRowsSelectedHandler()}
            className="rounded border-[var(--border)] bg-[var(--bg-elevated)]"
          />
        ),
        cell: ({ row }) => (
          <input
            type="checkbox"
            checked={row.getIsSelected()}
            onChange={row.getToggleSelectedHandler()}
            onClick={(e) => e.stopPropagation()}
            className="rounded border-[var(--border)] bg-[var(--bg-elevated)]"
          />
        ),
      }),
      columnHelper.accessor('name', {
        header: 'Indexer',
        cell: (info) => (
          <div>
            <p className="font-medium text-[var(--text)] hover:text-[var(--accent)] transition-colors">
              {info.getValue()}
            </p>
            <p className="text-xs text-[var(--text-faint)] font-mono">
              {shortenAddress(info.row.original.address)}
            </p>
          </div>
        ),
      }),
      columnHelper.accessor('selfStake', {
        header: 'Self-Stake',
        cell: (info) => (
          <span className="font-mono text-[var(--text)]">
            {formatGRT(info.getValue())} GRT
          </span>
        ),
      }),
      columnHelper.accessor('delegated', {
        header: 'Delegated',
        cell: (info) => (
          <span className="font-mono text-[var(--green)]">
            {formatGRT(info.getValue())} GRT
          </span>
        ),
      }),
      columnHelper.accessor('capacity', {
        header: 'Capacity',
        cell: (info) => {
          const value = info.getValue();
          return (
            <div className="w-24">
              <ProgressBar
                value={value}
                max={100}
                size="sm"
                variant={value > 90 ? 'orange' : 'teal'}
              />
              <span className="text-xs font-mono text-[var(--text-muted)] mt-1 block">
                {value.toFixed(1)}% used
              </span>
            </div>
          );
        },
      }),
      columnHelper.accessor('rewardCut', {
        header: 'Reward Cut',
        cell: (info) => (
          <span className="font-mono text-[var(--text)]">
            {formatPPM(info.getValue())}
          </span>
        ),
      }),
      columnHelper.accessor('allocations', {
        header: 'Allocations',
        cell: (info) => (
          <span className="font-mono text-[var(--text)]">{info.getValue()}</span>
        ),
      }),
      columnHelper.display({
        id: 'actions',
        cell: ({ row }) => (
          <Link
            href={`/indexers/${row.original.address}`}
            className="text-[var(--accent)] hover:underline text-sm"
            onClick={(e) => e.stopPropagation()}
          >
            Details →
          </Link>
        ),
      }),
    ],
    []
  );

  const table = useReactTable({
    data: tableData,
    columns,
    state: {
      sorting,
      globalFilter,
      rowSelection,
    },
    enableRowSelection: true,
    onRowSelectionChange: setRowSelection,
    onSortingChange: setSorting,
    onGlobalFilterChange: setGlobalFilter,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: {
      pagination: {
        pageSize: 25,
      },
    },
  });

  // Get selected indexers for comparison
  const selectedIndexers = useMemo(() => {
    return Object.keys(rowSelection)
      .filter((key) => rowSelection[key])
      .map((key) => {
        const row = tableData[parseInt(key)];
        return {
          id: row.address,
          name: row.name,
          stakedTokens: row.raw.stakedTokens,
          delegatedTokens: row.raw.delegatedTokens,
          allocatedTokens: row.raw.allocatedTokens,
          indexingRewardCut: row.raw.indexingRewardCut,
          queryFeeCut: row.raw.queryFeeCut,
          allocationCount: row.raw.allocationCount,
          rewardsEarned: row.raw.rewardsEarned,
          delegatorParameterCooldown: row.raw.delegatorParameterCooldown,
          lastDelegationParameterUpdate: row.raw.lastDelegationParameterUpdate,
        };
      });
  }, [rowSelection, tableData]);

  const selectedCount = Object.values(rowSelection).filter(Boolean).length;

  return (
    <div className="space-y-4">
      {/* Comparison panel */}
      {selectedCount > 0 && (
        <div className="flex items-center justify-between p-4 rounded-lg bg-[var(--accent-dim)] border border-[var(--accent-hover)]">
          <div className="flex items-center gap-3">
            <Badge variant="accent">{selectedCount} selected</Badge>
            <span className="text-sm text-[var(--text)]">
              {selectedCount >= 2
                ? 'Click "Compare" to view side-by-side'
                : 'Select at least 2 indexers to compare'}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setRowSelection({})}
              className={cn(
                'px-3 py-1.5 text-sm rounded-[var(--radius-button)]',
                'border border-[var(--border)] hover:bg-[var(--bg-elevated)]',
                'transition-colors'
              )}
            >
              Clear
            </button>
            <button
              onClick={() => setShowComparison(true)}
              disabled={selectedCount < 2}
              className={cn(
                'px-3 py-1.5 text-sm font-medium rounded-[var(--radius-button)]',
                'bg-[var(--accent)] text-white',
                'hover:opacity-90 transition-opacity',
                selectedCount < 2 && 'opacity-50 cursor-not-allowed'
              )}
            >
              Compare
            </button>
          </div>
        </div>
      )}

      {/* Comparison modal/panel */}
      {showComparison && selectedCount >= 2 && (
        <div className="relative">
          <button
            onClick={() => setShowComparison(false)}
            className="absolute top-4 right-4 z-10 p-2 rounded-lg bg-[var(--bg-surface)] border border-[var(--border)] hover:border-[var(--accent-hover)]"
          >
            <svg className="w-5 h-5 text-[var(--text-muted)]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
          <IndexerComparison
            indexers={selectedIndexers}
            delegationRatio={delegationRatio}
          />
        </div>
      )}

      <Card className="overflow-hidden">
        {/* Filters */}
        <div className="p-4 border-b border-[var(--border)] flex flex-wrap gap-4 items-center">
          <div className="flex-1 min-w-[200px]">
            <input
              type="text"
              placeholder="Search by name or address..."
              value={globalFilter}
              onChange={(e) => setGlobalFilter(e.target.value)}
              className={cn(
                'w-full px-3 py-2 text-sm rounded-[var(--radius-button)]',
                'bg-[var(--bg-elevated)] border border-[var(--border)]',
                'text-[var(--text)] placeholder:text-[var(--text-faint)]',
                'focus:outline-none focus:border-[var(--accent)]'
              )}
            />
          </div>
          <div className="flex items-center gap-2">
            <label className="text-sm text-[var(--text-muted)]">Min stake:</label>
            <select
              value={minStake}
              onChange={(e) => setMinStake(Number(e.target.value))}
              className={cn(
                'px-3 py-2 text-sm rounded-[var(--radius-button)]',
                'bg-[var(--bg-elevated)] border border-[var(--border)]',
                'text-[var(--text)]',
                'focus:outline-none focus:border-[var(--accent)]'
              )}
            >
              <option value={0}>Any</option>
              <option value={10000}>10K GRT</option>
              <option value={100000}>100K GRT</option>
              <option value={1000000}>1M GRT</option>
            </select>
          </div>
        </div>

        {/* Table */}
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-[var(--bg-elevated)]">
              {table.getHeaderGroups().map((headerGroup) => (
                <tr key={headerGroup.id}>
                  {headerGroup.headers.map((header) => (
                    <th
                      key={header.id}
                      className={cn(
                        'px-4 py-3 text-left text-xs font-medium text-[var(--text-muted)] uppercase tracking-wider',
                        header.column.getCanSort() && 'cursor-pointer select-none hover:text-[var(--text)]'
                      )}
                      onClick={header.column.getToggleSortingHandler()}
                    >
                      <div className="flex items-center gap-1">
                        {flexRender(header.column.columnDef.header, header.getContext())}
                        {header.column.getIsSorted() && (
                          <span className="text-[var(--accent)]">
                            {header.column.getIsSorted() === 'asc' ? '↑' : '↓'}
                          </span>
                        )}
                      </div>
                    </th>
                  ))}
                </tr>
              ))}
            </thead>
            <tbody className="divide-y divide-[var(--border)]">
              {isLoading ? (
                Array.from({ length: 10 }).map((_, i) => (
                  <tr key={i}>
                    {columns.map((_, j) => (
                      <td key={j} className="px-4 py-4">
                        <div className="h-4 w-24 animate-pulse rounded bg-[var(--bg-elevated)]" />
                      </td>
                    ))}
                  </tr>
                ))
              ) : (
                table.getRowModel().rows.map((row) => (
                  <tr
                    key={row.id}
                    className={cn(
                      'hover:bg-[var(--bg-elevated)] transition-colors cursor-pointer',
                      row.getIsSelected() && 'bg-[var(--accent-dim)]'
                    )}
                    onClick={() => {
                      window.location.href = `/indexers/${row.original.address}`;
                    }}
                  >
                    {row.getVisibleCells().map((cell) => (
                      <td key={cell.id} className="px-4 py-4">
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </td>
                    ))}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        <div className="p-4 border-t border-[var(--border)] flex items-center justify-between">
          <div className="text-sm text-[var(--text-muted)]">
            Showing {table.getState().pagination.pageIndex * table.getState().pagination.pageSize + 1} to{' '}
            {Math.min(
              (table.getState().pagination.pageIndex + 1) * table.getState().pagination.pageSize,
              table.getFilteredRowModel().rows.length
            )}{' '}
            of {table.getFilteredRowModel().rows.length} indexers
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => table.previousPage()}
              disabled={!table.getCanPreviousPage()}
              className={cn(
                'px-3 py-1 text-sm rounded-[var(--radius-button)]',
                'border border-[var(--border)]',
                'disabled:opacity-50 disabled:cursor-not-allowed',
                'hover:bg-[var(--bg-elevated)] transition-colors'
              )}
            >
              Previous
            </button>
            <span className="text-sm text-[var(--text-muted)]">
              Page {table.getState().pagination.pageIndex + 1} of {table.getPageCount()}
            </span>
            <button
              onClick={() => table.nextPage()}
              disabled={!table.getCanNextPage()}
              className={cn(
                'px-3 py-1 text-sm rounded-[var(--radius-button)]',
                'border border-[var(--border)]',
                'disabled:opacity-50 disabled:cursor-not-allowed',
                'hover:bg-[var(--bg-elevated)] transition-colors'
              )}
            >
              Next
            </button>
          </div>
        </div>
      </Card>
    </div>
  );
}
