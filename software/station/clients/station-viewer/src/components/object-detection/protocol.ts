export interface ObjectBox {
  label: string;
  score: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface DetectionFrame {
  boxes: ObjectBox[];
  width: number;
  height: number;
}

export type DetectionResponse = { type: 'ready' } | { type: 'error' } | ({ type: 'result' } & DetectionFrame);
