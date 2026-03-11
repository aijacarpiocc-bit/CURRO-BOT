export type ChatRole = "system" | "user" | "assistant" | "tool";

export interface ChatMessage {
  role: ChatRole;
  content: string;
  name?: string;
}

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface AgentToolCall {
  name: string;
  arguments: Record<string, unknown>;
}

export interface AgentModelResponse {
  reply: string;
  toolCall?: AgentToolCall;
}

export type ToolExecutionResult = {
  ok: boolean;
  output: string;
};
