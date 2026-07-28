export type ToolProtocolKind = 'ASSISTANT_MESSAGE' | 'TOOL_REQUEST' | 'MALFORMED_TOOL_PROTOCOL';

export interface ToolProtocolInspection {
  readonly kind: ToolProtocolKind;
  readonly assistantText: string;
}

export class MalformedToolProtocolError extends Error {
  readonly code = 'MALFORMED_TOOL_PROTOCOL';
  readonly recoverable = true;

  constructor() {
    super('The model returned malformed internal tool protocol.');
    this.name = 'MalformedToolProtocolError';
  }
}

const PROTOCOL_MARKER = /<\/?(?:tool_calls|function_calls|tool_results|invoke|parameter)\b/i;
const COMPLETE_BLOCK = /<(tool_calls|function_calls)>([\s\S]*?)<\/\1>/g;

function validStructuredBody(body: string): boolean {
  try {
    const value = JSON.parse(body);
    return Array.isArray(value) && value.length > 0 && value.every((call) =>
      call && typeof call === 'object' && typeof call.name === 'string' &&
      (call.arguments === undefined || (call.arguments && typeof call.arguments === 'object' && !Array.isArray(call.arguments))));
  } catch {
    return false;
  }
}

function validXmlBody(body: string): boolean {
  const invokes = [...body.matchAll(/<invoke name="[^"]+">([\s\S]*?)<\/invoke>/g)];
  if (invokes.length === 0) return false;
  return invokes.every((invoke) => {
    const remainder = invoke[1].replace(/<parameter name="[^"]+">[\s\S]*?<\/parameter>/g, '').trim();
    return remainder.length === 0;
  });
}

export function inspectToolProtocolMessage(message: string): ToolProtocolInspection {
  if (!PROTOCOL_MARKER.test(message)) return Object.freeze({ kind: 'ASSISTANT_MESSAGE', assistantText: message });
  const blocks = [...message.matchAll(COMPLETE_BLOCK)];
  if (blocks.length === 0) return Object.freeze({ kind: 'MALFORMED_TOOL_PROTOCOL', assistantText: '' });

  let consumed = '';
  for (const block of blocks) {
    const valid = block[1] === 'tool_calls'
      ? (validStructuredBody(block[2]) || validXmlBody(block[2]))
      : validXmlBody(block[2]);
    if (!valid) return Object.freeze({ kind: 'MALFORMED_TOOL_PROTOCOL', assistantText: '' });
    consumed += block[0];
  }
  const remainder = message.replace(COMPLETE_BLOCK, '');
  if (PROTOCOL_MARKER.test(remainder) || consumed.length === 0) {
    return Object.freeze({ kind: 'MALFORMED_TOOL_PROTOCOL', assistantText: '' });
  }
  return Object.freeze({ kind: 'TOOL_REQUEST', assistantText: '' });
}
