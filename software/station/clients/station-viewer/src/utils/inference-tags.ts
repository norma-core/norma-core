export interface TagMarker {
  frame: number;
  pointer: Uint8Array;
  tag: string;
}

export interface InferenceTagEvent extends TagMarker {
  removed: boolean;
}

function tagIdentity(tag: TagMarker): string {
  return JSON.stringify([pointerToBigInt(tag.pointer).toString(), tag.tag]);
}

export function pointerToBigInt(pointer: Uint8Array): bigint {
  let value = 0n;
  for (let index = pointer.length - 1; index >= 0; index -= 1) {
    value = (value << 8n) | BigInt(pointer[index]);
  }
  return value;
}

export function resolveInferenceTagEvents(events: readonly InferenceTagEvent[]): TagMarker[] {
  const activeTags = new Map<string, TagMarker>();

  for (const event of events) {
    const identity = tagIdentity(event);
    if (event.removed) {
      activeTags.delete(identity);
    } else {
      activeTags.set(identity, {
        frame: event.frame,
        pointer: event.pointer,
        tag: event.tag,
      });
    }
  }

  return Array.from(activeTags.values()).sort((left, right) => {
    const leftPointer = pointerToBigInt(left.pointer);
    const rightPointer = pointerToBigInt(right.pointer);
    if (leftPointer !== rightPointer) return leftPointer < rightPointer ? -1 : 1;
    return left.tag.localeCompare(right.tag);
  });
}
