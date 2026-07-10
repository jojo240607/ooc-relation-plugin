import * as vscode from 'vscode';
import { McpClient } from '../mcp/mcpClient'; // 路径请根据你的项目结构调整

export class MCPTestPanel {
    public static currentPanel: MCPTestPanel | undefined;
    private readonly _panel: vscode.WebviewPanel;
    private readonly _extensionUri: vscode.Uri;
    private readonly _mcpClient: McpClient;
    private _disposables: vscode.Disposable[] = [];

    public static createOrShow(extensionUri: vscode.Uri, mcpClient: McpClient) {
        const column = vscode.window.activeTextEditor
            ? vscode.window.activeTextEditor.viewColumn
            : undefined;

        if (MCPTestPanel.currentPanel) {
            MCPTestPanel.currentPanel._panel.reveal(column);
            return;
        }

        const panel = vscode.window.createWebviewPanel(
            'mcpTestPanel',
            'MCP Tool Tester',
            column || vscode.ViewColumn.One,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'media')]
            }
        );

        MCPTestPanel.currentPanel = new MCPTestPanel(panel, extensionUri, mcpClient);
    }

    private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri, mcpClient: McpClient) {
        this._panel = panel;
        this._extensionUri = extensionUri;
        this._mcpClient = mcpClient;

        this._panel.webview.html = this._getWebviewContent(this._panel.webview);

        this._panel.webview.onDidReceiveMessage(
            message => this._handleMessage(message),
            null,
            this._disposables
        );

        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);
    }

    private async _handleMessage(message: any) {
        switch (message.command) {
            case 'getTools':
                const tools = await this._mcpClient.getTools();
                const slimTools = tools.map(t => ({
                    name: t.name,
                    description: t.description || '',
                    inputSchema: t.inputSchema || {}
                }));
                this._panel.webview.postMessage({
                    command: 'toolsList',
                    tools: slimTools
                });
                break;

            case 'executeTool':
                try {
                    let args: any;
                    try {
                        args = JSON.parse(message.args);
                    } catch {
                        args = message.args;
                    }
                    const result = await this._mcpClient.callTool(message.toolName, args);
                    this._panel.webview.postMessage({
                        command: 'toolResult',
                        result: result
                    });
                } catch (err: any) {
                    this._panel.webview.postMessage({
                        command: 'toolResult',
                        result: { success: false, message: err.message }
                    });
                }
                break;
        }
    }

    public dispose() {
        MCPTestPanel.currentPanel = undefined;
        this._panel.dispose();
        while (this._disposables.length) {
            const x = this._disposables.pop();
            if (x) x.dispose();
        }
    }

    private _getWebviewContent(webview: vscode.Webview): string {
        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>MCP Tool Tester</title>
    <style>
        body {
            font-family: var(--vscode-font-family);
            padding: 20px;
            color: var(--vscode-foreground);
            background-color: var(--vscode-editor-background);
        }
        select, textarea, button {
            background-color: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            border: 1px solid var(--vscode-input-border);
            padding: 4px 8px;
            font-family: inherit;
        }
        button {
            cursor: pointer;
            margin-top: 10px;
            margin-bottom: 20px;
        }
        #result {
            background-color: var(--vscode-textBlockQuote-background);
            border: 1px solid var(--vscode-widget-border);
            padding: 10px;
            white-space: pre-wrap;
            font-family: var(--vscode-editor-font-family);
            min-height: 100px;
            max-height: 400px;
            overflow-y: auto;
        }
        .error {
            color: var(--vscode-errorForeground);
        }
        .success {
            color: var(--vscode-terminal-ansiGreen);
        }
        #schema {
            font-size: 12px;
            margin-bottom: 10px;
        }
    </style>
</head>
<body>
    <h2>Codebase Memory MCP Tools</h2>

    <label for="toolSelect">Select tool:</label>
    <select id="toolSelect" style="width:100%; margin-bottom:15px;">
        <option value="">-- Loading tools... --</option>
    </select>

    <div id="schema"></div>

    <label for="argsInput">Arguments (JSON):</label>
    <textarea id="argsInput" rows="6" style="width:100%; margin-bottom:10px;">{}</textarea>

    <button id="executeBtn">Execute</button>

    <h3>Result</h3>
    <div id="result"></div>

    <script>
        const vscode = acquireVsCodeApi();

        const toolSelect = document.getElementById('toolSelect');
        const schemaDiv = document.getElementById('schema');
        const argsInput = document.getElementById('argsInput');
        const executeBtn = document.getElementById('executeBtn');
        const resultDiv = document.getElementById('result');

        let tools = [];

        // Request tools list from extension
        vscode.postMessage({ command: 'getTools' });

        // Handle messages from extension
        window.addEventListener('message', event => {
            const msg = event.data;
            switch (msg.command) {
                case 'toolsList':
                    tools = msg.tools;
                    populateToolSelect(tools);
                    break;
                case 'toolResult':
                    displayResult(msg.result);
                    break;
            }
        });

        function populateToolSelect(toolList) {
            toolSelect.innerHTML = '';
            toolList.forEach((tool, idx) => {
                const option = document.createElement('option');
                option.value = tool.name;
                option.textContent = tool.name;
                toolSelect.appendChild(option);
            });
            if (toolList.length > 0) {
                toolSelect.selectedIndex = 0;
                updateToolInfo(toolList[0]);
            }
        }

        toolSelect.addEventListener('change', () => {
            const selectedName = toolSelect.value;
            const tool = tools.find(t => t.name === selectedName);
            if (tool) {
                updateToolInfo(tool);
            }
        });

        // ---------- 改进的 updateToolInfo：自动填充默认参数 ----------
        function updateToolInfo(tool) {
            // 显示工具描述和完整 schema
            schemaDiv.innerHTML = '<strong>Description:</strong> ' + escapeHtml(tool.description) +
                '<br><strong>Parameters:</strong><pre>' + JSON.stringify(tool.inputSchema, null, 2) + '</pre>';

            // 根据 inputSchema 自动生成包含默认值的参数对象
            const defaultArgs = {};
            if (tool.inputSchema && tool.inputSchema.properties) {
                for (const [key, prop] of Object.entries(tool.inputSchema.properties)) {
                    if (prop.default !== undefined) {
                        defaultArgs[key] = prop.default;
                    }
                    // 可选：如果希望必填字段自动填充空字符串，取消下面的注释
                    // else if (tool.inputSchema.required && tool.inputSchema.required.includes(key)) {
                    //     defaultArgs[key] = "";
                    // }
                }
            }
            argsInput.value = JSON.stringify(defaultArgs, null, 2);
            resultDiv.textContent = '';
        }

        executeBtn.addEventListener('click', () => {
            const toolName = toolSelect.value;
            if (!toolName) return;
            const argsStr = argsInput.value;
            resultDiv.textContent = 'Executing...';
            vscode.postMessage({
                command: 'executeTool',
                toolName: toolName,
                args: argsStr
            });
        });

        function displayResult(result) {
            if (result.success) {
                resultDiv.innerHTML = '<span class="success">Success</span>\\n' + escapeHtml(result.message);
            } else {
                resultDiv.innerHTML = '<span class="error">Error</span>\\n' + escapeHtml(result.message);
            }
        }

        function escapeHtml(text) {
            return text
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;');
        }
    </script>
</body>
</html>`;
    }
}