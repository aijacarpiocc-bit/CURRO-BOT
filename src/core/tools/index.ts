import { ToolDefinition, ToolExecutionResult } from "../types.js";
import { getCurrentTimeTool } from "./getCurrentTime.js";
import { googleWorkspaceTools } from "./googleWorkspace.js";
import { setProfilePhotoTool } from "./setProfilePhoto.js";

interface RegisteredTool {
  definition: ToolDefinition;
  execute(args: Record<string, unknown>): Promise<ToolExecutionResult>;
}

const registeredTools: RegisteredTool[] = [
  getCurrentTimeTool,
  setProfilePhotoTool,
  ...googleWorkspaceTools,
];

const tools = new Map<string, RegisteredTool>(
  registeredTools.map((tool) => [tool.definition.name, tool]),
);

export function listToolDefinitions(): ToolDefinition[] {
  return Array.from(tools.values(), (tool) => tool.definition);
}

export async function runTool(name: string, args: Record<string, unknown>): Promise<ToolExecutionResult> {
  const tool = tools.get(name);
  if (!tool) {
    return {
      ok: false,
      output: `Herramienta no permitida: ${name}`,
    };
  }

  return tool.execute(args);
}
