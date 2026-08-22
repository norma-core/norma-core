import { createElement, lazy } from 'react';
import type { ComponentType, ReactNode } from 'react';
import type { Frame, FrameEntry } from '@/api/frame-parser';

type LazyViewLoader<Props extends object> = () => Promise<{ default: ComponentType<Props> }>;

export type LiveLayout = 'card' | 'section' | 'feature' | 'screen';

export const LIVE_TRAIT_REALTIME = 'realtime';

export function frameFieldClaims(
  ...fields: readonly (keyof Frame)[]
): readonly string[] {
  return fields.map((field) => `frame:${String(field)}`);
}

export interface LiveContent {
  key: string;
  content: ReactNode;
}

export interface LiveModule {
  label: string;
  order: number;
  layout: LiveLayout;
  claims: readonly string[];
  traits: readonly string[];
  resolve: (frame: Frame) => readonly LiveContent[];
}

interface LiveDefinition<Props extends object> {
  label: string;
  order?: number;
  layout?: LiveLayout;
  traits?: readonly string[];
  loadView: LazyViewLoader<Props>;
}

export interface CustomLiveDefinition<Props extends object> extends LiveDefinition<Props> {
  claims: readonly string[];
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

export interface FrameEntryLiveDefinition<Key extends LiveFrameEntryField>
  extends LiveDefinition<{ data: FrameEntryData<Key> }> {
  field: Key;
  claims?: readonly string[];
  when?: (data: FrameEntryData<Key>) => boolean;
}

function defineLiveModule<Props extends object>(
  definition: LiveDefinition<Props>,
  claims: readonly string[],
  select: (frame: Frame) => readonly { key: string; props: Props }[],
): LiveModule {
  const View = lazy(definition.loadView);
  const TypedView = View as ComponentType<Props>;

  return {
    label: definition.label,
    order: definition.order ?? 0,
    layout: definition.layout ?? 'section',
    claims,
    traits: definition.traits ?? [],
    resolve: (frame) => select(frame).map(({ key, props }) => ({
      key,
      content: createElement<Props>(TypedView, props),
    })),
  };
}

export function customLive<Props extends object>(
  definition: CustomLiveDefinition<Props>,
): LiveModule {
  return defineLiveModule(definition, definition.claims, definition.select);
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
  definition: FrameEntryLiveDefinition<Key>,
): LiveModule {
  return defineLiveModule(
    definition,
    definition.claims ?? frameFieldClaims(definition.field),
    (frame) =>
      entriesFor(frame, definition.field)
        .filter((entry) => definition.when?.(entry.data) ?? true)
        .map((entry) => ({
          key: entry.queueId,
          props: { data: entry.data },
        })),
  );
}
