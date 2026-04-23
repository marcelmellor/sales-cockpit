'use client';

// Generische FilterBuilder-UI. Entitäts-unabhängig: rendert Criterion-Zeilen
// für eine beliebige Menge von Feldern (FieldConfig[]), ohne Deals oder Leads
// direkt zu kennen. Wird von DashboardView, der Deals-Tab und der Leads-Tab
// identisch benutzt.

import { useCallback, useState } from 'react';
import {
  Check,
  ChevronDown,
  ChevronRight,
  Group,
  Plus,
  Save,
  X,
  Loader2,
} from 'lucide-react';
import type {
  FieldConfig,
  FieldInputKind,
  FilterBadge,
  FilterCriterion,
  FilterLogic,
  FilterNode,
  FilterState,
  SavedFilterSet,
} from './types';
import { countActiveCriteria, makeCriterion, makeGroup } from './engine';

// ── Criterion Row ────────────────────────────────────────────────────────

function CriterionRow<T extends string>({
  criterion,
  fieldConfigs,
  onUpdate,
  onRemove,
}: {
  criterion: FilterCriterion<T>;
  fieldConfigs: FieldConfig<T>[];
  onUpdate: (patch: Partial<FilterCriterion<T>>) => void;
  onRemove: () => void;
}) {
  const config = fieldConfigs.find(f => f.type === criterion.type) ?? fieldConfigs[0];
  const inputKind: FieldInputKind = config?.inputKind ?? 'date';

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <select
        value={criterion.type}
        onChange={(e) => {
          const nextType = e.target.value as T;
          const nextConfig = fieldConfigs.find(f => f.type === nextType);
          const nextKind = nextConfig?.inputKind ?? 'date';
          onUpdate({
            type: nextType,
            // Payload passend zum neuen InputKind zurücksetzen, damit Altwerte
            // (z.B. ein dateFrom beim Wechsel auf number) nichts verfälschen.
            stageId: nextKind === 'stageDate' ? criterion.stageId : undefined,
            dateFrom: nextKind === 'date' || nextKind === 'stageDate' ? '' : '',
            dateTo: undefined,
            numberFrom: nextKind === 'number' ? undefined : undefined,
            numberTo: undefined,
            stringValue: nextKind === 'enum' ? undefined : undefined,
            booleanValue: nextKind === 'boolean' ? undefined : undefined,
            operator: nextKind === 'enum' || nextKind === 'boolean' ? 'after' : criterion.operator,
          });
        }}
        className="border border-gray-300 rounded-md px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white"
      >
        {fieldConfigs.map(f => (
          <option key={f.type} value={f.type}>{f.label}</option>
        ))}
      </select>

      {inputKind === 'stageDate' && (
        <select
          value={criterion.stageId ?? ''}
          onChange={(e) => onUpdate({ stageId: e.target.value || undefined })}
          className="border border-gray-300 rounded-md px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white"
        >
          <option value="">Stage...</option>
          {(config?.stages ?? []).map(s => (
            <option key={s.id} value={s.id}>{s.label}</option>
          ))}
        </select>
      )}

      {/* Operator — enum/boolean brauchen keinen Operator */}
      {inputKind !== 'enum' && inputKind !== 'boolean' && (
        <select
          value={criterion.operator}
          onChange={(e) => onUpdate({ operator: e.target.value as FilterCriterion<T>['operator'] })}
          className="border border-gray-300 rounded-md px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white"
        >
          {inputKind === 'number' ? (
            <>
              <option value="after">mindestens</option>
              <option value="before">höchstens</option>
              <option value="between">zwischen</option>
            </>
          ) : (
            <>
              <option value="after">nach</option>
              <option value="before">vor</option>
              <option value="between">zwischen</option>
            </>
          )}
        </select>
      )}

      {inputKind === 'number' && (
        <>
          <input
            type="number"
            value={criterion.numberFrom ?? ''}
            onChange={(e) => onUpdate({ numberFrom: e.target.value === '' ? undefined : Number(e.target.value) })}
            placeholder={config?.numberPlaceholderFrom ?? ''}
            className="border border-gray-300 rounded-md px-2 py-1 text-sm w-24 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          />
          {criterion.operator === 'between' && (
            <>
              <span className="text-sm text-gray-500">und</span>
              <input
                type="number"
                value={criterion.numberTo ?? ''}
                onChange={(e) => onUpdate({ numberTo: e.target.value === '' ? undefined : Number(e.target.value) })}
                placeholder={config?.numberPlaceholderTo ?? ''}
                className="border border-gray-300 rounded-md px-2 py-1 text-sm w-24 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
            </>
          )}
          {config?.numberUnit && (
            <span className="text-xs text-gray-400">{config.numberUnit}</span>
          )}
        </>
      )}

      {(inputKind === 'date' || inputKind === 'stageDate') && (
        <>
          <input
            type="date"
            value={criterion.dateFrom}
            onChange={(e) => onUpdate({ dateFrom: e.target.value })}
            onInput={(e) => onUpdate({ dateFrom: (e.target as HTMLInputElement).value })}
            className="border border-gray-300 rounded-md px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          />
          {criterion.operator === 'between' && (
            <>
              <span className="text-sm text-gray-500">und</span>
              <input
                type="date"
                value={criterion.dateTo ?? ''}
                onChange={(e) => onUpdate({ dateTo: e.target.value })}
                onInput={(e) => onUpdate({ dateTo: (e.target as HTMLInputElement).value })}
                className="border border-gray-300 rounded-md px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
            </>
          )}
        </>
      )}

      {inputKind === 'enum' && (
        <select
          value={criterion.stringValue ?? ''}
          onChange={(e) => onUpdate({ stringValue: e.target.value || undefined })}
          className="border border-gray-300 rounded-md px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white min-w-[160px]"
        >
          <option value="">Wert...</option>
          {(config?.enumOptions ?? []).map(o => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      )}

      {inputKind === 'boolean' && (
        <select
          value={criterion.booleanValue == null ? '' : criterion.booleanValue ? 'true' : 'false'}
          onChange={(e) =>
            onUpdate({ booleanValue: e.target.value === '' ? undefined : e.target.value === 'true' })
          }
          className="border border-gray-300 rounded-md px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white"
        >
          <option value="">...</option>
          <option value="true">{config?.booleanTrueLabel ?? 'Ja'}</option>
          <option value="false">{config?.booleanFalseLabel ?? 'Nein'}</option>
        </select>
      )}

      <button
        onClick={onRemove}
        className="p-1 text-gray-400 hover:text-red-500 transition-colors"
        title="Filter entfernen"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}

// ── Rekursive NodeList ───────────────────────────────────────────────────

function FilterNodeList<T extends string>({
  nodes,
  logic,
  fieldConfigs,
  defaultType,
  onSetFilter,
  parentPath,
}: {
  nodes: FilterNode<T>[];
  logic: FilterLogic;
  fieldConfigs: FieldConfig<T>[];
  defaultType: T;
  onSetFilter: React.Dispatch<React.SetStateAction<FilterState<T>>>;
  parentPath: string[];
}) {
  const updateChildren = useCallback(
    (updater: (children: FilterNode<T>[]) => FilterNode<T>[]) => {
      onSetFilter(prev => {
        if (parentPath.length === 0) {
          return { ...prev, children: updater(prev.children) };
        }
        const updateAtPath = (children: FilterNode<T>[], path: string[]): FilterNode<T>[] => {
          if (path.length === 0) return updater(children);
          const [head, ...rest] = path;
          return children.map(ch => {
            if (ch.kind === 'group' && ch.id === head) {
              return { ...ch, children: updateAtPath(ch.children, rest) };
            }
            return ch;
          });
        };
        return { ...prev, children: updateAtPath(prev.children, parentPath) };
      });
    },
    [onSetFilter, parentPath],
  );

  const toggleLogicAtLevel = useCallback(() => {
    onSetFilter(prev => {
      if (parentPath.length === 0) {
        return { ...prev, logic: prev.logic === 'AND' ? 'OR' : 'AND' };
      }
      const toggleInTree = (children: FilterNode<T>[], path: string[]): FilterNode<T>[] => {
        if (path.length === 1) {
          return children.map(ch => {
            if (ch.kind === 'group' && ch.id === path[0]) {
              return { ...ch, logic: ch.logic === 'AND' ? 'OR' : 'AND' };
            }
            return ch;
          });
        }
        const [head, ...rest] = path;
        return children.map(ch => {
          if (ch.kind === 'group' && ch.id === head) {
            return { ...ch, children: toggleInTree(ch.children, rest) };
          }
          return ch;
        });
      };
      return { ...prev, children: toggleInTree(prev.children, parentPath) };
    });
  }, [onSetFilter, parentPath]);

  const updateCriterion = useCallback(
    (id: string, patch: Partial<FilterCriterion<T>>) => {
      updateChildren(children =>
        children.map(ch => (ch.kind === 'criterion' && ch.id === id ? { ...ch, ...patch } : ch)),
      );
    },
    [updateChildren],
  );

  const removeNode = useCallback(
    (id: string) => {
      updateChildren(children => children.filter(ch => ch.id !== id));
    },
    [updateChildren],
  );

  const addCriterion = useCallback(() => {
    updateChildren(children => [...children, makeCriterion<T>({ type: defaultType })]);
  }, [updateChildren, defaultType]);

  const addGroup = useCallback(() => {
    updateChildren(children => [
      ...children,
      makeGroup<T>(logic === 'AND' ? 'OR' : 'AND', defaultType),
    ]);
  }, [updateChildren, logic, defaultType]);

  return (
    <div className="space-y-1.5">
      {nodes.map((node, idx) => (
        <div key={node.id}>
          {idx > 0 && nodes.length > 1 && (
            <div className="flex items-center gap-2 py-0.5">
              <button
                onClick={toggleLogicAtLevel}
                className="px-2 py-0.5 text-xs font-medium rounded border border-blue-300 bg-blue-50 text-blue-700 hover:bg-blue-100 transition-colors"
                title="Klicken zum Umschalten"
              >
                {logic}
              </button>
            </div>
          )}

          {node.kind === 'criterion' ? (
            <CriterionRow<T>
              criterion={node}
              fieldConfigs={fieldConfigs}
              onUpdate={(patch) => updateCriterion(node.id, patch)}
              onRemove={() => removeNode(node.id)}
            />
          ) : (
            <div className="border border-blue-200 bg-blue-50/30 rounded-lg px-3 py-2 relative">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-xs font-medium text-blue-600 flex items-center gap-1">
                  <Group className="h-3 w-3" />
                  Gruppe ({node.logic})
                </span>
                <button
                  onClick={() => removeNode(node.id)}
                  className="p-0.5 text-gray-400 hover:text-red-500 transition-colors"
                  title="Gruppe entfernen"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
              <FilterNodeList<T>
                nodes={node.children}
                logic={node.logic}
                fieldConfigs={fieldConfigs}
                defaultType={defaultType}
                onSetFilter={onSetFilter}
                parentPath={[...parentPath, node.id]}
              />
            </div>
          )}
        </div>
      ))}

      <div className="flex items-center gap-2 pt-0.5">
        <button
          onClick={addCriterion}
          className="flex items-center gap-1 px-2 py-1 text-xs rounded-md border border-dashed border-gray-300 text-gray-600 hover:bg-gray-50 hover:border-gray-400 transition-colors"
        >
          <Plus className="h-3 w-3" /> Filter
        </button>
        <button
          onClick={addGroup}
          className="flex items-center gap-1 px-2 py-1 text-xs rounded-md border border-dashed border-blue-300 text-blue-600 hover:bg-blue-50 hover:border-blue-400 transition-colors"
        >
          <Group className="h-3 w-3" /> Gruppe
        </button>
      </div>
    </div>
  );
}

// ── FilterBuilder (Top-Level) ────────────────────────────────────────────

export interface FilterBuilderProps<T extends string> {
  filter: FilterState<T>;
  onSetFilter: React.Dispatch<React.SetStateAction<FilterState<T>>>;
  fieldConfigs: FieldConfig<T>[];
  defaultType: T;
  getInputKind: (type: T) => FieldInputKind;
  quickButtons?: { label: string; action: () => void }[];
  totalFiltered: number;
  totalItems: number;
  itemLabel?: string; // "Deals" | "Leads"
  /** Label für die Auslastungs-Spinner, falls einer der Kriteriumstypen
   *  zusätzliche Daten (z.B. stageHistory) benötigt, die noch laden. */
  pendingDataLabel?: string | null;
  pendingDataLoading?: boolean;
  savedSets?: SavedFilterSet<T>[];
  onSaveFilterSet?: (name: string) => void;
  onDeleteFilterSet?: (id: string) => void;
  showFilterSets?: boolean;
  /** System-Badges (fest in der App definiert, nicht löschbar). */
  systemBadges?: FilterBadge<T>[];
  /** IDs der aktuell aktiven Badges (System + gespeicherte Sets). */
  activeBadgeIds?: string[];
  /** Umschalten eines Badges (System oder gespeichertes Set). */
  onToggleBadge?: (id: string) => void;
  /** Default: true (beim ersten Render kollabiert). */
  defaultCollapsed?: boolean;
}

export function FilterBuilder<T extends string>({
  filter,
  onSetFilter,
  fieldConfigs,
  defaultType,
  getInputKind,
  quickButtons = [],
  totalFiltered,
  totalItems,
  itemLabel = 'Einträge',
  pendingDataLabel = null,
  pendingDataLoading = false,
  savedSets = [],
  onSaveFilterSet,
  onDeleteFilterSet,
  showFilterSets = false,
  systemBadges = [],
  activeBadgeIds = [],
  onToggleBadge,
  defaultCollapsed = true,
}: FilterBuilderProps<T>) {
  const [isSaving, setIsSaving] = useState(false);
  const [saveName, setSaveName] = useState('');
  const [collapsed, setCollapsed] = useState(defaultCollapsed);

  const activeCount = countActiveCriteria<T>(filter.children, getInputKind);

  // Alle Badges (System + gespeicherte Sets als Badge gerendert). System
  // kommt zuerst, damit feste Bausteine oben links stehen.
  const savedAsBadges: FilterBadge<T>[] = savedSets.map(s => ({
    id: s.id,
    label: s.name,
    filter: s.filter,
  }));
  const allBadges: FilterBadge<T>[] = [...systemBadges, ...savedAsBadges];
  const showBadgesRow = onToggleBadge != null && allBadges.length > 0;

  return (
    <div className="space-y-2 mb-6">
      <button
        onClick={() => setCollapsed(prev => !prev)}
        className="flex items-center gap-1.5 text-sm text-gray-600 hover:text-gray-900 transition-colors"
      >
        {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        <span className="font-medium">Filter</span>
        {collapsed && activeCount > 0 && (
          <span className="text-xs text-gray-400">({activeCount} aktiv)</span>
        )}
        {collapsed && (
          <span className="text-xs text-gray-400 ml-1">
            {totalFiltered} von {totalItems} {itemLabel}
          </span>
        )}
      </button>

      {showBadgesRow && (
        <div className="flex items-center gap-2 flex-wrap">
          {allBadges.map(badge => {
            const active = activeBadgeIds.includes(badge.id);
            const deletable = !badge.system && onDeleteFilterSet != null;
            return (
              <div
                key={badge.id}
                className={`group relative inline-flex items-center gap-1 rounded-full border text-xs pl-3 transition-colors ${
                  deletable ? 'pr-1' : 'pr-3'
                } py-1 ${
                  active
                    ? 'bg-blue-600 border-blue-600 text-white hover:bg-blue-700'
                    : 'bg-white border-gray-300 text-gray-600 hover:bg-gray-50'
                }`}
              >
                <button
                  onClick={() => onToggleBadge!(badge.id)}
                  className="focus:outline-none"
                  title={active ? 'Deaktivieren' : 'Aktivieren'}
                >
                  {badge.label}
                </button>
                {deletable && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onDeleteFilterSet!(badge.id);
                    }}
                    className={`ml-0.5 rounded-full p-0.5 transition-colors ${
                      active
                        ? 'hover:bg-blue-800 text-blue-100'
                        : 'hover:bg-gray-200 text-gray-400'
                    }`}
                    title="Gespeicherten Filter löschen"
                  >
                    <X className="h-3 w-3" />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {!collapsed && (
        <>
          <FilterNodeList<T>
            nodes={filter.children}
            logic={filter.logic}
            fieldConfigs={fieldConfigs}
            defaultType={defaultType}
            onSetFilter={onSetFilter}
            parentPath={[]}
          />

          <div className="flex items-center gap-3 flex-wrap pt-1">
            {quickButtons.length > 0 && (
              <>
                <div className="w-px h-5 bg-gray-200" />
                <div className="flex gap-1">
                  {quickButtons.map((btn) => (
                    <button
                      key={btn.label}
                      onClick={btn.action}
                      className="px-2 py-1 text-xs rounded-md border border-gray-300 text-gray-600 hover:bg-gray-100 transition-colors"
                    >
                      {btn.label}
                    </button>
                  ))}
                </div>
              </>
            )}

            {showFilterSets && onSaveFilterSet && (
              <>
                <div className="w-px h-5 bg-gray-200" />

                {isSaving ? (
                  <div className="flex items-center gap-1">
                    <input
                      type="text"
                      value={saveName}
                      onChange={(e) => setSaveName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && saveName.trim()) {
                          onSaveFilterSet(saveName);
                          setSaveName('');
                          setIsSaving(false);
                        }
                        if (e.key === 'Escape') {
                          setSaveName('');
                          setIsSaving(false);
                        }
                      }}
                      placeholder="Name..."
                      autoFocus
                      className="border border-gray-300 rounded-md px-2 py-0.5 text-xs w-32 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    />
                    <button
                      onClick={() => {
                        if (saveName.trim()) {
                          onSaveFilterSet(saveName);
                          setSaveName('');
                          setIsSaving(false);
                        }
                      }}
                      disabled={!saveName.trim()}
                      className="p-1 text-green-600 hover:text-green-700 disabled:text-gray-300 transition-colors"
                      title="Speichern"
                    >
                      <Check className="h-3.5 w-3.5" />
                    </button>
                    <button
                      onClick={() => {
                        setSaveName('');
                        setIsSaving(false);
                      }}
                      className="p-1 text-gray-400 hover:text-gray-600 transition-colors"
                      title="Abbrechen"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setIsSaving(true)}
                    className="flex items-center gap-1 px-2 py-1 text-xs rounded-md border border-gray-300 text-gray-600 hover:bg-gray-100 transition-colors"
                    title="Filter speichern"
                  >
                    <Save className="h-3 w-3" /> Speichern
                  </button>
                )}
              </>
            )}

            <span className="text-xs text-gray-400 ml-2">
              {totalFiltered} von {totalItems} {itemLabel}
            </span>

            {pendingDataLoading && pendingDataLabel && (
              <span className="flex items-center gap-1 text-xs text-blue-500 ml-2">
                <Loader2 className="h-3 w-3 animate-spin" />
                {pendingDataLabel}
              </span>
            )}
          </div>
        </>
      )}
    </div>
  );
}
