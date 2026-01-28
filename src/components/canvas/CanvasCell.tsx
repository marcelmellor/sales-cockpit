'use client';

import { ReactNode, useState, useRef, useEffect } from 'react';
import { RichTextEditor } from '@/components/editor/RichTextEditor';
import { useCanvasStore } from '@/stores/canvas-store';
import { Pencil, Check } from 'lucide-react';

interface CanvasCellProps {
  id: string;
  title: string;
  children?: ReactNode;
  highlighted?: boolean;
  className?: string;
  editable?: boolean;
  fieldPath?: string;
  textContent?: string;
  placeholder?: string;
  columns?: number;
  hideTitle?: boolean;
  onExpandChange?: (expanded: boolean) => void;
}

// Strip HTML tags to get plain text length
function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').trim();
}

// Make "Word:" at the beginning of a line bold
function formatLeadingLabels(html: string): string {
  // Match paragraphs and make leading "Word:" bold
  return html.replace(
    /(<p[^>]*>)(\s*)([A-Za-zÄÖÜäöüß][A-Za-zÄÖÜäöüß\s]*?:)(\s)/gi,
    '$1$2<strong>$3</strong>$4'
  );
}

// Split HTML content into two columns by paragraphs
function splitIntoColumns(html: string): [string, string] {
  // Match all paragraph tags
  const paragraphs = html.match(/<p[^>]*>.*?<\/p>/gi) || [];

  if (paragraphs.length === 0) {
    return [html, ''];
  }

  if (paragraphs.length === 1) {
    return [paragraphs[0], ''];
  }

  // Calculate total text length
  const lengths = paragraphs.map(p => stripHtml(p).length);
  const totalLength = lengths.reduce((a, b) => a + b, 0);
  const halfLength = totalLength / 2;

  // Find split point
  let currentLength = 0;
  let splitIndex = 0;
  for (let i = 0; i < lengths.length; i++) {
    currentLength += lengths[i];
    if (currentLength >= halfLength) {
      // Check if this paragraph or the previous one is closer to half
      const beforeHalf = currentLength - lengths[i];
      const afterHalf = currentLength;
      splitIndex = (halfLength - beforeHalf) < (afterHalf - halfLength) ? i : i + 1;
      break;
    }
  }

  // Ensure at least one paragraph in each column
  splitIndex = Math.max(1, Math.min(splitIndex, paragraphs.length - 1));

  const leftColumn = paragraphs.slice(0, splitIndex).join('');
  const rightColumn = paragraphs.slice(splitIndex).join('');

  return [leftColumn, rightColumn];
}

export function CanvasCell({
  id,
  title,
  children,
  highlighted = false,
  className = '',
  editable = true,
  fieldPath,
  textContent,
  placeholder,
  columns,
  hideTitle = false,
  onExpandChange,
}: CanvasCellProps) {
  const { activeCell, setActiveCell, updateField } = useCanvasStore();
  const isActive = activeCell === id;
  const [isEditing, setIsEditing] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const [hasOverflow, setHasOverflow] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);

  // Notify parent when expanded state changes
  useEffect(() => {
    onExpandChange?.(isExpanded);
  }, [isExpanded, onExpandChange]);

  // Display content without character truncation - rely on overflow detection
  const displayContent = textContent || '';

  // Detect overflow using ResizeObserver (works for all layouts with fixed height parents)
  useEffect(() => {
    if (!contentRef.current || isExpanded) {
      setHasOverflow(false);
      return;
    }

    const el = contentRef.current;

    const checkOverflow = () => {
      const isOverflowing = el.scrollHeight > el.clientHeight + 5;
      setHasOverflow(isOverflowing);
    };

    // Check immediately after layout
    requestAnimationFrame(checkOverflow);

    // Also observe size changes
    const observer = new ResizeObserver(checkOverflow);
    observer.observe(el);

    return () => observer.disconnect();
  }, [textContent, isExpanded]);

  const handleEdit = () => {
    if (editable) {
      setIsEditing(true);
      setActiveCell(id);
    }
  };

  const handleSave = () => {
    setIsEditing(false);
    setActiveCell(null);
  };

  const handleChange = (value: string) => {
    if (fieldPath) {
      updateField(fieldPath, value);
    }
  };

  return (
    <div
      className={`
        relative bg-white p-4 min-h-[100px] flex flex-col
        ${highlighted ? 'bg-yellow-50' : ''}
        ${isActive ? 'ring-2 ring-blue-500 ring-inset z-10' : ''}
        ${className}
      `}
    >
      {!hideTitle ? (
        <div className="flex items-center justify-between mb-2">
          <h3 className="font-medium text-xs text-gray-400 uppercase tracking-wide">{title}</h3>
          {editable && (
            <button
              onClick={isEditing ? handleSave : handleEdit}
              className="no-print p-1 rounded hover:bg-gray-100 text-gray-500 hover:text-gray-700 transition-colors"
            >
              {isEditing ? <Check size={16} /> : <Pencil size={16} />}
            </button>
          )}
        </div>
      ) : editable && (
        <button
          onClick={isEditing ? handleSave : handleEdit}
          className="no-print absolute top-2 right-2 p-1 rounded hover:bg-gray-100 text-gray-500 hover:text-gray-700 transition-colors z-10"
        >
          {isEditing ? <Check size={16} /> : <Pencil size={16} />}
        </button>
      )}
      <div className="text-sm text-gray-600 flex-1 flex flex-col min-h-0">
        {children ? (
          children
        ) : fieldPath && textContent !== undefined ? (
          isEditing ? (
            <RichTextEditor
              content={textContent}
              onChange={handleChange}
              placeholder={placeholder}
              editable={true}
            />
          ) : (() => {
            // Shared logic for both column and single-column layouts
            const emptyPlaceholder = editable
              ? `<p class="text-gray-400 italic">${placeholder || 'Klicken zum Bearbeiten...'}</p>`
              : `<p class="text-gray-400 italic">Keine Daten</p>`;
            const showExpandButton = hasOverflow || isExpanded;
            const isContentTruncated = hasOverflow && !isExpanded;

            return (
              <div className="flex-1 flex flex-col min-h-0">
                <div
                  ref={contentRef}
                  className={`flex-1 min-h-0 relative ${isContentTruncated ? 'overflow-hidden' : ''}`}
                >
                  {columns === 2 ? (
                    // Two-column grid layout
                    (() => {
                      const [leftCol, rightCol] = splitIntoColumns(displayContent || '');
                      return (
                        <div
                          className={`grid grid-cols-2 gap-6 rounded-lg p-2 -m-2 transition-colors ${editable ? 'cursor-pointer hover:bg-gray-50/50' : ''}`}
                          onClick={editable ? handleEdit : undefined}
                        >
                          <div
                            className="prose prose-sm max-w-none"
                            dangerouslySetInnerHTML={{ __html: formatLeadingLabels(leftCol) || emptyPlaceholder }}
                          />
                          <div
                            className="prose prose-sm max-w-none"
                            dangerouslySetInnerHTML={{ __html: formatLeadingLabels(rightCol) || '' }}
                          />
                        </div>
                      );
                    })()
                  ) : (
                    // Single-column layout
                    <div
                      className={`prose prose-sm max-w-none rounded-lg p-2 -m-2 min-h-[50px] transition-colors ${editable ? 'cursor-pointer hover:bg-gray-50/50' : ''}`}
                      onClick={editable ? handleEdit : undefined}
                      dangerouslySetInnerHTML={{ __html: formatLeadingLabels(displayContent) || emptyPlaceholder }}
                    />
                  )}
                  {/* Fade overlay when content is truncated */}
                  {isContentTruncated && (
                    <div className="absolute bottom-0 left-0 right-0 h-8 bg-gradient-to-t from-white to-transparent pointer-events-none" />
                  )}
                </div>
                {showExpandButton && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setIsExpanded(!isExpanded);
                    }}
                    className="no-print mt-2 text-xs text-gray-500 hover:text-gray-900 font-medium transition-colors shrink-0"
                  >
                    {isExpanded ? 'Weniger' : 'Mehr'}
                  </button>
                )}
              </div>
            );
          })()
        ) : null}
      </div>
    </div>
  );
}
