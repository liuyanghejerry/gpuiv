import { afterEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, h, ref } from 'vue';
import { Loading } from '../src/components/Loading.js';
import { Modal } from '../src/components/Modal.js';
import { Skeleton, SkeletonAvatar, SkeletonButton, SkeletonInput } from '../src/components/Skeleton.js';
import { mountHost } from './harness.js';

const cleanups: (() => void)[] = [];
function mount(component: Parameters<typeof mountHost>[0]) {
    const app = mountHost(component);
    cleanups.push(app.unmount);
    return app;
}
afterEach(() => { cleanups.splice(0).forEach(cleanup => cleanup()); vi.useRealTimers(); });
const flake = (app: ReturnType<typeof mountHost>) => app.find(node => {
    const style = node.props.style as { position?: string; width?: number; backgroundColor?: string } | undefined;
    return style?.position === 'absolute' && typeof style.width === 'number' && style.width <= 6 && style.backgroundColor === '#fff';
});

describe('Loading snowfall lifecycle', () => {
    it('covers deferred dialogs and releases its occluder while fading out', async () => {
        vi.useFakeTimers();
        const active = ref(true);
        const app = mount(defineComponent(() => () => [h(Modal, { open: true, typewriter: false }), h(Loading, { active: active.value })]));
        const layer = app.find(node => node.type === 'anchored' && node.props.priority === 3000);
        expect(layer.props.deferred).toBe(true);
        expect(layer.props.occlude).toBe(true);
        await vi.advanceTimersByTimeAsync(240);
        expect(layer.props.style).toMatchObject({ opacity: 1 });
        active.value = false;
        await app.settle();
        expect(layer.props.occlude).toBe(false);
        expect(layer.props.style).toMatchObject({ pointerEvents: 'none' });
    });
    it('animates the default initially active snowfall and clears timers on unmount', async () => {
        vi.useFakeTimers();
        const app = mount(defineComponent({ setup: () => () => h(Loading, { testId: 'loading' }) }));
        await app.settle();
        const before = (flake(app).props.style as { top: number }).top;
        await vi.advanceTimersByTimeAsync(80);
        await app.settle();
        expect((flake(app).props.style as { top: number }).top).not.toBe(before);
        app.unmount();
        cleanups.pop();
        expect(vi.getTimerCount()).toBe(0);
    });
    it('cancels a delayed show when active becomes false before the delay', async () => {
        vi.useFakeTimers();
        const active = ref(true);
        const app = mount(defineComponent({ setup: () => () => h(Loading, { active: active.value, delay: 100, tip: 'Delayed' }) }));
        await vi.advanceTimersByTimeAsync(50);
        active.value = false;
        await app.settle();
        await vi.advanceTimersByTimeAsync(100);
        expect(app.text()).not.toContain('Delayed');
    });
    it('keeps VNode tips and survives reactivation during fade-out', async () => {
        vi.useFakeTimers();
        const active = ref(true);
        const app = mount(defineComponent({ setup: () => () => h(Loading, { active: active.value, fadeDuration: 0.1, tip: h('text', 'Rich tip'), testId: 'loading' }) }));
        expect(app.text()).toContain('Rich tip');
        active.value = false;
        await app.settle();
        expect(app.find('loading').props.style).toMatchObject({ pointerEvents: 'none' });
        for (const node of app.all()) {
            const style = node.props.style as { backgroundColor?: string; pointerEvents?: string } | undefined;
            if (style?.backgroundColor) expect(style.pointerEvents).toBe('none');
        }
        await vi.advanceTimersByTimeAsync(50);
        active.value = true;
        await app.settle();
        await vi.advanceTimersByTimeAsync(100);
        expect(app.text()).toContain('Rich tip');
        expect((app.find('loading').props.style as { pointerEvents?: string }).pointerEvents).toBe('auto');
    });
});

describe('Skeleton public helpers', () => {
    it('samples five active skeletons on one timer and emits one mutation batch per 50ms', async () => {
        vi.useFakeTimers();
        const active = ref(true);
        const app = mount(defineComponent({ setup: () => () => h('div', [0, 1, 2, 3, 4].map(index =>
            h(Skeleton, { key: index, active: active.value, testId: `skeleton-${index}` })
        )) }));
        await app.settle();
        expect(vi.getTimerCount()).toBe(1);
        const apply = vi.spyOn(app.native, 'applyBatch');
        try {
            await vi.advanceTimersByTimeAsync(50);
            await app.settle();
            expect(apply).toHaveBeenCalledOnce();
            const opacities = [0, 1, 2, 3, 4].map(index => (app.find(`skeleton-${index}`).props.style as { opacity: number }).opacity);
            expect(opacities[0]).toBeLessThan(1);
            expect(new Set(opacities).size).toBe(1);
            apply.mockClear();
            await vi.advanceTimersByTimeAsync(50);
            await app.settle();
            expect(apply).toHaveBeenCalledOnce();

            active.value = false;
            await app.settle();
            expect(vi.getTimerCount()).toBe(0);
            for (const index of [0, 1, 2, 3, 4]) expect(app.find(`skeleton-${index}`).props.style).toMatchObject({ opacity: 1 });
            apply.mockClear();
            await vi.advanceTimersByTimeAsync(100);
            await app.settle();
            expect(apply).not.toHaveBeenCalled();
        } finally {
            apply.mockRestore();
        }
    });
    it('preserves independent phase and resets newly active or reloading instances while releasing the last timer on unmount', async () => {
        vi.useFakeTimers();
        const secondActive = ref(false), secondLoading = ref(true);
        const app = mount(defineComponent({ setup: () => () => h('div', [
            h(Skeleton, { testId: 'first' }),
            h(Skeleton, { testId: 'second', active: secondActive.value, loading: secondLoading.value }, { default: () => h('text', 'loaded second') }),
        ]) }));
        const opacity = (id: string) => (app.find(id).props.style as { opacity: number }).opacity;
        await vi.advanceTimersByTimeAsync(150);
        await app.settle();
        expect(opacity('second')).toBe(1);
        const firstBefore = opacity('first');
        secondActive.value = true;
        await app.settle();
        expect(vi.getTimerCount()).toBe(1);
        expect(opacity('first')).toBe(firstBefore);
        expect(opacity('second')).toBe(1);
        await vi.advanceTimersByTimeAsync(50);
        await app.settle();
        const firstSample = opacity('second');
        expect(firstSample).toBeLessThan(opacity('first'));
        expect(firstSample).toBeGreaterThanOrEqual(0.45);

        secondActive.value = false;
        await app.settle();
        expect(opacity('second')).toBe(1);
        expect(vi.getTimerCount()).toBe(1);
        secondActive.value = true;
        await app.settle();
        await vi.advanceTimersByTimeAsync(50);
        await app.settle();
        expect(opacity('second')).toBe(firstSample);

        secondLoading.value = false;
        await app.settle();
        expect(app.text()).toContain('loaded second');
        expect(vi.getTimerCount()).toBe(1);
        secondLoading.value = true;
        await app.settle();
        expect(opacity('second')).toBe(1);
        await vi.advanceTimersByTimeAsync(50);
        await app.settle();
        expect(opacity('second')).toBe(firstSample);
        app.unmount();
        cleanups.pop();
        expect(vi.getTimerCount()).toBe(0);
    });
    it.each([
        [SkeletonButton, 'small', 80, 32, 50],
        [SkeletonButton, 'middle', 100, 45, 50],
        [SkeletonButton, 'large', 130, 48, 50],
        [SkeletonInput, 'small', 160, 32, 50],
        [SkeletonInput, 'middle', 200, 40, 50],
        [SkeletonInput, 'large', 240, 48, 50],
        [SkeletonAvatar, 'small', 32, 32, 999],
        [SkeletonAvatar, 'middle', 44, 44, 999],
        [SkeletonAvatar, 'large', 56, 56, 999],
    ] as const)('preserves original %s %s size', (component, size, width, height, borderRadius) => {
        const app = mount(defineComponent({ setup: () => () => h(component, { size, active: false, testId: 'helper' }) }));
        expect(app.find('helper').props.style).toMatchObject({ width, height, borderRadius, opacity: 1 });
    });
    it('keeps square avatars and consumer style overrides', () => {
        const app = mount(defineComponent({ setup: () => () => h(SkeletonAvatar, { shape: 'square', active: false, testId: 'avatar', style: { width: 64 } }) }));
        expect(app.find('avatar').props.style).toMatchObject({ width: 64, height: 44, borderRadius: 12 });
    });
    it('runs and stops helper animation as active changes', async () => {
        vi.useFakeTimers();
        const active = ref(true);
        const app = mount(defineComponent({ setup: () => () => h(SkeletonInput, { active: active.value, testId: 'input' }) }));
        await vi.advanceTimersByTimeAsync(100);
        await app.settle();
        expect((app.find('input').props.style as { opacity: number }).opacity).toBeLessThan(1);
        active.value = false;
        await app.settle();
        expect(app.find('input').props.style).toMatchObject({ opacity: 1 });
        expect(vi.getTimerCount()).toBe(0);
    });
    it('switches normal Skeleton loading to slot content and retains paragraph widths', async () => {
        vi.useFakeTimers();
        const loading = ref(true);
        const app = mount(defineComponent({ setup: () => () => h(Skeleton, { loading: loading.value, variant: 'paragraph', rows: 3, rowWidths: [100, '50%'], testId: 'paragraph' }, () => h('text', 'Loaded content')) }));
        expect(app.find('paragraph').children.map(node => (node.props.style as { width: unknown }).width)).toEqual([100, '50%', '50%']);
        loading.value = false;
        await app.settle();
        expect(app.text()).toContain('Loaded content');
        expect(vi.getTimerCount()).toBe(0);
    });
});
