/** Form.Provider ported from animal-island-vue FormProvider.vue (MIT).
 * Provides an existing form without adding a native layout element.
 */
import { computed, defineComponent, provide, type PropType } from 'vue';
import { FormContextKey } from '../form/context.js';
import type { FormContextValue, FormInstance } from '../form/types.js';

export const FormProvider = defineComponent({
    name: 'AnimalFormProvider',
    props: { form: { type: Object as PropType<FormInstance>, required: true } },
    setup(props, { slots }) {
        provide(FormContextKey, computed<FormContextValue>(() => ({
            form: props.form, prefixCls: 'island-form', layout: 'vertical',
            labelAlign: 'left', size: 'middle', disabled: false, colon: true, requiredMark: false,
        })));
        return () => slots.default?.();
    },
});

export default FormProvider;
