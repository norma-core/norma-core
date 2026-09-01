import { memo } from 'react';
import { vesc_trampa } from '@/api/proto.js';
import VescTrampaCard from './VescTrampaCard';

export interface VescTrampaViewerProps {
  data: vesc_trampa.IInferenceState;
}

const VescTrampaViewer = memo(function VescTrampaViewer({ data }: VescTrampaViewerProps) {
  if (!data.boards?.length) {
    return null;
  }

  return (
    <div className="w-full font-mono text-accent-success">
      <div className="grid w-full grid-cols-1 gap-4 xl:grid-cols-2">
        {data.boards.map((boardState, boardIndex) => (
          <VescTrampaCard
            key={boardState.board?.uuid?.length ? Array.from(boardState.board.uuid).join('-') : boardState.board?.portName ?? boardIndex}
            boardState={boardState}
            boardIndex={boardIndex}
          />
        ))}
      </div>
    </div>
  );
});

export default VescTrampaViewer;
