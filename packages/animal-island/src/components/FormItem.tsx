/** Form.Item ported from animal-island-vue FormItem.vue (MIT).
 * Native adaptation: DOM label/htmlFor and aria-errormessage become the child's
 * aria-label/aria-description and help status text. CSS grid uses equivalent
 * span/offset percentages in a flex row. hidden fields stay registered/bound but
 * paint no nodes; noStyle keeps binding and help. scrollToField registers the
 * actual HostNode rather than querying the DOM. No DOM submit/reset defaults.
 */
import { cloneVNode, computed, defineComponent, inject, isVNode, ref, watch, type PropType, type VNodeChild } from 'vue';
import type { EventPayload, HostNode, StyleDesc } from '@gpuiv/vue';
import { colors } from '../tokens.js';
import { FormContextKey } from '../form/context.js';
import { defaultGetValueFromEvent, stringifyNamePath, type ColProps, type FormItemLayout, type NamePath, type RequiredMark, type Rules, type ValidateStatus } from '../form/types.js';
import type { InternalForm } from '../form/useForm.js';
import { contentLabel, renderContent as renderNodeContent } from './content.js';

export const FormItem = defineComponent({
    name: 'AnimalFormItem',
    inheritAttrs: false,
    props: {
        name: { type: [String, Number, Array] as PropType<NamePath>, default: undefined },
        label: { type: [String, Number, Object, Array, Boolean] as PropType<VNodeChild>, default: undefined },
        rules: { type: Array as PropType<Rules>, default: () => [] },
        required: { type: Boolean, default: false },
        dependencies: { type: Array as PropType<NamePath[]>, default: () => [] },
        valuePropName: { type: String, default: 'modelValue' },
        trigger: { type: String, default: 'onUpdate:modelValue' },
        getValueFromEvent: { type: Function as PropType<(event: unknown) => unknown>, default: defaultGetValueFromEvent },
        normalize: { type: Function as PropType<(value: unknown, previous: unknown, all: Record<string, unknown>) => unknown>, default: undefined },
        hidden: { type: Boolean, default: false },
        hasFeedback: { type: Boolean, default: false },
        validateStatus: { type: String as PropType<ValidateStatus>, default: undefined },
        help: { type: [String, Number, Object, Array, Boolean] as PropType<VNodeChild>, default: undefined },
        noStyle: { type: Boolean, default: false },
        labelCol: { type: Object as PropType<ColProps>, default: undefined },
        wrapperCol: { type: Object as PropType<ColProps>, default: undefined },
        colon: { type: Boolean as PropType<boolean | null>, default: null },
        requiredMark: { type: [Boolean, String] as PropType<RequiredMark | null>, default: null },
        layout: { type: String as PropType<FormItemLayout>, default: undefined },
        initialValue: { default: undefined },
        testId: { type: String, default: undefined },
        style: { type: Object as PropType<StyleDesc>, default: undefined },
    },
    setup(props, { attrs, slots }) {
        const injectedContext = inject(FormContextKey);
        if (!injectedContext) throw new Error('Form.Item must be used inside <Form> or <Form.Provider>');
        const context = injectedContext;
        const form = computed(() => context.value.form as InternalForm);
        const key = computed(() => props.name !== undefined ? stringifyNamePath(props.name) : undefined);
        const tick = ref(0);
        const host = ref<HostNode | null>(null);
        watch([form, key], ([instance, name], _previous, onCleanup) => {
            if (name === undefined) return;
            instance.__store?.registerField(name, props.rules, props.initialValue, () => { tick.value++; });
            instance.__store?.setHost(name, host.value);
            onCleanup(() => instance.__store?.unregisterField(name));
        }, { immediate: true, flush: 'sync' });
        // Rules and initial-value updates keep the active registration and
        // native host, rather than canceling an unrelated pending validation.
        watch(() => [props.rules, props.initialValue] as const, ([rules, initial]) => {
            if (key.value !== undefined) form.value.__store?.registerField(key.value, rules, initial, () => { tick.value++; });
        }, { deep: true });
        watch([form, key, host], ([instance, name, node]) => {
            if (name !== undefined) instance.__store?.setHost(name, node);
        }, { flush: 'post', immediate: true });
        watch(() => {
            void tick.value;
            return { instance: form.value, values: props.dependencies.map(name => form.value.getFieldValue(name)) };
        }, (next, previous) => {
            if (key.value !== undefined && previous && next.instance === previous.instance && next.values.some((value, i) => !Object.is(value, previous.values[i]))) {
                next.instance.setFields([{ name: key.value, errors: [] }]);
            }
        });

        function renderContent(status: ValidateStatus, help: VNodeChild) {
            const children = slots.default?.() ?? [];
            const first = children.findIndex(child => isVNode(child) && typeof child.type !== 'symbol');
            if (first < 0) return children;
            const original = children[first];
            const originalProps = original.props ?? {};
            const injected: Record<string, unknown> = {};
            if (key.value !== undefined) {
                const nativeInput = typeof original.type === 'string' && ['input', 'textarea'].includes(original.type);
                const valueProp = nativeInput && props.valuePropName === 'modelValue' ? 'value' : props.valuePropName;
                const trigger = nativeInput && props.trigger === 'onUpdate:modelValue' ? 'onChange' : props.trigger;
                injected[valueProp] = form.value.getFieldValue(key.value);
                injected[trigger] = (...args: unknown[]) => {
                    const handler = originalProps[trigger];
                    for (const fn of Array.isArray(handler) ? handler : [handler]) {
                        if (typeof fn === 'function') fn(...args);
                    }
                    if (key.value === undefined || context.value.disabled) return;
                    const value = props.getValueFromEvent(args[0]);
                    const normalized = props.normalize ? props.normalize(value, form.value.getFieldValue(key.value), form.value.getFieldsValue(true)) : value;
                    form.value.setFieldValue(key.value, normalized);
                };
                if (originalProps['aria-id'] === undefined) injected['aria-id'] = key.value;
                if (originalProps['aria-label'] === undefined) injected['aria-label'] = contentLabel(props.label);
                if (originalProps['aria-description'] === undefined) injected['aria-description'] = contentLabel(help);
                injected.onSubmit = (event: EventPayload) => {
                    const handlers = originalProps.onSubmit;
                    for (const handler of Array.isArray(handlers) ? handlers : [handlers]) {
                        if (typeof handler === 'function') handler(event);
                    }
                    if (!context.value.disabled) form.value.submit();
                };
            }
            if (context.value.disabled) {
                injected.disabled = true;
                if (typeof original.type === 'string') injected.readOnly = true;
            }
            if (originalProps.size === undefined && typeof original.type !== 'string') injected.size = context.value.size;
            if (originalProps.status === undefined && status === 'error') injected.status = 'error';
            const bound = props.noStyle ? cloneVNode(original, {
                ref: (value: HostNode | { $el?: HostNode } | null) => {
                    host.value = value && '$el' in value ? value.$el ?? null : value as HostNode | null;
                },
            }, true) : cloneVNode(original);
            // cloneVNode normally merges event listeners; these are already
            // chained above. Assign once to avoid firing original listeners twice.
            bound.props = { ...originalProps, ...injected };
            children[first] = bound;
            return children;
        }

        return () => {
            void tick.value;
            const ctx = context.value;
            const errors = key.value !== undefined ? form.value.getFieldError(key.value) : undefined;
            const status = props.validateStatus ?? (key.value !== undefined && form.value.isFieldValidating(key.value) ? 'validating' : errors?.length ? 'error' : '');
            const help = (key.value !== undefined && form.value.isFieldTouched(key.value) ? errors?.[0] : undefined) ?? props.help;
            const content = renderContent(status, help);
            if (props.hidden) return null;
            const explainColor = status === 'error' ? colors.error : status === 'warning' ? colors.warning : status === 'success' ? colors.success : status === 'validating' ? '#1677ff' : 'rgba(0, 0, 0, 0.45)';
            const explain = help !== undefined ? <div role="status" aria-label={contentLabel(help)} style={{ display: 'flex', gap: 4, minHeight: 22, marginTop: 4, fontSize: 12, lineHeight: 18, color: explainColor }}>
                {props.hasFeedback && status === 'error' ? <text>✕</text> : null}
                {renderNodeContent(help)}
            </div> : null;
            if (props.noStyle) return <>{content}{explain}</>;
            const layout = props.layout ?? (ctx.layout === 'inline' ? 'vertical' : ctx.layout);
            const vertical = layout === 'vertical';
            const labelCol = props.labelCol ?? ctx.labelCol;
            const wrapperCol = props.wrapperCol ?? ctx.wrapperCol;
            const labelStyle: StyleDesc = {
                display: 'flex', alignItems: 'center', flexShrink: 0, gap: 4,
                justifyContent: ctx.labelAlign === 'right' ? 'flex-end' : 'flex-start',
                fontSize: ctx.size === 'small' ? 12 : ctx.size === 'large' ? 16 : 14,
                color: 'rgba(0, 0, 0, 0.85)', lineHeight: (ctx.size === 'small' ? 12 : ctx.size === 'large' ? 16 : 14) * 1.6,
                ...(vertical ? { marginBottom: 6 } : labelCol ? {
                    width: `${Math.max(0, Math.min(24, labelCol.span ?? 24)) / 24 * 100}%`,
                } : { marginRight: 8 }),
            };
            const controlStyle: StyleDesc = {
                minWidth: 0, display: 'flex', flexDirection: 'column',
                ...(!vertical && wrapperCol ? {
                    width: `${Math.max(0, Math.min(24, wrapperCol.span ?? 24)) / 24 * 100}%`,
                    flexShrink: 0,
                } : { flexGrow: 1 }),
            };
            const required = props.required || props.rules.some(rule => (typeof rule === 'function' ? rule(form.value) : rule).required);
            const showMark = required && (props.requiredMark ?? ctx.requiredMark) !== false;
            const colon = (props.colon ?? ctx.colon) && props.label !== '';
            return <div {...attrs} ref={host} testId={props.testId} style={{ display: 'flex', flexDirection: vertical ? 'column' : 'row', alignItems: vertical ? 'stretch' : 'baseline', ...props.style }}>
                {!vertical && labelCol?.offset ? <div style={{ width: `${labelCol.offset / 24 * 100}%`, flexShrink: 0 }} /> : null}
                {props.label !== undefined ? <div style={labelStyle}>
                    {showMark ? <text style={{ color: colors.error }}>*</text> : null}
                    {renderNodeContent(props.label)}
                    {colon ? <text>:</text> : null}
                </div> : null}
                {!vertical && wrapperCol?.offset ? <div style={{ width: `${wrapperCol.offset / 24 * 100}%`, flexShrink: 0 }} /> : null}
                <div style={controlStyle}><div style={{ display: 'flex', alignItems: 'center', minHeight: 32 }}>{content}</div>{explain}</div>
            </div>;
        };
    },
});

export default FormItem;
