/** Form store ported from animal-island-vue Form/useForm.ts (MIT).
 * Returns flat dot-path keys, as the original does. DOM scrollIntoView is
 * replaced by the registered native HostNode's nearest-scroll-parent command.
 * Native GPUI controls scrolling; behavior/block/inline are compatibility hints
 * only, since its scrollIntoView command currently takes no alignment options.
 */
import type { HostNode } from '@gpuiv/vue';
import { runRule } from './validators.js';
import { stringifyNamePath, type FieldData, type FormInstance, type NamePath, type Rules, type ValidateError, type ValidateInfo } from './types.js';

export interface FormOptions<T = Record<string, unknown>> {
    initialValues?: Partial<T>;
    onValuesChange?: (changed: Partial<T>, all: T) => void;
    onFinish?: (values: T) => void;
    onFinishFailed?: (info: ValidateInfo) => void;
}

interface FieldMeta {
    rules: Rules;
    notify: () => void;
    host?: HostNode | null;
}

export interface FormStore {
    registerField(name: NamePath, rules: Rules, initialValue: unknown, notify: () => void): void;
    unregisterField(name: NamePath): void;
    updateRules(name: NamePath, rules: Rules): void;
    hasField(name: NamePath): boolean;
    setHost(name: NamePath, host: HostNode | null): void;
    notifyAll(): void;
}

export type InternalForm = FormInstance & {
    __store: FormStore;
    __bindCallbacks(callbacks: FormOptions): void;
};

/** Objects become dot paths; arrays, dates and scalar values remain leaves. */
function flatten(values: Record<string, unknown>, prefix = '', output: Record<string, unknown> = {}): Record<string, unknown> {
    for (const [key, value] of Object.entries(values)) {
        const path = prefix ? `${prefix}.${key}` : key;
        if (value !== null && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
            flatten(value as Record<string, unknown>, path, output);
        } else output[path] = value;
    }
    return output;
}

function copy(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(copy);
    if (value instanceof Date) return new Date(value.getTime());
    if (value && Object.getPrototypeOf(value) === Object.prototype) {
        return Object.fromEntries(Object.entries(value).map(([key, v]) => [key, copy(v)]));
    }
    return value;
}

export function useForm<T = Record<string, unknown>>(options: FormOptions<T> = {}): [FormInstance<T>] {
    const callbacks: FormOptions = { ...options } as FormOptions;
    const values = new Map<string, unknown>();
    const initial = new Map<string, unknown>();
    const errors = new Map<string, string[]>();
    const touched = new Set<string>();
    const validating = new Set<string>();
    const fields = new Map<string, FieldMeta>();
    const generations = new Map<string, number>();
    let revision = 0;

    function notifyAll() { fields.forEach(field => field.notify()); }
    function write(name: string, value: unknown) {
        if (!Object.is(values.get(name), value)) revision++;
        values.set(name, value);
    }
    if (options.initialValues) {
        for (const [key, value] of Object.entries(flatten(options.initialValues as Record<string, unknown>))) {
            values.set(key, copy(value));
            initial.set(key, copy(value));
        }
    }

    const store: FormStore = {
        registerField(name, rules, initialValue, notify) {
            const key = stringifyNamePath(name);
            fields.set(key, { ...fields.get(key), rules, notify });
            if (!values.has(key) && initialValue !== undefined) {
                write(key, copy(initialValue));
                initial.set(key, copy(initialValue));
            }
        },
        unregisterField(name) {
            const key = stringifyNamePath(name);
            fields.delete(key);
            generations.set(key, (generations.get(key) ?? 0) + 1);
            validating.delete(key);
        },
        updateRules(name, rules) {
            const field = fields.get(stringifyNamePath(name));
            if (field) field.rules = rules;
        },
        hasField: name => fields.has(stringifyNamePath(name)),
        setHost(name, host) {
            const field = fields.get(stringifyNamePath(name));
            if (field) field.host = host;
        },
        notifyAll,
    };

    const form: InternalForm = {
        getFieldValue: name => values.get(stringifyNamePath(name)),
        getFieldsValue(nameList) {
            const keys = Array.isArray(nameList) ? nameList.map(stringifyNamePath) : [...values.keys()];
            return Object.fromEntries(keys.filter(key => values.has(key)).map(key => [key, values.get(key)]));
        },
        setFieldValue(name, value) {
            const key = stringifyNamePath(name);
            const previous = values.get(key);
            write(key, value);
            touched.add(key);
            // Dependencies subscribe through their own field's reactive tick.
            notifyAll();
            if (!Object.is(previous, value)) callbacks.onValuesChange?.({ [key]: value }, form.getFieldsValue(true));
        },
        setFieldsValue(newValues) {
            for (const [key, value] of Object.entries(flatten(newValues))) {
                write(key, value);
                // Preserve the original's first-assignment reset snapshot.
                if (!initial.has(key)) initial.set(key, copy(value));
            }
            notifyAll();
        },
        resetFields(nameList) {
            const keys = nameList ? nameList.map(stringifyNamePath) : [...new Set([...values.keys(), ...fields.keys()])];
            for (const key of keys) {
                write(key, copy(initial.get(key)));
                errors.delete(key);
                touched.delete(key);
                validating.delete(key);
                generations.set(key, (generations.get(key) ?? 0) + 1);
            }
            notifyAll();
        },
        setFields(nextFields: FieldData[]) {
            for (const field of nextFields) {
                const key = stringifyNamePath(field.name);
                if ('value' in field) write(key, field.value);
                if (field.errors !== undefined) {
                    if (field.errors.length) errors.set(key, field.errors);
                    else errors.delete(key);
                }
                if (field.touched !== undefined) {
                    if (field.touched) touched.add(key);
                    else touched.delete(key);
                }
                if (field.validating !== undefined) {
                    if (field.validating) validating.add(key);
                    else validating.delete(key);
                }
            }
            notifyAll();
        },
        isFieldTouched: name => touched.has(stringifyNamePath(name)),
        isFieldValidating: name => validating.has(stringifyNamePath(name)),
        getFieldError: name => errors.get(stringifyNamePath(name)),
        async validateFields(nameList) {
            const keys = nameList?.map(stringifyNamePath);
            const targets = [...fields].filter(([key]) => !keys || keys.includes(key));
            const startRevision = revision;
            const snapshots = targets.map(([key, field]) => {
                const generation = (generations.get(key) ?? 0) + 1;
                generations.set(key, generation);
                validating.add(key);
                return { key, rules: [...field.rules], value: values.get(key), generation };
            });
            notifyAll();
            const results = await Promise.all(snapshots.map(async ({ key, rules, value, generation }) => {
                const fieldErrors: string[] = [];
                for (const ruleRender of rules) {
                    try {
                        const rule = typeof ruleRender === 'function' ? ruleRender(form) : ruleRender;
                        await runRule(rule, value);
                    } catch (error) {
                        fieldErrors.push(error instanceof Error ? error.message : String(error));
                    }
                }
                // A later validation, reset, unmount or edit must not publish an
                // older asynchronous result into current field state.
                const current = generations.get(key) === generation;
                if (current) {
                    validating.delete(key);
                    if (Object.is(values.get(key), value)) {
                        if (fieldErrors.length) { errors.set(key, fieldErrors); touched.add(key); }
                        else errors.delete(key);
                    }
                }
                return { name: key, errors: fieldErrors, current };
            }));
            notifyAll();
            const errorFields: ValidateError[] = results.filter(result => result.errors.length).map(({ name, errors }) => ({ name, errors }));
            const outOfDate = revision !== startRevision || results.some(result => !result.current);
            if (errorFields.length || outOfDate) {
                throw Object.assign(new Error('Validation failed'), { values: form.getFieldsValue(true), errorFields, outOfDate });
            }
            return form.getFieldsValue(true);
        },
        submit() {
            void form.validateFields().then(
                values => callbacks.onFinish?.(values),
                (error: ValidateInfo) => callbacks.onFinishFailed?.({ values: error.values, errorFields: error.errorFields, outOfDate: error.outOfDate ?? false }),
            );
        },
        scrollToField(name) {
            fields.get(stringifyNamePath(name))?.host?.scrollIntoView?.();
        },
        __store: store,
        __bindCallbacks(next) { Object.assign(callbacks, next); },
    };
    return [form as unknown as FormInstance<T>];
}
