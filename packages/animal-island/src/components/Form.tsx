/** Form ported from animal-island-vue Form.vue (MIT).
 * Native adaptation: <form> becomes a flex div. There is no browser default
 * submit/reset action: use form.submit()/resetFields(), the exposed submit/reset,
 * or a bound field's Enter submission. 24-column CSS grid in FormItem becomes
 * proportional flex widths. CSS classes remain accepted metadata; styling uses
 * StyleDesc. Context and mounted fields follow replacement form instances as
 * well as layout/disabled/size changes, matching React's contextual instance.
 */
import { computed, defineComponent, provide, watch, type PropType } from 'vue';
import type { EventPayload, StyleDesc } from '@gpuiv/vue';
import { FormContextKey } from '../form/context.js';
import { useForm, type InternalForm } from '../form/useForm.js';
import type { ColProps, FormContextValue, FormInstance, FormLabelAlign, FormLayout, FormSize, RequiredMark, ValidateInfo } from '../form/types.js';
import { FormItem } from './FormItem.js';
import { FormProvider } from './FormProvider.js';
import { fonts } from '../tokens.js';

const FormComponent = defineComponent({
    name: 'AnimalForm',
    inheritAttrs: false,
    props: {
        form: { type: Object as PropType<FormInstance>, default: undefined },
        initialValues: { type: Object as PropType<Record<string, unknown>>, default: undefined },
        layout: { type: String as PropType<FormLayout>, default: 'horizontal' },
        labelAlign: { type: String as PropType<FormLabelAlign>, default: undefined },
        labelCol: { type: Object as PropType<ColProps>, default: undefined },
        wrapperCol: { type: Object as PropType<ColProps>, default: undefined },
        size: { type: String as PropType<FormSize>, default: 'middle' },
        disabled: { type: Boolean, default: false },
        colon: { type: Boolean, default: true },
        requiredMark: { type: [Boolean, String] as PropType<RequiredMark>, default: false },
        className: { type: String, default: undefined },
        testId: { type: String, default: undefined },
        style: { type: Object as PropType<StyleDesc>, default: undefined },
    },
    emits: {
        finish: (_values: Record<string, unknown>) => true,
        finishFailed: (_info: ValidateInfo) => true,
        valuesChange: (_changed: Record<string, unknown>, _all: Record<string, unknown>) => true,
        reset: (_event?: EventPayload) => true,
    },
    setup(props, { attrs, emit, expose, slots }) {
        const [fallback] = useForm();
        const form = computed(() => props.form ?? fallback);
        watch(form, (instance, _previous, onCleanup) => {
            const unbind = (instance as InternalForm).__bindCallbacks?.({
                onFinish: values => emit('finish', values),
                onFinishFailed: info => emit('finishFailed', info),
                onValuesChange: (changed, all) => emit('valuesChange', changed, all),
            });
            if (typeof unbind === 'function') onCleanup(unbind);
        }, { immediate: true, flush: 'sync' });
        let lastInitial: string | undefined;
        watch([form, () => props.initialValues], ([instance, values]) => {
            if (!values) return;
            const key = JSON.stringify(values);
            if (key === lastInitial) return;
            lastInitial = key;
            instance.setFieldsValue(values);
        }, { immediate: true, deep: true });

        provide(FormContextKey, computed<FormContextValue>(() => ({
            form: form.value, prefixCls: 'island-form', layout: props.layout,
            labelAlign: props.labelAlign ?? (props.layout === 'horizontal' ? 'right' : 'left'),
            labelCol: props.labelCol, wrapperCol: props.wrapperCol, size: props.size,
            disabled: props.disabled, colon: props.colon, requiredMark: props.requiredMark,
            reset,
        })));

        function reset(event?: EventPayload) { form.value.resetFields(); emit('reset', event); }
        expose({ get form() { return form.value; }, submit: () => form.value.submit(), reset });
        return () => <div
            {...attrs}
            role="form"
            class={['island-form', props.className, attrs.class]}
            testId={props.testId}
            style={{
                display: 'flex', flexDirection: props.layout === 'inline' ? 'row' : 'column',
                ...(props.layout === 'inline' ? { flexWrap: 'wrap' as const } : {}), gap: 8,
                color: 'rgba(0, 0, 0, 0.85)', fontSize: 14, lineHeight: 22.4,
                ...(fonts.sans ? { fontFamily: fonts.sans } : {}),
                ...(props.disabled ? { opacity: 0.6, cursor: 'not-allowed' as const } : {}),
                ...props.style,
            }}
        >{slots.default?.()}</div>;
    },
});

export const Form = Object.assign(FormComponent, { Item: FormItem, Provider: FormProvider, useForm });
export default Form;
