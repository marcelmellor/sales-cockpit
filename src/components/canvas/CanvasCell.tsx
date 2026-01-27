'use client';

import { ReactNode, useState, useMemo } from 'react';
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
  maxLength?: number;
}

// Strip HTML tags to get plain text length
function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').trim();
}

// Truncate HTML content while preserving tags
function truncateHtml(html: string, maxLength: number): string {
  let textLength = 0;
  let result = '';
  let inTag = false;
  let tagBuffer = '';

  for (let i = 0; i < html.length; i++) {
    const char = html[i];

    if (char === '<') {
      inTag = true;
      tagBuffer = char;
    } else if (char === '>') {
      inTag = false;
      tagBuffer += char;
      result += tagBuffer;
      tagBuffer = '';
    } else if (inTag) {
      tagBuffer += char;
    } else {
      if (textLength >= maxLength) {
        result += '...';
        break;
      }
      result += char;
      textLength++;
    }
  }

  return result;
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
  maxLength = 200,
}: CanvasCellProps) {
  const { activeCell, setActiveCell, updateField } = useCanvasStore();
  const isActive = activeCell === id;
  const [isEditing, setIsEditing] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);

  const { isTruncated, displayContent } = useMemo(() => {
    if (!textContent) return { isTruncated: false, displayContent: '' };
    const plainText = stripHtml(textContent);
    const needsTruncation = plainText.length > maxLength;
    return {
      isTruncated: needsTruncation,
      displayContent: needsTruncation && !isExpanded ? truncateHtml(textContent, maxLength) : textContent,
    };
  }, [textContent, maxLength, isExpanded]);

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
        relative bg-white p-4 min-h-[100px]
        ${highlighted ? 'bg-yellow-50' : ''}
        ${isActive ? 'ring-2 ring-blue-500 ring-inset z-10' : ''}
        ${className}
      `}
    >
      <div className="flex items-center justify-between mb-2">
        <h3 className="font-medium text-xs text-gray-400 uppercase tracking-wide">{title}</h3>
        {editable && (
          <button
            onClick={isEditing ? handleSave : handleEdit}
            className="p-1 rounded hover:bg-gray-100 text-gray-500 hover:text-gray-700 transition-colors"
          >
            {isEditing ? <Check size={16} /> : <Pencil size={16} />}
          </button>
        )}
      </div>
      <div className="text-sm text-gray-600">
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
          ) : (
            <div>
              <div
                className={`prose prose-sm max-w-none rounded-lg p-2 -m-2 min-h-[50px] transition-colors ${columns === 2 ? 'columns-2 gap-6' : ''} ${editable ? 'cursor-pointer hover:bg-gray-50/50' : ''}`}
                onClick={editable ? handleEdit : undefined}
                dangerouslySetInnerHTML={{ __html: displayContent || (editable ? `<p class="text-gray-400 italic">${placeholder || 'Klicken zum Bearbeiten...'}</p>` : `<p class="text-gray-400 italic">Keine Daten</p>`) }}
              />
              {isTruncated && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setIsExpanded(!isExpanded);
                  }}
                  className="mt-2 text-xs text-gray-500 hover:text-gray-900 font-medium transition-colors"
                >
                  {isExpanded ? 'Weniger' : 'Mehr'}
                </button>
              )}
            </div>
          )
        ) : null}
      </div>
    </div>
  );
}
