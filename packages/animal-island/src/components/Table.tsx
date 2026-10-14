/** Table ported from animal-island-vue Table.vue (MIT).
 * Native adaptation: semantic table tags use flex rows/cells with accessibility
 * roles. Width/alignment, cream palette, stripes and teal hover are preserved;
 * dotted row separators use a single dashed SVG (no CSS repeating gradient), and
 * the browser's animated circular loading SVG becomes native Spinner dots.
 * A single body scroll surface supports x/y; header scrolls with the rows. GPUIV
 * has no sticky/fixed cells, so column.fixed is unsupported (the original Vue
 * component did not implement it either). Mount a y-scrolling Table outside
 * another scroll parent. Classes are metadata; customize with native StyleDesc.
 */
import { computed, defineComponent, isVNode, ref, type PropType, type VNode, type VNodeChild } from 'vue';
import { Spinner, type EventPayload, type StyleDesc } from '@gpuiv/vue';
import { Pagination, type PaginationProps } from './Pagination.js';
import { activationKeys } from '../interaction.js';
import { colors, fonts } from '../tokens.js';

export type TableRecord = Record<string, unknown>;
const SEPARATOR_SVG = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="960" height="1" viewBox="0 0 960 1"><path d="M0 .5H960" fill="none" stroke="black" stroke-dasharray="6 6" /></svg>')}`;
export interface TableColumn<T extends TableRecord = TableRecord> {
    title: VNode | string | (() => VNode | string);
    dataIndex?: string | (string | number)[];
    render?: (value: unknown, record: T, index: number) => VNode | string | number | null;
    width?: number | string;
    align?: 'left' | 'center' | 'right';
    /** Unsupported: GPUIV has no sticky cells; this column scrolls normally. */
    fixed?: 'left' | 'right';
    style?: StyleDesc;
}
export type ColumnType<T extends TableRecord = TableRecord> = TableColumn<T>;
export type TablePagination = Omit<PaginationProps, 'total'>;
export interface TableRowAttributes {
    class?: string | string[] | Record<string, boolean>;
    style?: StyleDesc;
    onClick?: (event: EventPayload) => void;
    onDblclick?: (event: EventPayload) => void;
    [key: string]: unknown;
}
export interface TableProps<T extends TableRecord = TableRecord> {
    columns?: TableColumn<T>[];
    dataSource?: T[];
    rowKey?: string | ((record: T) => string);
    striped?: boolean;
    showHeader?: boolean;
    rowClassName?: string | ((record: T, index: number) => string);
    onRow?: (record: T, index: number) => TableRowAttributes;
    loading?: boolean;
    emptyText?: string | VNode;
    scroll?: { x?: number | string; y?: number | string };
    pagination?: false | TablePagination;
    className?: string;
    style?: StyleDesc;
    testId?: string;
    onChange?: (page: number, pageSize: number) => void;
}

function fieldValue(record: TableRecord, path?: string | (string | number)[]): unknown {
    if (path === undefined) return undefined;
    // Direct dot-named properties remain compatible with the old implementation.
    if (typeof path === 'string' && Object.prototype.hasOwnProperty.call(record, path)) return record[path];
    const parts = Array.isArray(path) ? path : path.replace(/\[(\d+)\]/g, '.$1').split('.');
    return parts.reduce<unknown>((value, part) => value !== null && typeof value === 'object' ? (value as TableRecord)[part] : undefined, record);
}

function painted(value: VNodeChild | unknown): VNodeChild {
    if (isVNode(value)) return value;
    if (Array.isArray(value)) return value.map(painted);
    if (value === null || value === undefined || typeof value === 'boolean') return null;
    return <text>{String(value)}</text>;
}

export const Table = defineComponent({
    name: 'AnimalTable',
    inheritAttrs: false,
    props: {
        columns: { type: Array as PropType<TableColumn[]>, default: () => [] },
        dataSource: { type: Array as PropType<TableRecord[]>, default: () => [] },
        rowKey: { type: [String, Function] as PropType<string | ((record: TableRecord) => string)>, default: 'key' },
        striped: { type: Boolean, default: true },
        showHeader: { type: Boolean, default: true },
        rowClassName: { type: [String, Function] as PropType<TableProps['rowClassName']>, default: undefined },
        onRow: { type: Function as PropType<TableProps['onRow']>, default: undefined },
        loading: { type: Boolean, default: false },
        emptyText: { type: [String, Object] as PropType<string | VNode>, default: '暂无数据' },
        scroll: { type: Object as PropType<TableProps['scroll']>, default: undefined },
        pagination: { type: [Boolean, Object] as PropType<false | TablePagination>, default: undefined },
        className: { type: String, default: undefined },
        style: { type: Object as PropType<StyleDesc>, default: undefined },
        testId: { type: String, default: undefined },
    },
    emits: { change: (_page: number, _size: number) => true },
    setup(props, { attrs, emit, slots }) {
        const innerPage = ref(props.pagination ? props.pagination.defaultCurrent ?? 1 : 1);
        const innerSize = ref(props.pagination ? props.pagination.defaultPageSize ?? 10 : 10);
        const config = computed(() => props.pagination || {});
        const paginated = computed(() => !!props.pagination);
        const pageSize = computed(() => paginated.value ? Math.max(1, config.value.pageSize ?? innerSize.value) : props.dataSource.length);
        const pageCount = computed(() => Math.max(1, Math.ceil(props.dataSource.length / Math.max(1, pageSize.value))));
        const page = computed(() => paginated.value ? Math.max(1, Math.min(config.value.current ?? innerPage.value, pageCount.value)) : 1);
        const data = computed(() => paginated.value ? props.dataSource.slice((page.value - 1) * pageSize.value, page.value * pageSize.value) : props.dataSource);
        function change(next: number, size: number) {
            if (config.value.current === undefined) innerPage.value = next;
            if (config.value.pageSize === undefined) innerSize.value = size;
            emit('change', next, size);
        }
        function cellStyle(col: TableColumn, header: boolean): StyleDesc {
            const align = col.align ?? 'left';
            return {
                display: 'flex', alignItems: 'center',
                justifyContent: align === 'right' ? 'flex-end' : align === 'center' ? 'center' : 'flex-start',
                textAlign: align, minWidth: 0,
                ...(col.width === undefined ? { flexGrow: 1, flexBasis: 0 } : { width: col.width, flexShrink: 0 }),
                paddingTop: header ? 16 : 14, paddingBottom: header ? 16 : 14, paddingLeft: 20, paddingRight: 20,
                fontSize: 14, fontWeight: header ? 700 : 500, lineHeight: 22.4, color: colors.warmSoft,
                ...col.style,
            };
        }
        const separator = () => <div style={{ height: 1, marginLeft: 20, marginRight: 20, overflow: 'hidden', flexShrink: 0 }}>
            <svg src={SEPARATOR_SVG} style={{ width: '100%', height: 1, color: colors.bgSecondary }} />
        </div>;

        return () => <div {...attrs} testId={props.testId} style={{ width: '100%', minWidth: 0, position: 'relative', display: 'flex', flexDirection: 'column', backgroundColor: '#f7f3df', borderRadius: 20, padding: 6, ...(fonts.sans ? { fontFamily: fonts.sans } : {}), ...props.style }}>
            <div style={{
                minWidth: 0,
                ...(props.scroll?.x !== undefined ? { overflowX: 'scroll' } : {}),
                ...(props.scroll?.y !== undefined ? { overflowY: 'scroll', maxHeight: props.scroll.y } : {}),
            }}>
                <div role="table" aria-label={String(attrs['aria-label'] ?? '数据表格')} class={props.className} style={{
                    minWidth: props.scroll?.x, width: '100%', display: 'flex', flexDirection: 'column',
                    ...(props.loading ? { opacity: 0.7, pointerEvents: 'none' as const } : {}),
                }}>
                    {props.showHeader ? <div role="rowgroup">
                        <div role="row" style={{ display: 'flex' }}>{props.columns.map((col, index) => {
                            const path = Array.isArray(col.dataIndex) ? col.dataIndex.join('.') : col.dataIndex;
                            const header = slots[`header-${path ?? index}`];
                            return <div key={index} role="columnheader" style={cellStyle(col, true)}>{painted(header ? header({ column: col }) : typeof col.title === 'function' ? col.title() : col.title)}</div>;
                        })}</div>{separator()}
                    </div> : null}
                    <div role="rowgroup" style={{ display: 'flex', flexDirection: 'column' }}>
                        {props.dataSource.length === 0 ? <div role="row" style={{ paddingTop: 60, paddingBottom: 60, paddingLeft: 20, paddingRight: 20 }}>
                            <div role="cell" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16, color: colors.textSecondary, fontSize: 14 }}>
                                {slots.empty ? painted(slots.empty()) : <><text style={{ opacity: 0.5, fontSize: 40 }}>▤</text>{painted(props.emptyText)}</>}
                            </div>
                        </div> : data.value.map((record, index) => {
                            const rawKey = typeof props.rowKey === 'function' ? props.rowKey(record) : fieldValue(record, props.rowKey);
                            const rowKey = rawKey === null || rawKey === undefined ? String(index) : String(rawKey);
                            const row = props.onRow?.(record, index) ?? {};
                            const rowClass = typeof props.rowClassName === 'function' ? props.rowClassName(record, index) : props.rowClassName;
                            const { onDblclick, onClick, style, ...rowAttrs } = row;
                            return <div key={rowKey}>
                                <div {...rowAttrs} role="row" class={['animal-table__row', rowClass, row.class]} testId={row.testId ?? (props.testId ? `${props.testId}-row-${rowKey}` : undefined)}
                                    tabIndex={onClick && !props.loading ? ((row.tabIndex as number | undefined) ?? 0) : (row.tabIndex as number | undefined)}
                                    onClick={(event: EventPayload) => { if (props.loading) return; onClick?.(event); if ((event.clickCount ?? 0) >= 2) onDblclick?.(event); }}
                                    onKeyDown={onClick && !props.loading ? activationKeys(onClick) : undefined}
                                    style={{ display: 'flex', backgroundColor: props.striped && index % 2 === 1 ? 'rgba(248, 248, 240, 0.6)' : undefined, hover: { backgroundColor: '#d6f0ea', borderRadius: 30 }, ...style }}>
                                    {props.columns.map((col, ci) => {
                                        const path = Array.isArray(col.dataIndex) ? col.dataIndex.join('.') : col.dataIndex;
                                        const value = fieldValue(record, col.dataIndex);
                                        const cellSlot = path ? slots[`cell-${path}`] : undefined;
                                        return <div key={ci} role="cell" style={cellStyle(col, false)}>{painted(cellSlot ? cellSlot({ value, record, index }) : col.render ? col.render(value, record, index) : value)}</div>;
                                    })}
                                </div>{index < data.value.length - 1 ? separator() : null}
                            </div>;
                        })}
                    </div>
                </div>
            </div>
            {paginated.value ? <div style={{ display: 'flex', justifyContent: 'flex-end', paddingTop: 10, paddingRight: 16, paddingBottom: 8, paddingLeft: 16 }}>
                <Pagination {...config.value} total={props.dataSource.length} current={page.value} pageSize={pageSize.value} disabled={props.loading || config.value.disabled} onChange={change} testId={props.testId ? `${props.testId}-pagination` : undefined} />
            </div> : null}
            {props.loading ? <div role="status" aria-label="加载中" testId={props.testId ? `${props.testId}-loading` : undefined} style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, backgroundColor: 'rgba(247, 243, 223, 0.8)', borderRadius: 20, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Spinner size={40} color={colors.primary} /></div> : null}
        </div>;
    },
});

export default Table;
