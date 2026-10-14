/** Form.Item ported from animal-island-vue FormItem.vue (MIT).
 * Native adaptation: DOM label/htmlFor and aria-errormessage become the child's
 * aria-label/aria-description and help status text. CSS grid uses equivalent
 * span/offset percentages in a flex row. hidden fields stay registered/bound but
 * paint no nodes; noStyle keeps binding and help. scrollToField registers the
 * actual HostNode rather than querying the DOM. No DOM submit/reset defaults.
 */
import { cloneVNode, computed, defineComponent, inject, isVNode, onBeforeUnmount, ref, watch, type PropType, type VNode } from 'vue';
import type { EventPayload, HostNode, StyleDesc } from '@gpuiv/vue';
import { colors } from '../tokens.js';
import { FormContextKey } from '../form/context.js';
import { defaultGetValueFromEvent, stringifyNamePath, type ColProps, type FormItemLayout, type NamePath, type RequiredMark, type Rules, type ValidateStatus } from '../form/types.js';
import type { InternalForm } from '../form/useForm.js';

export const FormItem = defineComponent({
    name: 'AnimalFormItem',
    inheritAttrs: false,
    props: {
        name: { type: [String, Number, Array] as PropType<NamePath>, default: undefined },
        label: { type: [String, Object] as PropType<string | VNode>, default: undefined },
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
        help: { type: [String, Object] as PropType<string | VNode>, default: undefined },
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
        const form = context.value.form as InternalForm;
        const key = computed(() => props.name !== undefined ? stringifyNamePath(props.name) : undefined);
        const tick = ref(0);
        const host = ref<HostNode | null>(null);
        watch(() => [key.value, props.rules, props.initialValue] as const, ([nextKey, rules, initial], old) => {
            if (old?.[0] !== undefined && old[0] !== nextKey) form.__store?.unregisterField(old[0]);
            if (nextKey !== undefined) form.__store?.registerField(nextKey, rules, initial, () => { tick.value++; });
        }, { immediate: true, deep: true });
        watch([key, host], ([name, node]) => {
            if (name !== undefined) form.__store?.setHost(name, node);
        }, { flush: 'post', immediate: true });
        onBeforeUnmount(() => {
            if (key.value !== undefined) form.__store?.unregisterField(key.value);
        });
        watch(() => {
            void tick.value;
            return props.dependencies.map(name => form.getFieldValue(name));
        }, (next, previous) => {
            if (key.value !== undefined && previous && next.some((value, i) => !Object.is(value, previous[i]))) {
                form.setFields([{ name: key.value, errors: [] }]);
            }
        });

        function renderContent(status: ValidateStatus, help: string | VNode | undefined) {
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
                injected[valueProp] = form.getFieldValue(key.value);
                injected[trigger] = (...args: unknown[]) => {
                    const handler = originalProps[trigger];
                    for (const fn of Array.isArray(handler) ? handler : [handler]) {
                        if (typeof fn === 'function') fn(...args);
                    }
                    if (key.value === undefined || context.value.disabled) return;
                    const value = props.getValueFromEvent(args[0]);
                    const normalized = props.normalize ? props.normalize(value, form.getFieldValue(key.value), form.getFieldsValue(true)) : value;
                    form.setFieldValue(key.value, normalized);
                };
                if (originalProps['aria-id'] === undefined) injected['aria-id'] = key.value;
                if (originalProps['aria-label'] === undefined && typeof props.label === 'string') injected['aria-label'] = props.label;
                if (originalProps['aria-description'] === undefined && typeof help === 'string') injected['aria-description'] = help;
                injected.onSubmit = (event: EventPayload) => {
                    const handlers = originalProps.onSubmit;
                    for (const handler of Array.isArray(handlers) ? handlers : [handlers]) {
                        if (typeof handler === 'function') handler(event);
                    }
                    if (!context.value.disabled) form.submit();
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
            const errors = key.value !== undefined ? form.getFieldError(key.value) : undefined;
            const status = props.validateStatus ?? (key.value !== undefined && form.isFieldValidating(key.value) ? 'validating' : errors?.length ? 'error' : '');
            const help = (key.value !== undefined && form.isFieldTouched(key.value) ? errors?.[0] : undefined) ?? props.help;
            const content = renderContent(status, help);
            if (props.hidden) return null;
            const explainColor = status === 'error' ? colors.error : status === 'warning' ? colors.warning : status === 'success' ? colors.success : status === 'validating' ? '#1677ff' : 'rgba(0, 0, 0, 0.45)';
            const explain = help !== undefined ? <div role="status" aria-label={typeof help === 'string' ? help : undefined} style={{ display: 'flex', gap: 4, minHeight: 22, marginTop: 4, fontSize: 12, lineHeight: 18, color: explainColor }}>
                {props.hasFeedback && status === 'error' ? <text>✕</text> : null}
                {isVNode(help) ? help : <text>{help}</text>}
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
            const required = props.required || props.rules.some(rule => (typeof rule === 'function' ? rule(form) : rule).required);
            const showMark = required && (props.requiredMark ?? ctx.requiredMark) !== false;
            const colon = (props.colon ?? ctx.colon) && props.label !== '';
            return <div {...attrs} ref={host} testId={props.testId} style={{ display: 'flex', flexDirection: vertical ? 'column' : 'row', alignItems: vertical ? 'stretch' : 'baseline', ...props.style }}>
                {!vertical && labelCol?.offset ? <div style={{ width: `${labelCol.offset / 24 * 100}%`, flexShrink: 0 }} /> : null}
                {props.label !== undefined ? <div style={labelStyle}>
                    {showMark ? <text style={{ color: colors.error }}>*</text> : null}
                    {isVNode(props.label) ? props.label : <text>{props.label}</text>}
                    {colon ? <text>:</text> : null}
                </div> : null}
                {!vertical && wrapperCol?.offset ? <div style={{ width: `${wrapperCol.offset / 24 * 100}%`, flexShrink: 0 }} /> : null}
                <div style={controlStyle}><div style={{ display: 'flex', alignItems: 'center', minHeight: 32 }}>{content}</div>{explain}</div>
            </div>;
        };
    },
});

export default FormItem;
