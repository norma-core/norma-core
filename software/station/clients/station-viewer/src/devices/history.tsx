import { lazy } from 'react';
import type { ComponentType } from 'react';
import type { AnyDeviceCodec, DeviceCodec, FrameEntry } from './codec';

export interface HistoryExpandedProps<T> {
  entry: FrameEntry<T>;
  onImageClick: (src: string, alt: string) => void;
}

export interface HistoryAdapter<T> {
  codec: DeviceCodec<T>;
  order: number;
  defaultExpanded: boolean;
  Summary?: ComponentType<{ entry: FrameEntry<T> }>;
  Expanded?: ComponentType<HistoryExpandedProps<T>>;
  toJson: (data: T) => unknown;
}

// Heterogeneous discovery erases T once. The history registry keys this value
// by adapter.codec identity, and the shell only pairs it with entries produced
// by that exact codec object.
export type AnyHistoryAdapter = HistoryAdapter<any>;

interface HistoryDefinition<T> {
  codec: DeviceCodec<T>;
  order?: number;
  defaultExpanded?: boolean;
  Summary?: ComponentType<{ entry: FrameEntry<T> }>;
  loadExpanded?: () => Promise<{ default: ComponentType<HistoryExpandedProps<T>> }>;
  toJson?: (data: T) => unknown;
}

const JSON_OPTIONS = {
  longs: String,
  enums: String,
  bytes: String,
  defaults: true,
};

export function defineHistory<T>(definition: HistoryDefinition<T>): HistoryAdapter<T> {
  const Expanded = definition.loadExpanded ? lazy(definition.loadExpanded) : undefined;
  return Object.freeze({
    codec: definition.codec,
    order: definition.order ?? Number.POSITIVE_INFINITY,
    defaultExpanded: definition.defaultExpanded ?? false,
    Summary: definition.Summary,
    Expanded,
    toJson: definition.toJson
      ?? ((data: T) => definition.codec.message.toObject(data, JSON_OPTIONS)),
  });
}

export interface HistoryAdapterLookup {
  forCodec(codec: AnyDeviceCodec): AnyHistoryAdapter | undefined;
  orderFor(codec: AnyDeviceCodec): number;
}
