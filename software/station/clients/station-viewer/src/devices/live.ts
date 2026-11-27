import { createElement, lazy } from 'react';
import type { ComponentType, ReactNode } from 'react';
import type { Frame, FrameEntry } from '@/api/frame-parser';

type LazyViewLoader<Props extends object> = () => Promise<{ default: ComponentType<Props> }>;

export type LiveDeviceSlot = 'summary' | 'primary';

export interface LiveDeviceContent {
  key: string;
  content: ReactNode;
}

export interface LiveDeviceAdapter {
  id: string;
  label: string;
  order: number;
  slot: LiveDeviceSlot;
  isRealtime: boolean;
  ownsCameras: boolean;
  isImmersive: boolean;
  replaces: readonly string[];
  resolve: (frame: Frame) => readonly LiveDeviceContent[];
}

interface LiveDeviceDefinition<Props extends object> {
  id: string;
  label: string;
  order: number;
  slot?: LiveDeviceSlot;
  isRealtime?: boolean;
  ownsCameras?: boolean;
  isImmersive?: boolean;
  replaces?: readonly string[];
  loadView: LazyViewLoader<Props>;
}

export interface CustomLiveDeviceDefinition<Props extends object> extends LiveDeviceDefinition<Props> {
  select: (frame: Frame) => readonly {
    key: string;
    props: Props;
  }[];
}

type FrameEntryItem<Value> = Value extends readonly (infer Item)[] ? Item : Value;
type FrameEntryValue<Key extends keyof Frame> = FrameEntryItem<NonNullable<Frame[Key]>>;

export type LiveFrameEntryField = Extract<{
  [Key in keyof Frame]: FrameEntryValue<Key> extends FrameEntry<unknown> ? Key : never;
}[keyof Frame], keyof Frame>;

type FrameEntryData<Key extends LiveFrameEntryField> =
  FrameEntryValue<Key> extends FrameEntry<infer Data> ? Data : never;

export interface FrameEntryLiveDeviceDefinition<Key extends LiveFrameEntryField>
  extends LiveDeviceDefinition<{ data: FrameEntryData<Key> }> {
  field: Key;
  when?: (data: FrameEntryData<Key>) => boolean;
}

function defineLiveDevice<Props extends object>(
  definition: LiveDeviceDefinition<Props>,
  select: (frame: Frame) => readonly { key: string; props: Props }[],
): LiveDeviceAdapter {
  const View = lazy(definition.loadView);
  const TypedView = View as ComponentType<Props>;

  return {
    id: definition.id,
    label: definition.label,
    order: definition.order,
    slot: definition.slot ?? 'primary',
    isRealtime: definition.isRealtime ?? false,
    ownsCameras: definition.ownsCameras ?? false,
    isImmersive: definition.isImmersive ?? false,
    replaces: definition.replaces ?? [],
    resolve: (frame) => select(frame).map(({ key, props }) => ({
      key,
      content: createElement<Props>(TypedView, props),
    })),
  };
}

export function customLive<Props extends object>(
  definition: CustomLiveDeviceDefinition<Props>,
): LiveDeviceAdapter {
  return defineLiveDevice(definition, definition.select);
}

function entriesFor<Key extends LiveFrameEntryField>(
  frame: Frame,
  field: Key,
): readonly FrameEntry<FrameEntryData<Key>>[] {
  const value = frame[field] as
    | FrameEntry<FrameEntryData<Key>>
    | readonly FrameEntry<FrameEntryData<Key>>[]
    | undefined;

  if (!value) {
    return [];
  }

  if (Array.isArray(value)) {
    return value as readonly FrameEntry<FrameEntryData<Key>>[];
  }

  return [value as FrameEntry<FrameEntryData<Key>>];
}

export function live<Key extends LiveFrameEntryField>(
  definition: FrameEntryLiveDeviceDefinition<Key>,
): LiveDeviceAdapter {
  return defineLiveDevice(definition, (frame) =>
    entriesFor(frame, definition.field)
      .filter((entry) => definition.when?.(entry.data) ?? true)
      .map((entry) => ({
        key: entry.queueId,
        props: { data: entry.data },
      })),
  );
}
