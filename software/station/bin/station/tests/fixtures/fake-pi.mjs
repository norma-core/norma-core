import readline from 'node:readline';
import path from 'node:path';

const args = process.argv.slice(2);
const valueAfter = (flag) => {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
};

if (valueAfter('--mode') !== 'rpc') {
  process.stderr.write('fake-pi requires --mode rpc\n');
  process.exit(2);
}

const sessionFile =
  valueAfter('--session') ??
  path.join(valueAfter('--session-dir') ?? '.', 'fake-session.jsonl');

const write = (value, crlf = false) => {
  process.stdout.write(`${JSON.stringify(value)}${crlf ? '\r\n' : '\n'}`);
};

const respond = (command, success = true, data = undefined) => {
  const response = {
    id: command.id,
    type: 'response',
    command: command.type,
    success,
  };
  if (data !== undefined) response.data = data;
  write(response, command.type === 'get_state');
};

const input = readline.createInterface({
  input: process.stdin,
  crlfDelay: Infinity,
});

input.on('line', (line) => {
  const command = JSON.parse(line);
  switch (command.type) {
    case 'get_state':
      respond(command, true, {
        model: { provider: 'test-provider', id: 'test-model' },
        isStreaming: false,
        sessionFile,
        sessionId: 'fake-session-id',
        sessionName: valueAfter('--name'),
        messageCount: 0,
      });
      break;
    case 'prompt':
      respond(command);
      write({ type: 'agent_start' });
      write({
        type: 'message_start',
        message: {
          role: 'user',
          content: [{ type: 'text', text: command.message }],
        },
      });
      write({
        type: 'message_start',
        message: { role: 'assistant', content: [] },
      });
      write({
        type: 'message_update',
        assistantMessageEvent: { type: 'text_delta', delta: 'hello from fake pi' },
      });
      write({
        type: 'message_end',
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: 'hello from fake pi' }],
        },
      });
      write({ type: 'agent_end', messages: [] });
      write({ type: 'agent_settled' });
      break;
    case 'steer':
    case 'follow_up':
    case 'abort':
      respond(command);
      break;
    default:
      write({
        id: command.id,
        type: 'response',
        command: command.type,
        success: false,
        error: `unsupported command: ${command.type}`,
      });
  }
});
