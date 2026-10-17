/** Form context adapted from animal-island-vue (MIT). Keep layout props reactive. */
import type { ComputedRef, InjectionKey } from 'vue';
import type { FormContextValue } from './types.js';

export const FormContextKey: InjectionKey<ComputedRef<FormContextValue>> = Symbol('AnimalFormContext');
