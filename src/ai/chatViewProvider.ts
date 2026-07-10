import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { callDeepSeekForFunctionCalls, callDeepSeekForText, streamDeepSeekForText } from './deepseekClient';
import { OOC_TOOLS } from './tools';
import { executeFunctionCalls } from './agentExecutor';
import { relationStore } from '../sync/ClassRelationStore';
import { McpClient } from '../mcp/mcpClient';
import { exec } from 'child_process';
import { promisify } from 'util';

interface ChatMessage {
    role: 'user' | 'assistant' | 'system';
    text: string;
}

interface PersistedData {
    chatHistory: ChatMessage[];
    inputHistory: string[];
    fullHistory?: any[];
}

const MAX_HISTORY_SIZE = 20;
const execAsync = promisify(exec);

function trimHistoryByTurns(history: any[], maxTurns: number): any[] {
    const turns: any[][] = [];
    let currentTurn: any[] = [];
    for (const msg of history) {
        if (msg.role === 'user' && currentTurn.length > 0) {
            turns.push(currentTurn);
            currentTurn = [];
        }
        currentTurn.push(msg);
    }
    if (currentTurn.length > 0) turns.push(currentTurn);
    return turns.slice(-maxTurns).flat();
}

export class ChatViewProvider implements vscode.WebviewViewProvider, vscode.Disposable {
    private _view?: vscode.WebviewView;
    private _chatHistory: ChatMessage[] = [];
    private _inputHistory: string[] = [];
    private _fullHistory: any[] = [];
    private _allTools: any[] = [...OOC_TOOLS];
    private _cachedArchitecture: string = '';
    private _commandExecutionAllowed: boolean = false;

    constructor(private readonly _context: vscode.ExtensionContext,
        private mcpClient: McpClient
    ) {
        this._loadPersistedData();
        this.mcpClient.start()
            .then(() => {
                console.log('[MCP] Process started');
                setTimeout(() => this._updateTools(), 2000);
            })
            .catch(err => {
                console.error('[MCP] Start failed:', err);
                vscode.window.showErrorMessage('MCP 启动失败，高级分析不可用');
            });

        _context.subscriptions.push(this);
    }

    dispose() {
        this.mcpClient.dispose();
    }

    private get _workspaceRoot(): string {
        return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '';
    }

    private _getDataFilePath(): string {
        return path.join(this._workspaceRoot, '.vscode', 'ooc-chat-data.json');
    }

    private _loadPersistedData() {
        const filePath = this._getDataFilePath();
        if (!this._workspaceRoot || !fs.existsSync(filePath)) return;
        try {
            const raw = fs.readFileSync(filePath, 'utf-8');
            const parsed: PersistedData = JSON.parse(raw);

            this._chatHistory = (parsed.chatHistory || []).map(m => ({
                role: m.role as 'user' | 'assistant' | 'system',
                text: m.text || ''
            }));
            this._inputHistory = (parsed.inputHistory || []).filter(t => typeof t === 'string');

            if (parsed.fullHistory && Array.isArray(parsed.fullHistory)) {
                this._fullHistory = parsed.fullHistory;
            } else {
                this._fullHistory = this._chatHistory.map(m => ({
                    role: m.role,
                    content: m.text
                }));
            }
        } catch (err) {
            console.error('[ChatView] Failed to load data:', err);
        }
    }

    private _savePersistedData() {
        if (!this._workspaceRoot) return;
        const dir = path.join(this._workspaceRoot, '.vscode');
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

        const chat = this._chatHistory.length > MAX_HISTORY_SIZE
            ? this._chatHistory.slice(-MAX_HISTORY_SIZE) : this._chatHistory;
        const input = this._inputHistory.length > 100
            ? this._inputHistory.slice(-100) : this._inputHistory;

        const MAX_TURNS = 50;
        const full = trimHistoryByTurns(this._fullHistory, MAX_TURNS);

        const data: PersistedData = {
            chatHistory: chat,
            inputHistory: input,
            fullHistory: full
        };

        try {
            fs.writeFileSync(this._getDataFilePath(), JSON.stringify(data, null, 2), 'utf-8');
        } catch (err) {
            console.error('[ChatView] Failed to save data:', err);
        }
    }

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken
    ) {
        this._view = webviewView;
        webviewView.webview.options = { enableScripts: true };
        webviewView.webview.html = this._getHtml();

        webviewView.webview.onDidReceiveMessage(async (msg) => {
            if (msg.command === 'ask') {
                await this._handleAsk(msg.text);
            }
        });
    }

    private async _handleAsk(userInput: string) {
        if (!this._view || !userInput) return;

        this._inputHistory.push(userInput);
        const userMsg: ChatMessage = { role: 'user', text: userInput };
        this._chatHistory.push(userMsg);
        this._fullHistory.push({ role: 'user', content: userInput });
        this._savePersistedData();

        let existingClassesInfo = '';
        try {
            const classNames = relationStore.getAllClassNames();
            existingClassesInfo = classNames.map(name => {
                const entry = relationStore.getClass(name);
                const filePath = entry
                    ? vscode.Uri.joinPath(vscode.workspace.workspaceFolders![0].uri, entry.file).fsPath
                    : `${name}.h`;
                return `${name} -> ${filePath}`;
            }).join('\n');
        } catch (err) {
            console.error('[ChatView] Failed to get existing classes:', err);
        }
        const contextInfo = `Workspace root: ${this._workspaceRoot}\nExisting classes:\n${existingClassesInfo || 'none'}`;

        let systemPrompt: string;
        try {
            systemPrompt = await this._loadSystemPrompt(contextInfo);
        } catch (err: any) {
            this._sendError(`❌ 配置错误: ${err.message}`);
            return;
        }

        const messages: any[] = [
            { role: 'system', content: systemPrompt }
        ];
        const cleanHistory = this._fullHistory.filter(m => m.role !== 'system');
        messages.push(...cleanHistory);

        let allResults: string[] = [];
        const maxSteps = 50;

        try {
            for (let step = 0; step < maxSteps; step++) {
                const result = await callDeepSeekForFunctionCalls(messages, this._allTools, step === 0);
                const calls = result.calls;
                const assistantMsg = result.assistantMessage;
                if (calls.length === 0) break;

                const stepDesc = calls.map(c => c.name).join(', ');
                const stepId = 'step-' + Date.now() + '-' + Math.random().toString(36).substr(2, 5);
                this._view.webview.postMessage({
                    command: 'stepStart',
                    stepId: stepId,
                    text: `正在执行: ${stepDesc}...`,
                    reasoning: assistantMsg?.reasoning_content || null
                });

                const results = await this._executeWithMCPFallback(calls);
                const resultText = results.join('\n');
                this._view.webview.postMessage({ command: 'stepResult', text: resultText });
                allResults.push(...results);

                calls.forEach((call, idx) => {
                    if (call.name === 'update_ai_prompt' && results[idx]?.startsWith('✅')) {
                        const content = call.arguments.content;
                        messages.push({
                            role: 'system',
                            content: `【提示词已更新】请立即遵守以下新规则：\n${content.substring(0, 500)}`
                        });
                    }
                });

                const safeAssistantMsg = {
                    role: 'assistant',
                    content: assistantMsg.content || null,
                    tool_calls: assistantMsg.tool_calls?.map((tc: any) => ({
                        id: tc.id,
                        type: 'function',
                        function: {
                            name: tc.function.name,
                            arguments: typeof tc.function.arguments === 'string'
                                ? tc.function.arguments
                                : JSON.stringify(tc.function.arguments)
                        }
                    }))
                };
                messages.push(safeAssistantMsg);
                this._fullHistory.push(safeAssistantMsg);

                results.forEach((res, i) => {
                    const toolMsg = {
                        role: 'tool',
                        tool_call_id: assistantMsg.tool_calls[i].id,
                        content: res
                    };
                    messages.push(toolMsg);
                    this._fullHistory.push(toolMsg);
                });

                await new Promise(resolve => setTimeout(resolve, 500));
            }

            // 生成最终总结
            let finalText = '';
            let isStreaming = false;   // 标记是否使用了流式输出

            if (allResults.length > 0) {
                isStreaming = true;
                messages.push({
                    role: 'system',
                    content: '工具调用已完成。请**不要再调用任何工具**，直接根据上面的工具执行结果，用中文生成最终分析报告或总结。直接输出文本，不要使用任何 JSON 数组或 XML 格式。'
                });

                this._view.webview.postMessage({ command: 'streamStart' });
                try {
                    const stream = streamDeepSeekForText(messages);
                    for await (const chunk of stream) {
                        if (chunk.type === 'reasoning') {
                            this._view?.webview.postMessage({ command: 'streamThinking', text: chunk.text });
                        } else {
                            finalText += chunk.text;
                            this._view?.webview.postMessage({ command: 'streamChunk', text: chunk.text });
                        }
                    }
                    this._view?.webview.postMessage({ command: 'streamEnd' });
                } catch (err) {
                    this._view?.webview.postMessage({ command: 'streamEnd', error: true });
                    finalText = '⚠️ 流式总结生成失败: ' + (err as Error).message;
                }
            } else {
                // 没有工具调用，直接取助手第一条文本回复
                const firstAssistantMsg = messages.find(m => m.role === 'assistant' && m.content);
                if (firstAssistantMsg?.content) {
                    finalText = firstAssistantMsg.content;
                } else {
                    finalText = '';
                }
            }

            // 保存最终结果并通知前端
            if (finalText) {
                const assistantSimpleMsg: ChatMessage = { role: 'assistant', text: finalText };
                this._chatHistory.push(assistantSimpleMsg);
                this._fullHistory.push({ role: 'assistant', content: finalText });
                this._savePersistedData();

                // 【关键修复】如果没有流式输出，需要手动通知前端显示助手消息
                if (!isStreaming) {
                    this._view?.webview.postMessage({ command: 'addMessage', role: 'assistant', text: finalText });
                }
            } else {
                // 没有任何有效回复，也要告知前端
                this._view?.webview.postMessage({ command: 'addMessage', role: 'assistant', text: 'AI 未给出有效回复。' });
            }

        } catch (err: any) {
            this._sendError(`❌ AI 调用失败: ${err.message}`);
        }
    }

    private async _executeWithMCPFallback(calls: { name: string; arguments: any }[]): Promise<string[]> {
        const results: string[] = [];
        const oocToolNames = new Set(OOC_TOOLS.map(t => t.function.name));

        const projectTools = new Set([
            'search_graph', 'query_graph', 'get_code_snippet', 'get_graph_schema',
            'get_architecture', 'search_code', 'delete_project', 'index_status',
            'detect_changes', 'manage_adr', 'ingest_traces', 'trace_path'
        ]);
        const repoPathTools = new Set(['index_repository']);

        for (const call of calls) {
            if (call.name === 'update_ai_prompt') {
                const res = await this._handleUpdatePrompt(call.arguments);
                results.push(res);
                continue;
            }
            if (call.name === 'run_command') {
                const res = await this._executeCommand(call.arguments.command, call.arguments.timeout || 30);
                results.push(res);
                continue;
            }

            if (oocToolNames.has(call.name)) {
                const [result] = await executeFunctionCalls([call]);
                results.push(result);
            } else {
                if (projectTools.has(call.name) && !call.arguments.project) {
                    const projectName = await this._getMcpProjectName();
                    if (projectName) {
                        call.arguments.project = projectName;
                        console.log(`[MCP AutoFix] Added project="${projectName}" for ${call.name}`);
                    }
                }
                if (repoPathTools.has(call.name) && !call.arguments.repo_path) {
                    call.arguments.repo_path = this._workspaceRoot;
                    console.log(`[MCP AutoFix] Added repo_path="${this._workspaceRoot}" for ${call.name}`);
                }
                if (call.name === 'search_graph' && !call.arguments.limit) {
                    call.arguments.limit = 10;
                    console.log('[MCP AutoFix] Added default limit=10 for search_graph');
                }

                try {
                    const mcpResult = await this.mcpClient.callTool(call.name, call.arguments);
                    const prefix = mcpResult.success ? '✅ [MCP]' : '❌ [MCP]';
                    results.push(`${prefix} ${call.name}: ${mcpResult.message}`);
                } catch (err: any) {
                    results.push(`❌ [MCP] ${call.name}: ${err.message}`);
                }
            }
        }
        return results;
    }

    private async _handleUpdatePrompt(args: {
        action: 'append' | 'replace_section' | 'prepend';
        section_title?: string;
        content: string;
    }): Promise<string> {
        const workspaceRoot = this._workspaceRoot;
        if (!workspaceRoot) {
            return '❌ update_ai_prompt: 未打开工作区';
        }
        const promptPath = path.join(workspaceRoot, '.vscode', 'ooc-ai-prompt.txt');
        if (!fs.existsSync(promptPath)) {
            const defaultPromptPath = path.join(this._context.extensionPath, 'resources', 'default-prompt.txt');
            if (fs.existsSync(defaultPromptPath)) {
                fs.copyFileSync(defaultPromptPath, promptPath);
            } else {
                return '❌ update_ai_prompt: 默认提示词文件缺失，无法创建';
            }
        }
        let currentContent = fs.readFileSync(promptPath, 'utf-8');
        const { action, section_title, content } = args;

        if (action === 'append') {
            currentContent += '\n\n' + content;
        } else if (action === 'prepend') {
            currentContent = content + '\n\n' + currentContent;
        } else if (action === 'replace_section') {
            if (!section_title) {
                return '❌ update_ai_prompt: replace_section 需要 section_title 参数';
            }
            const escaped = section_title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const regex = new RegExp(`(## ${escaped}[\\s\\S]*?)(?=\n## |\n*$)`, 'gm');
            if (!regex.test(currentContent)) {
                return `❌ update_ai_prompt: 未找到章节 "${section_title}"`;
            }
            currentContent = currentContent.replace(regex, `## ${section_title}\n${content}`);
        }

        try {
            fs.writeFileSync(promptPath, currentContent, 'utf-8');
            return `✅ update_ai_prompt: 提示词已更新 (${action})`;
        } catch (err: any) {
            return `❌ update_ai_prompt: 写入失败 - ${err.message}`;
        }
    }

    private async _getAiTextResponse(messages: any[]): Promise<string> {
        try {
            return await callDeepSeekForText(messages);
        } catch (err) {
            console.error('Failed to get AI text response:', err);
            return '';
        }
    }

    private _sendError(text: string) {
        if (this._view) {
            const msg: ChatMessage = { role: 'system', text };
            this._chatHistory.push(msg);
            this._savePersistedData();
            this._view.webview.postMessage({ command: 'error', text });
        }
    }

    private async _loadSystemPrompt(contextInfo: string): Promise<string> {
        const workspaceRoot = this._workspaceRoot;
        let basePrompt: string;

        if (workspaceRoot) {
            const vscodeDir = path.join(workspaceRoot, '.vscode');
            const projectPromptPath = path.join(vscodeDir, 'ooc-ai-prompt.txt');
            if (fs.existsSync(projectPromptPath)) {
                const content = fs.readFileSync(projectPromptPath, 'utf-8').trim();
                if (content) {
                    basePrompt = content;
                } else {
                    basePrompt = this._loadDefaultPrompt();
                }
            } else {
                basePrompt = this._loadDefaultPrompt();
                try {
                    if (!fs.existsSync(vscodeDir)) fs.mkdirSync(vscodeDir, { recursive: true });
                    fs.writeFileSync(projectPromptPath, basePrompt, 'utf-8');
                } catch (err) {
                    console.error('[ChatView] Failed to create default prompt file:', err);
                }
            }
        } else {
            basePrompt = this._loadDefaultPrompt();
        }

        try {
            const projName = await this._getMcpProjectName();
            if (projName) {
                contextInfo += `\nCurrent MCP project name: "${projName}" (use this as 'project' parameter in MCP tools)`;
            }
        } catch (e) {
            console.error('[ChatView] Failed to get MCP project name:', e);
        }

        try {
            const mcpTools = await this.mcpClient.getTools();
            if (mcpTools.length > 0) {
                const toolLines = mcpTools.map((t: any) => {
                    const required = t.inputSchema?.required || [];
                    const reqStr = required.length > 0 ? `【必填：${required.join(', ')}】` : '';
                    return `- ${t.name} ${reqStr}：${t.description?.split('.')[0] || ''}`;
                });
                basePrompt += `\n\n## 当前可用的 MCP 分析工具\n${toolLines.join('\n')}`;
            }
        } catch (e) {
            console.error('[ChatView] Failed to attach MCP tools to prompt:', e);
        }

        return basePrompt.replace('${contextInfo}', contextInfo);
    }

    private _loadDefaultPrompt(): string {
        const defaultPromptPath = path.join(this._context.extensionPath, 'resources', 'default-prompt.txt');
        if (!fs.existsSync(defaultPromptPath)) {
            throw new Error(`默认提示词文件缺失：${defaultPromptPath}`);
        }
        const defaultContent = fs.readFileSync(defaultPromptPath, 'utf-8').trim();
        if (!defaultContent) throw new Error('默认提示词文件为空');
        return defaultContent;
    }

    private async _updateTools() {
        const maxRetries = 5;
        for (let i = 0; i < maxRetries; i++) {
            try {
                this.mcpClient.clearToolsCache();
                const mcpTools = await this.mcpClient.getTools();
                console.log(`[MCP] Attempt ${i + 1}: Available tools:`, mcpTools.map((t: any) => t.name));
                if (mcpTools.length > 0) {
                    await this._cacheArchitecture();

                    const openAiFormatted = mcpTools.map((t: any) => ({
                        type: 'function',
                        function: {
                            name: t.name,
                            description: t.description || '',
                            parameters: t.inputSchema || { type: 'object', properties: {} }
                        }
                    }));

                    const toolMap = new Map<string, any>();

                    OOC_TOOLS.forEach(t => toolMap.set(t.function.name, t));

                    openAiFormatted.forEach(t => {
                        if (!toolMap.has(t.function.name)) {
                            toolMap.set(t.function.name, t);
                        }
                    });

                    toolMap.set('update_ai_prompt', {
                        type: 'function',
                        function: {
                            name: 'update_ai_prompt',
                            description: '更新项目的 AI 提示词配置文件 (.vscode/ooc-ai-prompt.txt)，用于沉淀经验、修复规则或添加约定。',
                            parameters: {
                                type: 'object',
                                properties: {
                                    action: {
                                        type: 'string',
                                        enum: ['append', 'replace_section', 'prepend'],
                                        description: '操作类型'
                                    },
                                    section_title: {
                                        type: 'string',
                                        description: '当 action=replace_section 时，指定要替换的章节标题'
                                    },
                                    content: {
                                        type: 'string',
                                        description: '要写入的新内容（纯文本）'
                                    }
                                },
                                required: ['action', 'content']
                            }
                        }
                    });

                    toolMap.set('run_command', {
                        type: 'function',
                        function: {
                            name: 'run_command',
                            description: '在项目工作目录下执行一个 Windows shell 命令，返回标准输出、标准错误和退出码。用于编译、运行测试等。',
                            parameters: {
                                type: 'object',
                                properties: {
                                    command: {
                                        type: 'string',
                                        description: '要执行的完整命令，例如 "gcc main.c -o test.exe && test.exe"'
                                    },
                                    timeout: {
                                        type: 'number',
                                        description: '命令超时秒数，默认 30',
                                        default: 30
                                    }
                                },
                                required: ['command']
                            }
                        }
                    });

                    this._allTools = Array.from(toolMap.values());

                    console.log('[MCP] Total tools:', this._allTools.length);
                    vscode.window.showInformationMessage(`MCP 已就绪，提供 ${mcpTools.length} 个分析工具`);
                    return;
                }
            } catch (e) {
                console.error(`[MCP] Retry ${i + 1} failed:`, e);
            }
            await new Promise(resolve => setTimeout(resolve, 3000));
        }
        console.warn('[MCP] Failed to get tools after retries');
    }

    private async _cacheArchitecture() {
        try {
            const projName = await this._getMcpProjectName();
            if (!projName) return;
            const indexStatus = await this.mcpClient.callTool('index_status', { project: projName });
            if (!indexStatus.success || !indexStatus.message.includes('indexed')) {
                await this.mcpClient.callTool('index_repository', { repo_path: this._workspaceRoot });
            }
            const result = await this.mcpClient.callTool('get_architecture', { project: projName });
            if (result.success) {
                this._cachedArchitecture = `## 项目架构缓存（来自 MCP）\n${result.message}\n\n（以上数据在本次会话中有效，后续问题请直接引用）`;
            }
        } catch (e) {
            console.error('[ChatView] Failed to cache architecture:', e);
        }
    }

    private async _getMcpProjectName(): Promise<string> {
        try {
            const res = await this.mcpClient.callTool('list_projects', {});
            if (res.success) {
                let projects: any[] = [];
                try {
                    const parsed = JSON.parse(res.message);
                    if (Array.isArray(parsed)) projects = parsed;
                    else if (parsed.projects && Array.isArray(parsed.projects)) projects = parsed.projects;
                } catch {
                    projects = res.message.split('\n').filter(line => line.trim());
                }
                if (projects.length > 0) {
                    const first = projects[0];
                    return typeof first === 'string' ? first : (first.name || first.project || '');
                }
            }
        } catch (e) {}
        return '';
    }

    private _extractMissingParams(errorMsg: string): string[] {
        const match = errorMsg.match(/(\w+)\s+is required/);
        return match ? [match[1]] : [];
    }

    private _getHtml(): string {
        const htmlPath = path.join(this._context.extensionPath, 'resources', 'chat.html');
        if (!fs.existsSync(htmlPath)) {
            return `<html><body><h3>错误：找不到 chat.html</h3></body></html>`;
        }
        let html = fs.readFileSync(htmlPath, 'utf-8');
        html = html.replace('{{HISTORY_JSON}}', JSON.stringify(this._chatHistory));
        html = html.replace('{{INPUT_HISTORY_JSON}}', JSON.stringify(this._inputHistory));
        return html;
    }

    private async _executeCommand(command: string, timeout: number = 30): Promise<string> {
        const workspaceRoot = this._workspaceRoot;
        if (!workspaceRoot) {
            return '❌ 未打开工作区，无法执行命令';
        }

        const SAFE_COMMANDS = [
            'gcc', 'g++', 'make', 'cmake', 'ctest', 'echo', 'dir', 'ls',
            'mkdir', 'md', 'rmdir', 'del', 'copy', 'xcopy', 'cd', 'pushd', 'popd',
            'set', 'if', 'for', 'type', 'find', 'findstr', 'powershell'
        ];
        
        const firstWord = command.trim().split(/\s+/)[0].toLowerCase();
        const isExeInWorkspace = firstWord.endsWith('.exe') && path.resolve(workspaceRoot, firstWord).startsWith(workspaceRoot);
        const isSafe = SAFE_COMMANDS.some(cmd => firstWord === cmd || firstWord.endsWith(`\\${cmd}`) || firstWord.endsWith(`/${cmd}`)) || isExeInWorkspace;

        if (!isSafe && !this._commandExecutionAllowed) {
            const choice = await vscode.window.showWarningMessage(
                `AI 想要执行命令：\n${command}\n\n是否允许？`,
                { modal: true },
                '允许本次',
                '总是允许（本次会话）',
                '拒绝'
            );
            if (choice === '拒绝' || !choice) {
                return '❌ 用户拒绝了命令执行';
            }
            if (choice === '总是允许（本次会话）') {
                this._commandExecutionAllowed = true;
            }
        }

        try {
            const { stdout, stderr } = await execAsync(command, {
                cwd: workspaceRoot,
                timeout: timeout * 1000,
                maxBuffer: 1024 * 1024,
                shell: 'cmd.exe'
            });
            const output = (stdout + stderr).trim();
            const maxLength = 2000;
            const truncated = output.length > maxLength 
                ? output.substring(0, maxLength) + '\n... [输出已截断]'
                : output;
            return `✅ 命令执行成功，退出码 0\n${truncated || '(无输出)'}`;
        } catch (err: any) {
            const stderr = err.stderr || '';
            const stdout = err.stdout || '';
            const exitCode = err.code || 'UNKNOWN';
            const output = (stdout + stderr).trim();
            const truncated = output.length > 2000 
                ? output.substring(0, 2000) + '\n... [输出已截断]'
                : output;
            return `❌ 命令执行失败，退出码 ${exitCode}\n${truncated}`;
        }
    }
}