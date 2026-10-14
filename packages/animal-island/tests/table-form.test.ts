import { describe, expect, it, vi } from 'vitest';
import { defineComponent, h, ref } from 'vue';
import { Table, type TableRecord } from '../src/components/Table.js';
import { Form } from '../src/components/Form.js';
import { FormItem } from '../src/components/FormItem.js';
import { FormProvider } from '../src/components/FormProvider.js';
import { Input } from '../src/components/Input.js';
import { useForm, type InternalForm } from '../src/form/useForm.js';
import { runRule } from '../src/form/validators.js';
import { mountHost } from './harness.js';

const rows: TableRecord[] = Array.from({ length: 25 }, (_, index) => ({ key: String(index + 1), name: `Name${index + 1}`, user: { age: index + 20 } }));
const columns = [{ title: 'Name', dataIndex: 'name' }, { title: 'Age', dataIndex: 'user.age' }];
async function settleSubmit(app: ReturnType<typeof mountHost>) { await new Promise<void>(resolve => setImmediate(resolve)); await app.settle(); }
const hostTable = (props: Record<string, unknown> = {}, slots = {}) => mountHost(defineComponent({ setup: () => () => h(Table, { testId: 'table', columns, dataSource: rows, ...props }, slots) }));

describe('Table native Vue renderer behavior', () => {
    it('paints header and nested record values through text nodes', () => {
        const app = hostTable();
        expect(app.text()).toContain('Name1');
        expect(app.text()).toContain('Age');
        expect(app.text()).toContain('20');
        expect(app.all().filter(node => node.props.role === 'cell')).toHaveLength(50);
        app.unmount();
    });
    it('supports array field paths and cell/header slots', () => {
        const app = hostTable({ columns: [{ title: 'ignored', dataIndex: ['user', 'age'] }] }, {
            'header-user.age': () => h('text', 'Custom age'),
            'cell-user.age': ({ value }: { value: unknown }) => h('text', `Years ${value}`),
        });
        expect(app.text()).toContain('Custom age');
        expect(app.text()).toContain('Years 20');
        expect(app.text()).not.toContain('ignored');
        app.unmount();
    });
    it('hides header and paints rich custom renderers / empty state', () => {
        const app = hostTable({ showHeader: false, columns: [{ title: 'Name', render: (_: unknown, record: TableRecord) => h('text', `${record.name}!`) }] });
        expect(app.text()).toContain('Name1!');
        expect(app.all().some(node => node.props.role === 'columnheader')).toBe(false);
        app.unmount();
        const empty = hostTable({ dataSource: [], emptyText: '无内容' });
        expect(empty.text()).toContain('无内容');
        empty.unmount();
        const custom = hostTable({ dataSource: [] }, { empty: () => h('text', 'Custom empty') });
        expect(custom.text()).toContain('Custom empty');
        custom.unmount();
    });
    it('sets striped rows and onRow style, then activates rows by keyboard', async () => {
        const clicked = vi.fn();
        const doubleClicked = vi.fn();
        const app = hostTable({ onRow: () => ({ onClick: clicked, onDblclick: doubleClicked, style: { fontWeight: 700 } }) });
        expect(app.find('table-row-2').props.style).toMatchObject({ backgroundColor: 'rgba(248, 248, 240, 0.6)', fontWeight: 700 });
        await app.fire('table-row-1', 'keyDown', { key: 'enter' });
        expect(clicked).toHaveBeenCalledOnce();
        await app.fire('table-row-1', 'click', { clickCount: 2 });
        expect(doubleClicked).toHaveBeenCalledOnce();
        app.unmount();
    });
    it('uses rowKey functions and guards pointer callbacks while loading', async () => {
        const clicked = vi.fn();
        const app = hostTable({ rowKey: (record: TableRecord) => `id-${record.name}`, loading: true, onRow: () => ({ onClick: clicked }) });
        expect(app.find('table-loading').props.role).toBe('status');
        await app.fire('table-row-id-Name1', 'click');
        expect(clicked).not.toHaveBeenCalled();
        app.unmount();
    });
    it('slices client pages, emits changes and clamps when the dataset shrinks', async () => {
        const changed = vi.fn();
        const data = ref(rows);
        const app = mountHost(defineComponent({ setup: () => () => h(Table, { testId: 'table', columns, dataSource: data.value, pagination: { defaultPageSize: 10 }, onChange: changed }) }));
        expect(app.text()).toContain('Name1');
        expect(app.text()).not.toContain('Name11');
        const third = app.find(node => node.props.role === 'button' && node.children.some(child => child.children.some(run => run.text === '3')));
        await app.fire(third, 'click');
        expect(changed).toHaveBeenCalledWith(3, 10);
        expect(app.text()).toContain('Name21');
        expect(app.text()).not.toContain('Name20');
        data.value = rows.slice(0, 5);
        await app.settle();
        expect(app.text()).toContain('Name1');
        expect(app.text()).not.toContain('Name21');
        app.unmount();
    });
    it('keeps controlled pagination unchanged until parent updates it', async () => {
        const current = ref(1);
        const changed = vi.fn();
        const app = mountHost(defineComponent({ setup: () => () => h(Table, { columns, dataSource: rows, pagination: { current: current.value, pageSize: 10 }, onChange: changed }) }));
        const third = app.find(node => node.props.role === 'button' && node.children.some(child => child.children.some(run => run.text === '3')));
        await app.fire(third, 'click');
        expect(changed).toHaveBeenCalledWith(3, 10);
        expect(app.text()).toContain('Name1');
        current.value = 3;
        await app.settle();
        expect(app.text()).toContain('Name21');
        app.unmount();
    });
});

describe('Form store and native field binding', () => {
    it('exposes original static aliases and Provider binding', async () => {
        expect(Form.Item).toBe(FormItem);
        expect(Form.Provider).toBe(FormProvider);
        expect(Form.useForm).toBe(useForm);
        const [form] = useForm({ initialValues: { name: 'Initial' } });
        const app = mountHost(defineComponent({ setup: () => () => h(FormProvider, { form }, () => h(FormItem, { name: 'name' }, () => h(Input))) }));
        expect(app.find(node => node.type === 'input').props.value).toBe('Initial');
        await app.fire(app.find(node => node.type === 'input'), 'change', { value: 'Changed' });
        expect(form.getFieldValue('name')).toBe('Changed');
        app.unmount();
    });
    it('supports nested initials, child initialValue and reset snapshots', async () => {
        const [form] = useForm();
        const app = mountHost(defineComponent({ setup: () => () => h(Form, { form, initialValues: { user: { name: 'Alice' }, tags: ['a', 'b'] } }, () => [
            h(FormItem, { name: ['user', 'name'] }, () => h(Input)),
            h(FormItem, { name: 'city', initialValue: 'Tokyo' }, () => h(Input)),
        ]) }));
        expect(form.getFieldsValue()).toEqual({ 'user.name': 'Alice', tags: ['a', 'b'], city: 'Tokyo' });
        form.setFieldValue('user.name', 'Bob');
        form.setFieldsValue({ city: 'Osaka' });
        form.resetFields(['user.name', 'city']);
        await app.settle();
        expect(form.getFieldValue(['user', 'name'])).toBe('Alice');
        expect(form.getFieldValue('city')).toBe('Tokyo');
        expect(form.isFieldTouched('user.name')).toBe(false);
        app.unmount();
    });
    it('normalizes native input events, chains handlers once and emits valuesChange once', async () => {
        const [form] = useForm();
        const changed = vi.fn();
        const childChanged = vi.fn();
        const app = mountHost(defineComponent({ setup: () => () => h(Form, { form, onValuesChange: changed }, () => h(FormItem, { name: 'name', normalize: (value: unknown) => String(value).trim() }, () => h(Input, { 'onUpdate:modelValue': childChanged }))) }));
        await app.fire(app.find(node => node.type === 'input'), 'change', { value: '  Alice  ' });
        expect(form.getFieldValue('name')).toBe('Alice');
        expect(changed).toHaveBeenCalledOnce();
        expect(changed).toHaveBeenCalledWith({ name: 'Alice' }, { name: 'Alice' });
        expect(childChanged).toHaveBeenCalledOnce();
        expect(childChanged).toHaveBeenCalledWith('  Alice  ');
        app.unmount();
    });
    it('binds native elements directly, custom value/trigger and custom event extraction', async () => {
        const [form] = useForm();
        const app = mountHost(defineComponent({ setup: () => () => h(Form, { form }, () => [
            h(FormItem, { name: 'text' }, () => h('input', { testId: 'native' })),
            h(FormItem, { name: 'custom', valuePropName: 'value', trigger: 'onChange', getValueFromEvent: (e: unknown) => `${(e as { value: string }).value}!` }, () => h('input', { testId: 'custom' })),
        ]) }));
        await app.fire('native', 'change', { value: 'Native' });
        await app.fire('custom', 'change', { value: 'Custom' });
        expect(form.getFieldsValue()).toEqual({ text: 'Native', custom: 'Custom!' });
        app.unmount();
    });
    it('validates required/dynamic/async rules and exposes error/help feedback', async () => {
        const [form] = useForm();
        const app = mountHost(defineComponent({ setup: () => () => h(Form, { form }, () => h(FormItem, {
            name: 'email', label: '邮箱', help: '帮助说明', hasFeedback: true,
            rules: [{ required: true, message: '必填' }, f => ({ validator: async (_, value) => { if (value === 'bad' || f.getFieldValue('email') === 'bad') throw new Error('不可使用'); } })],
        }, () => h(Input))) }));
        await expect(form.validateFields()).rejects.toMatchObject({ errorFields: [{ name: 'email', errors: ['必填'] }], outOfDate: false });
        await app.settle();
        expect(app.text()).toContain('必填');
        expect(app.text()).toContain('✕');
        expect(app.text()).not.toContain('帮助说明');
        form.setFieldValue('email', 'bad');
        await expect(form.validateFields()).rejects.toMatchObject({ errorFields: [{ name: 'email', errors: ['不可使用'] }] });
        form.setFieldValue('email', 'ok');
        await expect(form.validateFields()).resolves.toEqual({ email: 'ok' });
        await app.settle();
        expect(app.text()).toContain('帮助说明');
        app.unmount();
    });
    it('submits and calls current controlled Form callbacks only once', async () => {
        const [form] = useForm();
        const finished = vi.fn();
        const failed = vi.fn();
        const callback = ref(finished);
        const app = mountHost(defineComponent({ setup: () => () => h(Form, { form, onFinish: callback.value, onFinishFailed: failed }, () => h(FormItem, { name: 'name', rules: [{ required: true }] }, () => h(Input))) }));
        form.submit();
        await settleSubmit(app);
        expect(failed).toHaveBeenCalledOnce();
        expect(finished).not.toHaveBeenCalled();
        form.setFieldValue('name', 'Alice');
        form.submit();
        await settleSubmit(app);
        expect(finished).toHaveBeenCalledOnce();
        const next = vi.fn();
        callback.value = next;
        await app.settle();
        form.submit();
        await settleSubmit(app);
        expect(next).toHaveBeenCalledOnce();
        app.unmount();
    });
    it('submits on native Enter while preserving the input submit callback', async () => {
        const [form] = useForm({ initialValues: { name: 'Alice' } });
        const finished = vi.fn();
        const inputSubmitted = vi.fn();
        const app = mountHost(defineComponent({ setup: () => () => h(Form, { form, onFinish: finished }, () => h(FormItem, { name: 'name' }, () => h(Input, { onSubmit: inputSubmitted }))) }));
        await app.fire(app.find(node => node.type === 'input'), 'submit');
        await settleSubmit(app);
        expect(inputSubmitted).toHaveBeenCalledOnce();
        expect(finished).toHaveBeenCalledOnce();
        expect(finished).toHaveBeenCalledWith({ name: 'Alice' });
        app.unmount();
    });
    it('clears dependency errors when upstream field changes and unregisters unmounted fields', async () => {
        const [form] = useForm({ initialValues: { password: 'abc', confirm: 'xyz' } });
        const shown = ref(true);
        const app = mountHost(defineComponent({ setup: () => () => h(Form, { form }, () => [
            h(FormItem, { name: 'password' }, () => h(Input)),
            shown.value ? h(FormItem, { name: 'confirm', dependencies: ['password'], rules: [{ required: true }] }, () => h(Input)) : null,
        ]) }));
        form.setFields([{ name: 'confirm', errors: ['不匹配'], touched: true }]);
        await app.settle();
        expect(app.text()).toContain('不匹配');
        form.setFieldValue('password', 'new');
        await app.settle();
        expect(form.getFieldError('confirm')).toBeUndefined();
        shown.value = false;
        await app.settle();
        form.setFieldValue('confirm', '');
        await expect(form.validateFields()).resolves.toMatchObject({ confirm: '' });
        app.unmount();
    });
    it('keeps context disabled/size/layout reactive and exposes native accessibility text', async () => {
        const [form] = useForm();
        const disabled = ref(false);
        const app = mountHost(defineComponent({ setup: () => () => h(Form, { form, disabled: disabled.value, layout: disabled.value ? 'vertical' : 'horizontal', size: disabled.value ? 'large' : 'small' }, () => h(FormItem, { name: 'name', label: '姓名', help: '填写名字', testId: 'item' }, () => h(Input))) }));
        expect(app.find('item').props.style).toMatchObject({ flexDirection: 'row' });
        disabled.value = true;
        await app.settle();
        expect(app.find('item').props.style).toMatchObject({ flexDirection: 'column' });
        expect(app.find(node => node.type === 'input').props.readOnly).toBe(true);
        expect(app.all().some(node => node.props['aria-label'] === '姓名' && node.props['aria-description'] === '填写名字')).toBe(true);
        app.unmount();
    });
    it('does not overwrite edited values on identical initialValues rerenders', async () => {
        const [form] = useForm();
        const changed = ref(0);
        const app = mountHost(defineComponent({ setup: () => () => h(Form, { form, initialValues: { name: 'Alice' }, testId: String(changed.value) }, () => h(FormItem, { name: 'name' }, () => h(Input))) }));
        form.setFieldValue('name', 'Bob');
        changed.value++;
        await app.settle();
        expect(form.getFieldValue('name')).toBe('Bob');
        app.unmount();
    });
    it('keeps hidden values registered without paint and binds noStyle fields', async () => {
        const [form] = useForm();
        const app = mountHost(defineComponent({ setup: () => () => h(Form, { form }, () => [
            h(FormItem, { name: 'hidden', hidden: true, initialValue: 'Secret', rules: [{ required: true }] }, () => h(Input)),
            h(FormItem, { name: 'flat', noStyle: true, help: 'No style help' }, () => h(Input)),
        ]) }));
        expect(form.getFieldValue('hidden')).toBe('Secret');
        expect(app.all().filter(node => node.type === 'input')).toHaveLength(1);
        expect(app.text()).toContain('No style help');
        await app.fire(app.find(node => node.type === 'input'), 'change', { value: 'Flat' });
        expect(form.getFieldValue('flat')).toBe('Flat');
        app.unmount();
    });
    it('scrollToField delegates to the registered native host', async () => {
        const scroll = vi.fn();
        const [form] = useForm();
        const app = mountHost(defineComponent({ setup: () => () => h(Form, { form }, () => h(FormItem, { name: 'name', testId: 'item' }, () => h(Input))) }), { scrollIntoView: scroll });
        await app.settle();
        form.scrollToField('name');
        expect(scroll).toHaveBeenCalledWith(app.find('item').id);
        app.unmount();
    });
    it('scrollToField also reveals noStyle fields through the bound component host', async () => {
        const scroll = vi.fn();
        const [form] = useForm();
        const app = mountHost(defineComponent({ setup: () => () => h(Form, { form }, () => h(FormItem, { name: 'name', noStyle: true }, () => h(Input, { testId: 'input' }))) }), { scrollIntoView: scroll });
        await app.settle();
        form.scrollToField('name');
        expect(scroll).toHaveBeenCalledWith(app.find('input').id);
        app.unmount();
    });
    it('tracks async validation and rejects stale results without installing stale errors', async () => {
        let resolve: (() => void) | undefined;
        const [form] = useForm({ initialValues: { field: 'bad' } });
        const app = mountHost(defineComponent({ setup: () => () => h(Form, { form }, () => h(FormItem, { name: 'field', rules: [{ validator: async () => { await new Promise<void>(done => { resolve = done; }); throw new Error('old error'); } }] }, () => h(Input))) }));
        const validation = form.validateFields();
        expect(form.isFieldValidating('field')).toBe(true);
        form.setFieldValue('field', 'good');
        resolve?.();
        await expect(validation).rejects.toMatchObject({ outOfDate: true });
        expect(form.getFieldError('field')).toBeUndefined();
        expect(form.isFieldValidating('field')).toBe(false);
        app.unmount();
    });
    it('setFields clears touched/validating and accepts an explicit undefined value', () => {
        const [form] = useForm({ initialValues: { field: 'value' } });
        form.setFields([{ name: 'field', touched: true, validating: true, errors: ['error'] }]);
        expect(form.isFieldTouched('field')).toBe(true);
        form.setFields([{ name: 'field', value: undefined, touched: false, validating: false, errors: [] }]);
        expect(form.getFieldValue('field')).toBeUndefined();
        expect(form.isFieldTouched('field')).toBe(false);
        expect(form.isFieldValidating('field')).toBe(false);
        expect(form.getFieldError('field')).toBeUndefined();
    });
});

describe('Form rule parity', () => {
    it.each([
        [{ type: 'integer', min: 18, max: 99 }, '20', true],
        [{ type: 'integer' }, '20.5', false],
        [{ type: 'float' }, '20.5', true],
        [{ type: 'email' }, 'person@example.com', true],
        [{ type: 'url' }, 'https://example.com', true],
        [{ required: true, whitespace: true }, '  ', false],
        [{ len: 3 }, ['a', 'b'], false],
        [{ type: 'date' }, new Date('2026-01-01'), true],
    ] as const)('validates %j against %j', async (rule, value, valid) => {
        if (valid) await expect(runRule(rule, value)).resolves.toBeUndefined();
        else await expect(runRule(rule, value)).rejects.toThrow();
    });
    it('reuses global regexp rules consistently', async () => {
        const rule = { pattern: /^ok$/g };
        await expect(runRule(rule, 'ok')).resolves.toBeUndefined();
        await expect(runRule(rule, 'ok')).resolves.toBeUndefined();
    });
});
