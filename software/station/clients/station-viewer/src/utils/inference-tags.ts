export interface TagMarker {
  frame: number;
  tag: string;
}

export interface InferenceTagEvent extends TagMarker {
  removed: boolean;
}

function tagIdentity(tag: TagMarker): string {
  return JSON.stringify([tag.frame, tag.tag]);
}

export function resolveInferenceTagEvents(events: readonly InferenceTagEvent[]): TagMarker[] {
  const activeTags = new Map<string, TagMarker>();

  for (const event of events) {
    const identity = tagIdentity(event);
    if (event.removed) {
      activeTags.delete(identity);
    } else {
      activeTags.set(identity, { frame: event.frame, tag: event.tag });
    }
  }

  return Array.from(activeTags.values()).sort((left, right) => (
    left.frame - right.frame || left.tag.localeCompare(right.tag)
  ));
}
