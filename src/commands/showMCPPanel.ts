import * as vscode from 'vscode';
import { MCPTestPanel } from '../panels/MCPTestPanel';
import { McpClient } from '../mcp/mcpClient'; // 假设从这里导出

export function showMCPPanel(context: vscode.ExtensionContext, McpClient: McpClient) {
    MCPTestPanel.createOrShow(context.extensionUri, McpClient);
}