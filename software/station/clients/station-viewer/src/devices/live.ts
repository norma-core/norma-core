import { createElement, lazy } from 'react';
import type { ComponentType, ReactNode } from 'react';
import type { Frame } from '@/api/frame-parser';
import type { DeviceCodec } from './codec';

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
  embedsCameraFeed: boolean;
  resolve: (frame: Frame) => readonly LiveDeviceContent[];
}

interface LiveDeviceDefinition<Props extends object> {
  id: string;
  label: string;
  order: number;
  slot?: LiveDeviceSlot;
  isRealtime?: boolean;
  embedsCameraFeed?: boolean;
  loadView: LazyViewLoader<Props>;
}

export interface CustomLiveDeviceDefinition<Props extends object> extends LiveDeviceDefinition<Props> {
  select: (frame: Frame) => readonly {
    key: string;
    props: Props;
  }[];
}

export interface CodecLiveDeviceDefinition<T>
  extends LiveDeviceDefinition<{ data: T }> {
  codec: DeviceCodec<T>;
  when?: (data: T) => boolean;
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
    embedsCameraFeed: definition.embedsCameraFeed ?? false,
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

export function live<T>(
  definition: CodecLiveDeviceDefinition<T>,
): LiveDeviceAdapter {
  return defineLiveDevice(definition, (frame) =>
    frame.devices.entriesOf(definition.codec)
      .filter((entry) => definition.when?.(entry.data) ?? true)
      .map((entry) => ({
        key: entry.queueId,
        props: { data: entry.data },
      })),
  );
}
