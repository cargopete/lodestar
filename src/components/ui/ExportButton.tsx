'use client';

import { useState } from 'react';
import { cn } from '@/lib/utils';

interface ExportButtonProps {
  onExport: () => string;
  filename: string;
  label?: string;
  disabled?: boolean;
}

export function ExportButton({
  onExport,
  filename,
  label = 'Export CSV',
  disabled = false,
}: ExportButtonProps) {
  const [exporting, setExporting] = useState(false);

  const handleExport = async () => {
    if (disabled || exporting) return;

    setExporting(true);
    try {
      const csvContent = onExport();

      // Create blob and download
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.setAttribute('href', url);
      link.setAttribute('download', `${filename}.csv`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Export failed:', error);
    } finally {
      setExporting(false);
    }
  };

  return (
    <button
      onClick={handleExport}
      disabled={disabled || exporting}
      className={cn(
        'inline-flex items-center gap-2 px-3 py-2 text-sm font-medium',
        'rounded-[var(--radius-button)] border border-[var(--border)]',
        'transition-colors',
        disabled || exporting
          ? 'opacity-50 cursor-not-allowed'
          : 'hover:border-[var(--accent-hover)] hover:bg-[var(--bg-elevated)]'
      )}
    >
      {exporting ? (
        <div className="w-4 h-4 border-2 border-[var(--text-muted)] border-t-transparent rounded-full animate-spin" />
      ) : (
        <svg
          className="w-4 h-4 text-[var(--text-muted)]"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
          />
        </svg>
      )}
      <span className="text-[var(--text)]">{label}</span>
    </button>
  );
}
