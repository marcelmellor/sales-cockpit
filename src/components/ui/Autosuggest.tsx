'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { Search, X, ChevronDown } from 'lucide-react';

export interface AutosuggestOption {
  id: string;
  label: string;
  sublabel?: string;
}

interface AutosuggestProps {
  options: AutosuggestOption[];
  value: string | null;
  onChange: (id: string | null) => void;
  placeholder?: string;
  disabled?: boolean;
  isLoading?: boolean;
  className?: string;
}

export function Autosuggest({
  options,
  value,
  onChange,
  placeholder = 'Suchen...',
  disabled = false,
  isLoading = false,
  className = '',
}: AutosuggestProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const selectedOption = options.find((opt) => opt.id === value);

  const filteredOptions = query
    ? options.filter((opt) =>
        opt.label.toLowerCase().includes(query.toLowerCase()) ||
        opt.sublabel?.toLowerCase().includes(query.toLowerCase())
      )
    : options;

  const handleSelect = useCallback((id: string) => {
    onChange(id);
    setQuery('');
    setIsOpen(false);
    setHighlightedIndex(0);
  }, [onChange]);

  const handleClear = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    onChange(null);
    setQuery('');
    setIsOpen(false);
  }, [onChange]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (!isOpen) {
      if (e.key === 'Enter' || e.key === 'ArrowDown') {
        setIsOpen(true);
        e.preventDefault();
      }
      return;
    }

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setHighlightedIndex((prev) =>
          prev < filteredOptions.length - 1 ? prev + 1 : prev
        );
        break;
      case 'ArrowUp':
        e.preventDefault();
        setHighlightedIndex((prev) => (prev > 0 ? prev - 1 : 0));
        break;
      case 'Enter':
        e.preventDefault();
        if (filteredOptions[highlightedIndex]) {
          handleSelect(filteredOptions[highlightedIndex].id);
        }
        break;
      case 'Escape':
        setIsOpen(false);
        setQuery('');
        setHighlightedIndex(0);
        break;
    }
  }, [isOpen, filteredOptions, highlightedIndex, handleSelect]);

  // Scroll highlighted item into view
  useEffect(() => {
    if (isOpen && listRef.current) {
      const highlighted = listRef.current.children[highlightedIndex] as HTMLElement;
      if (highlighted) {
        highlighted.scrollIntoView({ block: 'nearest' });
      }
    }
  }, [highlightedIndex, isOpen]);

  // Close on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
        setQuery('');
        setHighlightedIndex(0);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Reset highlighted index when filtered options change
  useEffect(() => {
    setHighlightedIndex(0);
  }, [query]);

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      <div
        className={`
          flex items-center gap-2 bg-gray-50 border border-gray-300 rounded-lg px-3 py-2 text-sm
          focus-within:ring-2 focus-within:ring-blue-500 focus-within:border-blue-500
          ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-text'}
        `}
        onClick={() => {
          if (!disabled) {
            setIsOpen(true);
            inputRef.current?.focus();
          }
        }}
      >
        <Search className="h-4 w-4 text-gray-400 flex-shrink-0" />

        {selectedOption && !isOpen ? (
          <div className="flex-1 flex items-center justify-between min-w-0">
            <span className="truncate">{selectedOption.label}</span>
            <button
              type="button"
              onClick={handleClear}
              className="ml-2 p-0.5 hover:bg-gray-200 rounded flex-shrink-0"
              disabled={disabled}
            >
              <X className="h-3.5 w-3.5 text-gray-500" />
            </button>
          </div>
        ) : (
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              if (!isOpen) setIsOpen(true);
            }}
            onFocus={() => setIsOpen(true)}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            disabled={disabled}
            className="flex-1 bg-transparent outline-none min-w-0 placeholder:text-gray-400"
          />
        )}

        <ChevronDown
          className={`h-4 w-4 text-gray-400 flex-shrink-0 transition-transform ${isOpen ? 'rotate-180' : ''}`}
        />
      </div>

      {isOpen && !disabled && (
        <ul
          ref={listRef}
          className="absolute z-50 mt-1 w-full bg-white border border-gray-200 rounded-lg shadow-lg max-h-60 overflow-auto"
        >
          {isLoading ? (
            <li className="px-3 py-2 text-sm text-gray-500">Laden...</li>
          ) : filteredOptions.length === 0 ? (
            <li className="px-3 py-2 text-sm text-gray-500">
              {query ? 'Keine Ergebnisse' : 'Keine Optionen verfügbar'}
            </li>
          ) : (
            filteredOptions.map((option, index) => (
              <li
                key={option.id}
                onClick={() => handleSelect(option.id)}
                onMouseEnter={() => setHighlightedIndex(index)}
                className={`
                  px-3 py-2 cursor-pointer text-sm
                  ${index === highlightedIndex ? 'bg-blue-50' : 'hover:bg-gray-50'}
                  ${option.id === value ? 'font-medium text-blue-600' : ''}
                `}
              >
                <div className="truncate">{option.label}</div>
                {option.sublabel && (
                  <div className="text-xs text-gray-500 truncate">{option.sublabel}</div>
                )}
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
